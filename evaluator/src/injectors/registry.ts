/**
 * Maps `fault.injector` keys from case YAML to FaultInjector instances.
 * v0 keeps a single shared injector per type so `recover_*` can reach the
 * in-memory state saved by the matching `inject_*` call.
 */

import type { K8sClient } from "../k8s-client.js";
import type { FaultInjector } from "./base.js";
import { ImagePullFailureInjector } from "./image-pull-failure.js";

export interface InjectorBinding {
  faultType: string;
  injector: FaultInjector;
}

export class InjectorRegistry {
  private byInjectorName = new Map<string, FaultInjector>();

  constructor(k8s: K8sClient) {
    this.register(new ImagePullFailureInjector(k8s));
  }

  register(injector: FaultInjector): void {
    injector.assertPaired();
    this.byInjectorName.set(injector.name, injector);
  }

  /**
   * Given a case's `fault.injector` string (which IS the fault type in v0 —
   * one fault per injector class), return the binding to invoke.
   */
  resolve(injectorName: string): InjectorBinding {
    const injector = this.byInjectorName.get(injectorName);
    if (!injector) {
      throw new Error(
        `Unknown injector "${injectorName}". Registered: ${[...this.byInjectorName.keys()].join(", ")}`,
      );
    }
    return { faultType: injectorName, injector };
  }
}
