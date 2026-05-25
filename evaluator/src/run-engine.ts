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

import { randomUUID } from "node:crypto";
import { ChatTraceReader } from "./chat-trace-reader.js";
import { score } from "./evaluator/deterministic.js";
import type { InjectorRegistry } from "./injectors/registry.js";
import { buildEvalPrompt, type SiclawClient } from "./siclaw-client.js";
import type { Case, RunReport, RunStatus } from "./types.js";

export interface RunEngineDeps {
  injectors: InjectorRegistry;
  siclaw: SiclawClient;
  traceReader: ChatTraceReader;
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

    const binding = this.deps.injectors.resolve(c.fault.injector);
    const overallStart = Date.now();
    const budgetMs = c.budget.ttl_sec * 1000;
    const ac = new AbortController();
    const budgetTimer = setTimeout(() => ac.abort(), budgetMs);
    let injected = false;

    try {
      // 1. inject
      report.status = "injecting";
      await binding.injector.inject(binding.faultType, c.fault.params);
      injected = true;

      // 2. wait propagation
      report.status = "waiting_propagation";
      await sleepWithAbort(c.fault.propagation_wait_sec * 1000, ac.signal);

      // 3. trigger siclaw
      report.status = "triggering";
      const sessionId = await this.deps.siclaw.createSession(
        agentId,
        `[EVAL] ${c.id}/${runId.slice(0, 8)}`,
      );
      report.sessionId = sessionId;

      const prompt = buildEvalPrompt(c.id, runId, c.trigger.prompt);
      report.status = "running_agent";
      const sendStart = Date.now();
      await this.deps.siclaw.sendAndWait({
        agentId,
        sessionId,
        text: prompt,
        signal: ac.signal,
      });
      const ttlMs = Date.now() - sendStart;

      // 4. read trace
      report.status = "evaluating";
      const trace = await this.deps.traceReader.read(agentId, sessionId);
      report.trace = trace;
      report.metrics = {
        ttl_ms: ttlMs,
        steps: trace.assistantSteps,
        approx_output_tokens: trace.approxOutputTokens,
        approx_input_tokens: trace.approxInputTokens,
      };

      // 5. score
      report.score = score(trace, c.oracle);
      report.status = "completed";
    } catch (err) {
      report.status = inferFailureStatus(err, ac.signal);
      report.error = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(budgetTimer);
      // 6. recover — unconditional. Errors here are folded into `error` but
      // don't override an earlier failure reason.
      if (injected) {
        try {
          report.status = report.status === "completed" ? "recovering" : report.status;
          await binding.injector.recover(binding.faultType, c.fault.params);
          report.recovered = true;
          if (report.status === "recovering") report.status = "completed";
        } catch (rerr) {
          const msg = rerr instanceof Error ? rerr.message : String(rerr);
          report.error = report.error ? `${report.error}; recover: ${msg}` : `recover: ${msg}`;
          if (report.status === "completed" || report.status === "recovering") {
            report.status = "failed";
          }
        }
      }
      report.finishedAt = new Date().toISOString();
      // Bookkeeping: if metrics were never set but we have an obvious total,
      // surface the wall-clock so the report is still useful on a failed run.
      if (report.metrics.ttl_ms == null) {
        report.metrics.ttl_ms = Date.now() - overallStart;
      }
    }
    return report;
  }
}

function inferFailureStatus(err: unknown, signal: AbortSignal): RunStatus {
  if (signal.aborted) return "timed_out";
  if (err instanceof Error && err.name === "AbortError") return "timed_out";
  return "failed";
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
