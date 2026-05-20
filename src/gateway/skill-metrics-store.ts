/**
 * Skill usage telemetry store — durable persistence + dashboard queries.
 *
 * Backs the skill frequency/quality dashboard. Writes the three tables defined
 * in `migrate.ts` (skill_call_events / skill_usage_daily / skill_stats) and
 * exposes the read paths consumed by the Portal `/metrics/skills` endpoint.
 *
 * Design contract (see docs discussion): dashboard queries operate ONLY on the
 * bounded rollup/stats tables (and the bounded `skills` catalogue). The raw
 * `skill_call_events` table is never aggregated for the dashboard — it serves
 * the per-message audit drill-down and acts as the recomputable source of truth.
 *
 * Two write entry points, one per runtime topology:
 *   - recordSkillCallEvent()  — full fidelity, Local mode (in-process event bus).
 *   - recordSkillCallDelta()  — aggregated counts, K8s mode (30s snapshot merge;
 *                               no raw event / session / message granularity).
 */

import crypto from "node:crypto";
import { getDb, type Db } from "./db.js";
import { buildUpsert, toSqlTimestamp, type UpdateColumn } from "./dialect-helpers.js";

export type SkillScope = "builtin" | "global";

/** UTC day bucket (YYYY-MM-DD), accepted as-is by both MySQL DATE and SQLite. */
function dayBucket(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** `col = col + incoming` increment expression, dialect-correct. */
function incr(db: Db, col: string): UpdateColumn {
  const rhs = db.driver === "mysql" ? `VALUES(\`${col}\`)` : `excluded.\`${col}\``;
  return { col, expr: `\`${col}\` + ${rhs}` };
}

/** Upsert the per-(skill, day) rollup row, accumulating counts. */
async function upsertDaily(
  db: Db,
  skillName: string,
  scope: SkillScope,
  day: string,
  calls: number,
  errors: number,
  totalDurationMs: number,
): Promise<void> {
  const { sql, params } = buildUpsert(
    db,
    "skill_usage_daily",
    ["skill_name", "day", "scope", "call_count", "error_count", "total_duration_ms"],
    [skillName, day, scope, calls, errors, totalDurationMs],
    ["skill_name", "day"],
    [incr(db, "call_count"), incr(db, "error_count"), incr(db, "total_duration_ms")],
  );
  await db.query(sql, params);
}

/** Upsert the per-skill lifetime summary row. */
async function upsertStats(
  db: Db,
  skillName: string,
  calls: number,
  errors: number,
  lastCalledAt: Date,
): Promise<void> {
  const { sql, params } = buildUpsert(
    db,
    "skill_stats",
    ["skill_name", "total_calls", "error_calls", "last_called_at"],
    [skillName, calls, errors, toSqlTimestamp(lastCalledAt)],
    ["skill_name"],
    [incr(db, "total_calls"), incr(db, "error_calls"), "last_called_at"],
  );
  await db.query(sql, params);
}

export interface SkillCallRecord {
  skillName: string;
  scriptName: string | null;
  scope: SkillScope;
  outcome: "success" | "error";
  durationMs: number;
  sessionId?: string | null;
  /** The user message that triggered this call. Null until message-id threading lands. */
  messageId?: string | null;
  userId: string;
  agentId: string | null;
}

/**
 * Full-fidelity record of a single skill call (Local / in-process mode).
 * Writes the raw event row AND increments the rollup + stats tables.
 */
export async function recordSkillCallEvent(ev: SkillCallRecord, db: Db = getDb()): Promise<void> {
  const now = new Date();
  const errors = ev.outcome === "error" ? 1 : 0;

  await db.query(
    `INSERT INTO skill_call_events
       (id, session_id, message_id, skill_name, script_name, scope, outcome, duration_ms, user_id, agent_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      ev.sessionId ?? null,
      ev.messageId ?? null,
      ev.skillName,
      ev.scriptName,
      ev.scope,
      ev.outcome,
      ev.durationMs,
      ev.userId,
      ev.agentId,
    ],
  );

  await upsertDaily(db, ev.skillName, ev.scope, dayBucket(now), 1, errors, ev.durationMs);
  await upsertStats(db, ev.skillName, 1, errors, now);
}

export interface SkillCallDelta {
  skillName: string;
  scope: SkillScope;
  /** success + error count accumulated since the last snapshot export. */
  success: number;
  error: number;
  /** mean duration over (success + error) calls in this delta. */
  avgDurationMs: number;
}

/**
 * Aggregated-count record (K8s mode). Snapshot deltas reaching the Gateway have
 * already lost per-call detail (no raw event, session, or message), so this only
 * increments the rollup + stats tables — enough for the frequency dashboard.
 */
export async function recordSkillCallDelta(delta: SkillCallDelta, db: Db = getDb()): Promise<void> {
  const total = delta.success + delta.error;
  if (total <= 0) return;
  const now = new Date();
  await upsertDaily(
    db,
    delta.skillName,
    delta.scope,
    dayBucket(now),
    total,
    delta.error,
    Math.round(delta.avgDurationMs * total),
  );
  await upsertStats(db, delta.skillName, total, delta.error, now);
}

// ── Dashboard read paths (bounded tables only) ──

export interface SkillUsageRow {
  skillName: string;
  scope: SkillScope | null;
  calls: number;
  errors: number;
  errorRate: number;
  avgDurationMs: number;
  lastCalledAt: string | null;
}

function toIso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  // SQLite returns the stored "YYYY-MM-DD HH:MM:SS" string.
  return String(v);
}

/** Top-N most-used skills in [fromDay, toDay]. Scans the bounded rollup only. */
export async function queryTopSkills(
  fromDay: string,
  toDay: string,
  limit: number,
  db: Db = getDb(),
): Promise<SkillUsageRow[]> {
  const [rows] = await db.query<any[]>(
    `SELECT skill_name AS skillName, MAX(scope) AS scope,
            SUM(call_count) AS calls, SUM(error_count) AS errors,
            SUM(total_duration_ms) AS totalDurationMs
     FROM skill_usage_daily
     WHERE day BETWEEN ? AND ?
     GROUP BY skill_name
     ORDER BY calls DESC
     LIMIT ?`,
    [fromDay, toDay, limit],
  );
  return rows.map(mapAggRow);
}

/**
 * Bottom-N least-used skills in [fromDay, toDay], INCLUDING zero-usage skills.
 * Driven by the full `skills` catalogue (bounded) LEFT JOINed onto the rollup —
 * skills with no rollup rows surface with calls=0.
 */
export async function queryBottomSkills(
  fromDay: string,
  toDay: string,
  limit: number,
  db: Db = getDb(),
): Promise<SkillUsageRow[]> {
  const [rows] = await db.query<any[]>(
    `SELECT s.name AS skillName,
            COALESCE(SUM(d.call_count), 0) AS calls,
            COALESCE(SUM(d.error_count), 0) AS errors,
            COALESCE(SUM(d.total_duration_ms), 0) AS totalDurationMs
     FROM skills s
     LEFT JOIN skill_usage_daily d
       ON d.skill_name = s.name AND d.day BETWEEN ? AND ?
     GROUP BY s.name
     ORDER BY calls ASC
     LIMIT ?`,
    [fromDay, toDay, limit],
  );
  return rows.map(mapAggRow);
}

/**
 * Skills ranked by least-recently-used (lifetime). Never-invoked skills
 * (last_called_at NULL) sort first under both MySQL and SQLite ASC ordering.
 */
export async function queryNeverUsedSkills(limit: number, db: Db = getDb()): Promise<SkillUsageRow[]> {
  const [rows] = await db.query<any[]>(
    `SELECT s.name AS skillName,
            COALESCE(st.total_calls, 0) AS calls,
            COALESCE(st.error_calls, 0) AS errors,
            st.last_called_at AS lastCalledAt
     FROM skills s
     LEFT JOIN skill_stats st ON st.skill_name = s.name
     GROUP BY s.name
     ORDER BY lastCalledAt ASC
     LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({
    skillName: String(r.skillName),
    scope: null,
    calls: Number(r.calls ?? 0),
    errors: Number(r.errors ?? 0),
    errorRate: rate(Number(r.errors ?? 0), Number(r.calls ?? 0)),
    avgDurationMs: 0,
    lastCalledAt: toIso(r.lastCalledAt),
  }));
}

function rate(errors: number, calls: number): number {
  return calls > 0 ? Math.round((errors / calls) * 1000) / 1000 : 0;
}

function mapAggRow(r: any): SkillUsageRow {
  const calls = Number(r.calls ?? 0);
  const errors = Number(r.errors ?? 0);
  const totalDurationMs = Number(r.totalDurationMs ?? 0);
  return {
    skillName: String(r.skillName),
    scope: (r.scope ?? null) as SkillScope | null,
    calls,
    errors,
    errorRate: rate(errors, calls),
    avgDurationMs: calls > 0 ? Math.round(totalDurationMs / calls) : 0,
    lastCalledAt: null,
  };
}
