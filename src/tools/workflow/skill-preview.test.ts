import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createSkillPreviewTool, registration } from "./skill-preview.js";

describe("skill_preview tool", () => {
  let tmpDir: string;
  let tool: ReturnType<typeof createSkillPreviewTool>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-preview-test-"));
    tool = createSkillPreviewTool();
  });

  afterEach(() => {
    // Clean up in case test didn't trigger cleanup
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function exec(params: Record<string, unknown>) {
    return tool.execute("test-id", params, undefined, {} as any);
  }

  function writeSkill(skillMd: string, scripts?: Array<{ name: string; content: string }>) {
    const skillDir = path.join(tmpDir, "test-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillMd, "utf-8");
    if (scripts) {
      const scriptsDir = path.join(skillDir, "scripts");
      fs.mkdirSync(scriptsDir, { recursive: true });
      for (const s of scripts) {
        fs.writeFileSync(path.join(scriptsDir, s.name), s.content, "utf-8");
      }
    }
    return skillDir;
  }

  // --- Validation ---

  it("returns error for empty dir", async () => {
    const result = await exec({ dir: "" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("dir is required");
    expect(result.details).toHaveProperty("error", true);
  });

  it("returns error for non-existent directory", async () => {
    const result = await exec({ dir: "/tmp/nonexistent-skill-dir-12345" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("Directory not found");
  });

  it("returns error when SKILL.md is missing", async () => {
    const skillDir = path.join(tmpDir, "empty-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    const result = await exec({ dir: skillDir });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("SKILL.md not found");
  });

  // --- Frontmatter parsing ---

  it("parses name and inline description from frontmatter", async () => {
    const dir = writeSkill(`---
name: check-pod-oom
description: Diagnose OOM killed pods
type: Monitoring
---
# Check Pod OOM
`);
    const result = await exec({ dir });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.skill.name).toBe("check-pod-oom");
    expect(parsed.skill.description).toBe("Diagnose OOM killed pods");
    expect(parsed.skill.type).toBe("Monitoring");
  });

  it("parses multiline description from frontmatter", async () => {
    const dir = writeSkill(`---
name: gpu-diag
description: >-
  Diagnose GPU NVLink errors.
  Supports CRC and replay error detection.
---
# GPU Diag
`);
    const result = await exec({ dir });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.skill.name).toBe("gpu-diag");
    expect(parsed.skill.description).toContain("Diagnose GPU NVLink errors");
    expect(parsed.skill.description).toContain("Supports CRC");
  });

  it("falls back to directory name when frontmatter has no name", async () => {
    const dir = writeSkill(`---
description: Some skill
---
# No Name Skill
`);
    const result = await exec({ dir });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.skill.name).toBe("test-skill");
  });

  it("handles SKILL.md without frontmatter", async () => {
    const dir = writeSkill("# Just a title\n\nSome content");
    const result = await exec({ dir });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.skill.name).toBe("test-skill"); // directory name
    expect(parsed.skill.description).toBe("");
    expect(parsed.skill.type).toBe("Custom");
    expect(parsed.skill.specs).toBe("# Just a title\n\nSome content");
  });

  // --- Scripts ---

  it("reads scripts from scripts/ directory", async () => {
    const dir = writeSkill(`---
name: my-skill
description: test
---
# My Skill
`, [
      { name: "check.sh", content: "#!/bin/bash\necho hello" },
      { name: "setup.py", content: "#!/usr/bin/env python3\nprint('hi')" },
    ]);
    const result = await exec({ dir });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.skill.scripts).toHaveLength(2);
    expect(parsed.skill.scripts[0].name).toBe("check.sh");
    expect(parsed.skill.scripts[0].content).toContain("echo hello");
    expect(parsed.skill.scripts[1].name).toBe("setup.py");
    expect(parsed.skill.scripts[1].content).toContain("print('hi')");
  });

  it("returns empty scripts array when no scripts/ directory", async () => {
    const dir = writeSkill(`---
name: no-scripts
description: Pure guidance skill
---
# No Scripts
`);
    const result = await exec({ dir });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.skill.scripts).toEqual([]);
  });

  it("scripts are sorted by name", async () => {
    const dir = writeSkill(`---
name: sorted
description: test
---
# Sorted
`, [
      { name: "z-last.sh", content: "last" },
      { name: "a-first.sh", content: "first" },
    ]);
    const result = await exec({ dir });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.skill.scripts[0].name).toBe("a-first.sh");
    expect(parsed.skill.scripts[1].name).toBe("z-last.sh");
  });

  // --- Cleanup ---

  it("cleans up draft directory after reading", async () => {
    const dir = writeSkill(`---
name: cleanup-test
description: test
---
# Cleanup
`);
    expect(fs.existsSync(dir)).toBe(true);
    await exec({ dir });
    expect(fs.existsSync(dir)).toBe(false);
  });

  // --- Output format ---

  it("returns expected JSON structure", async () => {
    const dir = writeSkill(`---
name: structured
description: Test structure
type: Network
---
# Structured Skill
`, [{ name: "run.sh", content: "#!/bin/bash\necho ok" }]);
    const result = await exec({ dir });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveProperty("skill");
    expect(parsed).toHaveProperty("summary");
    expect(parsed.skill).toHaveProperty("name", "structured");
    expect(parsed.skill).toHaveProperty("description", "Test structure");
    expect(parsed.skill).toHaveProperty("type", "Network");
    expect(parsed.skill).toHaveProperty("specs");
    expect(parsed.skill).toHaveProperty("scripts");
    expect(parsed.skill.specs).toContain("# Structured Skill");
    expect(parsed.summary).toContain("structured");
  });

  // --- Registration ---

  it("registration has correct modes and platform flag", () => {
    expect(registration.modes).toEqual(["web", "channel"]);
    expect(registration.platform).toBe(true);
    expect(registration.category).toBe("workflow");
  });
});
