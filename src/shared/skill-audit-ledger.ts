/**
 * SkillAuditLedger — durable per-session JSONL audit trail for skill/tool use.
 *
 * This intentionally sits below the model. It records what the runtime exposed,
 * what the agent read, and which tools/scripts actually executed so skill
 * adoption can be inspected without trusting the assistant's final prose.
 */

import fs from "node:fs";
import path from "node:path";
import { onDiagnostic, type DiagnosticEvent, type SkillAuditScope } from "./diagnostic-events.js";
import { buildRedactionConfig, redactText } from "./output-redactor.js";

export type SkillAuditEventType =
  | "prompt_started"
  | "skill_available"
  | "skill_read"
  | "skill_script_executed"
  | "tool_executed"
  | "prompt_complete";

export interface SkillAuditEvent {
  version: 1;
  event_type: SkillAuditEventType;
  recorded_at: string;
  session_id: string;
  user_id?: string;
  agent_id?: string | null;
  model_id?: string;
  model_provider?: string;
  skill_name?: string;
  skill_scope?: SkillAuditScope | "builtin" | "global";
  skill_file_path?: string;
  prompt_preview?: string;
  prompt_chars?: number;
  script_name?: string;
  tool_name?: string;
  mcp_server?: string;
  mcp_tool?: string;
  outcome?: "success" | "error" | "completed";
  duration_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cost_usd?: number;
}

export interface SkillAuditSkillSummary {
  skill_name: string;
  available: number;
  read: number;
  script_executed: number;
  script_errors: number;
  avg_script_duration_ms: number;
}

export interface SkillAuditToolSummary {
  tool_name: string;
  executed: number;
  errors: number;
  avg_duration_ms: number;
}

export interface SkillAuditSummary {
  session_id?: string;
  events: number;
  skills: SkillAuditSkillSummary[];
  tools: SkillAuditToolSummary[];
  prompt_count: number;
  prompt_previews: string[];
  total_tokens: number;
  cost_usd: number;
}

const PROMPT_PREVIEW_CHARS = 500;

function promptPreview(text: string): string {
  const redacted = redactText(text, buildRedactionConfig());
  return redacted.length > PROMPT_PREVIEW_CHARS
    ? `${redacted.slice(0, PROMPT_PREVIEW_CHARS)}...`
    : redacted;
}

function auditDir(): string {
  if (process.env.SICLAW_SKILL_AUDIT_DIR) {
    return path.resolve(process.env.SICLAW_SKILL_AUDIT_DIR);
  }
  const userDataDir = process.env.SICLAW_USER_DATA_DIR
    ? path.resolve(process.env.SICLAW_USER_DATA_DIR)
    : path.resolve(process.cwd(), ".siclaw", "user-data");
  return path.join(userDataDir, "skill-audit");
}

function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

export function skillAuditFilePath(sessionId: string): string {
  return path.join(auditDir(), `${sanitizeSessionId(sessionId)}.jsonl`);
}

function parseMcpToolName(toolName: string): { mcp_server?: string; mcp_tool?: string } {
  if (!toolName.startsWith("mcp__")) return {};
  const parts = toolName.split("__");
  if (parts.length < 3) return {};
  return { mcp_server: parts[1], mcp_tool: parts.slice(2).join("__") };
}

export function appendSkillAuditEvent(event: SkillAuditEvent): void {
  const dir = auditDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(skillAuditFilePath(event.session_id), JSON.stringify(event) + "\n", "utf-8");
}

export function readSkillAuditEvents(sessionId: string): SkillAuditEvent[] {
  const file = skillAuditFilePath(sessionId);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SkillAuditEvent);
}

export function summarizeSkillAuditEvents(events: SkillAuditEvent[]): SkillAuditSummary {
  const skillMap = new Map<string, {
    available: number;
    read: number;
    script_executed: number;
    script_errors: number;
    total_script_duration_ms: number;
  }>();
  const toolMap = new Map<string, { executed: number; errors: number; total_duration_ms: number }>();
  let promptCount = 0;
  const promptPreviews: string[] = [];
  let totalTokens = 0;
  let costUsd = 0;

  function skillEntry(name: string) {
    let entry = skillMap.get(name);
    if (!entry) {
      entry = { available: 0, read: 0, script_executed: 0, script_errors: 0, total_script_duration_ms: 0 };
      skillMap.set(name, entry);
    }
    return entry;
  }

  for (const event of events) {
    if (event.skill_name && event.event_type === "skill_available") skillEntry(event.skill_name).available++;
    if (event.skill_name && event.event_type === "skill_read") skillEntry(event.skill_name).read++;
    if (event.skill_name && event.event_type === "skill_script_executed") {
      const entry = skillEntry(event.skill_name);
      entry.script_executed++;
      if (event.outcome === "error") entry.script_errors++;
      entry.total_script_duration_ms += event.duration_ms ?? 0;
    }
    if (event.tool_name && event.event_type === "tool_executed") {
      let entry = toolMap.get(event.tool_name);
      if (!entry) {
        entry = { executed: 0, errors: 0, total_duration_ms: 0 };
        toolMap.set(event.tool_name, entry);
      }
      entry.executed++;
      if (event.outcome === "error") entry.errors++;
      entry.total_duration_ms += event.duration_ms ?? 0;
    }
    if (event.event_type === "prompt_started" && event.prompt_preview) {
      promptPreviews.push(event.prompt_preview);
    }
    if (event.event_type === "prompt_complete") {
      promptCount++;
      totalTokens += event.total_tokens ?? 0;
      costUsd += event.cost_usd ?? 0;
    }
  }

  const skills = [...skillMap.entries()].map(([skill_name, entry]) => ({
    skill_name,
    available: entry.available,
    read: entry.read,
    script_executed: entry.script_executed,
    script_errors: entry.script_errors,
    avg_script_duration_ms: entry.script_executed > 0
      ? Math.round(entry.total_script_duration_ms / entry.script_executed)
      : 0,
  })).sort((a, b) =>
    (b.script_executed + b.read + b.available) - (a.script_executed + a.read + a.available) ||
    a.skill_name.localeCompare(b.skill_name)
  );

  const tools = [...toolMap.entries()].map(([tool_name, entry]) => ({
    tool_name,
    executed: entry.executed,
    errors: entry.errors,
    avg_duration_ms: entry.executed > 0 ? Math.round(entry.total_duration_ms / entry.executed) : 0,
  })).sort((a, b) => b.executed - a.executed || a.tool_name.localeCompare(b.tool_name));

  return {
    session_id: events[0]?.session_id,
    events: events.length,
    skills,
    tools,
    prompt_count: promptCount,
    prompt_previews: promptPreviews,
    total_tokens: totalTokens,
    cost_usd: Math.round(costUsd * 1_000_000) / 1_000_000,
  };
}

export function detectSkillReadTarget(filePath: string): { skillName: string; scope: SkillAuditScope } | null {
  const resolved = path.resolve(filePath);
  if (path.basename(resolved) !== "SKILL.md") return null;
  const parts = resolved.split(path.sep);
  const skillName = parts.at(-2);
  const parent = parts.at(-3);
  if (!skillName || !parent) return null;

  if (parent === "core" || parent === "extension") return { skillName, scope: "builtin" };
  if (parent === "platform") return { skillName, scope: "platform" };
  if (parent === "resolved" || parent === "global" || parent === "user" || parent === "skillset") {
    return { skillName, scope: "global" };
  }
  return { skillName, scope: "unknown" };
}

function eventFromDiagnostic(event: DiagnosticEvent): SkillAuditEvent | null {
  const recordedAt = new Date().toISOString();
  switch (event.type) {
    case "prompt_started":
      return {
        version: 1,
        event_type: "prompt_started",
        recorded_at: recordedAt,
        session_id: event.sessionId,
        user_id: event.userId,
        agent_id: event.agentId,
        prompt_preview: promptPreview(event.promptPreview),
        prompt_chars: event.promptChars,
      };
    case "skill_available":
      return {
        version: 1,
        event_type: "skill_available",
        recorded_at: recordedAt,
        session_id: event.sessionId,
        user_id: event.userId,
        agent_id: event.agentId,
        skill_name: event.skillName,
        skill_scope: event.scope,
        skill_file_path: event.filePath,
      };
    case "skill_read":
      return {
        version: 1,
        event_type: "skill_read",
        recorded_at: recordedAt,
        session_id: event.sessionId,
        user_id: event.userId,
        agent_id: event.agentId,
        skill_name: event.skillName,
        skill_scope: event.scope,
        skill_file_path: event.filePath,
      };
    case "skill_call":
      if (!event.sessionId) return null;
      return {
        version: 1,
        event_type: "skill_script_executed",
        recorded_at: recordedAt,
        session_id: event.sessionId,
        user_id: event.userId,
        agent_id: event.agentId,
        skill_name: event.skillName,
        skill_scope: event.scope,
        script_name: event.scriptName,
        outcome: event.outcome,
        duration_ms: event.durationMs,
      };
    case "tool_call":
      if (!event.sessionId) return null;
      return {
        version: 1,
        event_type: "tool_executed",
        recorded_at: recordedAt,
        session_id: event.sessionId,
        user_id: event.userId,
        agent_id: event.agentId,
        tool_name: event.toolName,
        outcome: event.outcome,
        duration_ms: event.durationMs,
        ...parseMcpToolName(event.toolName),
      };
    case "prompt_complete": {
      const input = Math.max(0, event.curr.tokens.input - event.prev.tokens.input);
      const output = Math.max(0, event.curr.tokens.output - event.prev.tokens.output);
      const total = Math.max(0, event.curr.tokens.total - event.prev.tokens.total);
      const cost = Math.max(0, event.curr.cost - event.prev.cost);
      return {
        version: 1,
        event_type: "prompt_complete",
        recorded_at: recordedAt,
        session_id: event.sessionId,
        user_id: event.userId,
        model_id: event.model?.id,
        model_provider: event.model?.provider,
        outcome: event.outcome === "error" ? "error" : "completed",
        duration_ms: event.durationMs,
        input_tokens: input,
        output_tokens: output,
        total_tokens: total,
        cost_usd: cost,
      };
    }
    default:
      return null;
  }
}

let unsubscribe: (() => void) | null = null;

export function startSkillAuditLedger(): void {
  if (unsubscribe) return;
  unsubscribe = onDiagnostic((event) => {
    const auditEvent = eventFromDiagnostic(event);
    if (!auditEvent) return;
    appendSkillAuditEvent(auditEvent);
  });
}

export function stopSkillAuditLedgerForTests(): void {
  unsubscribe?.();
  unsubscribe = null;
}
