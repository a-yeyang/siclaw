/**
 * Entry point. Wires env config → K8s/Portal clients → engine → HTTP server.
 *
 * Env vars (also documented in README):
 *   EVAL_PORT          (default 8080)
 *   PORTAL_URL         (required)
 *   PORTAL_JWT         (required)
 *   EVAL_NAMESPACE     (default "siclaw" — design §3.1 / §3.4.5)
 *
 * In production the evaluator is a single pod with a tightly-scoped
 * ServiceAccount that can only patch Deployments in EVAL_NAMESPACE.
 */

import { CaseRegistry } from "./case-registry.js";
import { ChatTraceReader } from "./chat-trace-reader.js";
import { InjectorRegistry } from "./injectors/registry.js";
import { K8sClient } from "./k8s-client.js";
import { RunEngine } from "./run-engine.js";
import { startServer } from "./server.js";
import { SiclawClient } from "./siclaw-client.js";

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

function main(): void {
  const port = parseInt(process.env.EVAL_PORT ?? "8080", 10);
  const portalUrl = requiredEnv("PORTAL_URL");
  const jwt = requiredEnv("PORTAL_JWT");
  const namespace = process.env.EVAL_NAMESPACE ?? "siclaw";

  const k8s = new K8sClient({ allowedNamespace: namespace });
  const injectors = new InjectorRegistry(k8s);
  const siclaw = new SiclawClient({ portalUrl, jwt });
  const traceReader = new ChatTraceReader({ portalUrl, jwt });
  const engine = new RunEngine({ injectors, siclaw, traceReader });
  const cases = new CaseRegistry();

  startServer({ cases, engine, siclaw, port });
}

main();
