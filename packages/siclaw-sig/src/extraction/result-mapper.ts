/**
 * Maps Semgrep match results to ExtractionResult.
 *
 * Handles quote stripping, log level detection, and metavar flattening.
 */

import type { SemgrepMatch, SemgrepOutput } from "./semgrep-schema.js";
import type { ExtractionResult, ExtractionOutput, LogLevel } from "./types.js";

/**
 * Strips surrounding Go string literal quotes from a Semgrep-captured content string.
 *
 * Semgrep captures Go string literals with their quotes intact, e.g. `"hello %s"`.
 * This function removes the outer quotes and unescapes inner escaped quotes.
 */
export function stripGoQuotes(raw: string): string {
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    return raw.slice(1, -1).replace(/\\"/g, '"');
  }
  return raw;
}

/** Maps Go log function names to normalized log levels. */
const FUNCTION_LEVEL_MAP: Record<string, LogLevel> = {
  // klog printf
  Infof: "info",
  Warningf: "warning",
  Errorf: "error",
  Fatalf: "fatal",
  // klog structured
  InfoS: "info",
  ErrorS: "error",
  // logr
  Info: "info",
  Warn: "warning",
  Error: "error",
  Debug: "debug",
  Fatal: "fatal",
  // zap sugar printf
  Warnf: "warning",
  // zap sugar structured
  Infow: "info",
  Warnw: "warning",
  Errorw: "error",
};

/**
 * Detects the log level from matched code and metadata.
 *
 * Priority: metadata.level (if present) > function name from matchedCode > default "info".
 */
export function detectLevel(
  matchedCode: string,
  metadata: Record<string, unknown>,
): LogLevel {
  // Metadata takes precedence
  if (typeof metadata["level"] === "string") {
    return metadata["level"] as LogLevel;
  }

  // Scan matched code for function name
  const funcPattern =
    /\.(Infof|Warningf|Errorf|Fatalf|InfoS|ErrorS|Info|Warn|Error|Debug|Fatal|Warnf|Infow|Warnw|Errorw)\(/;
  const match = funcPattern.exec(matchedCode);
  if (match) {
    const funcName = match[1]!;
    const level = FUNCTION_LEVEL_MAP[funcName];
    if (level) return level;
  }

  return "info";
}

/**
 * Maps a single Semgrep match to an ExtractionResult.
 *
 * Fails fast if required metadata (framework, style) is missing.
 */
export function mapSemgrepMatch(match: SemgrepMatch): ExtractionResult {
  const metadata = match.extra.metadata ?? {};

  const framework = metadata["framework"];
  if (typeof framework !== "string") {
    throw new Error(
      `Missing metadata.framework in rule ${match.check_id} at ${match.path}:${match.start.line}`,
    );
  }

  const style = metadata["style"];
  if (style !== "printf" && style !== "structured") {
    throw new Error(
      `Missing or invalid metadata.style in rule ${match.check_id} at ${match.path}:${match.start.line}`,
    );
  }

  const metavars = match.extra.metavars ?? {};

  // Flatten metavars to key -> abstract_content
  const flatMetavars: Record<string, string> = {};
  for (const [key, val] of Object.entries(metavars)) {
    flatMetavars[key] = val.abstract_content;
  }

  // Extract template from $FMT or $MSG metavar
  let template: string;
  if (metavars["$FMT"]) {
    template = stripGoQuotes(metavars["$FMT"].abstract_content);
  } else if (metavars["$MSG"]) {
    template = stripGoQuotes(metavars["$MSG"].abstract_content);
  } else {
    throw new Error(
      `No $FMT or $MSG metavar in rule ${match.check_id} at ${match.path}:${match.start.line}`,
    );
  }

  // Extract kvRaw from $...KVPAIRS if present
  const kvRaw = metavars["$...KVPAIRS"]?.abstract_content ?? null;

  return {
    ruleId: match.check_id,
    framework,
    style,
    level: detectLevel(match.extra.lines, metadata),
    file: match.path,
    line: match.start.line,
    template,
    kvRaw,
    matchedCode: match.extra.lines,
    metavars: flatMetavars,
  };
}

/**
 * Maps the full Semgrep output to an ExtractionOutput.
 *
 * Individual match mapping errors are collected in `errors` rather than
 * aborting the entire run.
 */
export function mapSemgrepOutput(output: SemgrepOutput): ExtractionOutput {
  const results: ExtractionResult[] = [];
  const errors: string[] = [];

  // Collect Semgrep-reported errors
  if (output.errors) {
    for (const err of output.errors) {
      errors.push(err.message);
    }
  }

  // Map each match
  for (const match of output.results) {
    try {
      results.push(mapSemgrepMatch(match));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  const scannedFiles = output.paths?.scanned ?? [];

  return { results, errors, scannedFiles };
}
