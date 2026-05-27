import { parseArgs } from "./command-sets.js";
import { validateScriptArgs, type ResolvedScript } from "./script-resolver.js";
import { hashText, redactedPreview } from "../../shared/skill-audit-ledger.js";
import type { SkillAuditArgValidation } from "../../shared/diagnostic-events.js";

function redactParsedArgs(parsed: { flags: Record<string, string[]>; positionals: string[] }): string {
  const redacted = {
    flags: Object.fromEntries(
      Object.entries(parsed.flags).map(([key, values]) => [
        key,
        values.map((value) => redactedPreview(value, 200)),
      ]),
    ),
    positionals: parsed.positionals.map((value) => redactedPreview(value, 200)),
  };
  return JSON.stringify(redacted);
}

export function buildScriptArgAudit(skill: string, script: string, args: string | undefined): SkillAuditArgValidation {
  const rawArgs = args?.trim() ?? "";
  const argv = rawArgs ? parseArgs(rawArgs) : [];
  if (skill.includes("/") || skill.includes("\\") || script.includes("/") || script.includes("\\")) {
    return {
      schemaStatus: "unknown",
      status: "unknown",
      errors: [],
      argsPreview: rawArgs ? redactedPreview(rawArgs) : "",
      argsHash: hashText(rawArgs),
      parsedArgsJson: redactParsedArgs({ flags: {}, positionals: argv }),
    };
  }
  const validation = validateScriptArgs(skill, script, argv);
  return {
    schemaStatus: validation.schemaStatus,
    status: validation.status,
    errors: validation.errors,
    argsPreview: rawArgs ? redactedPreview(rawArgs) : "",
    argsHash: hashText(rawArgs),
    parsedArgsJson: redactParsedArgs(validation.parsedArgs),
  };
}

export function skillCallAuditMetadata(resolved: ResolvedScript): {
  skillFilePath?: string;
  skillFileHash?: string;
  skillKind: "scripted";
  scriptCount: number;
  scriptPath: string;
  scriptHash: string;
} {
  const scriptCount = resolved.siblingScriptCount ?? 1;
  return {
    skillFilePath: resolved.skillFilePath,
    skillFileHash: resolved.skillFileHash,
    skillKind: "scripted",
    scriptCount,
    scriptPath: resolved.path,
    scriptHash: resolved.scriptHash,
  };
}
