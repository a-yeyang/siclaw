/**
 * DevEval Repository — experiment & case CRUD for developer evaluation mode
 */

import crypto from "node:crypto";
import { eq, desc, and } from "drizzle-orm";
import type { Database } from "../index.js";
import { devEvalExperiments, devEvalCases } from "../schema.js";

export interface DevEvalCaseInput {
  title?: string;
  podName?: string;
  namespace?: string;
  faultType?: string;
  kubectlInject?: string;
  diagnosticSteps?: string[];
  expectedAnswer?: string;
  workOrders?: Array<{ difficulty: string; text: string }>;
}

export class DevEvalRepository {
  constructor(private db: Database) {}

  // ── Experiments ──────────────────────────────────────

  async createExperiment(userId: string, workspaceId: string, prompt: string) {
    const id = crypto.randomUUID();
    await this.db.insert(devEvalExperiments).values({
      id,
      userId,
      workspaceId,
      prompt,
      caseCount: 0,
      status: "draft",
    });
    return id;
  }

  async getExperiment(id: string) {
    const rows = await this.db
      .select()
      .from(devEvalExperiments)
      .where(eq(devEvalExperiments.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async listExperiments(userId: string, limit = 50) {
    return this.db
      .select()
      .from(devEvalExperiments)
      .where(eq(devEvalExperiments.userId, userId))
      .orderBy(desc(devEvalExperiments.createdAt))
      .limit(limit);
  }

  async updateExperimentStatus(id: string, status: string) {
    await this.db
      .update(devEvalExperiments)
      .set({ status, updatedAt: new Date() })
      .where(eq(devEvalExperiments.id, id));
  }

  async updateExperimentCaseCount(id: string, count: number) {
    await this.db
      .update(devEvalExperiments)
      .set({ caseCount: count, updatedAt: new Date() })
      .where(eq(devEvalExperiments.id, id));
  }

  async deleteExperiment(id: string, userId: string) {
    await this.db
      .delete(devEvalExperiments)
      .where(and(eq(devEvalExperiments.id, id), eq(devEvalExperiments.userId, userId)));
  }

  // ── Cases ───────────────────────────────────────────

  async createCase(experimentId: string, caseIndex: number, input: DevEvalCaseInput) {
    const id = crypto.randomUUID();
    await this.db.insert(devEvalCases).values({
      id,
      experimentId,
      caseIndex,
      title: input.title ?? null,
      podName: input.podName ?? null,
      namespace: input.namespace ?? null,
      faultType: input.faultType ?? null,
      kubectlInject: input.kubectlInject ?? null,
      diagnosticSteps: input.diagnosticSteps ?? null,
      expectedAnswer: input.expectedAnswer ?? null,
      workOrders: input.workOrders ?? null,
      status: "generated",
    });
    return id;
  }

  async getCasesForExperiment(experimentId: string) {
    return this.db
      .select()
      .from(devEvalCases)
      .where(eq(devEvalCases.experimentId, experimentId))
      .orderBy(devEvalCases.caseIndex);
  }

  async getCase(id: string) {
    const rows = await this.db
      .select()
      .from(devEvalCases)
      .where(eq(devEvalCases.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async updateCaseStatus(id: string, status: string, errorMessage?: string) {
    await this.db
      .update(devEvalCases)
      .set({ status, errorMessage: errorMessage ?? null })
      .where(eq(devEvalCases.id, id));
  }

  async updateCaseAgentResult(id: string, updates: {
    agentSessionId?: string;
    agentResponse?: string;
    agentCommands?: string[];
  }) {
    await this.db
      .update(devEvalCases)
      .set({
        agentSessionId: updates.agentSessionId ?? null,
        agentResponse: updates.agentResponse ?? null,
        agentCommands: updates.agentCommands ?? null,
        status: "completed",
      })
      .where(eq(devEvalCases.id, id));
  }

  async updateCaseScore(id: string, scores: {
    scoreCommands: number;
    scoreConclusion: number;
    scoreReasoning: string;
  }) {
    await this.db
      .update(devEvalCases)
      .set({
        scoreCommands: scores.scoreCommands,
        scoreConclusion: scores.scoreConclusion,
        scoreReasoning: scores.scoreReasoning,
        status: "scored",
      })
      .where(eq(devEvalCases.id, id));
  }

  async updateCaseSelectedWorkOrder(id: string, index: number) {
    await this.db
      .update(devEvalCases)
      .set({ selectedWorkOrder: index })
      .where(eq(devEvalCases.id, id));
  }
}
