import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emitDiagnostic } from "../diagnostic-events.js";
import {
  detectSkillReadTarget,
  readSkillAuditEvents,
  skillAuditFilePath,
  startSkillAuditLedger,
  stopSkillAuditLedgerForTests,
  summarizeSkillAuditEvents,
} from "../skill-audit-ledger.js";

const zeroStats = {
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  cost: 0,
};

describe("SkillAuditLedger", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "siclaw-skill-audit-"));
    process.env.SICLAW_SKILL_AUDIT_DIR = tmpDir;
    startSkillAuditLedger();
  });

  afterEach(() => {
    stopSkillAuditLedgerForTests();
    delete process.env.SICLAW_SKILL_AUDIT_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes a session JSONL audit funnel for available/read/script/tool/prompt events", () => {
    emitDiagnostic({
      type: "prompt_started",
      sessionId: "session/1",
      promptPreview: "Investigate Pending pods with token=sk-abcdefghijklmnopqrstuvwxyz",
      promptChars: 64,
      userId: "u1",
      agentId: "a1",
    });
    emitDiagnostic({
      type: "skill_available",
      sessionId: "session/1",
      skillName: "gpu-health",
      scope: "builtin",
      filePath: "/repo/skills/core/gpu-health/SKILL.md",
      userId: "u1",
      agentId: "a1",
    });
    emitDiagnostic({
      type: "skill_read",
      sessionId: "session/1",
      skillName: "gpu-health",
      scope: "builtin",
      filePath: "/repo/skills/core/gpu-health/SKILL.md",
      userId: "u1",
      agentId: "a1",
    });
    emitDiagnostic({
      type: "skill_call",
      sessionId: "session/1",
      skillName: "gpu-health",
      scriptName: "collect.sh",
      scope: "builtin",
      outcome: "success",
      durationMs: 120,
      userId: "u1",
      agentId: "a1",
    });
    emitDiagnostic({
      type: "tool_call",
      sessionId: "session/1",
      toolName: "mcp__prometheus__query",
      outcome: "success",
      durationMs: 40,
      userId: "u1",
      agentId: "a1",
    });
    emitDiagnostic({
      type: "prompt_complete",
      sessionId: "session/1",
      prev: zeroStats,
      curr: {
        tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 },
        cost: 0.001,
      },
      model: { id: "m", name: "Model", provider: "p", contextWindow: 1000, maxTokens: 100, reasoning: true },
      durationMs: 200,
      outcome: "completed",
      userId: "u1",
    });

    expect(fs.existsSync(skillAuditFilePath("session/1"))).toBe(true);
    const events = readSkillAuditEvents("session/1");
    expect(events.map((e) => e.event_type)).toEqual([
      "prompt_started",
      "skill_available",
      "skill_read",
      "skill_script_executed",
      "tool_executed",
      "prompt_complete",
    ]);
    expect(events[3]).toMatchObject({
      event_type: "skill_script_executed",
    });
    expect(events[4]).toMatchObject({
      tool_name: "mcp__prometheus__query",
      mcp_server: "prometheus",
      mcp_tool: "query",
    });
    expect(events[0].prompt_preview).toContain("[REDACTED]");

    const summary = summarizeSkillAuditEvents(events);
    expect(summary.skills[0]).toMatchObject({
      skill_name: "gpu-health",
      available: 1,
      read: 1,
      script_executed: 1,
      avg_script_duration_ms: 120,
    });
    expect(summary.tools[0]).toMatchObject({
      tool_name: "mcp__prometheus__query",
      executed: 1,
      avg_duration_ms: 40,
    });
    expect(summary.prompt_count).toBe(1);
    expect(summary.prompt_previews[0]).toContain("Investigate Pending pods");
    expect(summary.total_tokens).toBe(15);
  });

  it("detects SKILL.md reads and derives a conservative scope", () => {
    expect(detectSkillReadTarget("/repo/skills/core/gpu-health/SKILL.md")).toEqual({
      skillName: "gpu-health",
      scope: "builtin",
    });
    expect(detectSkillReadTarget("/repo/.siclaw/skills/resolved/team-skill/SKILL.md")).toEqual({
      skillName: "team-skill",
      scope: "global",
    });
    expect(detectSkillReadTarget("/repo/docs/SKILL.md")).toEqual({
      skillName: "docs",
      scope: "unknown",
    });
    expect(detectSkillReadTarget("/repo/skills/core/gpu-health/README.md")).toBeNull();
  });
});

describe("skillAuditFilePath", () => {
  const prevAuditDir = process.env.SICLAW_SKILL_AUDIT_DIR;
  const prevUserDataDir = process.env.SICLAW_USER_DATA_DIR;

  afterEach(() => {
    if (prevAuditDir === undefined) delete process.env.SICLAW_SKILL_AUDIT_DIR;
    else process.env.SICLAW_SKILL_AUDIT_DIR = prevAuditDir;
    if (prevUserDataDir === undefined) delete process.env.SICLAW_USER_DATA_DIR;
    else process.env.SICLAW_USER_DATA_DIR = prevUserDataDir;
  });

  it("defaults to the writable Siclaw user-data tree", () => {
    delete process.env.SICLAW_SKILL_AUDIT_DIR;
    process.env.SICLAW_USER_DATA_DIR = "/app/.siclaw/user-data";

    expect(skillAuditFilePath("session/1")).toBe(
      path.join("/app/.siclaw/user-data", "skill-audit", "session_1.jsonl"),
    );
  });
});
