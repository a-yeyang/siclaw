/**
 * End-to-end smoke test of the run-engine using fully-mocked dependencies.
 *
 * Verifies the critical invariants:
 *   - inject runs before trigger
 *   - recover runs even when trigger fails
 *   - recover runs even when the trace reader fails
 *   - completed runs produce a non-null score
 */

import { describe, expect, it } from "vitest";
import type { ChatTraceReader } from "../src/chat-trace-reader.js";
import { FaultInjector } from "../src/injectors/base.js";
import { InjectorRegistry } from "../src/injectors/registry.js";
import { RunEngine } from "../src/run-engine.js";
import type { SiclawClient } from "../src/siclaw-client.js";
import type { Case, ChatTrace } from "../src/types.js";

class StubInjector extends FaultInjector {
  readonly name = "stub";
  log: string[] = [];
  async inject_stub(): Promise<void> { this.log.push("inject"); }
  async recover_stub(): Promise<void> { this.log.push("recover"); }
}

function makeRegistry(): { reg: InjectorRegistry; injector: StubInjector } {
  const injector = new StubInjector({ allowedNamespace: "siclaw" } as never);
  const reg = Object.assign(new InjectorRegistry({ allowedNamespace: "siclaw" } as never), {});
  reg.register(injector);
  return { reg, injector };
}

const CASE: Case = {
  id: "c1",
  title: "t",
  fault: { injector: "stub", params: {}, propagation_wait_sec: 0 },
  trigger: { prompt: "go", agent: "a", max_steps: 5 },
  oracle: {
    must_use_skills: ["s1"],
    may_use_skills: [],
    must_not_use_skills: [],
    rca_must_contain: [],
    recommendation_must_contain: [],
  },
  budget: { ttl_sec: 30, max_tokens: 1000 },
};

const TRACE: ChatTrace = {
  sessionId: "sess",
  skills: [{
    skill: "s1", script: null, args: null, toolName: "local_script",
    outcome: "success", durationMs: 10, createdAt: new Date(),
  }],
  finalAssistantText: "done",
  assistantSteps: 1,
  approxOutputTokens: 1,
  approxInputTokens: 1,
  durationMs: 5,
};

function siclawOk(): SiclawClient {
  return {
    createSession: async () => "sess",
    sendAndWait: async () => ({ doneAt: Date.now(), events: 3 }),
  } as never;
}
function readerOk(): ChatTraceReader {
  return { read: async () => TRACE } as never;
}

describe("RunEngine.runCase", () => {
  it("completes happy-path and recovers", async () => {
    const { reg, injector } = makeRegistry();
    const engine = new RunEngine({ injectors: reg, siclaw: siclawOk(), traceReader: readerOk() });
    const r = await engine.runCase(CASE);
    expect(r.status).toBe("completed");
    expect(r.recovered).toBe(true);
    expect(r.score?.sufficiency).toBe(1);
    expect(injector.log).toEqual(["inject", "recover"]);
  });

  it("recovers even when sendAndWait throws", async () => {
    const { reg, injector } = makeRegistry();
    const siclaw = {
      createSession: async () => "sess",
      sendAndWait: async () => { throw new Error("portal exploded"); },
    } as unknown as SiclawClient;
    const engine = new RunEngine({ injectors: reg, siclaw, traceReader: readerOk() });
    const r = await engine.runCase(CASE);
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/portal exploded/);
    expect(r.recovered).toBe(true);
    expect(injector.log).toEqual(["inject", "recover"]);
  });

  it("recovers even when traceReader throws", async () => {
    const { reg, injector } = makeRegistry();
    const reader = { read: async () => { throw new Error("db gone"); } } as unknown as ChatTraceReader;
    const engine = new RunEngine({ injectors: reg, siclaw: siclawOk(), traceReader: reader });
    const r = await engine.runCase(CASE);
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/db gone/);
    expect(r.recovered).toBe(true);
    expect(injector.log).toEqual(["inject", "recover"]);
  });

  it("when inject itself fails, recover is NOT called (nothing to undo)", async () => {
    class BadInjector extends FaultInjector {
      readonly name = "bad";
      log: string[] = [];
      async inject_bad(): Promise<void> {
        this.log.push("inject-attempt");
        throw new Error("k8s 403");
      }
      async recover_bad(): Promise<void> { this.log.push("recover"); }
    }
    const bad = new BadInjector({ allowedNamespace: "siclaw" } as never);
    const reg = new InjectorRegistry({ allowedNamespace: "siclaw" } as never);
    reg.register(bad);
    const engine = new RunEngine({ injectors: reg, siclaw: siclawOk(), traceReader: readerOk() });
    const c = { ...CASE, fault: { ...CASE.fault, injector: "bad" } };
    const r = await engine.runCase(c);
    expect(r.status).toBe("failed");
    expect(r.recovered).toBe(false);
    expect(bad.log).toEqual(["inject-attempt"]);
  });
});
