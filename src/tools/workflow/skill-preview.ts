import type { ToolEntry } from "../../core/tool-registry.js";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";

interface SkillPreviewParams {
  dir: string;
}

export function createSkillPreviewTool(): ToolDefinition {
  return {
    name: "skill_preview",
    label: "Skill Preview",
    description: `Render a skill draft as a structured preview panel with copy buttons.

**Workflow** — when the user asks to create, modify, or improve a skill:
1. First explain what you plan to build or change.
2. Write the files to \`.siclaw/user-data/skill-drafts/<name>/\`:
   - \`SKILL.md\` — the skill spec (YAML frontmatter + markdown body)
   - \`scripts/<script-name>.sh\` or \`.py\` — optional helper scripts
3. Call \`skill_preview\` with the directory path **in a separate turn** (do NOT combine write + skill_preview in the same tool call batch — it may exceed output limits).

The tool reads all files from the directory, returns them as a structured preview, and cleans up the draft directory.

**SKILL.md format**:
\`\`\`
---
name: <kebab-case-name>
description: >-
  One-line summary. Mention the execution tool if the skill uses scripts.
---
# <Title>
## Purpose    — what problem this solves
## Tool       — execution tool invocation (required for script-based skills)
## Parameters — table of required/optional parameters
## Procedure  — step-by-step actions with concrete commands
## Examples   — concrete tool invocations with realistic parameters
\`\`\`

**Script execution modes**:
| Tool | Runs where | When to use |
|------|-----------|-------------|
| \`local_script\` | AgentBox | kubectl commands from outside the cluster — most common |
| \`node_script\` | K8s node | Needs host tools, /proc, /sys, devices |
| \`pod_script\` | Inside a pod | Diagnostics inside a running container |
| \`node_script\` + \`netns\` | Node + pod network ns | Host tools + pod network view |`,
    parameters: Type.Object({
      dir: Type.String({
        description: "Path to the skill draft directory (e.g. '.siclaw/user-data/skill-drafts/check-pod-oom')",
      }),
    }),
    async execute(_toolCallId, rawParams) {
      const params = rawParams as SkillPreviewParams;
      const dir = params.dir?.trim();

      if (!dir) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "dir is required" }) }],
          details: { error: true },
        };
      }

      if (!fs.existsSync(dir)) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Directory not found: ${dir}` }) }],
          details: { error: true },
        };
      }

      // Read SKILL.md
      const specPath = path.join(dir, "SKILL.md");
      if (!fs.existsSync(specPath)) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `SKILL.md not found in ${dir}` }) }],
          details: { error: true },
        };
      }
      const specs = fs.readFileSync(specPath, "utf-8");

      // Parse name and description from YAML frontmatter
      let name = path.basename(dir);
      let description = "";
      let type = "Custom";
      const fmMatch = specs.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        const fm = fmMatch[1];
        const nameMatch = fm.match(/^name:\s*(.+)$/m);
        if (nameMatch) name = nameMatch[1].trim();
        // Multiline: "description: >-\n  line1\n  line2" or inline: "description: one line"
        const descMulti = fm.match(/^description:\s*>-?\s*\n((?:[ \t]+.+\n?)+)/m);
        if (descMulti) {
          description = descMulti[1].trim().replace(/\n\s*/g, " ");
        } else {
          const descInline = fm.match(/^description:\s*(?!>)(.+)$/m);
          if (descInline) description = descInline[1].trim();
        }
        const typeMatch = fm.match(/^type:\s*(.+)$/m);
        if (typeMatch) type = typeMatch[1].trim();
      }

      // Read scripts
      const scripts: Array<{ name: string; content: string }> = [];
      const scriptsDir = path.join(dir, "scripts");
      if (fs.existsSync(scriptsDir) && fs.statSync(scriptsDir).isDirectory()) {
        for (const f of fs.readdirSync(scriptsDir).sort()) {
          const fp = path.join(scriptsDir, f);
          if (fs.statSync(fp).isFile()) {
            scripts.push({ name: f, content: fs.readFileSync(fp, "utf-8") });
          }
        }
      }

      // Clean up draft directory
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // non-critical — NFS might delay deletion
      }

      const result = {
        skill: { name, description, type, specs, scripts },
        summary: `Skill preview for '${name}'. Click View to inspect and copy.`,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: {},
      };
    },
  };
}

export const registration: ToolEntry = {
  category: "workflow",
  create: (_refs) => createSkillPreviewTool(),
  modes: ["web", "channel"],
  platform: true,
};
