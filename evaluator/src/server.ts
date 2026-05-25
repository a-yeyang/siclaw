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
import type { SiclawClient } from "./siclaw-client.js";
import type { RunLog } from "./run-log.js";
import type { TraceDbWriter } from "./trace-db-writer.js";
import type { RunReport } from "./types.js";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

export interface ServerDeps {
  cases: CaseRegistry;
  engine: RunEngine;
  siclaw: SiclawClient;
  log: RunLog;
  traceDb: TraceDbWriter | null;
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
    if (method === "GET"    && (u.pathname === "/" || u.pathname === "/index.html")) return serveIndex(res);
    if (method === "POST"   && u.pathname === "/cases")    return uploadCase(req, res);
    if (method === "DELETE" && u.pathname.startsWith("/cases/")) return deleteCase(res, u);
    if (method === "POST"   && u.pathname === "/runs")     return startRun(req, res, u);
    if (method === "GET"    && u.pathname === "/runs")     return listRuns(res);
    if (method === "GET"    && u.pathname.startsWith("/runs/") && u.pathname.endsWith("/messages/stream"))
                                                           return streamRunMessages(req, res, u);
    if (method === "GET"    && u.pathname.startsWith("/runs/") && u.pathname.endsWith("/log/stream"))
                                                           return streamRunLog(req, res, u);
    if (method === "GET"    && u.pathname.startsWith("/runs/") && u.pathname.endsWith("/messages"))
                                                           return getRunMessages(res, u);
    if (method === "GET"    && u.pathname.startsWith("/runs/") && u.pathname.endsWith("/log"))
                                                           return getRunLog(res, u);
    if (method === "GET"    && u.pathname.startsWith("/runs/")) return getRun(req, res, u);
    if (method === "GET"    && u.pathname === "/metrics")  return getMetrics(res);
    if (method === "GET"    && u.pathname === "/cases")    return sendJson(res, 200, { cases: deps.cases.list() });
    if (method === "GET"    && u.pathname === "/agents")   return getAgents(res);
    if (method === "GET"    && u.pathname === "/healthz")  return sendJson(res, 200, { ok: true });
    sendJson(res, 404, { error: "not_found" });
  }

  function deleteCase(res: ServerResponse, u: URL): void {
    const id = decodeURIComponent(u.pathname.slice("/cases/".length));
    if (!id) { sendJson(res, 400, { error: "case id required" }); return; }
    const ok = deps.cases.delete(id);
    if (!ok) { sendJson(res, 404, { error: `unknown case "${id}"` }); return; }
    sendJson(res, 200, { deleted: id });
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
    const agentOverride = u.searchParams.get("agent") ?? undefined;

    // Queue this run after any in-flight one so injector state never overlaps.
    let resolveDone: () => void = () => {};
    const done = new Promise<void>((r) => { resolveDone = r; });
    const placeholder: RunReport = {
      runId: "(pending)",
      caseId,
      agentId: agentOverride ?? c.trigger.agent,
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
    deps.log.append(placeholder.runId, `Case ${c.id} queued (agent: ${agentOverride ?? c.trigger.agent})`);

    serial = serial.then(async () => {
      try {
        // Pass placeholder so engine mutates it in real-time (sessionId, status visible
        // to SSE streams while the run is still in flight).
        await deps.engine.runCase(c, agentOverride, placeholder);
        // placeholder.runId is now the real UUID; register under it too.
        runs.set(placeholder.runId, { report: placeholder, done });
      } catch (err) {
        if (!placeholder.finishedAt) {
          placeholder.status = "failed";
          placeholder.error = err instanceof Error ? err.message : String(err);
          placeholder.finishedAt = new Date().toISOString();
        }
      } finally {
        resolveDone();
        // Persist completed run to trace DB (non-blocking, errors are swallowed).
        if (deps.traceDb && placeholder.finishedAt) {
          deps.traceDb.write(placeholder).catch(() => {});
        }
      }
    });
    // Register placeholder under a temporary id so the caller can poll. The
    // ID is rewritten to the engine's runId once runCase resolves.
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    placeholder.runId = tempId;
    runs.set(tempId, { report: placeholder, done });

    // Watch for the engine assigning a real UUID and register it immediately.
    // This prevents SSE message/log streams from 404-ing between ID assignment
    // and runCase() returning (which can be minutes later).
    const watchId = setInterval(() => {
      if (placeholder.runId !== tempId && !runs.has(placeholder.runId)) {
        runs.set(placeholder.runId, { report: placeholder, done });
      }
      if (placeholder.finishedAt) clearInterval(watchId);
    }, 100);

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

  async function getAgents(res: ServerResponse): Promise<void> {
    try {
      const body = await deps.siclaw.listAgents();
      sendJson(res, 200, body);
    } catch (err) {
      sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  function getRunLog(res: ServerResponse, u: URL): void {
    // URL: /runs/:id/log
    const id = u.pathname.slice("/runs/".length, -"/log".length);
    sendJson(res, 200, { entries: deps.log.get(id) });
  }

  async function getRunMessages(res: ServerResponse, u: URL): Promise<void> {
    // URL format: /runs/:id/messages
    const mid = u.pathname.slice("/runs/".length, -"/messages".length);
    const rec = runs.get(mid);
    if (!rec) { sendJson(res, 404, { error: "not_found" }); return; }
    const { sessionId, agentId } = rec.report;
    if (!sessionId || !agentId) { sendJson(res, 200, { data: [], total: 0 }); return; }
    const page = parseInt(u.searchParams.get("page") ?? "1", 10);
    const pageSize = parseInt(u.searchParams.get("page_size") ?? "200", 10);
    try {
      const body = await deps.siclaw.getSessionMessages(agentId, sessionId, page, pageSize);
      sendJson(res, 200, body);
    } catch (err) {
      sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
    }
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

  /** SSE: stream Portal messages for a run in real-time. */
  async function streamRunMessages(req: IncomingMessage, res: ServerResponse, u: URL): Promise<void> {
    const mid = u.pathname.slice("/runs/".length, -"/messages/stream".length);
    const rec = runs.get(mid);
    if (!rec) { sendJson(res, 404, { error: "not_found" }); return; }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(": ping\n\n");
    let sentCount = 0, closed = false;
    req.on("close", () => { closed = true; clearInterval(iv); });
    const iv = setInterval(async () => {
      if (closed) return;
      try {
        const { sessionId, agentId } = rec.report;
        if (sessionId && agentId) {
          const body = await deps.siclaw.getSessionMessages(agentId, sessionId, 1, 200);
          const msgs = ((body as Record<string, unknown[]>).data ??
            (body as Record<string, unknown[]>).messages ?? []) as unknown[];
          for (let i = sentCount; i < msgs.length; i++) {
            if (!closed) res.write(`data: ${JSON.stringify(msgs[i])}\n\n`);
          }
          sentCount = msgs.length;
        }
      } catch { /* Portal blip — skip */ }
      if (rec.report.finishedAt && !closed) {
        closed = true; clearInterval(iv);
        res.write("event: done\ndata: {}\n\n");
        res.end();
      }
    }, 500);
  }

  /** SSE: stream evaluator run-log entries in real-time. */
  function streamRunLog(req: IncomingMessage, res: ServerResponse, u: URL): void {
    const requestedId = u.pathname.slice("/runs/".length, -"/log/stream".length);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(": ping\n\n");
    let sentCount = 0, closed = false;
    req.on("close", () => { closed = true; clearInterval(iv); });
    const iv = setInterval(() => {
      if (closed) return;
      const rec = runs.get(requestedId);
      const actualId = rec?.report.runId;
      // Merge entries from tempId + real UUID (handles pending→UUID transition).
      const entries = [
        ...deps.log.get(requestedId),
        ...(actualId && actualId !== requestedId ? deps.log.get(actualId) : []),
      ].sort((a, b) => (a.ts < b.ts ? -1 : 1));
      for (let i = sentCount; i < entries.length; i++) {
        if (!closed) res.write(`data: ${JSON.stringify(entries[i])}\n\n`);
      }
      sentCount = entries.length;
      if (rec?.report.finishedAt && !closed) {
        closed = true; clearInterval(iv);
        res.write("event: done\ndata: {}\n\n");
        res.end();
      }
    }, 200);
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
