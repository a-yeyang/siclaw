import { describe, it, expect } from "vitest";
import type { ScanRecord } from "./file-resolver.js";
import {
  matchL1,
  matchL2,
  extractLineKeywords,
  keywordIntersectionRatio,
} from "./matcher.js";

function makeRecord(overrides: Partial<ScanRecord> = {}): ScanRecord {
  return {
    id: "abcdef012345",
    component: "test-component",
    version: "v1.0.0",
    file: "main.go",
    line: 42,
    function: "main",
    level: "error",
    template: "failed to connect to %s:%d",
    regex: "^failed to connect to (.*):(\\d+)$",
    keywords: ["failed", "connect"],
    context: { source_lines: ["klog.Errorf(...)"], line_range: [40, 44] as [number, number] },
    ...overrides,
  };
}

describe("matchL1", () => {
  it("returns exact match when regex matches", () => {
    const records = [makeRecord()];
    const results = matchL1("failed to connect to localhost:5432", records);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe("exact");
    expect(results[0].id).toBe("abcdef012345");
    expect(results[0].score).toBeUndefined();
  });

  it("returns empty array when no regex matches", () => {
    const records = [makeRecord()];
    const results = matchL1("something completely different", records);
    expect(results).toHaveLength(0);
  });

  it("skips records with null regex", () => {
    const records = [makeRecord({ regex: null })];
    const results = matchL1("failed to connect to localhost:5432", records);
    expect(results).toHaveLength(0);
  });

  it("skips records with invalid regex without throwing", () => {
    const records = [makeRecord({ regex: "[invalid(regex" })];
    expect(() => matchL1("anything", records)).not.toThrow();
    const results = matchL1("anything", records);
    expect(results).toHaveLength(0);
  });

  it("returns all matches without short-circuiting", () => {
    const records = [
      makeRecord({ id: "aaaaaaaaaaaa", regex: "^failed.*" }),
      makeRecord({ id: "bbbbbbbbbbbb", regex: "^failed to connect.*" }),
      makeRecord({ id: "cccccccccccc", regex: "^no-match$" }),
    ];
    const results = matchL1("failed to connect to localhost:5432", records);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.id)).toEqual(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
  });
});

describe("extractLineKeywords", () => {
  it("splits on whitespace and punctuation", () => {
    const keywords = extractLineKeywords("failed to connect to localhost:5432");
    expect(keywords).toContain("failed");
    expect(keywords).toContain("connect");
    expect(keywords).toContain("localhost");
    expect(keywords).toContain("5432");
  });

  it("filters tokens shorter than 3 characters", () => {
    const keywords = extractLineKeywords("a to be or not to be");
    expect(keywords).not.toContain("a");
    expect(keywords).not.toContain("to");
    expect(keywords).not.toContain("be");
    expect(keywords).not.toContain("or");
    expect(keywords).toContain("not");
  });

  it("lowercases all tokens", () => {
    const keywords = extractLineKeywords("Failed To CONNECT");
    expect(keywords).toContain("failed");
    expect(keywords).toContain("connect");
    expect(keywords).not.toContain("Failed");
    expect(keywords).not.toContain("CONNECT");
  });

  it("deduplicates tokens", () => {
    const keywords = extractLineKeywords("failed failed failed connect");
    const failedCount = keywords.filter((k) => k === "failed").length;
    expect(failedCount).toBe(1);
  });
});

describe("keywordIntersectionRatio", () => {
  it("returns 0 for empty template keywords", () => {
    const ratio = keywordIntersectionRatio(new Set(["failed", "connect"]), []);
    expect(ratio).toBe(0);
  });

  it("returns 1.0 for full intersection", () => {
    const ratio = keywordIntersectionRatio(
      new Set(["failed", "connect", "extra"]),
      ["failed", "connect"],
    );
    expect(ratio).toBe(1.0);
  });

  it("returns 0 for no intersection", () => {
    const ratio = keywordIntersectionRatio(
      new Set(["alpha", "beta"]),
      ["failed", "connect"],
    );
    expect(ratio).toBe(0);
  });

  it("returns correct ratio for partial intersection", () => {
    const ratio = keywordIntersectionRatio(
      new Set(["failed", "alpha"]),
      ["failed", "connect"],
    );
    expect(ratio).toBe(0.5);
  });
});

describe("matchL2", () => {
  it("returns matches with full keyword overlap (ratio 1.0)", () => {
    const records = [makeRecord({ keywords: ["failed", "connect"] })];
    const results = matchL2("failed to connect to localhost", records);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe("high");
    expect(results[0].score).toBe(1.0);
  });

  it("returns correct ratio for partial overlap", () => {
    const records = [makeRecord({ keywords: ["failed", "connect"] })];
    const results = matchL2("failed with unknown error", records);
    expect(results).toHaveLength(1);
    expect(results[0].score).toBe(0.5);
  });

  it("excludes records with zero keyword overlap", () => {
    const records = [makeRecord({ keywords: ["alpha", "beta"] })];
    const results = matchL2("failed to connect", records);
    expect(results).toHaveLength(0);
  });

  it("returns top-3 candidates when more than 3 exist", () => {
    const records = [
      makeRecord({ id: "aaaaaaaaaaaa", keywords: ["failed", "connect", "localhost", "extra", "bonus"] }), // 3/5 = 0.6
      makeRecord({ id: "bbbbbbbbbbbb", keywords: ["failed", "connect"] }), // 2/2 = 1.0
      makeRecord({ id: "cccccccccccc", keywords: ["failed", "connect", "localhost"] }), // 3/3 = 1.0
      makeRecord({ id: "dddddddddddd", keywords: ["failed", "connect", "localhost", "extra"] }), // 3/4 = 0.75
      makeRecord({ id: "eeeeeeeeeeee", keywords: ["unrelated", "stuff"] }), // 0/2 = 0
    ];
    const results = matchL2("failed to connect to localhost", records);
    expect(results).toHaveLength(3);
    // Sorted by ratio descending — stable sort preserves insertion order for ties
    expect(results[0].id).toBe("bbbbbbbbbbbb"); // 1.0
    expect(results[1].id).toBe("cccccccccccc"); // 1.0
    expect(results[2].id).toBe("dddddddddddd"); // 0.75
    // aaaaaaaaaaaa (0.6) and eeeeeeeeeeee (0) are excluded from top-3
  });

  it("excludes records already matched by L1 via excludeIds", () => {
    const records = [
      makeRecord({ id: "aaaaaaaaaaaa", keywords: ["failed", "connect"] }),
      makeRecord({ id: "bbbbbbbbbbbb", keywords: ["failed", "connect"] }),
    ];
    const excludeIds = new Set(["aaaaaaaaaaaa"]);
    const results = matchL2("failed to connect to localhost", records, excludeIds);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("bbbbbbbbbbbb");
  });
});
