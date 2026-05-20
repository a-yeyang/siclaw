import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDb, closeDb, getDb } from "./db.js";
import { runPortalMigrations } from "../portal/migrate.js";
import {
  recordSkillCallEvent,
  recordSkillCallDelta,
  queryTopSkills,
  queryBottomSkills,
  queryNeverUsedSkills,
} from "./skill-metrics-store.js";

const TODAY = new Date().toISOString().slice(0, 10);
const WIDE_FROM = "2000-01-01";

async function seedSkill(name: string): Promise<void> {
  const db = getDb();
  await db.query(
    `INSERT INTO skills (id, org_id, name, author_id, created_by) VALUES (?, 'org', ?, 'u', 'u')`,
    [`id-${name}`, name],
  );
}

describe("skill-metrics-store", () => {
  beforeEach(async () => {
    initDb("sqlite::memory:");
    await runPortalMigrations();
    // Catalogue of three skills; only two will ever be invoked.
    await seedSkill("pod-crash-debug");
    await seedSkill("dns-debug");
    await seedSkill("never-touched");
  });

  afterEach(async () => {
    await closeDb();
  });

  it("recordSkillCallEvent writes raw event + rollup + stats", async () => {
    await recordSkillCallEvent({
      skillName: "pod-crash-debug", scriptName: "x.sh", scope: "builtin",
      outcome: "success", durationMs: 100, sessionId: "s1", userId: "u", agentId: "a",
    });
    await recordSkillCallEvent({
      skillName: "pod-crash-debug", scriptName: "x.sh", scope: "builtin",
      outcome: "error", durationMs: 300, sessionId: "s1", userId: "u", agentId: "a",
    });

    const db = getDb();
    const [events] = await db.query<any[]>("SELECT * FROM skill_call_events");
    expect(events.length).toBe(2);

    const top = await queryTopSkills(WIDE_FROM, TODAY, 10);
    expect(top[0].skillName).toBe("pod-crash-debug");
    expect(top[0].calls).toBe(2);
    expect(top[0].errors).toBe(1);
    expect(top[0].errorRate).toBe(0.5);
    expect(top[0].avgDurationMs).toBe(200); // (100 + 300) / 2
  });

  it("recordSkillCallDelta increments rollup/stats without raw events (K8s path)", async () => {
    await recordSkillCallDelta({
      skillName: "dns-debug", scope: "global", success: 3, error: 1, avgDurationMs: 50,
    });
    const db = getDb();
    const [events] = await db.query<any[]>("SELECT * FROM skill_call_events");
    expect(events.length).toBe(0); // deltas carry no per-call detail

    const top = await queryTopSkills(WIDE_FROM, TODAY, 10);
    const dns = top.find((s) => s.skillName === "dns-debug")!;
    expect(dns.calls).toBe(4);
    expect(dns.errors).toBe(1);
    expect(dns.avgDurationMs).toBe(50);
  });

  it("queryTopSkills ranks by call count descending", async () => {
    await recordSkillCallDelta({ skillName: "dns-debug", scope: "global", success: 5, error: 0, avgDurationMs: 10 });
    await recordSkillCallDelta({ skillName: "pod-crash-debug", scope: "builtin", success: 2, error: 0, avgDurationMs: 10 });

    const top = await queryTopSkills(WIDE_FROM, TODAY, 10);
    expect(top.map((s) => s.skillName)).toEqual(["dns-debug", "pod-crash-debug"]);
  });

  it("queryBottomSkills surfaces zero-usage skills from the catalogue", async () => {
    await recordSkillCallDelta({ skillName: "dns-debug", scope: "global", success: 5, error: 0, avgDurationMs: 10 });

    const bottom = await queryBottomSkills(WIDE_FROM, TODAY, 10);
    // never-touched + pod-crash-debug (both 0 calls) must rank ahead of dns-debug.
    expect(bottom[0].calls).toBe(0);
    expect(bottom.map((s) => s.skillName)).toContain("never-touched");
    expect(bottom[bottom.length - 1].skillName).toBe("dns-debug");
  });

  it("queryNeverUsedSkills puts never-invoked skills first (NULL last_called_at)", async () => {
    await recordSkillCallEvent({
      skillName: "pod-crash-debug", scriptName: null, scope: "builtin",
      outcome: "success", durationMs: 10, userId: "u", agentId: null,
    });

    const never = await queryNeverUsedSkills(10);
    // "never-touched" and "dns-debug" have NULL last_called_at → sorted first.
    expect(never[0].lastCalledAt).toBeNull();
    const podRow = never.find((s) => s.skillName === "pod-crash-debug")!;
    expect(podRow.lastCalledAt).not.toBeNull();
    expect(podRow.calls).toBe(1);
  });

  it("respects the day window in queryTopSkills", async () => {
    await recordSkillCallEvent({
      skillName: "pod-crash-debug", scriptName: null, scope: "builtin",
      outcome: "success", durationMs: 10, userId: "u", agentId: null,
    });
    // A window entirely in the past must exclude today's call.
    const past = await queryTopSkills("2000-01-01", "2000-01-02", 10);
    expect(past.length).toBe(0);
  });
});
