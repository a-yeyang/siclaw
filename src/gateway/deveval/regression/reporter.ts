/**
 * Regression Reporter — renders CaseResult[] into a markdown report.
 */

import type { CaseResult } from "./runner.js";

export interface ReportMeta {
  runId: string;
  startedAt: string;
  finishedAt: string;
  agentVersion?: string;
  modelProvider?: string;
  modelId?: string;
}

export function renderReport(results: CaseResult[], meta: ReportMeta): string {
  const pass = results.filter(r => r.outcome === "PASS").length;
  const fail = results.filter(r => r.outcome === "FAIL").length;
  const skip = results.filter(r => r.outcome === "SKIP").length;
  const error = results.filter(r => r.outcome === "ERROR").length;
  const missing = results.filter(r => r.outcome === "MISSING_CONTEXT").length;

  const lines: string[] = [];

  lines.push(`# 回归测试报告`);
  lines.push("");
  lines.push(`PASS: ${pass} | FAIL: ${fail} | ERROR: ${error} | SKIP: ${skip} | MISSING_CONTEXT: ${missing} | 总计: ${results.length}`);
  lines.push("");

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`## Case ${i + 1}: ${r.id}`);
    lines.push("");

    lines.push(`### 结果`);
    lines.push("");
    lines.push(`- **结果**: ${outcomeIcon(r.outcome)} ${r.outcome}`);
    lines.push(`- **标题**: ${r.title}`);
    lines.push(`- **类型**: ${r.reproducible ? "reproducible" : "knowledge-qa"}`);
    if (r.scoreCommands != null) {
      lines.push(`- **命令分**: ${r.scoreCommands}/5 (阈值 ${r.passThreshold.commands})`);
    }
    if (r.scoreConclusion != null) {
      lines.push(`- **结论分**: ${r.scoreConclusion}/5 (阈值 ${r.passThreshold.conclusion})`);
    }
    lines.push(`- **耗时**: ${formatDuration(r.durationMs)}`);
    if (r.usedCustomRubric) lines.push(`- **评分规则**: 自定义`);
    if (r.reason) lines.push(`- **原因**: ${r.reason}`);
    if (r.podName) lines.push(`- **Pod**: \`${r.podName}\``);
    if (r.namespace) lines.push(`- **Namespace**: \`${r.namespace}\``);
    lines.push("");

    if (r.workOrderText) {
      lines.push(`### 工单描述`);
      lines.push("");
      for (const l of r.workOrderText.split("\n")) lines.push(`> ${l}`);
      lines.push("");
    }

    if (r.scoreReasoning) {
      lines.push(`### 评分理由`);
      lines.push("");
      for (const l of r.scoreReasoning.split("\n")) lines.push(`> ${l}`);
      lines.push("");
    }

    if (r.agentResponse) {
      lines.push(`### Agent 分析结论`);
      lines.push("");
      pushPre(lines, truncate(r.agentResponse, 4000));
      lines.push("");
    }

    if (r.agentCommands && r.agentCommands.length > 0) {
      lines.push(`### Agent 执行命令`);
      lines.push("");
      pushPre(lines, r.agentCommands.join("\n"));
      lines.push("");
    }

    if (r.expectedAnswer) {
      lines.push(`### 期望结论`);
      lines.push("");
      pushPre(lines, r.expectedAnswer);
      lines.push("");
    }

    if (r.reproducible && r.injectCommand) {
      lines.push(`### 故障注入命令`);
      lines.push("");
      pushPre(lines, r.injectCommand);
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

function outcomeIcon(o: CaseResult["outcome"]): string {
  switch (o) {
    case "PASS": return "✅";
    case "FAIL": return "❌";
    case "SKIP": return "⏭️";
    case "ERROR": return "⚠️";
    case "MISSING_CONTEXT": return "📭";
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n...[truncated ${s.length - max} chars]`;
}

/**
 * Wrap content in HTML <pre> tags. Unlike markdown fenced code blocks,
 * <pre> cannot be broken by any content inside — no backtick matching issues.
 */
function pushPre(lines: string[], content: string): void {
  const escaped = content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  lines.push("<pre>");
  lines.push(escaped);
  lines.push("</pre>");
}
