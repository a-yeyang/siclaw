import crypto from "node:crypto";
import { eq, desc } from "drizzle-orm";
import type { Database } from "../../db/index.js";
import { flushSqliteDb } from "../../db/index.js";
import { regressionSessions, regressionRuns } from "../../db/schema.js";
import { parseRegressionMarkdown, type ParsedCase, type ParseWarning } from "./md-parser.js";
import type { CaseResult } from "./runner.js";

export interface RegressionSession {
  id: string;
  userId: string;
  workspaceId: string;
  fileName: string;
  cases: ParsedCase[];
  warnings: ParseWarning[];
  createdAt: string;
}

export interface RegressionRunRecord {
  id: string;
  sessionId: string;
  caseId: string;
  runIndex: number;
  result: CaseResult;
  createdAt: string;
}

export class RegressionStore {
  private sessions = new Map<string, RegressionSession>();
  private runs = new Map<string, Map<string, RegressionRunRecord[]>>();

  constructor(private db: Database) {}

  async loadFromDb(): Promise<void> {
    const rows = await this.db
      .select()
      .from(regressionSessions)
      .orderBy(desc(regressionSessions.createdAt));

    for (const row of rows) {
      const { cases, warnings } = parseRegressionMarkdown(row.markdownContent);
      const session: RegressionSession = {
        id: row.id,
        userId: row.userId,
        workspaceId: row.workspaceId,
        fileName: row.fileName,
        cases,
        warnings: row.warningsJson ?? warnings,
        createdAt: new Date((row.createdAt as any) * 1000).toISOString(),
      };
      this.sessions.set(row.id, session);
      this.runs.set(row.id, new Map());
    }

    const runRows = await this.db
      .select()
      .from(regressionRuns)
      .orderBy(regressionRuns.createdAt);

    for (const row of runRows) {
      const sessionRuns = this.runs.get(row.sessionId);
      if (!sessionRuns) continue;
      const record: RegressionRunRecord = {
        id: row.id,
        sessionId: row.sessionId,
        caseId: row.caseId,
        runIndex: row.runIndex,
        result: row.resultJson as unknown as CaseResult,
        createdAt: new Date((row.createdAt as any) * 1000).toISOString(),
      };
      const caseRuns = sessionRuns.get(row.caseId) ?? [];
      caseRuns.push(record);
      sessionRuns.set(row.caseId, caseRuns);
    }

    if (rows.length > 0) {
      console.log(`[regression-store] Loaded ${rows.length} session(s) and ${runRows.length} run(s) from DB`);
    }
  }

  async createSession(
    userId: string,
    workspaceId: string,
    fileName: string,
    markdownContent: string,
    cases: ParsedCase[],
    warnings: ParseWarning[],
  ): Promise<RegressionSession> {
    const id = `rs-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
    const now = new Date();
    const session: RegressionSession = {
      id,
      userId,
      workspaceId,
      fileName,
      cases,
      warnings,
      createdAt: now.toISOString(),
    };
    this.sessions.set(id, session);
    this.runs.set(id, new Map());

    await this.db.insert(regressionSessions).values({
      id,
      userId,
      workspaceId,
      fileName,
      markdownContent,
      warningsJson: warnings,
      createdAt: now,
    });
    flushSqliteDb();
    return session;
  }

  getSession(id: string): RegressionSession | undefined {
    return this.sessions.get(id);
  }

  listSessions(userId: string): RegressionSession[] {
    return [...this.sessions.values()]
      .filter(s => s.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async deleteSession(id: string): Promise<void> {
    this.sessions.delete(id);
    this.runs.delete(id);
    await this.db
      .delete(regressionSessions)
      .where(eq(regressionSessions.id, id));
    flushSqliteDb();
  }

  async addRun(sessionId: string, caseId: string, result: CaseResult): Promise<RegressionRunRecord> {
    const sessionRuns = this.runs.get(sessionId);
    if (!sessionRuns) throw new Error(`Session ${sessionId} not found`);

    const caseRuns = sessionRuns.get(caseId) ?? [];
    const now = new Date();
    const record: RegressionRunRecord = {
      id: `rr-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`,
      sessionId,
      caseId,
      runIndex: caseRuns.length,
      result,
      createdAt: now.toISOString(),
    };
    caseRuns.push(record);
    sessionRuns.set(caseId, caseRuns);

    await this.db.insert(regressionRuns).values({
      id: record.id,
      sessionId,
      caseId,
      runIndex: record.runIndex,
      resultJson: result as unknown as Record<string, unknown>,
      createdAt: now,
    });
    flushSqliteDb();
    return record;
  }

  getRunsForCase(sessionId: string, caseId: string): RegressionRunRecord[] {
    return this.runs.get(sessionId)?.get(caseId) ?? [];
  }

  getAllRuns(sessionId: string): RegressionRunRecord[] {
    const sessionRuns = this.runs.get(sessionId);
    if (!sessionRuns) return [];
    const all: RegressionRunRecord[] = [];
    for (const runs of sessionRuns.values()) {
      all.push(...runs);
    }
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}
