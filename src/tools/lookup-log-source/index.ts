import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { renderTextResult } from "../tool-render.js";
import { loadConfig } from "../../core/config.js";
import { normalizeLogLine } from "./normalizer.js";
import { resolveSigPackages, scanJsonl, type ScanRecord } from "./file-resolver.js";
import { matchL1, matchL2, type MatchResult } from "./matcher.js";

interface LookupLogSourceParams {
  log_line: string;
  component?: string;
}

export function createLookupLogSourceTool(knowledgeDir?: string): ToolDefinition {
  return {
    name: "lookup_log_source",
    label: "Lookup Log Source",
    renderCall(args: any, theme: any) {
      return new Text(
        theme.fg("toolTitle", theme.bold("lookup_log_source")) +
          " " + theme.fg("accent", args?.log_line?.slice(0, 80) || ""),
        0, 0,
      );
    },
    renderResult: renderTextResult,
    description: `Look up the source code location and context for a runtime log line.
Matches the log line against pre-extracted .sig template packages to find where the log was emitted in source code.

Parameters:
- log_line: The raw log line from kubectl logs or similar (K8s prefixes are auto-stripped)
- component: Optional component name to restrict search (e.g., "volcano-scheduler")

Returns matching templates with source file, line number, function name, and surrounding source code.
L1 (regex exact match, confidence=exact) and L2 (keyword intersection, confidence=high) results are merged.`,
    parameters: Type.Object({
      log_line: Type.String({ description: "Raw log line from kubectl logs or similar output" }),
      component: Type.Optional(Type.String({ description: "Component name to restrict search scope" })),
    }),
    async execute(_toolCallId, rawParams) {
      const params = rawParams as LookupLogSourceParams;
      const logLine = params.log_line?.trim();
      if (!logLine) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "Empty log_line" }) }],
          details: {},
        };
      }

      // Step 1: Normalize
      const { message, detectedLevel } = normalizeLogLine(logLine);

      // Step 2: Resolve .sig packages
      const resolvedDir = knowledgeDir ?? path.resolve(process.cwd(), loadConfig().paths.knowledgeDir);
      const packages = resolveSigPackages(resolvedDir, params.component);
      if (packages.length === 0) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              matches: [],
              message: `No .sig packages found${params.component ? ` for component "${params.component}"` : ""}`,
            }),
          }],
          details: {},
        };
      }

      // Step 3: Scan and match
      const allRecords: ScanRecord[] = [];
      for (const pkg of packages) {
        await scanJsonl(pkg.templatesPath, (record) => {
          allRecords.push(record);
        });
      }

      const l1Results = matchL1(message, allRecords);
      const l1Ids = new Set(l1Results.map((r) => r.id));
      const l2Results = matchL2(message, allRecords, l1Ids);

      // Step 4: Merge and format output
      const allMatches: MatchResult[] = [...l1Results, ...l2Results];

      if (allMatches.length === 0) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              matches: [],
              message: `No matching template found in ${packages.length} component${packages.length > 1 ? "s" : ""}`,
              ...(detectedLevel ? { detected_level: detectedLevel } : {}),
            }),
          }],
          details: {},
        };
      }

      // Format output: core fields + context, omit regex/keywords/error_conditions/related_logs
      const formatted = allMatches.map((m) => ({
        component: m.component,
        file: m.file,
        line: m.line,
        function: m.function,
        level: m.level,
        template: m.template,
        confidence: m.confidence,
        ...(m.score !== undefined ? { score: Math.round(m.score * 1000) / 1000 } : {}),
        context: m.context,
      }));

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            matches: formatted,
            ...(detectedLevel ? { detected_level: detectedLevel } : {}),
          }, null, 2),
        }],
        details: {},
      };
    },
  };
}
