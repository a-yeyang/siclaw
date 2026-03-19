import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLookupLogSourceTool } from "./index.js";

/**
 * Integration test for lookup_log_source tool.
 * Creates a temporary .sig package fixture and exercises the full pipeline:
 * normalizer -> file-resolver -> matcher -> formatted output.
 */

let tmpDir: string;
let knowledgeDir: string;

/** ScanRecord-shaped JSONL lines for the fixture */
const FIXTURE_RECORDS = [
  // Record 1: has regex — L1 matchable
  {
    id: "test-comp-001",
    component: "test-component",
    version: "v1.0.0",
    file: "pkg/scheduler/scheduler.go",
    line: 42,
    function: "Schedule",
    level: "info",
    template: "scheduling pod %s to node %s",
    regex: "^scheduling pod .* to node .*$",
    keywords: ["scheduling", "pod", "node"],
    context: {
      source_lines: [
        'func Schedule(pod string, node string) {',
        '  klog.Infof("scheduling pod %s to node %s", pod, node)',
        '}',
      ],
      line_range: [41, 43],
    },
  },
  // Record 2: null regex — L2-only matchable via keywords
  {
    id: "test-comp-002",
    component: "test-component",
    version: "v1.0.0",
    file: "pkg/scheduler/queue.go",
    line: 100,
    function: "Enqueue",
    level: "warning",
    template: "pod %v queue is full, dropping oldest entry",
    regex: null,
    keywords: ["pod", "queue", "full", "dropping", "oldest", "entry"],
    context: {
      source_lines: [
        'func Enqueue(pod interface{}) {',
        '  klog.Warningf("pod %v queue is full, dropping oldest entry", pod)',
        '}',
      ],
      line_range: [99, 101],
    },
  },
  // Record 3: should NOT match either test query
  {
    id: "test-comp-003",
    component: "test-component",
    version: "v1.0.0",
    file: "pkg/controller/gc.go",
    line: 55,
    function: "GarbageCollect",
    level: "info",
    template: "garbage collection completed in %v",
    regex: "^garbage collection completed in .*$",
    keywords: ["garbage", "collection", "completed"],
    context: {
      source_lines: [
        'func GarbageCollect() {',
        '  klog.Infof("garbage collection completed in %v", elapsed)',
        '}',
      ],
      line_range: [54, 56],
    },
  },
  // Record 4: another component for scoping test
  {
    id: "other-comp-001",
    component: "other-component",
    version: "v2.0.0",
    file: "pkg/api/server.go",
    line: 10,
    function: "Start",
    level: "info",
    template: "server started on port %d",
    regex: "^server started on port \\d+$",
    keywords: ["server", "started", "port"],
    context: {
      source_lines: [
        'func Start(port int) {',
        '  log.Printf("server started on port %d", port)',
        '}',
      ],
      line_range: [9, 11],
    },
  },
];

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lookup-tool-test-"));
  knowledgeDir = path.join(tmpDir, "knowledge");

  // Create test-component package
  const testCompDir = path.join(knowledgeDir, "test-component");
  fs.mkdirSync(testCompDir, { recursive: true });
  const testRecords = FIXTURE_RECORDS.filter((r) => r.component === "test-component");
  fs.writeFileSync(
    path.join(testCompDir, "templates.jsonl"),
    testRecords.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );

  // Create other-component package
  const otherCompDir = path.join(knowledgeDir, "other-component");
  fs.mkdirSync(otherCompDir, { recursive: true });
  const otherRecords = FIXTURE_RECORDS.filter((r) => r.component === "other-component");
  fs.writeFileSync(
    path.join(otherCompDir, "templates.jsonl"),
    otherRecords.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function parseResult(result: any): any {
  return JSON.parse(result.content[0].text);
}

describe("createLookupLogSourceTool", () => {
  it("L1 exact match — regex-matched record returns confidence=exact", async () => {
    const tool = createLookupLogSourceTool(knowledgeDir);
    const result = await tool.execute("call-1", {
      log_line: "scheduling pod my-pod to node worker-1",
    });
    const parsed = parseResult(result);
    // L1 match is first, L2 matches may follow (both always run per CONTEXT.md)
    expect(parsed.matches.length).toBeGreaterThanOrEqual(1);
    const exactMatch = parsed.matches.find((m: any) => m.confidence === "exact");
    expect(exactMatch).toBeDefined();
    expect(exactMatch.file).toBe("pkg/scheduler/scheduler.go");
    expect(exactMatch.line).toBe(42);
    expect(exactMatch.function).toBe("Schedule");
    expect(exactMatch.component).toBe("test-component");
    // Should NOT have regex or keywords in output
    expect(exactMatch).not.toHaveProperty("regex");
    expect(exactMatch).not.toHaveProperty("keywords");
  });

  it("L2 keyword match — non-regex record returns confidence=high with score", async () => {
    const tool = createLookupLogSourceTool(knowledgeDir);
    const result = await tool.execute("call-2", {
      log_line: "pod queue is full dropping oldest entry now",
    });
    const parsed = parseResult(result);
    // Should find L2 match for test-comp-002
    const l2Match = parsed.matches.find((m: any) => m.confidence === "high" && m.file === "pkg/scheduler/queue.go");
    expect(l2Match).toBeDefined();
    expect(l2Match.score).toBeGreaterThan(0);
    expect(l2Match.component).toBe("test-component");
  });

  it("no match — returns empty matches array with message", async () => {
    const tool = createLookupLogSourceTool(knowledgeDir);
    const result = await tool.execute("call-3", {
      log_line: "completely unrelated log about database migration",
    });
    const parsed = parseResult(result);
    expect(parsed.matches).toHaveLength(0);
    expect(parsed.message).toContain("No matching template found");
    expect(parsed.message).toContain("component");
  });

  it("component scoping — restricts search to named component", async () => {
    const tool = createLookupLogSourceTool(knowledgeDir);

    // Match within test-component
    const result1 = await tool.execute("call-4a", {
      log_line: "scheduling pod my-pod to node worker-1",
      component: "test-component",
    });
    const parsed1 = parseResult(result1);
    expect(parsed1.matches.length).toBeGreaterThan(0);
    expect(parsed1.matches[0].component).toBe("test-component");

    // No match for nonexistent component
    const result2 = await tool.execute("call-4b", {
      log_line: "scheduling pod my-pod to node worker-1",
      component: "nonexistent",
    });
    const parsed2 = parseResult(result2);
    expect(parsed2.matches).toHaveLength(0);
    expect(parsed2.message).toContain("nonexistent");
  });

  it("K8s prefix stripping — CRI-prefixed log line still matches L1", async () => {
    const tool = createLookupLogSourceTool(knowledgeDir);
    const result = await tool.execute("call-5", {
      log_line: "2024-01-15T10:30:00.123456789Z stdout F scheduling pod my-pod to node worker-1",
    });
    const parsed = parseResult(result);
    expect(parsed.matches.length).toBeGreaterThan(0);
    const exactMatch = parsed.matches.find((m: any) => m.confidence === "exact");
    expect(exactMatch).toBeDefined();
    expect(exactMatch.file).toBe("pkg/scheduler/scheduler.go");
  });

  it("empty log_line — returns error response", async () => {
    const tool = createLookupLogSourceTool(knowledgeDir);
    const result = await tool.execute("call-6", { log_line: "   " });
    const parsed = parseResult(result);
    expect(parsed.error).toBe("Empty log_line");
  });

  it("detected_level — included when klog prefix present", async () => {
    const tool = createLookupLogSourceTool(knowledgeDir);
    const result = await tool.execute("call-7", {
      log_line: "I0115 10:30:00.123456 12345 scheduler.go:42] scheduling pod my-pod to node worker-1",
    });
    const parsed = parseResult(result);
    expect(parsed.detected_level).toBe("info");
    expect(parsed.matches.length).toBeGreaterThan(0);
  });

  it("output includes context with source_lines and line_range", async () => {
    const tool = createLookupLogSourceTool(knowledgeDir);
    const result = await tool.execute("call-8", {
      log_line: "scheduling pod my-pod to node worker-1",
    });
    const parsed = parseResult(result);
    expect(parsed.matches[0].context).toBeDefined();
    expect(parsed.matches[0].context.source_lines).toBeInstanceOf(Array);
    expect(parsed.matches[0].context.line_range).toHaveLength(2);
  });
});
