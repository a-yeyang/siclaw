import { describe, expect, it } from "vitest";
import { CaseValidationError, loadCaseFromYaml } from "../src/case-loader.js";

const VALID_YAML = `
id: t1
title: "test"
fault:
  injector: image_pull_failure
  params: { namespace: siclaw, deployment: foo, container: app }
  propagation_wait_sec: 5
trigger:
  prompt: "diagnose"
  agent: sre-default
  max_steps: 5
oracle:
  must_use_skills: [a]
  may_use_skills: [b]
  must_not_use_skills: [c]
  rca_must_contain: ["root cause"]
  recommendation_must_contain: ["fix"]
budget:
  ttl_sec: 60
  max_tokens: 1000
`;

describe("loadCaseFromYaml", () => {
  it("parses a valid case", () => {
    const c = loadCaseFromYaml(VALID_YAML);
    expect(c.id).toBe("t1");
    expect(c.fault.injector).toBe("image_pull_failure");
    expect(c.oracle.must_use_skills).toEqual(["a"]);
    expect(c.budget.ttl_sec).toBe(60);
  });

  it("rejects YAML with no top-level mapping", () => {
    expect(() => loadCaseFromYaml("- one\n- two")).toThrow(CaseValidationError);
  });

  it("rejects missing id", () => {
    expect(() => loadCaseFromYaml(VALID_YAML.replace(/id: t1\n/, ""))).toThrow(/id: required/);
  });

  it("rejects bad id charset", () => {
    expect(() => loadCaseFromYaml(VALID_YAML.replace("id: t1", "id: 'a b!'"))).toThrow(/path \/ log key/);
  });

  it("rejects must_use ∩ must_not_use overlap", () => {
    const overlap = VALID_YAML.replace(
      "must_not_use_skills: [c]",
      "must_not_use_skills: [a]",
    );
    expect(() => loadCaseFromYaml(overlap)).toThrow(/must_use and must_not_use/);
  });

  it("rejects negative propagation_wait_sec", () => {
    const bad = VALID_YAML.replace("propagation_wait_sec: 5", "propagation_wait_sec: -1");
    expect(() => loadCaseFromYaml(bad)).toThrow(/non-negative integer/);
  });

  it("rejects non-snake_case injector", () => {
    const bad = VALID_YAML.replace("injector: image_pull_failure", "injector: ImagePullFailure");
    expect(() => loadCaseFromYaml(bad)).toThrow(/snake_case/);
  });

  it("treats may/must-not/keywords as optional", () => {
    const minimal = `
id: m
title: t
fault: { injector: x_fault, params: {}, propagation_wait_sec: 0 }
trigger: { prompt: hi, agent: a, max_steps: 1 }
oracle: { must_use_skills: [x] }
budget: { ttl_sec: 1, max_tokens: 1 }
`;
    const c = loadCaseFromYaml(minimal);
    expect(c.oracle.may_use_skills).toEqual([]);
    expect(c.oracle.rca_must_contain).toEqual([]);
  });
});
