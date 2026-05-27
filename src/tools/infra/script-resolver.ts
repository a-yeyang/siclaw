import * as path from "node:path";
import * as fs from "node:fs";
import { createHash } from "node:crypto";
import { loadConfig } from "../../core/config.js";

function skillsBase(): string {
  const config = loadConfig();
  return path.resolve(process.cwd(), config.paths.skillsDir);
}

/** Builtin skills directories (baked into Docker image at skills/core/ and skills/extension/) */
const BUILTIN_TIERS = ["core", "extension"] as const;

function builtinCoreDir(): string {
  return path.resolve(process.cwd(), "skills", "core");
}

function builtinDirs(): string[] {
  return BUILTIN_TIERS.map(t => path.resolve(process.cwd(), "skills", t));
}

/** Load disabled builtins list (written by agentbox startup from bundle API) */
function loadDisabledBuiltins(): Set<string> {
  try {
    const filePath = path.join(skillsBase(), ".disabled-builtins.json");
    if (fs.existsSync(filePath)) {
      return new Set(JSON.parse(fs.readFileSync(filePath, "utf-8")) as string[]);
    }
  } catch { /* ignore malformed file */ }
  return new Set();
}

/**
 * Skill scope directories to search (in priority order, CLI fallback).
 * Higher-specificity scopes first: global > builtin.
 */
const SKILL_SCOPES = ["extension", "global", "core"];

/** Directory entry with associated scope */
interface ScopeDir {
  dir: string;
  scope: SkillScope;
}

/** Map scope directory names to SkillScope values */
const SCOPE_MAP: Record<string, SkillScope> = {
  extension: "builtin",
  global: "global",
  core: "builtin",
};

/**
 * Build the list of directories to search for a specific skill's scripts.
 *
 * Priority: global (bundle) > builtin (Docker image).
 * 1. Bundle-materialized resolved/ directory (built by materialize with priority merging)
 * 2. Legacy flat layout (bundle-materialized without scope subdirs)
 * 3. Scope subdirectories (extension > global > core)
 * 4. Builtin fallback (skills/core/) — unless disabled
 */
function getSkillScriptDirs(skill: string): ScopeDir[] {
  const base = skillsBase();

  // 1. Unified resolved/ directory (built by materialize with priority merging)
  // K8s mode: {base}/resolved/{skill}/scripts
  const resolvedPath = path.join(base, "resolved", skill, "scripts");
  if (fs.existsSync(resolvedPath)) return [{ dir: resolvedPath, scope: "global" }];

  // 2. Legacy flat layout (bundle-materialized without scope subdirs)
  const directPath = path.join(base, skill, "scripts");
  if (fs.existsSync(directPath)) return [{ dir: directPath, scope: "global" }];

  // 3. Scope subdirectories (extension > global > core)
  const dirs: ScopeDir[] = [];
  for (const scopeName of SKILL_SCOPES) {
    const dir = path.join(base, scopeName, skill, "scripts");
    if (fs.existsSync(dir)) dirs.push({ dir, scope: SCOPE_MAP[scopeName] });
  }
  if (dirs.length > 0) return dirs;

  // 4. Builtin fallback (skills/{core,extension}/) — for skills not in the bundle
  const disabled = loadDisabledBuiltins();
  if (!disabled.has(skill)) {
    for (const bDir of builtinDirs()) {
      const builtinPath = path.join(bDir, skill, "scripts");
      if (fs.existsSync(builtinPath)) return [{ dir: builtinPath, scope: "builtin" }];
    }
  }

  return [];
}

/**
 * Build the list of base directories for enumerating all skills.
 *
 * Priority: global (bundle) > builtin (Docker image).
 * Uses seenSkills dedup in callers so first-wins = highest priority.
 */
function getSkillBaseDirs(): string[] {
  const base = skillsBase();

  // 1. Legacy flat layout (bundle-materialized without scope subdirs)
  const hasDirectSkills = fs.existsSync(base) && fs.readdirSync(base).some(
    (entry) => !entry.startsWith(".") && !SKILL_SCOPES.includes(entry) &&
      fs.statSync(path.join(base, entry)).isDirectory(),
  );
  if (hasDirectSkills) {
    const dirs = [base];
    for (const bDir of builtinDirs()) {
      if (fs.existsSync(bDir)) dirs.push(bDir);
    }
    return dirs;
  }

  // 2. Scope subdirectories (extension > global > core)
  const dirs: string[] = [];
  for (const scope of SKILL_SCOPES) {
    const dir = path.join(base, scope);
    if (fs.existsSync(dir)) dirs.push(dir);
  }

  // 3. Builtin fallback (skills/{core,extension}/ from Docker image)
  for (const bDir of builtinDirs()) {
    if (fs.existsSync(bDir) && !dirs.includes(bDir)) dirs.push(bDir);
  }

  return dirs;
}

/** Check if a skill exists in the materialized bundle (global/builtin) */
export function skillExistsInBundle(skillName: string): boolean {
  const base = skillsBase();
  // Legacy flat layout
  const directDir = path.join(base, skillName);
  if (fs.existsSync(directDir) && fs.statSync(directDir).isDirectory()) return true;
  // Scope subdirectory layout
  for (const scopeDir of ["extension", "global"]) {
    const dir = path.join(base, scopeDir, skillName);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return true;
  }
  return false;
}

/** Check if a skill exists as a non-disabled builtin (skills/{core,extension}/) */
export function skillExistsAsBuiltin(skillName: string): boolean {
  const disabled = loadDisabledBuiltins();
  if (disabled.has(skillName)) return false;
  for (const bDir of builtinDirs()) {
    const dir = path.join(bDir, skillName);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return true;
  }
  return false;
}

export type SkillScope = "builtin" | "global";

export interface ResolvedScript {
  path: string;
  content: string;
  interpreter: "bash" | "python3";
  scope: SkillScope;
  skillFilePath?: string;
  skillFileHash?: string;
  siblingScriptCount?: number;
  scriptHash: string;
}

export interface ScriptArgSpec {
  name: string;
  aliases?: string[];
  required?: boolean;
  takesValue?: boolean;
  repeatable?: boolean;
  allowedValues?: string[];
}

export interface ScriptArgManifestEntry {
  args?: ScriptArgSpec[];
  allowExtraArgs?: boolean;
}

export interface ScriptArgValidationResult {
  schemaStatus: "present" | "missing" | "unknown";
  status: "valid" | "invalid" | "unknown";
  errors: string[];
  parsedArgs: {
    flags: Record<string, string[]>;
    positionals: string[];
  };
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function skillFileForScriptsDir(scriptsDir: string): { skillFilePath?: string; skillFileHash?: string } {
  const skillFile = path.join(path.dirname(scriptsDir), "SKILL.md");
  if (!fs.existsSync(skillFile)) return {};
  const content = fs.readFileSync(skillFile, "utf-8");
  return { skillFilePath: skillFile, skillFileHash: sha256(content) };
}

function countScriptsInDir(scriptsDir: string): number {
  try {
    return fs.readdirSync(scriptsDir)
      .filter((name) => name.endsWith(".sh") || name.endsWith(".py"))
      .length;
  } catch {
    return 0;
  }
}

/**
 * Resolve a skill script.
 * Searches the single skills directory (bundle model) or scope dirs (CLI fallback).
 */
export function resolveSkillScript(
  skill: string,
  script: string,
): ResolvedScript | null {
  for (const { dir, scope } of getSkillScriptDirs(skill)) {
    const scriptPath = path.join(dir, script);
    if (fs.existsSync(scriptPath)) {
      const content = fs.readFileSync(scriptPath, "utf-8");
      return {
        path: scriptPath,
        content,
        interpreter: script.endsWith(".py") ? "python3" : "bash",
        scope,
        ...skillFileForScriptsDir(dir),
        siblingScriptCount: countScriptsInDir(dir),
        scriptHash: sha256(content),
      };
    }
  }
  return null;
}

function readScriptManifest(skill: string): Record<string, ScriptArgManifestEntry> | null {
  for (const { dir } of getSkillScriptDirs(skill)) {
    const skillDir = path.dirname(dir);
    for (const name of ["script-manifest.json", "scripts.json"]) {
      const filePath = path.join(skillDir, name);
      if (!fs.existsSync(filePath)) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as any;
        if (parsed?.scripts && typeof parsed.scripts === "object") {
          return parsed.scripts as Record<string, ScriptArgManifestEntry>;
        }
        return parsed as Record<string, ScriptArgManifestEntry>;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function canonicalFlag(spec: ScriptArgSpec): string {
  return spec.name;
}

export function validateScriptArgs(skill: string, script: string, argv: string[]): ScriptArgValidationResult {
  const manifest = readScriptManifest(skill);
  const parsedArgs = { flags: {} as Record<string, string[]>, positionals: [] as string[] };
  if (!manifest) {
    for (const token of argv) {
      if (token.startsWith("-")) parsedArgs.flags[token.split("=")[0]!] = [];
      else parsedArgs.positionals.push(token);
    }
    return { schemaStatus: "missing", status: "unknown", errors: [], parsedArgs };
  }

  const entry = manifest[script];
  if (!entry) {
    return { schemaStatus: "missing", status: "unknown", errors: [], parsedArgs };
  }

  const specs = entry.args ?? [];
  const byName = new Map<string, ScriptArgSpec>();
  for (const spec of specs) {
    byName.set(spec.name, spec);
    for (const alias of spec.aliases ?? []) byName.set(alias, spec);
  }

  const errors: string[] = [];
  const seen = new Map<string, number>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (!token.startsWith("-") || token === "-") {
      parsedArgs.positionals.push(token);
      continue;
    }

    const eq = token.indexOf("=");
    const rawFlag = eq >= 0 ? token.slice(0, eq) : token;
    const inlineValue = eq >= 0 ? token.slice(eq + 1) : undefined;
    const spec = byName.get(rawFlag);
    if (!spec) {
      errors.push(`unknown_flag:${rawFlag}`);
      if (inlineValue !== undefined) parsedArgs.flags[rawFlag] = [inlineValue];
      else parsedArgs.flags[rawFlag] = [];
      continue;
    }

    const flag = canonicalFlag(spec);
    seen.set(flag, (seen.get(flag) ?? 0) + 1);
    if (!spec.repeatable && (seen.get(flag) ?? 0) > 1) errors.push(`duplicate_flag:${flag}`);

    let value = inlineValue;
    if (spec.takesValue) {
      if (value === undefined) {
        const next = argv[i + 1];
        if (next && !next.startsWith("-")) {
          value = next;
          i++;
        } else {
          errors.push(`missing_value:${flag}`);
        }
      }
      if (value !== undefined && spec.allowedValues && !spec.allowedValues.includes(value)) {
        errors.push(`invalid_value:${flag}`);
      }
      parsedArgs.flags[flag] = [...(parsedArgs.flags[flag] ?? []), value ?? ""];
    } else {
      if (inlineValue !== undefined) errors.push(`unexpected_value:${flag}`);
      parsedArgs.flags[flag] = [...(parsedArgs.flags[flag] ?? []), "true"];
    }
  }

  for (const spec of specs) {
    if (spec.required && !seen.has(canonicalFlag(spec))) {
      errors.push(`missing_required:${canonicalFlag(spec)}`);
    }
  }
  if (entry.allowExtraArgs === false && parsedArgs.positionals.length > 0) {
    errors.push("unexpected_positional_args");
  }

  return {
    schemaStatus: "present",
    status: errors.length > 0 ? "invalid" : "valid",
    errors,
    parsedArgs,
  };
}

/**
 * List available scripts for a given skill.
 */
export function listSkillScripts(skill: string): string[] {
  const scripts = new Set<string>();
  for (const { dir } of getSkillScriptDirs(skill)) {
    try {
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith(".sh") || f.endsWith(".py")) scripts.add(f);
      }
    } catch {
      /* dir may not exist */
    }
  }
  return [...scripts];
}

/**
 * List all skills that have scripts.
 */
export function listAllSkillsWithScripts(): Array<{
  skill: string;
  scripts: string[];
}> {
  const result: Array<{ skill: string; scripts: string[] }> = [];
  const seen = new Set<string>();
  const disabled = loadDisabledBuiltins();
  const builtinSet = new Set(builtinDirs());

  for (const base of getSkillBaseDirs()) {
    const isBuiltinDir = builtinSet.has(base);
    try {
      for (const d of fs.readdirSync(base, { withFileTypes: true })) {
        if (d.name.startsWith("_")) continue; // skip _lib etc.
        if (seen.has(d.name)) continue;
        // Check if entry is a directory (for symlinks, stat the target)
        let isDir = d.isDirectory();
        if (!isDir && d.isSymbolicLink()) {
          try {
            isDir = fs.statSync(path.join(base, d.name)).isDirectory();
          } catch { /* broken symlink */ }
        }
        if (!isDir) continue;
        // Skip disabled builtins so they don't shadow bundle overrides
        if (isBuiltinDir && disabled.has(d.name)) continue;
        const scriptsDir = path.join(base, d.name, "scripts");
        try {
          const scripts = fs
            .readdirSync(scriptsDir)
            .filter((f) => f.endsWith(".sh") || f.endsWith(".py"));
          if (scripts.length > 0) {
            seen.add(d.name);
            result.push({ skill: d.name, scripts });
          }
        } catch {
          /* no scripts dir */
        }
      }
    } catch {
      /* dir doesn't exist */
    }
  }

  return result;
}

/**
 * Unified entry point: resolve a script from skill scripts.
 * Requires a skill name.
 */
export function resolveScript(params: {
  skill?: string;
  script: string;
}): ResolvedScript | { error: string } {
  const script = params.script?.trim();
  if (!script) {
    return { error: "Script name is required." };
  }

  if (
    script.includes("/") ||
    script.includes("\\")
  ) {
    return {
      error: "Script name must not contain path separators.",
    };
  }

  const skill = params.skill?.trim();
  if (!skill) {
    return { error: "Skill name is required." };
  }
  if (skill.includes("/") || skill.includes("\\")) {
    return {
      error: "Skill name must not contain path separators.",
    };
  }

  const resolved = resolveSkillScript(skill, script);
  if (!resolved) {
    const available = listSkillScripts(skill);
    if (available.length > 0) {
      return {
        error: `Script "${script}" not found in skill "${skill}". Available: ${available.join(", ")}`,
      };
    }
    const allSkills = listAllSkillsWithScripts();
    let hint = `Skill "${skill}" has no scripts directory.`;
    if (allSkills.length > 0) {
      hint += `\nSkills with scripts: ${allSkills.map((s) => `${s.skill} (${s.scripts.join(", ")})`).join("; ")}`;
    }
    return { error: hint };
  }
  return resolved;
}
