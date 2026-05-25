/** Per-run structured event log. Captured in-memory and exposed via REST. */

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
}

export class RunLog {
  private store = new Map<string, LogEntry[]>();

  append(runId: string, msg: string, level: LogLevel = "info"): void {
    let entries = this.store.get(runId);
    if (!entries) { entries = []; this.store.set(runId, entries); }
    entries.push({ ts: new Date().toISOString(), level, msg });
    const icon = level === "error" ? "✗" : level === "warn" ? "⚠" : "•";
    console.log(`[eval:${runId.slice(0, 8)}] ${icon} ${msg}`);
  }

  get(runId: string): LogEntry[] {
    return this.store.get(runId) ?? [];
  }
}
