/**
 * FaultInjector base — reflective inject_<type> / recover_<type> dispatch.
 *
 * Borrowed in spirit from AIOpsLab's `aiopslab/generators/fault/base.py`:
 * concrete subclasses implement methods named `inject_<fault>(params)` and
 * `recover_<fault>(params)`. The base looks them up by name so the case YAML
 * only needs an injector key — no per-case branching in the engine.
 *
 * Strict contract: every `inject_X` MUST be paired with `recover_X` in the
 * SAME class. `assertPaired()` is run at registration time so missing pairs
 * fail at boot, not at fault-recovery-after-failure time.
 */

import type { K8sClient } from "../k8s-client.js";

export type InjectorParams = Record<string, unknown>;

export abstract class FaultInjector {
  constructor(protected readonly k8s: K8sClient) {}

  /** Subclasses set this so the registry can label results. */
  abstract readonly name: string;

  async inject(faultType: string, params: InjectorParams): Promise<void> {
    const method = (this as unknown as Record<string, unknown>)[`inject_${faultType}`];
    if (typeof method !== "function") {
      throw new Error(
        `Injector "${this.name}" has no inject_${faultType}() method`,
      );
    }
    await (method as (p: InjectorParams) => Promise<void>).call(this, params);
  }

  async recover(faultType: string, params: InjectorParams): Promise<void> {
    const method = (this as unknown as Record<string, unknown>)[`recover_${faultType}`];
    if (typeof method !== "function") {
      throw new Error(
        `Injector "${this.name}" has no recover_${faultType}() method`,
      );
    }
    await (method as (p: InjectorParams) => Promise<void>).call(this, params);
  }

  /**
   * Static contract check: for every `inject_X` on the prototype chain, a
   * matching `recover_X` must exist. Run once at injector registration.
   */
  assertPaired(): void {
    const proto = Object.getPrototypeOf(this) as object;
    const injectNames = Object.getOwnPropertyNames(proto)
      .filter((n) => n.startsWith("inject_"))
      .map((n) => n.slice("inject_".length));
    const missing: string[] = [];
    for (const fault of injectNames) {
      if (typeof (this as unknown as Record<string, unknown>)[`recover_${fault}`] !== "function") {
        missing.push(fault);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `Injector "${this.name}" missing recover for: ${missing.join(", ")}`,
      );
    }
  }
}
