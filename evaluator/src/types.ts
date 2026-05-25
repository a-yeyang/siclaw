/**
 * Shared types for the evaluator. Maps 1:1 to design doc §3.2.
 *
 * A Case is a self-contained problem definition:
 *   - which fault to inject and how to recover it
 *   - what prompt to give siclaw, against which agent
 *   - the oracle (must / may / must-not skills, + RCA keyword checks)
 *   - the run budget (timeout, token cap)
 */

export interface FaultSpec {
  /** Reflective name; an injector with `inject_<this>` + `recover_<this>` must exist. */
  injector: string;
  /** Free-form parameters consumed by the named injector. */
  params: Record<string, unknown>;
  /** Wait time between injection and triggering siclaw, in seconds. */
  propagation_wait_sec: number;
}

export interface TriggerSpec {
  /** Natural-language prompt sent to siclaw (the eval tag is prepended automatically). */
  prompt: string;
  /** siclaw agent ID to target. */
  agent: string;
  /** Step cap honoured via budget.ttl_sec when siclaw exposes no native cap. */
  max_steps: number;
}

export interface OracleSpec {
  /** Skills that MUST appear at least once. Drives `sufficiency`. */
  must_use_skills: string[];
  /** Skills that are neutral — neither rewarded nor penalised. */
  may_use_skills: string[];
  /** Skills that MUST NOT appear. Drives `necessity`. */
  must_not_use_skills: string[];
  /** Substrings (case-insensitive) that should appear in the final assistant message. */
  rca_must_contain: string[];
  /** Substrings that should appear in the final assistant recommendation/summary. */
  recommendation_must_contain: string[];
}

export interface BudgetSpec {
  /** Hard wall-clock budget for the whole run (inject→trigger→evaluate→recover). */
  ttl_sec: number;
  /** Upper bound on agent output tokens (approximated as chars/4). */
  max_tokens: number;
}

export interface Case {
  id: string;
  title: string;
  fault: FaultSpec;
  trigger: TriggerSpec;
  oracle: OracleSpec;
  budget: BudgetSpec;
}

/** A normalized record of one skill invocation extracted from chat-repo. */
export interface SkillInvocation {
  skill: string;
  script: string | null;
  args: string | null;
  /** The wrapping tool: `local_script` / `pod_script` / `host_script` / `node_script`. */
  toolName: string;
  outcome: "success" | "error" | "blocked" | "unknown";
  durationMs: number | null;
  createdAt: Date;
}

/** Trace returned by chat-trace-reader after a run completes. */
export interface ChatTrace {
  sessionId: string;
  /** All skill invocations in chronological order. */
  skills: SkillInvocation[];
  /** Final assistant message content. */
  finalAssistantText: string;
  /** Number of assistant turns (proxy for steps). */
  assistantSteps: number;
  /** Approximate output tokens. */
  approxOutputTokens: number;
  /** Approximate input tokens (tool results + user messages). */
  approxInputTokens: number;
  /** Total wall-clock from first to last message. */
  durationMs: number;
}

/** Result of deterministic scoring. */
export interface ScoreReport {
  used_skills: string[];
  missing_must_use: string[];
  forbidden_used: string[];
  noise_skills: string[];
  sufficiency: number;
  necessity: number;
  noise_ratio: number;
  skill_score: number;
  rca_hits: string[];
  rca_misses: string[];
  recommendation_hits: string[];
  recommendation_misses: string[];
}

export type RunStatus =
  | "queued"
  | "injecting"
  | "waiting_propagation"
  | "triggering"
  | "running_agent"
  | "evaluating"
  | "recovering"
  | "completed"
  | "failed"
  | "timed_out";

export interface RunReport {
  runId: string;
  caseId: string;
  /** Actual agent UUID used for this run (may differ from case default if overridden). */
  agentId: string | null;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  /** Session that siclaw produced — null until trigger succeeds. */
  sessionId: string | null;
  trace: ChatTrace | null;
  score: ScoreReport | null;
  metrics: {
    ttl_ms: number | null;
    steps: number | null;
    approx_output_tokens: number | null;
    approx_input_tokens: number | null;
  };
  /** Free-form human-readable failure reason on `failed` / `timed_out`. */
  error: string | null;
  /** Recover-side bookkeeping; true even if recover ran during a failed run. */
  recovered: boolean;
}
