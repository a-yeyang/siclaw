/**
 * Skill metrics bridge — Gateway-only DB sink for skill call telemetry.
 *
 * Lives in a separate file from `metrics-aggregator.ts` on purpose: the
 * aggregator is compiled into the AgentBox image (see Dockerfile.agentbox)
 * which deliberately excludes Portal-DB code (`db.ts` / `dialect-helpers.ts`)
 * because pods must not touch the Portal DB directly. Putting any DB import
 * into the aggregator file would break the AgentBox build.
 *
 * Two write paths, mirroring the two runtime topologies:
 *   - Local mode: `startSkillEventBusBridge()` subscribes to the in-process
 *     diagnostic bus and persists full-fidelity rows (skill_call fires here).
 *   - K8s   mode: `persistSkillDelta()` is registered as the aggregator's
 *     `onSkillDelta` callback; called once per merged delta on every 30s pull.
 */

import { onDiagnostic } from "../shared/diagnostic-events.js";
import type { SkillCallStats } from "../shared/metrics-types.js";
import { recordSkillCallEvent, recordSkillCallDelta } from "./skill-metrics-store.js";

let busSubscribed = false;

/**
 * Register the in-process subscription that persists raw skill_call events.
 * Idempotent — safe to call multiple times during boot. No-op in K8s mode
 * because skill_call events fire inside AgentBox pods, not in this process.
 */
export function startSkillEventBusBridge(): void {
  if (busSubscribed) return;
  busSubscribed = true;
  onDiagnostic((event) => {
    if (event.type !== "skill_call") return;
    recordSkillCallEvent({
      skillName: event.skillName,
      scriptName: event.scriptName ?? null,
      scope: event.scope,
      outcome: event.outcome,
      durationMs: event.durationMs,
      sessionId: event.sessionId ?? null,
      userId: event.userId,
      agentId: event.agentId,
    }).catch((err: unknown) => console.warn("[skill-metrics-bridge] event persist failed:", err));
  });
}

/**
 * K8s callback wired into `MetricsAggregator(onSkillDelta=...)`. Persists the
 * aggregated counts (no raw row, no session/message granularity) every 30s.
 */
export function persistSkillDelta(delta: SkillCallStats): void {
  recordSkillCallDelta({
    skillName: delta.skillName,
    scope: delta.scope,
    success: delta.success,
    error: delta.error,
    avgDurationMs: delta.avgDurationMs,
  }).catch((err: unknown) => console.warn("[skill-metrics-bridge] delta persist failed:", err));
}
