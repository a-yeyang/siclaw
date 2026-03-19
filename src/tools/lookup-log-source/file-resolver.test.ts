import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ScanRecord,
  type SigPackage,
  resolveSigPackages,
  scanJsonl,
} from "./file-resolver.js";

describe("resolveSigPackages", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sig-resolver-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when knowledge directory does not exist", () => {
    const result = resolveSigPackages(path.join(tmpDir, "nonexistent"));
    expect(result).toEqual([]);
  });

  it("returns empty array when directory exists but has no component subdirectories", () => {
    const result = resolveSigPackages(tmpDir);
    expect(result).toEqual([]);
  });

  it("returns SigPackage entries for directories containing templates.jsonl", () => {
    const compDir = path.join(tmpDir, "my-app");
    fs.mkdirSync(compDir);
    fs.writeFileSync(path.join(compDir, "templates.jsonl"), "");

    const result = resolveSigPackages(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].component).toBe("my-app");
    expect(result[0].templatesPath).toBe(
      path.resolve(path.join(tmpDir, "my-app", "templates.jsonl")),
    );
  });

  it("skips directories without templates.jsonl", () => {
    // Directory with templates.jsonl
    const validDir = path.join(tmpDir, "valid-comp");
    fs.mkdirSync(validDir);
    fs.writeFileSync(path.join(validDir, "templates.jsonl"), "");

    // Directory without templates.jsonl
    const invalidDir = path.join(tmpDir, "no-templates");
    fs.mkdirSync(invalidDir);
    fs.writeFileSync(path.join(invalidDir, "other.txt"), "");

    // Regular file (not a directory)
    fs.writeFileSync(path.join(tmpDir, "not-a-dir.txt"), "");

    const result = resolveSigPackages(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].component).toBe("valid-comp");
  });

  it("component-scoped lookup returns single-element array when package exists", () => {
    const compDir = path.join(tmpDir, "target-comp");
    fs.mkdirSync(compDir);
    fs.writeFileSync(path.join(compDir, "templates.jsonl"), "");

    const result = resolveSigPackages(tmpDir, "target-comp");
    expect(result).toHaveLength(1);
    expect(result[0].component).toBe("target-comp");
  });

  it("component-scoped lookup returns empty array when package does not exist", () => {
    const result = resolveSigPackages(tmpDir, "missing-comp");
    expect(result).toEqual([]);
  });
});

describe("scanJsonl", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sig-scanner-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeRecord(overrides: Partial<ScanRecord> = {}): ScanRecord {
    return {
      id: "abcdef123456",
      component: "test-app",
      version: "v1.0.0",
      file: "main.go",
      line: 42,
      function: "main",
      level: "info",
      template: "starting server on %s",
      regex: null,
      keywords: ["starting", "server"],
      context: {
        source_lines: ['log.Infof("starting server on %s", addr)'],
        line_range: [40, 44],
      },
      ...overrides,
    };
  }

  function writeJsonl(filename: string, lines: string[]): string {
    const filePath = path.join(tmpDir, filename);
    fs.writeFileSync(filePath, lines.join("\n"));
    return filePath;
  }

  it("scans valid JSONL and invokes visitor for each record", async () => {
    const rec1 = makeRecord({ id: "aaaaaaaaaaaa" });
    const rec2 = makeRecord({ id: "bbbbbbbbbbbb", template: "shutting down" });
    const filePath = writeJsonl("valid.jsonl", [
      JSON.stringify(rec1),
      JSON.stringify(rec2),
    ]);

    const visited: ScanRecord[] = [];
    const count = await scanJsonl(filePath, (r) => visited.push(r));

    expect(count).toBe(2);
    expect(visited).toHaveLength(2);
    expect(visited[0].id).toBe("aaaaaaaaaaaa");
    expect(visited[1].id).toBe("bbbbbbbbbbbb");
  });

  it("skips empty lines", async () => {
    const rec = makeRecord();
    const filePath = writeJsonl("with-blanks.jsonl", [
      "",
      JSON.stringify(rec),
      "",
      "   ",
      JSON.stringify(rec),
      "",
    ]);

    const visited: ScanRecord[] = [];
    const count = await scanJsonl(filePath, (r) => visited.push(r));

    expect(count).toBe(2);
  });

  it("skips malformed JSON lines", async () => {
    const rec = makeRecord();
    const filePath = writeJsonl("malformed.jsonl", [
      "{invalid json",
      JSON.stringify(rec),
      "not json at all",
    ]);

    const visited: ScanRecord[] = [];
    const count = await scanJsonl(filePath, (r) => visited.push(r));

    expect(count).toBe(1);
    expect(visited[0].id).toBe(rec.id);
  });

  it("skips records missing required fields (id, template, keywords)", async () => {
    const validRec = makeRecord();
    const filePath = writeJsonl("missing-fields.jsonl", [
      // Missing id
      JSON.stringify({ template: "test", keywords: [] }),
      // Missing template
      JSON.stringify({ id: "aaaaaaaaaaaa", keywords: [] }),
      // Missing keywords
      JSON.stringify({ id: "aaaaaaaaaaaa", template: "test" }),
      // keywords not array
      JSON.stringify({ id: "aaaaaaaaaaaa", template: "test", keywords: "not-array" }),
      // Valid record
      JSON.stringify(validRec),
    ]);

    const visited: ScanRecord[] = [];
    const count = await scanJsonl(filePath, (r) => visited.push(r));

    expect(count).toBe(1);
    expect(visited[0].id).toBe(validRec.id);
  });

  it("returns correct count of visited records", async () => {
    const filePath = writeJsonl("count.jsonl", [
      JSON.stringify(makeRecord({ id: "111111111111" })),
      "{bad}",
      JSON.stringify(makeRecord({ id: "222222222222" })),
      JSON.stringify(makeRecord({ id: "333333333333" })),
    ]);

    const count = await scanJsonl(filePath, () => {});
    expect(count).toBe(3);
  });
});
