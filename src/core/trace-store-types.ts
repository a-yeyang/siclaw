/**
 * TraceStore — storage contract for persisted per-prompt traces.
 *
 * This file is the *interface* layer. Concrete implementations live in:
 *   - trace-store-sqlite.ts      — SqliteTraceStore    (local, default in dev)
 *   - trace-store-mysql.ts       — MysqlTraceStore     (cluster-hosted prod DB)
 *   - trace-store-composite.ts   — CompositeTraceStore (dual-writes to several)
 *
 * TraceRecorder only depends on this interface — it does not know whether the
 * backing store is SQLite, MySQL, or a composite fan-out. This lets the
 * recorder run unchanged under ephemeral K8s pods (where local SQLite data
 * would be lost when the pod restarts) by swapping in a remote store.
 */

export interface TraceRow {
  /** Business id (human-readable, globally unique, matches trace-*.json filename stem). */
  id: string;
  sessionId: string;
  promptIdx: number;
  userId: string | null;
  username: string | null;
  mode: string;
  brainType: string | null;
  modelName: string | null;
  userMessage: string | null;
  outcome: string;
  /** Beijing time, "YYYY-MM-DD HH:mm:ss.SSS". Zero-padded → safe for lex sort. */
  startedAt: string;
  endedAt: string;
  /** Interval kept as integer ms for filtering/sorting; exposed as `duration`
   *  (formatted HH:mm:ss.SSS) in API responses. */
  durationMs: number;
  /** Formatted duration, HH:mm:ss.SSS. Derived from durationMs on read.
   *  Optional because insert() callers don't supply it — rowToTraceRow fills it. */
  duration?: string;
  stepCount: number;
  toolCallCount: number;
  tokensTotal: number | null;
  costUsd: number | null;
  schemaVersion: string;
  /** Beijing time string. Set by DB DEFAULT on insert, populated on read. */
  createdAt?: string;
  /** True when userMessage is a UI-button-generated canned string (DP_CONFIRM
   *  full body, dig-deeper, etc.). See trace-recorder's INJECTED_PROMPT
   *  classification. */
  isInjectedPrompt: boolean;
  /** DP (Deep Probe) workflow status at the moment the trace was persisted.
   *  One of: idle / investigating / awaiting_confirmation / validating /
   *  concluding / completed. */
  dpStatusEnd: string;
}

export interface TraceListOpts {
  userId?: string;
  username?: string;
  /** Inclusive lower bound, Beijing "YYYY-MM-DD HH:mm:ss.SSS". */
  from?: string;
  /** Inclusive upper bound, Beijing "YYYY-MM-DD HH:mm:ss.SSS". */
  to?: string;
  minDurationMs?: number;
  outcome?: string;
  limit?: number;
  /** Keyset cursor: last row's (startedAt, id). Next page is strictly older. */
  cursorStartedAt?: string;
  cursorId?: string;
}

export interface TraceListResult {
  items: TraceRow[];
  nextCursor: { startedAt: string; id: string } | null;
}

export interface TraceRecord extends TraceRow {
  bodyJson: string;
}

/**
 * The storage contract. All methods are async so implementations over the
 * network (MySQL, HTTP) are first-class — local synchronous implementations
 * just return resolved promises.
 */
export interface TraceStore {
  /** INSERT, fails loud on UNIQUE(trace_key) collision. */
  insert(row: TraceRow & { bodyJson: string }): Promise<void>;
  /** INSERT or UPDATE (same trace_key). Used by the recorder's two-phase
   *  persistence (stub at beginPrompt → full row at flush). */
  upsert(row: TraceRow & { bodyJson: string }): Promise<void>;
  /** Paginated list with filters. Keyset cursor in opts. */
  list(opts: TraceListOpts): Promise<TraceListResult>;
  /** Fetch one trace (with body JSON) by business key. */
  getById(id: string): Promise<TraceRecord | null>;
  /** Release resources (DB connections, file handles). Idempotent. */
  close(): Promise<void>;
}
