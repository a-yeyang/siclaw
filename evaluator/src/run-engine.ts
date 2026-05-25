/**
 * Run engine — orchestrates one case execution end-to-end. Concurrency=1 in v0
 * (no shared injector state across runs anyway, but kept simple).
 *
 * Lifecycle, with hard try/finally so `recover_*` always runs:
 *   1. inject       → state="injecting"
 *   2. propagate    → state="waiting_propagation"  (sleep)
 *   3. trigger      → state="triggering"  → "running_agent"
 *   4. read trace   → state="evaluating"
 *   5. score        → fold into report
 *   6. recover      → state="recovering"  → "completed" | "failed" | "timed_out"
 *
 * The whole pipeline is bounded by `budget.ttl_sec`. If it trips, recovery
 * still runs; the report is marked `timed_out` with whatever trace exists.
 */

import { exec } from "node:child_process";
import { randomUUID } from "node:crypto";
import { ChatTraceReader } from "./chat-trace-reader.js";
import { score } from "./evaluator/deterministic.js";
import { buildEvalPrompt, type SiclawClient } from "./siclaw-client.js";
import type { RunLog } from "./run-log.js";
import type { Case, RunReport, RunStatus } from "./types.js";

export interface RunEngineDeps {
  siclaw: SiclawClient;
  traceReader: ChatTraceReader;
  log: RunLog;
}

export class RunEngine {
  constructor(private readonly deps: RunEngineDeps) {}

  async runCase(c: Case, agentOverride?: string): Promise<RunReport> {
    const agentId = agentOverride ?? c.trigger.agent;
    const runId = randomUUID();
    const report: RunReport = {
      runId,
      caseId: c.id,
      agentId,
      status: "queued",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      sessionId: null,
      trace: null,
      score: null,
      metrics: {
        ttl_ms: null,
        steps: null,
        approx_output_tokens: null,
        approx_input_tokens: null,
      },
      error: null,
      recovered: false,
    };

    const overallStart = Date.now();
    const budgetMs = c.budget.ttl_sec * 1000;
    const ac = new AbortController();
    const budgetTimer = setTimeout(() => ac.abort(), budgetMs);
    let injected = false;

    const log = this.deps.log;

    try {
      // 1. inject
      report.status = "injecting";
      log.append(runId, `Injecting fault — cmd: ${c.fault.inject.trim().split("\n")[0]}…`);
      await runShell(c.fault.inject, log, runId, ac.signal);
      injected = true;
      log.append(runId, `Fault injected successfully`);

      // 2. wait propagation
      report.status = "waiting_propagation";
      log.append(runId, `Waiting ${c.fault.propagation_wait_sec}s for fault to propagate…`);
      await sleepWithAbort(c.fault.propagation_wait_sec * 1000, ac.signal);
      log.append(runId, `Propagation wait complete`);

      // 3. trigger siclaw
      report.status = "triggering";
      log.append(runId, `Creating siclaw session (agent: ${agentId})`);
      const sessionId = await this.deps.siclaw.createSession(
        agentId,
        `[EVAL] ${c.id}/${runId.slice(0, 8)}`,
      );
      report.sessionId = sessionId;
      log.append(runId, `Session created: ${sessionId}`);

      const prompt = buildEvalPrompt(c.id, runId, c.trigger.prompt);
      report.status = "running_agent";
      log.append(runId, `Sending prompt to agent…`);
      const sendStart = Date.now();
      await this.deps.siclaw.sendAndWait({
        agentId,
        sessionId,
        text: prompt,
        signal: ac.signal,
      });
      const ttlMs = Date.now() - sendStart;
      log.append(runId, `Agent finished in ${(ttlMs / 1000).toFixed(1)}s`);

      // 4. read trace
      report.status = "evaluating";
      log.append(runId, `Reading chat trace from Portal…`);
      const trace = await this.deps.traceReader.read(agentId, sessionId);
      log.append(runId, `Trace: ${trace.assistantSteps} steps, ${trace.skills.length} skill calls`);
      report.trace = trace;
      report.metrics = {
        ttl_ms: ttlMs,
        steps: trace.assistantSteps,
        approx_output_tokens: trace.approxOutputTokens,
        approx_input_tokens: trace.approxInputTokens,
      };

      // 5. score
      report.score = score(trace, c.oracle);
      const sc = report.score;
      log.append(runId, `Score: skill=${sc.skill_score.toFixed(4)} sufficiency=${sc.sufficiency.toFixed(4)} necessity=${sc.necessity.toFixed(4)} noise=${sc.noise_ratio.toFixed(4)}`);
      report.status = "completed";
    } catch (err) {
      report.status = inferFailureStatus(err, ac.signal);
      report.error = err instanceof Error ? err.message : String(err);
      log.append(runId, `Run failed: ${report.error}`, "error");
    } finally {
      clearTimeout(budgetTimer);
      // 6. recover — unconditional. Errors here are folded into `error` but
      // don't override an earlier failure reason.
      if (injected) {
        try {
          report.status = report.status === "completed" ? "recovering" : report.status;
          log.append(runId, `Recovering fault — cmd: ${c.fault.recover.trim().split("\n")[0]}…`);
          await runShell(c.fault.recover, log, runId, ac.signal);
          report.recovered = true;
          log.append(runId, `Fault recovered — test environment cleaned up`);
          if (report.status === "recovering") report.status = "completed";
        } catch (rerr) {
          const msg = rerr instanceof Error ? rerr.message : String(rerr);
          report.error = report.error ? `${report.error}; recover: ${msg}` : `recover: ${msg}`;
          log.append(runId, `Recovery failed: ${msg}`, "error");
          if (report.status === "completed" || report.status === "recovering") {
            report.status = "failed";
          }
        }
      }
      report.finishedAt = new Date().toISOString();
      if (report.metrics.ttl_ms == null) {
        report.metrics.ttl_ms = Date.now() - overallStart;
      }
      log.append(runId, `Run finished — status: ${report.status}`);
    }
    return report;
  }
}

function inferFailureStatus(err: unknown, signal: AbortSignal): RunStatus {
  if (signal.aborted) return "timed_out";
  if (err instanceof Error && err.name === "AbortError") return "timed_out";
  return "failed";
}

/** Execute a shell command, streaming stdout/stderr into the run log. */
async function runShell(cmd: string, log: RunLog, runId: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error("aborted");
  await new Promise<void>((resolve, reject) => {
    const child = exec(cmd, { shell: "/bin/sh" }, (err, stdout, stderr) => {
      if (stdout.trim()) log.append(runId, `[cmd] ${stdout.trim()}`);
      if (stderr.trim()) log.append(runId, `[cmd stderr] ${stderr.trim()}`, "warn");
      if (err) reject(new Error(`command failed (exit ${err.code ?? "?"}): ${err.message}`));
      else resolve();
    });
    function onAbort(): void {
      child.kill();
      reject(new Error("aborted"));
    }
    signal.addEventListener("abort", onAbort, { once: true });
    child.on("close", () => signal.removeEventListener("abort", onAbort));
  });
}

async function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (signal.aborted) throw new Error("aborted");
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(t);
      reject(new Error("aborted"));
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
