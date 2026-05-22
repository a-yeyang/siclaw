/**
 * Loads a Case from YAML text. Validates the design §3.2 schema strictly so a
 * malformed case is rejected at upload time instead of failing mid-run.
 */

import { load as loadYaml } from "js-yaml";
import type {
  BudgetSpec,
  Case,
  FaultSpec,
  OracleSpec,
  TriggerSpec,
} from "./types.js";

export class CaseValidationError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "CaseValidationError";
  }
}

export function loadCaseFromYaml(yaml: string): Case {
  let raw: unknown;
  try {
    raw = loadYaml(yaml);
  } catch (err) {
    throw new CaseValidationError(
      `YAML parse error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new CaseValidationError("Case must be a YAML mapping at the top level");
  }

  const obj = raw as Record<string, unknown>;
  const id = requireString(obj, "id");
  if (!/^[a-zA-Z0-9_.-]+$/.test(id)) {
    throw new CaseValidationError(
      `id "${id}" must match [a-zA-Z0-9_.-]+ (used as path / log key)`,
    );
  }
  const title = requireString(obj, "title");
  const fault = parseFault(obj.fault);
  const trigger = parseTrigger(obj.trigger);
  const oracle = parseOracle(obj.oracle);
  const budget = parseBudget(obj.budget);

  return { id, title, fault, trigger, oracle, budget };
}

function parseFault(raw: unknown): FaultSpec {
  if (!isObject(raw)) {
    throw new CaseValidationError("`fault` must be a mapping");
  }
  const injector = requireString(raw, "fault.injector");
  if (!/^[a-z][a-z0-9_]*$/.test(injector)) {
    throw new CaseValidationError(
      `fault.injector "${injector}" must be snake_case (matches reflective method names)`,
    );
  }
  const params = raw.params == null
    ? {}
    : (isObject(raw.params)
      ? (raw.params as Record<string, unknown>)
      : (() => { throw new CaseValidationError("fault.params must be a mapping if present"); })());
  const propagation_wait_sec = requireNonNegativeInt(raw, "fault.propagation_wait_sec");
  return { injector, params, propagation_wait_sec };
}

function parseTrigger(raw: unknown): TriggerSpec {
  if (!isObject(raw)) {
    throw new CaseValidationError("`trigger` must be a mapping");
  }
  const prompt = requireString(raw, "trigger.prompt");
  const agent = requireString(raw, "trigger.agent");
  const max_steps = requirePositiveInt(raw, "trigger.max_steps");
  return { prompt, agent, max_steps };
}

function parseOracle(raw: unknown): OracleSpec {
  if (!isObject(raw)) {
    throw new CaseValidationError("`oracle` must be a mapping");
  }
  const must_use_skills = parseStringList(raw, "oracle.must_use_skills");
  const may_use_skills = parseStringList(raw, "oracle.may_use_skills", true);
  const must_not_use_skills = parseStringList(raw, "oracle.must_not_use_skills", true);
  const rca_must_contain = parseStringList(raw, "oracle.rca_must_contain", true);
  const recommendation_must_contain = parseStringList(
    raw, "oracle.recommendation_must_contain", true,
  );
  // Cross-validation: overlap between must_use and must_not_use is contradictory.
  const overlap = must_use_skills.filter((s) => must_not_use_skills.includes(s));
  if (overlap.length > 0) {
    throw new CaseValidationError(
      `oracle: skill(s) appear in both must_use and must_not_use: ${overlap.join(", ")}`,
    );
  }
  return {
    must_use_skills,
    may_use_skills,
    must_not_use_skills,
    rca_must_contain,
    recommendation_must_contain,
  };
}

function parseBudget(raw: unknown): BudgetSpec {
  if (!isObject(raw)) {
    throw new CaseValidationError("`budget` must be a mapping");
  }
  const ttl_sec = requirePositiveInt(raw, "budget.ttl_sec");
  const max_tokens = requirePositiveInt(raw, "budget.max_tokens");
  return { ttl_sec, max_tokens };
}

// ── helpers ──────────────────────────────────────────────────

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function requireString(obj: Record<string, unknown>, dottedPath: string): string {
  const key = dottedPath.split(".").pop()!;
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new CaseValidationError(`${dottedPath}: required non-empty string`);
  }
  return v;
}

function requirePositiveInt(obj: Record<string, unknown>, dottedPath: string): number {
  const key = dottedPath.split(".").pop()!;
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v) || v <= 0) {
    throw new CaseValidationError(`${dottedPath}: required positive integer`);
  }
  return v;
}

function requireNonNegativeInt(obj: Record<string, unknown>, dottedPath: string): number {
  const key = dottedPath.split(".").pop()!;
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v) || v < 0) {
    throw new CaseValidationError(`${dottedPath}: required non-negative integer`);
  }
  return v;
}

function parseStringList(
  obj: Record<string, unknown>,
  dottedPath: string,
  optional = false,
): string[] {
  const key = dottedPath.split(".").pop()!;
  const v = obj[key];
  if (v == null) {
    if (optional) return [];
    throw new CaseValidationError(`${dottedPath}: required list of strings`);
  }
  if (!Array.isArray(v)) {
    throw new CaseValidationError(`${dottedPath}: must be a list`);
  }
  for (const item of v) {
    if (typeof item !== "string" || item.length === 0) {
      throw new CaseValidationError(`${dottedPath}: every entry must be a non-empty string`);
    }
  }
  return v as string[];
}
