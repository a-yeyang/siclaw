import { describe, expect, it } from "vitest";
import { reduceTrace } from "../src/chat-trace-reader.js";

function ts(s: number): string {
  return new Date(s * 1000).toISOString();
}

describe("reduceTrace", () => {
  it("extracts skills from skill-hosting tool calls", () => {
    const t = reduceTrace("sess1", [
      {
        id: "1", session_id: "s", role: "user", content: "diagnose",
        tool_name: null, tool_input: null, outcome: null, duration_ms: null,
        metadata: null, created_at: ts(1),
      },
      {
        id: "2", session_id: "s", role: "tool",
        content: "(pod list)", tool_name: "local_script",
        tool_input: JSON.stringify({ skill: "kubectl-get-pods", script: "list.sh", args: "-n siclaw" }),
        outcome: "success", duration_ms: 230, metadata: null,
        created_at: ts(2),
      },
      {
        id: "3", session_id: "s", role: "assistant",
        content: "Looks like ImagePullBackOff on pod foo.",
        tool_name: null, tool_input: null, outcome: null, duration_ms: null,
        metadata: null, created_at: ts(3),
      },
    ]);

    expect(t.skills).toHaveLength(1);
    expect(t.skills[0].skill).toBe("kubectl-get-pods");
    expect(t.skills[0].outcome).toBe("success");
    expect(t.finalAssistantText).toContain("ImagePullBackOff");
    expect(t.assistantSteps).toBe(1);
    expect(t.durationMs).toBe(2000);
  });

  it("ignores non-skill-hosting tools", () => {
    const t = reduceTrace("s", [
      {
        id: "1", session_id: "s", role: "tool",
        content: "", tool_name: "web_fetch",
        tool_input: JSON.stringify({ url: "http://x" }),
        outcome: "success", duration_ms: 10, metadata: null,
        created_at: ts(1),
      },
    ]);
    expect(t.skills).toEqual([]);
  });

  it("emits <unparseable> for malformed tool_input on skill-hosting tools", () => {
    const t = reduceTrace("s", [
      {
        id: "1", session_id: "s", role: "tool",
        content: "", tool_name: "pod_script",
        tool_input: "{not-json", outcome: "error", duration_ms: 1, metadata: null,
        created_at: ts(1),
      },
    ]);
    expect(t.skills).toHaveLength(1);
    expect(t.skills[0].skill).toBe("<unparseable>");
    expect(t.skills[0].outcome).toBe("error");
  });

  it("re-sorts cross-page messages chronologically", () => {
    const t = reduceTrace("s", [
      {
        id: "B", session_id: "s", role: "user", content: "later",
        tool_name: null, tool_input: null, outcome: null, duration_ms: null,
        metadata: null, created_at: ts(10),
      },
      {
        id: "A", session_id: "s", role: "user", content: "earlier",
        tool_name: null, tool_input: null, outcome: null, duration_ms: null,
        metadata: null, created_at: ts(5),
      },
    ]);
    expect(t.durationMs).toBe(5000);
  });
});
