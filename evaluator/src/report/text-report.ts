/**
 * Plain-text run report renderer. v0 deliverable per design §3.6.
 *
 * Designed to be human-skimmable in <30s and grep-friendly for CI logs.
 * Key sections: identity + status, metrics, oracle scoring, called skills,
 * RCA keyword hits/misses, error (if any).
 */

import type { RunReport } from "../types.js";

export function renderTextReport(r: RunReport): string {
  const lines: string[] = [];
  const sep = "─".repeat(72);

  lines.push(sep);
  lines.push(`EVAL RUN  ${r.runId}`);
  lines.push(`Case      ${r.caseId}`);
  lines.push(`Status    ${r.status}${r.error ? `  (${r.error})` : ""}`);
  lines.push(`Started   ${r.startedAt}`);
  lines.push(`Finished  ${r.finishedAt ?? "—"}`);
  lines.push(`Session   ${r.sessionId ?? "—"}`);
  lines.push(`Recovered ${r.recovered ? "yes" : "NO"}`);
  lines.push("");

  lines.push("METRICS");
  lines.push(`  TTL                 ${formatMs(r.metrics.ttl_ms)}`);
  lines.push(`  Agent steps         ${r.metrics.steps ?? "—"}`);
  lines.push(`  ~Output tokens      ${r.metrics.approx_output_tokens ?? "—"}`);
  lines.push(`  ~Input tokens       ${r.metrics.approx_input_tokens ?? "—"}`);
  lines.push("");

  if (r.score) {
    const s = r.score;
    lines.push("SCORE");
    lines.push(`  sufficiency         ${s.sufficiency.toFixed(4)}`);
    lines.push(`  necessity           ${s.necessity.toFixed(4)}`);
    lines.push(`  noise_ratio         ${s.noise_ratio.toFixed(4)}`);
    lines.push(`  skill_score         ${s.skill_score.toFixed(4)}`);
    lines.push("");
    lines.push("SKILLS");
    lines.push(`  used (${s.used_skills.length}):           ${formatList(s.used_skills)}`);
    if (s.missing_must_use.length > 0) {
      lines.push(`  MISSING must_use:   ${formatList(s.missing_must_use)}`);
    }
    if (s.forbidden_used.length > 0) {
      lines.push(`  FORBIDDEN used:     ${formatList(s.forbidden_used)}`);
    }
    if (s.noise_skills.length > 0) {
      lines.push(`  noise:              ${formatList(s.noise_skills)}`);
    }
    lines.push("");
    if (s.rca_hits.length + s.rca_misses.length > 0) {
      lines.push("RCA KEYWORDS");
      if (s.rca_hits.length > 0) lines.push(`  hit:                ${formatList(s.rca_hits)}`);
      if (s.rca_misses.length > 0) lines.push(`  MISS:               ${formatList(s.rca_misses)}`);
      lines.push("");
    }
    if (s.recommendation_hits.length + s.recommendation_misses.length > 0) {
      lines.push("RECOMMENDATION KEYWORDS");
      if (s.recommendation_hits.length > 0) lines.push(`  hit:                ${formatList(s.recommendation_hits)}`);
      if (s.recommendation_misses.length > 0) lines.push(`  MISS:               ${formatList(s.recommendation_misses)}`);
      lines.push("");
    }
  }

  if (r.trace) {
    lines.push("TRACE (chronological skill calls)");
    if (r.trace.skills.length === 0) {
      lines.push("  (no skill calls)");
    } else {
      for (const inv of r.trace.skills) {
        const dur = inv.durationMs != null ? `${inv.durationMs}ms` : "—";
        const argPart = inv.args ? ` ${truncate(inv.args, 60)}` : "";
        lines.push(`  [${inv.outcome.padEnd(7)}] ${inv.skill}/${inv.script ?? "?"}${argPart}  (${dur})`);
      }
    }
    lines.push("");
  }

  lines.push(sep);
  return lines.join("\n");
}

function formatMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatList(xs: string[]): string {
  if (xs.length === 0) return "(none)";
  return xs.join(", ");
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
