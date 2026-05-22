/**
 * Reads chat messages for an eval session via Portal REST and reduces them
 * into a `ChatTrace`. The bulk of the work is identifying skill calls:
 * skills are executed by tools `local_script` / `pod_script` / `host_script`
 * / `node_script`; the real skill name lives in `tool_input.skill`.
 *
 * Token counts are approximated as `chars / 4` — siclaw's own metrics use a
 * tokenizer, but we want a model-agnostic, dependency-free estimate so we
 * don't bias horizontal LLM comparisons (per design §2.3).
 */

import type { ChatTrace, SkillInvocation } from "./types.js";

export interface ChatTraceReaderConfig {
  portalUrl: string;
  jwt: string;
}

interface RawMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "tool" | string;
  content: string | null;
  tool_name: string | null;
  tool_input: string | null;
  outcome: string | null;
  duration_ms: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

const SKILL_HOSTING_TOOLS = new Set([
  "local_script",
  "pod_script",
  "host_script",
  "node_script",
]);

const APPROX_CHARS_PER_TOKEN = 4;

export class ChatTraceReader {
  constructor(private readonly cfg: ChatTraceReaderConfig) {}

  async read(agentId: string, sessionId: string): Promise<ChatTrace> {
    const messages = await this.fetchAllMessages(agentId, sessionId);
    return reduceTrace(sessionId, messages);
  }

  private async fetchAllMessages(
    agentId: string,
    sessionId: string,
  ): Promise<RawMessage[]> {
    const all: RawMessage[] = [];
    const pageSize = 200;
    let page = 1;
    let total = Infinity;
    // Portal returns newest-first paginated chronologically-sorted pages.
    // We pull until we've seen `total` rows.
    while (all.length < total) {
      const url = `${this.cfg.portalUrl}/api/v1/siclaw/agents/${encodeURIComponent(agentId)}/chat/sessions/${encodeURIComponent(sessionId)}/messages?page=${page}&page_size=${pageSize}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.cfg.jwt}` },
      });
      if (!res.ok) {
        throw new Error(`getMessages page ${page} failed: HTTP ${res.status}`);
      }
      const body = (await res.json()) as { data: RawMessage[]; total: number };
      all.push(...body.data);
      total = body.total;
      if (body.data.length < pageSize) break;
      page++;
    }
    // Each page is already chronological; concatenating across pages may
    // mis-order across page boundaries, so re-sort defensively by created_at.
    all.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    return all;
  }
}

/** Pure function — easy to test against fixture messages. */
export function reduceTrace(
  sessionId: string,
  messages: RawMessage[],
): ChatTrace {
  const skills: SkillInvocation[] = [];
  let finalAssistantText = "";
  let assistantSteps = 0;
  let outputChars = 0;
  let inputChars = 0;
  let first = Infinity;
  let last = 0;

  for (const m of messages) {
    const ts = new Date(m.created_at).getTime();
    if (Number.isFinite(ts)) {
      if (ts < first) first = ts;
      if (ts > last) last = ts;
    }
    if (m.role === "assistant") {
      assistantSteps++;
      outputChars += (m.content ?? "").length;
      // Only count "natural language" assistant rows for final-answer purposes;
      // skip rows that are pure tool dispatches (toolName present, no content).
      if ((m.content ?? "").trim().length > 0) {
        finalAssistantText = m.content!;
      }
    } else {
      inputChars += (m.content ?? "").length;
    }

    if (m.role === "tool" && m.tool_name && SKILL_HOSTING_TOOLS.has(m.tool_name)) {
      const invocation = parseSkillInvocation(m);
      if (invocation) skills.push(invocation);
    }
  }

  const durationMs = last >= first && Number.isFinite(first) ? last - first : 0;
  return {
    sessionId,
    skills,
    finalAssistantText,
    assistantSteps,
    approxOutputTokens: Math.ceil(outputChars / APPROX_CHARS_PER_TOKEN),
    approxInputTokens: Math.ceil(inputChars / APPROX_CHARS_PER_TOKEN),
    durationMs,
  };
}

function parseSkillInvocation(m: RawMessage): SkillInvocation | null {
  let parsed: Record<string, unknown> = {};
  if (typeof m.tool_input === "string" && m.tool_input.length > 0) {
    try {
      parsed = JSON.parse(m.tool_input) as Record<string, unknown>;
    } catch {
      // Unparseable input — record an "unknown" skill so we don't silently
      // drop a tool invocation that COULD have been a skill call. Callers
      // can filter these out if they're certain.
      return {
        skill: "<unparseable>",
        script: null,
        args: null,
        toolName: m.tool_name!,
        outcome: normalizeOutcome(m.outcome),
        durationMs: m.duration_ms,
        createdAt: new Date(m.created_at),
      };
    }
  }
  const skill = typeof parsed.skill === "string" ? parsed.skill : null;
  if (!skill) return null; // tool used these names but with no `skill` arg — not a skill call
  return {
    skill,
    script: typeof parsed.script === "string" ? parsed.script : null,
    args: typeof parsed.args === "string" ? parsed.args : null,
    toolName: m.tool_name!,
    outcome: normalizeOutcome(m.outcome),
    durationMs: m.duration_ms,
    createdAt: new Date(m.created_at),
  };
}

function normalizeOutcome(o: string | null): SkillInvocation["outcome"] {
  if (o === "success" || o === "error" || o === "blocked") return o;
  return "unknown";
}
