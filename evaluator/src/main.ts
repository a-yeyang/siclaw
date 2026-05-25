/**
 * Entry point. Wires env config → Portal clients → engine → HTTP server.
 *
 * Env vars:
 *   EVAL_PORT   (default 8080)
 *   PORTAL_URL  (required)
 *   PORTAL_JWT  (required)
 */

import { CaseRegistry } from "./case-registry.js";
import { ChatTraceReader } from "./chat-trace-reader.js";
import { RunEngine } from "./run-engine.js";
import { RunLog } from "./run-log.js";
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

  const siclaw = new SiclawClient({ portalUrl, jwt });
  const traceReader = new ChatTraceReader({ portalUrl, jwt });
  const log = new RunLog();
  const engine = new RunEngine({ siclaw, traceReader, log });
  const cases = new CaseRegistry();

  startServer({ cases, engine, siclaw, log, port });
}

main();
