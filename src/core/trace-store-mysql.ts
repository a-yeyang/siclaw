/**
 * MysqlTraceStore — `TraceStore` backed by a MySQL server (mysql2/promise).
 *
 * Intended for production / K8s use — a trace-mysql StatefulSet with a PVC
 * survives pod restarts (solves the SQLite "pod ephemeral → data lost" gap).
 *
 * Schema is kept functionally identical to the SQLite variant (same column
 * names / semantics). Differences dictated by MySQL dialect:
 *   - BIGINT AUTO_INCREMENT PRIMARY KEY   (vs INTEGER PRIMARY KEY AUTOINCREMENT)
 *   - LONGTEXT for body_json / user_message (up to 4 GB)
 *   - VARCHAR(32) for Beijing-time strings (zero-padded, known length)
 *   - schema_migrations table (MySQL has no PRAGMA user_version)
 *   - INSERT ... ON DUPLICATE KEY UPDATE ...  (vs ON CONFLICT DO UPDATE)
 */

import mysql from "mysql2/promise";
import type {
  TraceStore,
  TraceRow,
  TraceListOpts,
  TraceListResult,
  TraceRecord,
} from "./trace-store-types.js";

const SCHEMA_VERSION = 4;

const DDL_V4_TABLE = `
  CREATE TABLE IF NOT EXISTS agent_traces (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    trace_key           VARCHAR(255) NOT NULL,
    session_id          VARCHAR(255) NOT NULL,
    prompt_idx          INT NOT NULL,
    user_id             VARCHAR(255),
    username            VARCHAR(255),
    mode                VARCHAR(64) NOT NULL,
    brain_type          VARCHAR(64),
    model_name          VARCHAR(255),
    user_message        LONGTEXT,
    outcome             VARCHAR(32) NOT NULL,
    started_at          VARCHAR(32) NOT NULL,
    ended_at            VARCHAR(32) NOT NULL,
    duration_ms         BIGINT NOT NULL,
    step_count          INT NOT NULL DEFAULT 0,
    tool_call_count     INT NOT NULL DEFAULT 0,
    tokens_total        BIGINT,
    cost_usd            DOUBLE,
    schema_version      VARCHAR(16) NOT NULL,
    body_json           LONGTEXT NOT NULL,
    body_bytes          INT NOT NULL,
    created_at          VARCHAR(32) NOT NULL,
    is_injected_prompt  TINYINT NOT NULL DEFAULT 0,
    dp_status_end       VARCHAR(64) NOT NULL DEFAULT 'idle',
    PRIMARY KEY (id),
    UNIQUE KEY uk_trace_key (trace_key),
    KEY idx_traces_user_time (user_id, started_at),
    KEY idx_traces_time      (started_at),
    KEY idx_traces_session   (session_id, prompt_idx)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const DDL_SCHEMA_MIGRATIONS = `
  CREATE TABLE IF NOT EXISTS agent_traces_meta (
    meta_key   VARCHAR(64) NOT NULL PRIMARY KEY,
    meta_value VARCHAR(255) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const INSERT_COLS = `
  trace_key, session_id, prompt_idx, user_id, username, mode, brain_type, model_name,
  user_message, outcome, started_at, ended_at, duration_ms,
  step_count, tool_call_count, tokens_total, cost_usd,
  schema_version, body_json, body_bytes,
  is_injected_prompt, dp_status_end, created_at
`;

const INSERT_PLACEHOLDERS = `?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?`;

const UPDATE_ON_DUP = `
  session_id         = VALUES(session_id),
  prompt_idx         = VALUES(prompt_idx),
  user_id            = VALUES(user_id),
  username           = VALUES(username),
  mode               = VALUES(mode),
  brain_type         = VALUES(brain_type),
  model_name         = VALUES(model_name),
  user_message       = VALUES(user_message),
  outcome            = VALUES(outcome),
  started_at         = VALUES(started_at),
  ended_at           = VALUES(ended_at),
  duration_ms        = VALUES(duration_ms),
  step_count         = VALUES(step_count),
  tool_call_count    = VALUES(tool_call_count),
  tokens_total       = VALUES(tokens_total),
  cost_usd           = VALUES(cost_usd),
  schema_version     = VALUES(schema_version),
  body_json          = VALUES(body_json),
  body_bytes         = VALUES(body_bytes),
  is_injected_prompt = VALUES(is_injected_prompt),
  dp_status_end      = VALUES(dp_status_end)
`;

// ── Implementation ──────────────────────────────────────────────────────────

export class MysqlTraceStore implements TraceStore {
  private pool: mysql.Pool;
  private schemaReady: Promise<void> | null = null;

  constructor(url: string, poolOptions?: Partial<mysql.PoolOptions>) {
    this.pool = mysql.createPool({
      uri: url,
      waitForConnections: true,
      connectionLimit: 10,
      enableKeepAlive: true,
      keepAliveInitialDelay: 30_000,
      timezone: "+00:00", // we never store TIMESTAMP values — all time columns
                          // are pre-formatted VARCHAR in Beijing time
      ...poolOptions,
    });
  }

  /** First call runs DDL + migrations. Subsequent calls are instant. */
  async ensureSchema(): Promise<void> {
    if (!this.schemaReady) this.schemaReady = this.runSchemaInit();
    return this.schemaReady;
  }

  private async runSchemaInit(): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.query(DDL_SCHEMA_MIGRATIONS);
      await conn.query(DDL_V4_TABLE);
      // Record the version. Not used for branching yet — CREATE TABLE IF NOT
      // EXISTS already handles idempotency — but pins the expected version for
      // future additive migrations (v4 → v5).
      await conn.query(
        `INSERT INTO agent_traces_meta (meta_key, meta_value) VALUES ('schema_version', ?)
         ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)`,
        [String(SCHEMA_VERSION)],
      );
    } finally {
      conn.release();
    }
  }

  async insert(row: TraceRow & { bodyJson: string }): Promise<void> {
    await this.ensureSchema();
    await this.pool.execute(
      `INSERT INTO agent_traces (${INSERT_COLS}) VALUES (${INSERT_PLACEHOLDERS})`,
      this.rowToParams(row),
    );
  }

  async upsert(row: TraceRow & { bodyJson: string }): Promise<void> {
    await this.ensureSchema();
    await this.pool.execute(
      `INSERT INTO agent_traces (${INSERT_COLS}) VALUES (${INSERT_PLACEHOLDERS})
       ON DUPLICATE KEY UPDATE ${UPDATE_ON_DUP}`,
      this.rowToParams(row),
    );
  }

  async list(opts: TraceListOpts): Promise<TraceListResult> {
    await this.ensureSchema();
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 500));
    const where: string[] = [];
    const params: Array<string | number> = [];

    if (opts.userId) {
      where.push("user_id = ?");
      params.push(opts.userId);
    }
    if (opts.username) {
      where.push("username = ?");
      params.push(opts.username);
    }
    if (typeof opts.from === "string" && opts.from) {
      where.push("started_at >= ?");
      params.push(opts.from);
    }
    if (typeof opts.to === "string" && opts.to) {
      where.push("started_at <= ?");
      params.push(opts.to);
    }
    if (typeof opts.minDurationMs === "number") {
      where.push("duration_ms >= ?");
      params.push(opts.minDurationMs);
    }
    if (opts.outcome) {
      where.push("outcome = ?");
      params.push(opts.outcome);
    }
    if (opts.sessionId) {
      where.push("session_id = ?");
      params.push(opts.sessionId);
    }
    if (opts.mode) {
      where.push("mode = ?");
      params.push(opts.mode);
    }
    if (typeof opts.isInjectedPrompt === "boolean") {
      where.push("is_injected_prompt = ?");
      params.push(opts.isInjectedPrompt ? 1 : 0);
    }
    if (opts.dpStatusEnd) {
      where.push("dp_status_end = ?");
      params.push(opts.dpStatusEnd);
    }
    if (typeof opts.cursorStartedAt === "string" && opts.cursorStartedAt && opts.cursorId) {
      where.push("(started_at < ? OR (started_at = ? AND trace_key < ?))");
      params.push(opts.cursorStartedAt, opts.cursorStartedAt, opts.cursorId);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    // LIMIT is inlined (not parameterized) because mysql2's prepared-statement
    // protocol does not accept a numeric parameter for LIMIT — it throws
    // ER_WRONG_ARGUMENTS ("Incorrect arguments to mysqld_stmt_execute").
    // Safe to inline: `limit` is clamped to integer [1, 500] above, no
    // injection surface.
    const sql = `
      SELECT trace_key AS id, session_id, prompt_idx, user_id, username, mode, brain_type, model_name,
             user_message, outcome, started_at, ended_at, duration_ms,
             step_count, tool_call_count, tokens_total, cost_usd, schema_version, created_at,
             is_injected_prompt, dp_status_end
        FROM agent_traces
        ${whereSql}
       ORDER BY started_at DESC, trace_key DESC
       LIMIT ${limit}
    `;
    const [rows] = await this.pool.execute(sql, params);
    const items = (rows as Array<Record<string, unknown>>).map(rowToTraceRow);
    const nextCursor = items.length === limit
      ? { startedAt: items[items.length - 1].startedAt, id: items[items.length - 1].id }
      : null;
    return { items, nextCursor };
  }

  async getById(id: string): Promise<TraceRecord | null> {
    await this.ensureSchema();
    const [rows] = await this.pool.execute(
      `SELECT trace_key AS id, session_id, prompt_idx, user_id, username, mode, brain_type, model_name,
              user_message, outcome, started_at, ended_at, duration_ms,
              step_count, tool_call_count, tokens_total, cost_usd, schema_version,
              created_at, is_injected_prompt, dp_status_end, body_json
         FROM agent_traces WHERE trace_key = ? LIMIT 1`,
      [id],
    );
    const arr = rows as Array<Record<string, unknown>>;
    if (arr.length === 0) return null;
    const r = arr[0];
    return { ...rowToTraceRow(r), bodyJson: r.body_json as string };
  }

  async deleteById(id: string): Promise<boolean> {
    await this.ensureSchema();
    const [result] = await this.pool.execute(
      "DELETE FROM agent_traces WHERE trace_key = ?",
      [id],
    );
    const affected = (result as { affectedRows?: number }).affectedRows ?? 0;
    return affected > 0;
  }

  async close(): Promise<void> {
    try { await this.pool.end(); } catch { /* best-effort */ }
  }

  private rowToParams(row: TraceRow & { bodyJson: string }): Array<string | number | null> {
    // Order must match INSERT_COLS exactly.
    return [
      row.id,
      row.sessionId,
      row.promptIdx,
      row.userId,
      row.username,
      row.mode,
      row.brainType,
      row.modelName,
      row.userMessage,
      row.outcome,
      row.startedAt,
      row.endedAt,
      row.durationMs,
      row.stepCount,
      row.toolCallCount,
      row.tokensTotal,
      row.costUsd,
      row.schemaVersion,
      row.bodyJson,
      Buffer.byteLength(row.bodyJson, "utf8"),
      row.isInjectedPrompt ? 1 : 0,
      row.dpStatusEnd,
      // created_at — MySQL has no cheap Beijing-time default; fill from
      // application clock. Matches the strftime default used by SQLite.
      formatBeijingNow(),
    ];
  }
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function rowToTraceRow(r: Record<string, unknown>): TraceRow {
  const durationMs = Number(r.duration_ms);
  return {
    id: r.id as string,
    sessionId: r.session_id as string,
    promptIdx: Number(r.prompt_idx),
    userId: (r.user_id as string | null) ?? null,
    username: (r.username as string | null) ?? null,
    mode: r.mode as string,
    brainType: (r.brain_type as string | null) ?? null,
    modelName: (r.model_name as string | null) ?? null,
    userMessage: (r.user_message as string | null) ?? null,
    outcome: r.outcome as string,
    startedAt: r.started_at as string,
    endedAt: r.ended_at as string,
    durationMs,
    duration: formatDuration(durationMs),
    stepCount: Number(r.step_count),
    toolCallCount: Number(r.tool_call_count),
    tokensTotal: r.tokens_total != null ? Number(r.tokens_total) : null,
    costUsd: r.cost_usd != null ? Number(r.cost_usd) : null,
    schemaVersion: r.schema_version as string,
    createdAt: r.created_at as string,
    isInjectedPrompt: Number(r.is_injected_prompt) === 1,
    dpStatusEnd: (r.dp_status_end as string | null) ?? "idle",
  };
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "00:00:00.000";
  const hh = Math.floor(ms / 3600_000);
  const mm = Math.floor((ms / 60_000) % 60);
  const ss = Math.floor((ms / 1000) % 60);
  const sss = Math.floor(ms % 1000);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(sss).padStart(3, "0")}`;
}

function formatBeijingNow(): string {
  const d = new Date(Date.now() + 8 * 3600_000);
  const p2 = (n: number) => (n < 10 ? `0${n}` : String(n));
  const p3 = (n: number) => (n < 10 ? `00${n}` : n < 100 ? `0${n}` : String(n));
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ` +
         `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}.${p3(d.getUTCMilliseconds())}`;
}
