/**
 * Minimal HTTP server exposing the design §3.5 surface:
 *
 *   POST /cases               — upload one case (YAML in body)
 *   POST /runs?case=<id>      — kick off a run; responds 202 + runId
 *   GET  /runs/:id            — fetch report (JSON), or `?format=text`
 *   GET  /metrics             — per-case / per-skill rollups
 *
 * Single-process, in-memory state. Concurrency=1 — runs queue serially.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CaseValidationError, loadCaseFromYaml } from "./case-loader.js";
import type { CaseRegistry } from "./case-registry.js";
import type { RunEngine } from "./run-engine.js";
import { renderTextReport } from "./report/text-report.js";
import type { RunReport } from "./types.js";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

export interface ServerDeps {
  cases: CaseRegistry;
  engine: RunEngine;
  port: number;
}

interface RunRecord {
  report: RunReport;
  /** Resolves when the engine.runCase() promise settles. */
  done: Promise<void>;
}

export function startServer(deps: ServerDeps): { close: () => Promise<void> } {
  const runs = new Map<string, RunRecord>();
  let serial: Promise<void> = Promise.resolve();

  const server = createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      console.error("[evaluator-server] unhandled:", err);
      if (!res.headersSent) sendJson(res, 500, { error: "internal" });
    }
  });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { method = "GET", url = "/" } = req;
    const u = new URL(url, "http://localhost");
    if (method === "GET"  && (u.pathname === "/" || u.pathname === "/index.html")) return serveIndex(res);
    if (method === "POST" && u.pathname === "/cases") return uploadCase(req, res);
    if (method === "POST" && u.pathname === "/runs") return startRun(req, res, u);
    if (method === "GET"  && u.pathname === "/runs") return listRuns(res);
    if (method === "GET"  && u.pathname.startsWith("/runs/")) return getRun(req, res, u);
    if (method === "GET"  && u.pathname === "/metrics") return getMetrics(res);
    if (method === "GET"  && u.pathname === "/cases") return sendJson(res, 200, { cases: deps.cases.list() });
    if (method === "GET"  && u.pathname === "/healthz") return sendJson(res, 200, { ok: true });
    sendJson(res, 404, { error: "not_found" });
  }

  async function uploadCase(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);
    try {
      const c = loadCaseFromYaml(body);
      deps.cases.upsert(c);
      sendJson(res, 201, { id: c.id, title: c.title });
    } catch (err) {
      if (err instanceof CaseValidationError) {
        sendJson(res, 400, { error: err.message });
        return;
      }
      throw err;
    }
  }

  function startRun(_req: IncomingMessage, res: ServerResponse, u: URL): void {
    const caseId = u.searchParams.get("case");
    if (!caseId) { sendJson(res, 400, { error: "case= query param required" }); return; }
    const c = deps.cases.get(caseId);
    if (!c) { sendJson(res, 404, { error: `unknown case "${caseId}"` }); return; }

    // Queue this run after any in-flight one so injector state never overlaps.
    let resolveDone: () => void = () => {};
    const done = new Promise<void>((r) => { resolveDone = r; });
    const placeholder: RunReport = {
      runId: "(pending)",
      caseId,
      status: "queued",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      sessionId: null,
      trace: null,
      score: null,
      metrics: { ttl_ms: null, steps: null, approx_output_tokens: null, approx_input_tokens: null },
      error: null,
      recovered: false,
    };
    serial = serial.then(async () => {
      try {
        const r = await deps.engine.runCase(c);
        placeholder.runId = r.runId;
        Object.assign(placeholder, r);
        // Remap key under the real runId so /runs/:id resolves both before and after.
        runs.set(r.runId, { report: placeholder, done });
      } catch (err) {
        placeholder.status = "failed";
        placeholder.error = err instanceof Error ? err.message : String(err);
        placeholder.finishedAt = new Date().toISOString();
      } finally {
        resolveDone();
      }
    });
    // Register placeholder under a temporary id so the caller can poll. The
    // ID is rewritten to the engine's runId once runCase resolves.
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    placeholder.runId = tempId;
    runs.set(tempId, { report: placeholder, done });
    sendJson(res, 202, { runId: tempId, status: "queued" });
  }

  function getRun(_req: IncomingMessage, res: ServerResponse, u: URL): void {
    const id = u.pathname.slice("/runs/".length);
    const rec = runs.get(id);
    if (!rec) { sendJson(res, 404, { error: "not_found" }); return; }
    if (u.searchParams.get("format") === "text") {
      const body = renderTextReport(rec.report);
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(body);
      return;
    }
    sendJson(res, 200, rec.report);
  }

  function getMetrics(res: ServerResponse): void {
    sendJson(res, 200, computeRollups([...runs.values()].map((r) => r.report)));
  }

  function listRuns(res: ServerResponse): void {
    const list = [...runs.values()].map((r) => r.report);
    list.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    sendJson(res, 200, { runs: list });
  }

  async function serveIndex(res: ServerResponse): Promise<void> {
    try {
      const html = await readFile(join(PUBLIC_DIR, "index.html"), "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      sendJson(res, 404, { error: "frontend not found — public/index.html missing" });
    }
  }

  server.listen(deps.port, () => {
    console.log(`[evaluator] listening on :${deps.port}`);
  });

  return {
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

interface RollupResponse {
  totalRuns: number;
  byCase: Record<string, { runs: number; lastSkillScore: number | null }>;
  bySkill: Record<string, { invocations: number; success: number; error: number }>;
}

function computeRollups(reports: RunReport[]): RollupResponse {
  const byCase: RollupResponse["byCase"] = {};
  const bySkill: RollupResponse["bySkill"] = {};
  for (const r of reports) {
    const slot = byCase[r.caseId] ?? { runs: 0, lastSkillScore: null };
    slot.runs += 1;
    if (r.score) slot.lastSkillScore = r.score.skill_score;
    byCase[r.caseId] = slot;
    if (r.trace) {
      for (const inv of r.trace.skills) {
        const s = bySkill[inv.skill] ?? { invocations: 0, success: 0, error: 0 };
        s.invocations += 1;
        if (inv.outcome === "success") s.success += 1;
        else if (inv.outcome === "error") s.error += 1;
        bySkill[inv.skill] = s;
      }
    }
  }
  return { totalRuns: reports.length, byCase, bySkill };
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}
