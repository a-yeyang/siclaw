#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function usage() {
  console.error("Usage: node scripts/skill-audit-summary.mjs <audit-dir-or-jsonl> [--json] [--task <text>] [--expect skill[,skill...]]");
  process.exit(2);
}

const args = process.argv.slice(2);
let target;
let asJson = false;
let taskOverride = "";
let expectOverride = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--json") {
    asJson = true;
  } else if (arg === "--task") {
    taskOverride = args[++i] ?? "";
  } else if (arg === "--expect") {
    expectOverride = (args[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  } else if (!target) {
    target = arg;
  } else {
    usage();
  }
}
if (!target) usage();

function readJsonl(file) {
  return fs.readFileSync(file, "utf-8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new Error(`${file}:${index + 1}: invalid JSONL: ${err.message}`);
      }
    });
}

function auditFiles(input) {
  const stat = fs.statSync(input);
  if (!stat.isDirectory()) return [input];
  return fs.readdirSync(input)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .map((name) => path.join(input, name));
}

function inc(map, key, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

function top(map) {
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

const TASK_SKILL_RULES = [
  {
    label: "pod_pending",
    match: [/\bPending\b/i, /FailedScheduling/i, /无法调度|调度失败|等待调度|pending/i],
    expected: ["pod-pending-debug"],
    related: ["pvc-debug", "quota-debug", "node-health-check", "cluster-events", "volcano-resource-insufficient", "volcano-gang-scheduling"],
  },
  {
    label: "pvc_storage",
    match: [/\bPVC\b/i, /PersistentVolumeClaim/i, /StorageClass/i, /存储类|存储卷|卷绑定|pvc|storageclass/i],
    expected: ["pvc-debug"],
    related: ["pod-pending-debug", "cluster-events", "statefulset-debug"],
  },
  {
    label: "image_pull",
    match: [/ImagePullBackOff|ErrImagePull|pull image/i, /镜像拉取|镜像.*失败/i],
    expected: ["image-pull-debug"],
    related: ["pod-pending-debug", "deployment-rollout-debug", "cluster-events"],
  },
  {
    label: "pod_crash",
    match: [/CrashLoopBackOff|OOMKilled|Error|restart/i, /崩溃|重启|日志|oom/i],
    expected: ["pod-crash-debug"],
    related: ["node-health-check", "cluster-events"],
  },
  {
    label: "node_health",
    match: [/\bNode\b|nodepool|NotReady|kubelet/i, /节点|notready/i],
    expected: ["node-health-check"],
    related: ["node-logs", "find-node", "cluster-events"],
  },
  {
    label: "service_network",
    match: [/Service|Endpoint|Ingress|DNS|NetworkPolicy/i, /服务|入口|域名|网络策略|网络/i],
    expected: ["service-debug"],
    related: ["dns-debug", "ingress-debug", "networkpolicy-debug", "pod-ping-gateway", "pod-show-gateway"],
  },
  {
    label: "rollout",
    match: [/Deployment|ReplicaSet|rollout|HPA/i, /发布|回滚|扩缩容|副本/i],
    expected: ["deployment-rollout-debug"],
    related: ["hpa-debug", "pod-crash-debug", "pod-pending-debug"],
  },
  {
    label: "job",
    match: [/\bJob\b|CronJob|Completed|BackoffLimitExceeded/i, /任务|定时任务/i],
    expected: ["job-debug"],
    related: ["pod-crash-debug", "cluster-events"],
  },
  {
    label: "volcano",
    match: [/Volcano|PodGroup|Queue|gang/i, /队列|作业组|gang/i],
    expected: ["volcano-diagnose-pod"],
    related: ["volcano-queue-diagnose", "volcano-gang-scheduling", "volcano-resource-insufficient", "volcano-node-resources", "volcano-scheduler-logs"],
  },
];

function unique(list) {
  return [...new Set(list)];
}

function inferExpectedSkills(taskText) {
  const text = taskText ?? "";
  const matched = TASK_SKILL_RULES.filter((rule) => rule.match.some((re) => re.test(text)));
  return {
    taskText,
    matchedTaskTypes: matched.map((rule) => rule.label),
    expectedSkills: unique(matched.flatMap((rule) => rule.expected)),
    relatedSkills: unique(matched.flatMap((rule) => rule.related)),
  };
}

function evaluateSkillExpectations(events, taskText, manualExpected = []) {
  const inferred = inferExpectedSkills(taskText);
  const expectedSkills = unique([...manualExpected, ...inferred.expectedSkills]);
  const relatedSkills = inferred.relatedSkills.filter((skill) => !expectedSkills.includes(skill));
  if (expectedSkills.length === 0 && relatedSkills.length === 0) return null;

  const readCounts = new Map();
  const scriptCounts = new Map();
  const toolCounts = new Map();
  let firstSkillReadIndex = -1;
  let firstToolIndex = -1;

  events.forEach((event, index) => {
    if (event.event_type === "skill_read" && event.skill_name) {
      inc(readCounts, event.skill_name);
      if (firstSkillReadIndex < 0) firstSkillReadIndex = index;
    } else if (event.event_type === "skill_script_executed" && event.skill_name) {
      inc(scriptCounts, event.skill_name);
    } else if (event.event_type === "tool_executed" && event.tool_name) {
      inc(toolCounts, event.tool_name);
      if (firstToolIndex < 0) firstToolIndex = index;
    }
  });

  const readSkills = [...readCounts.keys()];
  const usedExpectedSkills = expectedSkills.filter((skill) => readCounts.has(skill) || scriptCounts.has(skill));
  const usedRelatedSkills = relatedSkills.filter((skill) => readCounts.has(skill) || scriptCounts.has(skill));
  const missingExpectedSkills = expectedSkills.filter((skill) => !usedExpectedSkills.includes(skill));
  const readBeforeFirstTool = firstSkillReadIndex >= 0 && (firstToolIndex < 0 || firstSkillReadIndex < firstToolIndex);

  return {
    taskText,
    matchedTaskTypes: inferred.matchedTaskTypes,
    expectedSkills,
    relatedSkills,
    readSkills,
    usedExpectedSkills,
    usedRelatedSkills,
    missingExpectedSkills,
    readBeforeFirstTool,
    firstSkillReadIndex,
    firstToolIndex,
    toolCounts: top(toolCounts),
  };
}

const sessions = [];
const globalAvailable = new Map();
const globalReads = new Map();
const globalScripts = new Map();
const globalTools = new Map();

for (const file of auditFiles(target)) {
  const events = readJsonl(file);
  if (events.length === 0) continue;

  const sessionId = events.find((e) => e.session_id)?.session_id ?? path.basename(file, ".jsonl");
  const available = new Map();
  const reads = new Map();
  const scripts = new Map();
  const tools = new Map();
  let prompts = 0;
  const promptPreviews = [];

  for (const event of events) {
    if (event.event_type === "skill_available" && event.skill_name) {
      inc(available, event.skill_name);
      inc(globalAvailable, event.skill_name);
    } else if (event.event_type === "skill_read" && event.skill_name) {
      inc(reads, event.skill_name);
      inc(globalReads, event.skill_name);
    } else if (event.event_type === "skill_script_executed") {
      const key = `${event.skill_name ?? "unknown"}/${event.script_name ?? "unknown"}`;
      inc(scripts, key);
      inc(globalScripts, key);
    } else if (event.event_type === "tool_executed" && event.tool_name) {
      inc(tools, event.tool_name);
      inc(globalTools, event.tool_name);
    } else if (event.event_type === "prompt_started" && event.prompt_preview) {
      promptPreviews.push(event.prompt_preview);
    } else if (event.event_type === "prompt_complete") {
      prompts += 1;
    }
  }

  const taskText = taskOverride || promptPreviews.join("\n\n");
  const expectation = evaluateSkillExpectations(events, taskText, expectOverride);
  const readSkillCount = reads.size;
  const availableSkillCount = available.size;
  sessions.push({
    sessionId,
    file,
    events: events.length,
    prompts,
    availableSkillCount,
    readSkillCount,
    readCoverage: availableSkillCount === 0 ? 0 : readSkillCount / availableSkillCount,
    promptPreviews,
    skillReads: top(reads),
    skillScripts: top(scripts),
    tools: top(tools),
    expectation,
  });
}

const allSkillNames = new Set([...globalAvailable.keys(), ...globalReads.keys()]);
const coldSkills = [...allSkillNames]
  .filter((name) => (globalReads.get(name) ?? 0) === 0)
  .sort();

const summary = {
  target,
  sessions: sessions.length,
  prompts: sessions.reduce((sum, session) => sum + session.prompts, 0),
  events: sessions.reduce((sum, session) => sum + session.events, 0),
  hotSkills: top(globalReads),
  coldSkills,
  scriptUse: top(globalScripts),
  tools: top(globalTools),
  expectedSkillRules: TASK_SKILL_RULES.map((rule) => ({
    label: rule.label,
    expected: rule.expected,
    related: rule.related,
  })),
  sessionSummaries: sessions,
};

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`Skill audit summary for ${target}`);
  console.log(`sessions=${summary.sessions} prompts=${summary.prompts} events=${summary.events}`);
  console.log("");
  console.log("Hot skills:");
  for (const item of summary.hotSkills.slice(0, 20)) console.log(`  ${item.name}: ${item.count}`);
  if (summary.hotSkills.length === 0) console.log("  none");
  console.log("");
  console.log(`Cold skills (${summary.coldSkills.length}): ${summary.coldSkills.slice(0, 30).join(", ") || "none"}`);
  if (summary.coldSkills.length > 30) console.log(`  ... ${summary.coldSkills.length - 30} more`);
  console.log("");
  console.log("Tools:");
  for (const item of summary.tools) console.log(`  ${item.name}: ${item.count}`);
  if (summary.tools.length === 0) console.log("  none");
  console.log("");
  console.log("Sessions:");
  for (const session of summary.sessionSummaries) {
    console.log(`  ${session.sessionId}: prompts=${session.prompts} readSkills=${session.readSkillCount}/${session.availableSkillCount} coverage=${session.readCoverage.toFixed(3)}`);
    if (session.expectation) {
      const e = session.expectation;
      console.log(`    taskTypes=${e.matchedTaskTypes.join(",") || "manual"} expected=${e.expectedSkills.join(",") || "none"} related=${e.relatedSkills.slice(0, 6).join(",") || "none"}`);
      console.log(`    read=${e.readSkills.join(",") || "none"} usedExpected=${e.usedExpectedSkills.join(",") || "none"} missingExpected=${e.missingExpectedSkills.join(",") || "none"} readBeforeFirstTool=${e.readBeforeFirstTool}`);
    }
  }
}
