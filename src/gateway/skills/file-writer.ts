/**
 * Skill File Writer
 *
 * Handles two responsibilities:
 * 1. Builtin skill reading — reads Docker-baked skills from skills/core/ and skills/extension/
 * 2. Frontmatter parsing — utility for extracting/updating SKILL.md metadata
 *
 * NOTE: Personal/global/skillset skill content is stored in the database
 * (via skillContentRepo). Disk directories for these scopes are only used
 * by the materialize() pipeline (resource-handlers.ts) which writes DB
 * content to disk for agent execution. This class no longer writes or
 * manages personal/global/skillset directories.
 */

import fs from "node:fs";
import path from "node:path";
import { resolveUnderDir } from "../../shared/path-utils.js";

export interface SkillFiles {
  specs?: string;
  scripts?: Array<{
    name: string;
    content: string;
  }>;
}

export type SkillFileScope = "builtin" | "global" | "personal" | "skillset";

export interface ScannedSkill {
  dirName: string;
  name: string;
  description: string;
  scope: SkillFileScope;
  scripts: string[];
}

export class SkillFileWriter {
  private skillsDir: string;
  constructor(skillsDir: string) {
    // resolveUnderDir requires an absolute base — resolve defensively so callers
    // can pass relative paths (e.g. ".siclaw/skills" from config).
    this.skillsDir = path.resolve(skillsDir);
  }

  /** Initialize Skills PV (ensure dirs exist) */
  async init(): Promise<void> {
    for (const sub of ["core", "extension", "global", "user", "skillset", "platform"]) {
      const dir = path.join(this.skillsDir, sub);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    console.log("[skill-writer] Initialized skills directory:", this.skillsDir);
  }

  /** Resolve skill directory path (traversal-safe) */
  resolveDir(
    scope: SkillFileScope,
    dirName: string,
    userId?: string,
    skillSpaceId?: string,
  ): string {
    switch (scope) {
      case "builtin":
        return resolveUnderDir(this.skillsDir, "core", dirName);
      case "global":
        return resolveUnderDir(this.skillsDir, "global", dirName);
      case "personal":
        if (!userId) throw new Error("userId is required for personal scope");
        return resolveUnderDir(this.skillsDir, "user", userId, dirName);
      case "skillset":
        if (!skillSpaceId) throw new Error("skillSpaceId is required for skillset scope");
        return resolveUnderDir(this.skillsDir, "skillset", skillSpaceId, dirName);
    }
  }

  /** Read skill files from disk (used for builtin skills only) */
  readSkill(
    scope: SkillFileScope,
    dirName: string,
    userId?: string,
    skillSpaceId?: string,
  ): SkillFiles | null {
    let skillDir = this.resolveDir(scope, dirName, userId, skillSpaceId);

    // Fallback to Docker-baked cwd/skills/{core,extension} for builtin skills
    if (!fs.existsSync(skillDir) && scope === "builtin") {
      for (const tier of ["core", "extension"]) {
        const bakedDir = path.join(process.cwd(), "skills", tier, dirName);
        if (fs.existsSync(bakedDir)) { skillDir = bakedDir; break; }
      }
    }

    if (!fs.existsSync(skillDir)) return null;

    const result: SkillFiles = {};

    // Read SKILL.md
    const specPath = path.join(skillDir, "SKILL.md");
    if (fs.existsSync(specPath)) {
      result.specs = fs.readFileSync(specPath, "utf-8");
    }

    // Read scripts
    const scriptsDir = path.join(skillDir, "scripts");
    if (fs.existsSync(scriptsDir)) {
      result.scripts = [];
      for (const name of fs.readdirSync(scriptsDir)) {
        const content = fs.readFileSync(
          path.join(scriptsDir, name),
          "utf-8",
        );
        result.scripts.push({ name, content });
      }
    }

    return result;
  }

  /** Split specs into { before, yaml, after } around the frontmatter block */
  private splitFrontmatter(specs: string): { before: string; yaml: string; after: string } | null {
    const match = specs.match(/^(---\n)([\s\S]*?)(\n---)([\s\S]*)$/);
    if (!match) return null;
    return { before: match[1], yaml: match[2], after: match[3] + match[4] };
  }

  /** Strip YAML quotes from a raw value string */
  private unquoteYaml(raw: string): string {
    const v = raw.trim();
    if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
    if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
    return v;
  }

  /** Parse YAML frontmatter from SKILL.md content */
  parseFrontmatter(specs: string): { name: string; description: string } {
    const fm = this.splitFrontmatter(specs);
    if (!fm) return { name: "", description: "" };
    const { yaml } = fm;

    // Extract name (may be quoted with single or double quotes)
    const nameMatch = yaml.match(/^name:\s*(.+)$/m);
    const name = nameMatch ? this.unquoteYaml(nameMatch[1]) : "";

    // Extract description — handles both inline and block scalar (>- / >)
    let description = "";
    // Block scalar first: "description: >-" or "description: >" followed by indented lines
    const blockMatch = yaml.match(
      /^description:\s*>-?\s*\n((?:[ \t]+.+\n?)+)/m,
    );
    if (blockMatch) {
      description = blockMatch[1]
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join(" ");
    } else {
      // Inline: "description: some text"
      const descInlineMatch = yaml.match(/^description:\s*(.+)$/m);
      if (descInlineMatch) {
        description = descInlineMatch[1].trim();
      }
    }

    return { name, description };
  }

  /** Replace the `name:` field inside YAML frontmatter, preserving everything else */
  setFrontmatterName(specs: string, newName: string): string {
    // Sanitize: strip newlines to prevent YAML injection
    const safeName = newName.replace(/[\r\n]/g, "").trim();
    if (!safeName) return specs;
    // Single-quote to prevent YAML special char issues (: # { } ' etc.)
    const quoted = `'${safeName.replace(/'/g, "''")}'`;
    const fm = this.splitFrontmatter(specs);
    if (!fm) {
      // No frontmatter — prepend one
      return `---\nname: ${quoted}\n---\n${specs}`;
    }
    const { before, yaml, after } = fm;
    const nameMatch = yaml.match(/^name:\s*.+$/m);
    if (nameMatch) {
      // Replace existing name field
      const updatedYaml = yaml.replace(/^name:\s*.+$/m, `name: ${quoted}`);
      return `${before}${updatedYaml}${after}`;
    }
    // No name field — add it as the first field
    return `${before}name: ${quoted}\n${yaml}${after}`;
  }

  /** Scan a single directory for skills */
  private scanDir(
    dir: string,
    scope: SkillFileScope,
  ): ScannedSkill[] {
    if (!fs.existsSync(dir)) return [];

    const results: ScannedSkill[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip non-directories and _ prefixed (e.g. _lib)
      if (!entry.isDirectory() || entry.name.startsWith("_")) continue;

      const skillMdPath = path.join(dir, entry.name, "SKILL.md");
      if (!fs.existsSync(skillMdPath)) continue;

      const specs = fs.readFileSync(skillMdPath, "utf-8");
      const { name, description } = this.parseFrontmatter(specs);

      // List scripts
      const scriptsDir = path.join(dir, entry.name, "scripts");
      let scripts: string[] = [];
      if (fs.existsSync(scriptsDir)) {
        scripts = fs.readdirSync(scriptsDir).filter((f) => !f.startsWith("."));
      }

      results.push({
        dirName: entry.name,
        name: name || entry.name,
        description,
        scope,
        scripts,
      });
    }

    return results;
  }

  /** Scan all skills under a scope directory (builtin only) */
  scanScope(scope: "builtin" | "global"): ScannedSkill[] {
    // "global" merges builtin + global-dir-scoped skills
    if (scope === "global") {
      const builtins = this.scanScope("builtin");
      const globalDir = path.join(this.skillsDir, "global");
      const globalSkills = this.scanDir(globalDir, "global");
      return [...builtins, ...globalSkills];
    }
    if (scope === "builtin") {
      const results: ScannedSkill[] = [];
      const seen = new Set<string>();

      // Scan Docker-baked cwd/skills/core and cwd/skills/extension
      for (const tier of ["core", "extension"]) {
        const bakedDir = path.join(process.cwd(), "skills", tier);
        for (const s of this.scanDir(bakedDir, "builtin")) {
          if (!seen.has(s.dirName)) { seen.add(s.dirName); results.push(s); }
        }
      }

      return results;
    }

    // Exhaustive — both "global" and "builtin" handled above
    return [];
  }

}
