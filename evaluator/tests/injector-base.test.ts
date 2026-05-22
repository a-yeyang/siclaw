import { describe, expect, it } from "vitest";
import { FaultInjector } from "../src/injectors/base.js";

class GoodInjector extends FaultInjector {
  readonly name = "good";
  calls: string[] = [];

  async inject_thing(p: Record<string, unknown>): Promise<void> {
    this.calls.push(`inject_thing:${JSON.stringify(p)}`);
  }
  async recover_thing(_p: Record<string, unknown>): Promise<void> {
    this.calls.push("recover_thing");
  }
}

class MissingRecover extends FaultInjector {
  readonly name = "missing";
  async inject_thing(): Promise<void> { /* noop */ }
}

describe("FaultInjector reflective dispatch", () => {
  it("dispatches inject_X / recover_X by name", async () => {
    const g = new GoodInjector(null as never);
    await g.inject("thing", { a: 1 });
    await g.recover("thing", {});
    expect(g.calls).toEqual([`inject_thing:{"a":1}`, "recover_thing"]);
  });

  it("throws when no inject_X exists", async () => {
    const g = new GoodInjector(null as never);
    await expect(g.inject("missing", {})).rejects.toThrow(/no inject_missing/);
  });

  it("assertPaired catches missing recover_X at registration time", () => {
    const bad = new MissingRecover(null as never);
    expect(() => bad.assertPaired()).toThrow(/missing recover for: thing/);
  });

  it("assertPaired passes on a paired injector", () => {
    const ok = new GoodInjector(null as never);
    expect(() => ok.assertPaired()).not.toThrow();
  });
});
