/**
 * Deterministic scoring per design §3.3 (first layer).
 *
 *   sufficiency = |used ∩ must_use| / |must_use|
 *   necessity   = 1 − |used ∩ must_not_use| / |used|
 *   noise_ratio = |used − (must_use ∪ may_use)| / |used|
 *   skill_score = sufficiency × necessity
 *
 * Plus keyword presence checks on the final assistant message.
 *
 * Edge cases:
 *   - empty `must_use` → sufficiency = 1.0 (nothing was required)
 *   - empty `used` → necessity = 1.0, noise_ratio = 0.0
 *     Rationale: if the agent ran no skills we shouldn't penalise "necessity"
 *     based on a divide-by-zero. The case will still fail `sufficiency` if it
 *     required any skill.
 */

import type { ChatTrace, OracleSpec, ScoreReport } from "../types.js";

export function score(trace: ChatTrace, oracle: OracleSpec): ScoreReport {
  const usedSet = new Set(trace.skills.map((s) => s.skill));
  const used = [...usedSet];
  const mustUse = new Set(oracle.must_use_skills);
  const mayUse = new Set(oracle.may_use_skills);
  const mustNotUse = new Set(oracle.must_not_use_skills);

  const usedIntersect = (set: Set<string>): string[] =>
    used.filter((s) => set.has(s));

  const missingMustUse = oracle.must_use_skills.filter((s) => !usedSet.has(s));
  const forbiddenUsed = usedIntersect(mustNotUse);
  const allowed = new Set<string>([...mustUse, ...mayUse]);
  const noiseSkills = used.filter((s) => !allowed.has(s) && !mustNotUse.has(s));

  const sufficiency =
    mustUse.size === 0
      ? 1
      : usedIntersect(mustUse).length / mustUse.size;
  const necessity = used.length === 0 ? 1 : 1 - forbiddenUsed.length / used.length;
  const noiseRatio = used.length === 0 ? 0 : noiseSkills.length / used.length;
  const skillScore = sufficiency * necessity;

  const rcaCheck = checkKeywords(trace.finalAssistantText, oracle.rca_must_contain);
  const recommendationCheck = checkKeywords(
    trace.finalAssistantText,
    oracle.recommendation_must_contain,
  );

  return {
    used_skills: used,
    missing_must_use: missingMustUse,
    forbidden_used: forbiddenUsed,
    noise_skills: noiseSkills,
    sufficiency: round4(sufficiency),
    necessity: round4(necessity),
    noise_ratio: round4(noiseRatio),
    skill_score: round4(skillScore),
    rca_hits: rcaCheck.hits,
    rca_misses: rcaCheck.misses,
    recommendation_hits: recommendationCheck.hits,
    recommendation_misses: recommendationCheck.misses,
  };
}

function checkKeywords(
  text: string,
  keywords: string[],
): { hits: string[]; misses: string[] } {
  const lower = text.toLowerCase();
  const hits: string[] = [];
  const misses: string[] = [];
  for (const k of keywords) {
    if (lower.includes(k.toLowerCase())) hits.push(k);
    else misses.push(k);
  }
  return { hits, misses };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
