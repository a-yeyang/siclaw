/**
 * Writes completed eval run reports to the shared siclaw_traces MySQL DB.
 * Uses the agent_traces table so eval runs appear alongside runtime traces.
 *
 * Connection is opened per-write (runs are infrequent and serial).
 * Silently swallows errors — a DB write failure must never fail a run report.
 */

import { createConnection } from "mysql2/promise";
import type { RunReport } from "./types.js";

export class TraceDbWriter {
  constructor(private readonly url: string) {}

  async write(report: RunReport): Promise<void> {
    let conn;
    try {
      conn = await createConnection(this.url);
      const bodyJson = JSON.stringify(report);
      const now = report.finishedAt ?? report.startedAt;
      const durationMs = report.metrics.ttl_ms ?? 0;
      const skillScore = report.score?.skill_score ?? null;
      await conn.execute(
        `INSERT INTO agent_traces
           (trace_key, session_id, prompt_idx,
            user_id, username,
            mode, outcome,
            started_at, ended_at, duration_ms,
            step_count, tool_call_count,
            schema_version, body_json, body_bytes, created_at,
            is_injected_prompt, trace_summary)
         VALUES (?, ?, 0, ?, ?, 'eval', ?, ?, ?, ?, ?, ?, '1', ?, ?, ?, 'eval', ?)
         ON DUPLICATE KEY UPDATE
           outcome        = VALUES(outcome),
           ended_at       = VALUES(ended_at),
           duration_ms    = VALUES(duration_ms),
           step_count     = VALUES(step_count),
           tool_call_count= VALUES(tool_call_count),
           body_json      = VALUES(body_json),
           body_bytes     = VALUES(body_bytes),
           trace_summary  = VALUES(trace_summary)`,
        [
          report.runId,
          report.sessionId ?? report.runId,
          report.caseId,
          report.caseId,
          report.status,
          report.startedAt,
          now,
          durationMs,
          report.metrics.steps ?? 0,
          report.trace?.skills.length ?? 0,
          bodyJson,
          Buffer.byteLength(bodyJson),
          now,
          skillScore != null ? `skill_score=${skillScore.toFixed(4)}` : null,
        ],
      );
    } catch (err) {
      console.error("[evaluator] trace-db write failed:", err instanceof Error ? err.message : err);
    } finally {
      try { await conn?.end(); } catch { /* noop */ }
    }
  }
}
