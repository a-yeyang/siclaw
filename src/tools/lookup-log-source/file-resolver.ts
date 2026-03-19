import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

/** Resolved .sig package location */
export interface SigPackage {
  /** Component name (directory name) */
  component: string;
  /** Absolute path to templates.jsonl */
  templatesPath: string;
}

/** Parsed JSONL record with fields needed for matching */
export interface ScanRecord {
  id: string;
  component: string;
  version: string;
  file: string;
  line: number;
  function: string;
  level: string;
  template: string;
  regex: string | null;
  keywords: string[];
  context: {
    source_lines: string[];
    line_range: [number, number];
  };
}

/**
 * Callback invoked for each valid record during scanning.
 * Return value is ignored — matching logic lives in the caller.
 */
export type RecordVisitor = (record: ScanRecord) => void;

/**
 * Default knowledge directory path relative to cwd.
 * Matches .siclaw/ convention used by skillsDir, userDataDir, etc.
 */
export const DEFAULT_KNOWLEDGE_DIR = ".siclaw/knowledge";

/**
 * Resolve .sig packages under the knowledge directory.
 *
 * @param knowledgeDir - Absolute path to knowledge directory (default: cwd + DEFAULT_KNOWLEDGE_DIR)
 * @param component - Optional component name to restrict search (O(1) lookup)
 * @returns Array of SigPackage with verified templates.jsonl paths
 */
export function resolveSigPackages(
  knowledgeDir?: string,
  component?: string,
): SigPackage[] {
  const dir = knowledgeDir ?? path.resolve(process.cwd(), DEFAULT_KNOWLEDGE_DIR);

  if (!fs.existsSync(dir)) {
    return [];
  }

  if (component) {
    const templatesPath = path.join(dir, component, "templates.jsonl");
    if (fs.existsSync(templatesPath)) {
      return [{ component, templatesPath: path.resolve(templatesPath) }];
    }
    return [];
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const packages: SigPackage[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const templatesPath = path.join(dir, entry.name, "templates.jsonl");
    if (fs.existsSync(templatesPath)) {
      packages.push({
        component: entry.name,
        templatesPath: path.resolve(templatesPath),
      });
    }
  }

  return packages;
}

/**
 * Stream a templates.jsonl file line-by-line, parsing each line and
 * invoking the visitor for valid records.
 *
 * Uses readline + createReadStream pattern (same as session-summarizer.ts)
 * to avoid loading entire file into memory.
 *
 * Invalid lines (malformed JSON, missing required fields) are silently skipped.
 *
 * @returns Count of records successfully visited
 */
export async function scanJsonl(
  templatesPath: string,
  visitor: RecordVisitor,
): Promise<number> {
  const stream = fs.createReadStream(templatesPath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let count = 0;

  for await (const line of rl) {
    if (line.trim() === "") continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !hasRequiredFields(parsed)
    ) {
      continue;
    }

    visitor(parsed as ScanRecord);
    count++;
  }

  return count;
}

function hasRequiredFields(obj: object): boolean {
  const rec = obj as Record<string, unknown>;
  return (
    typeof rec.id === "string" &&
    typeof rec.template === "string" &&
    Array.isArray(rec.keywords)
  );
}
