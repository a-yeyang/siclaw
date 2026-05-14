# Skill Audit Ledger

Status: experimental branch handoff  
Audience: Siclaw developers and Infra AI collaborators  
Scope: AgentBox skill-use observability, offline analysis, and planning material

## Why This Exists

Siclaw is moving toward an expert-agent model: the global skill pool can be much larger than the subset available to any one agent. In that model, answer quality alone is not enough. We need to know whether an agent:

- saw the relevant skills;
- read the expected skills;
- executed scripts from skill packages;
- gathered evidence before or after reading the relevant guidance;
- skipped skills that should have been part of the investigation;
- repeatedly ignores cold but important skills.

The skill audit ledger is the first observability layer for that question. It is intentionally objective and low-level. Product UI, policy decisions, auto skill generation, and workflow checkpoints can be layered on top later.

## Current Branch Contents

This branch includes three related pieces:

1. Runtime instrumentation
   - Records skill availability, skill reads, skill script execution, tool execution, prompt start, and prompt completion.
   - Writes JSONL from AgentBox into the writable user-data tree by default.
   - Exposes an internal mTLS-protected session audit endpoint for Gateway/Runtime access.

2. Offline analysis
   - Adds `scripts/skill-audit-summary.mjs`.
   - Computes objective usage counts plus simple task-to-skill expectation checks.
   - Supports `--json`, `--task`, and `--expect` for repeatable local or pod-side analysis.

3. Research / planning material
   - `docs/research/2026-05-14-infra-intelligence-skill-audit-direction.md`
   - `docs/research/infra-intelligence-skill-audit-direction.pptx`
   - These connect the implementation direction to SkillRL, SkillRouter, SkillFlow, MemPalace, Hermes Agent, RTK, and the Infra intelligence interest-group roadmap.

## Key Files

- `src/shared/skill-audit-ledger.ts`
  - JSONL writer and summary helpers.
  - Default path: `/app/.siclaw/user-data/skill-audit` in container mode.
  - Can be overridden with `SICLAW_SKILL_AUDIT_DIR`.

- `src/shared/diagnostic-events.ts`
  - Skill audit event contracts.

- `src/agentbox-main.ts`
  - Starts the ledger bridge in AgentBox.

- `src/agentbox/session.ts`
  - Emits prompt lifecycle, available skill, and tool execution events.

- `src/core/agent-factory.ts`
  - Emits `skill_read` when a `SKILL.md` file is consumed.

- `src/tools/script-exec/*-script.ts`
  - Emits `skill_script_executed` for local, pod, node, and host script execution.

- `src/agentbox/http-server.ts`
  - Adds `GET /api/sessions/:sessionId/skill-audit`.
  - This is currently internal-only. Direct user curl from outside Gateway/Runtime is expected to fail under current mTLS policy.

- `scripts/skill-audit-summary.mjs`
  - Offline analyzer for JSONL audit files.
  - Copied into Docker images so it can run inside AgentBox pods.

## Event Shape

The ledger is append-only JSONL. Important event types:

- `prompt_started`
- `skill_available`
- `skill_read`
- `skill_script_executed`
- `tool_executed`
- `prompt_complete`

The analysis script derives:

- `readSkills`
- `usedExpectedSkills`
- `missingExpectedSkills`
- `matchedTaskTypes`
- `readBeforeFirstTool`
- per-tool and per-skill counts

The current expected-skill matcher is deliberately simple and rule-based. It is a seed for evaluation, not the final router.

## Example Commands

Run unit tests:

```bash
npm test -- src/shared/__tests__/skill-audit-ledger.test.ts
```

Run type check and build:

```bash
npx tsc --noEmit
npm run build
```

Summarize a local JSONL file:

```bash
npm run -s skill-audit:summary -- /path/to/audit.jsonl --json
```

Summarize inside an AgentBox pod:

```bash
kubectl -n sdliu-siclaw exec <agentbox-pod> -- \
  sh -lc 'npm run -s skill-audit:summary -- /app/.siclaw/user-data/skill-audit/<file>.jsonl --json'
```

## Validation Notes From The Test Cluster

The current implementation was validated in the standalone Siclaw test namespace, not the integrated SiCore namespace.

Observed behavior:

- A natural Pending-pod investigation could reach the right conclusion while `skill_read=0`.
- Explicitly asking the agent to read skills made it consume `pvc-debug`.
- After adding prompt lifecycle and expected-skill analysis, a natural Pending/PVC/node-health prompt read `pod-pending-debug` but still missed `pvc-debug` and `node-health-check`.

This is exactly the kind of signal the audit layer is meant to expose: answer correctness, skill compliance, and evidence-flow quality are related but distinct.

## Known Limitations

- The expected-skill matcher is a small rule set, not a learned or complete router.
- `readBeforeFirstTool` currently treats context probes as tools; it may need a refined `readBeforeEvidenceTool` metric.
- The internal HTTP endpoint is not a user-facing product API. Productizing audit summaries should go through Runtime/Gateway/Portal.
- Reading a skill does not prove the model understood it. Later evaluation should combine skill reads, checklist coverage, evidence citation, and replay outcomes.
- The current branch records objective behavior; it does not yet enforce workflow checkpoints.

## Next Development Directions

Suggested P0/P1 follow-ups:

- Build a richer task taxonomy for SRE cases.
- Expand expected-skill mapping for Pending, CrashLoop, PVC, NodeNotReady, GPU, DNS, quota, image pull, and network cases.
- Add a summary artifact that can compare sessions across agents.
- Add cold/hot skill aggregation over many sessions.
- Add `readBeforeEvidenceTool` and checklist coverage.
- Decide where Gateway/Runtime/Portal should expose audit summaries.

Suggested research follow-ups:

- Use successful and failed audit traces to propose skill updates.
- Replay historical cases before accepting generated skill changes.
- Compare rule-based routing, LLM-judge routing, and SkillRouter-style routing.
- Use SkillFlow-style lifelong evaluation to separate skill usage from skill utility.
- Treat audit trace as source material for an SRE LLM Wiki / operations knowledge graph.

## Safety Notes

Skill audit data can include user prompts, cluster identifiers, tool names, and evidence paths. Treat it as operational telemetry:

- avoid exposing raw audit JSONL broadly by default;
- redact sensitive prompt previews when needed;
- keep generated skill updates behind human review;
- do not let auto-generated skills bypass command safety gates.
