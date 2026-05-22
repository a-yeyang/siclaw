import { describe, expect, it } from "vitest";
import { score } from "../src/evaluator/deterministic.js";
import type { ChatTrace, OracleSpec, SkillInvocation } from "../src/types.js";

function inv(skill: string): SkillInvocation {
  return {
    skill,
    script: null,
    args: null,
    toolName: "local_script",
    outcome: "success",
    durationMs: 10,
    createdAt: new Date(),
  };
}

function trace(skills: string[], finalText = ""): ChatTrace {
  return {
    sessionId: "s",
    skills: skills.map(inv),
    finalAssistantText: finalText,
    assistantSteps: 1,
    approxOutputTokens: 0,
    approxInputTokens: 0,
    durationMs: 0,
  };
}

function oracle(p: Partial<OracleSpec>): OracleSpec {
  return {
    must_use_skills: [],
    may_use_skills: [],
    must_not_use_skills: [],
    rca_must_contain: [],
    recommendation_must_contain: [],
    ...p,
  };
}

describe("deterministic.score", () => {
  it("perfect run", () => {
    const r = score(
      trace(["a", "b"], "the ImagePullBackOff means we should fix the image"),
      oracle({
        must_use_skills: ["a"],
        may_use_skills: ["b"],
        rca_must_contain: ["ImagePullBackOff"],
        recommendation_must_contain: ["image"],
      }),
    );
    expect(r.sufficiency).toBe(1);
    expect(r.necessity).toBe(1);
    expect(r.noise_ratio).toBe(0);
    expect(r.skill_score).toBe(1);
    expect(r.rca_misses).toEqual([]);
    expect(r.recommendation_misses).toEqual([]);
  });

  it("missing must_use lowers sufficiency", () => {
    const r = score(trace(["b"]), oracle({ must_use_skills: ["a", "b"] }));
    expect(r.sufficiency).toBe(0.5);
    expect(r.missing_must_use).toEqual(["a"]);
  });

  it("forbidden skill drops necessity", () => {
    const r = score(trace(["a", "bad"]), oracle({
      must_use_skills: ["a"],
      must_not_use_skills: ["bad"],
    }));
    expect(r.necessity).toBe(0.5);
    expect(r.forbidden_used).toEqual(["bad"]);
  });

  it("noise = skills outside must ∪ may ∪ must_not", () => {
    const r = score(trace(["a", "noise"]), oracle({
      must_use_skills: ["a"],
      may_use_skills: [],
    }));
    expect(r.noise_skills).toEqual(["noise"]);
    expect(r.noise_ratio).toBe(0.5);
  });

  it("empty must_use → sufficiency = 1", () => {
    const r = score(trace(["x"]), oracle({}));
    expect(r.sufficiency).toBe(1);
  });

  it("empty used → necessity = 1, noise_ratio = 0", () => {
    const r = score(trace([]), oracle({ must_not_use_skills: ["bad"] }));
    expect(r.necessity).toBe(1);
    expect(r.noise_ratio).toBe(0);
  });

  it("dedupes used skills across repeated calls", () => {
    const r = score(trace(["a", "a", "a"]), oracle({ must_use_skills: ["a"] }));
    expect(r.used_skills).toEqual(["a"]);
    expect(r.sufficiency).toBe(1);
  });

  it("keyword checks are case-insensitive", () => {
    const r = score(trace([], "Root cause: image pull failed"), oracle({
      rca_must_contain: ["IMAGE PULL"],
    }));
    expect(r.rca_hits).toEqual(["IMAGE PULL"]);
    expect(r.rca_misses).toEqual([]);
  });
});
