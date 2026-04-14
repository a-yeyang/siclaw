/**
 * Fault Generator — uses LLM via AgentBox to generate K8s fault injection cases
 */

import type { AgentBoxClient } from "../agentbox/client.js";
import { consumeAgentSse } from "../sse-consumer.js";

export interface GeneratedCase {
  title?: string;
  podName?: string;
  namespace?: string;
  faultType?: string;
  kubectlInject?: string;
  diagnosticSteps?: string[];
  expectedAnswer?: string;
  workOrders?: Array<{ difficulty: string; text: string }>;
}

interface GenerateOptions {
  prompt: string;
  namespace: string;
  caseCount: number;
  modelProvider?: string;
  modelId?: string;
}

const GENERATION_PROMPT = `You are a Kubernetes fault injection expert. Given a user request, generate fault-injection test cases for a K8s cluster.

IMPORTANT RULES:
1. Each case must create ONE faulty Pod (or related resource like Service/NetworkPolicy) using "kubectl apply -f - <<EOF ... EOF"
2. Pod names MUST follow pattern: deveval-<type>-<N>-{timestamp}
3. Namespace: {namespace}
4. Maximum {caseCount} cases
5. Each case needs 1-3 work orders (user-perspective problem descriptions) with difficulty:
   - "green": Clear with technical clues (mentions status, error codes)
   - "yellow": Vague, only business symptoms (app slow, can't connect)
   - "red": Misleading direction (blames wrong component)
6. Work orders MUST always mention the Pod name so the investigator knows WHAT to look at

CRITICAL YAML RULES — violations will cause kubectl to reject the manifest:
- dnsPolicy, dnsConfig, hostNetwork, initContainers, volumes, serviceAccountName → go under spec (Pod level), NOT inside spec.containers[]
- volumeMounts, resources, livenessProbe, readinessProbe, command, args, env, envFrom → go inside spec.containers[]
- resources.limits and resources.requests are under each container
- For multiple resources in one command, separate with "---"

CORRECT Pod structure example:
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: deveval-example-1-{timestamp}
  namespace: {namespace}
spec:
  dnsPolicy: None
  dnsConfig:
    nameservers:
    - 10.255.255.254
  containers:
  - name: app
    image: nginx
    resources:
      limits:
        memory: "50Mi"
EOF

RESPOND WITH VALID JSON ONLY. No markdown, no extra text. Output a JSON array:
[
  {{
    "title": "Short title",
    "podName": "deveval-oom-1-{timestamp}",
    "namespace": "{namespace}",
    "faultType": "OOMKilled",
    "kubectlInject": "kubectl apply -f - <<EOF\\napiVersion: v1\\nkind: Pod\\nmetadata:\\n  name: deveval-oom-1-{timestamp}\\n  namespace: {namespace}\\nspec:\\n  containers:\\n  - name: app\\n    image: busybox\\n    command: [\\"sh\\", \\"-c\\", \\"while true; do dd if=/dev/zero of=/dev/null bs=100M; done\\"]\\n    resources:\\n      limits:\\n        memory: \\"50Mi\\"\\nEOF",
    "diagnosticSteps": [
      "kubectl get pod deveval-oom-1-{timestamp} -n {namespace}",
      "kubectl describe pod deveval-oom-1-{timestamp} -n {namespace}"
    ],
    "expectedAnswer": "Root cause: memory limit 50Mi is too low, container gets OOM killed (exit code 137). Fix: increase memory limit.",
    "workOrders": [
      {{ "difficulty": "green", "text": "Pod deveval-oom-1-{timestamp} in namespace {namespace} keeps restarting with OOMKilled, exit code 137" }},
      {{ "difficulty": "yellow", "text": "Application deveval-oom-1-{timestamp} in {namespace} crashes every few minutes, no error in logs" }}
    ]
  }}
]

User request: {prompt}
Namespace: {namespace}
Number of cases: {caseCount}`;

export async function generateFaultCases(
  client: AgentBoxClient,
  options: GenerateOptions,
): Promise<GeneratedCase[]> {
  const timestamp = Math.floor(Date.now() / 1000);
  const filledPrompt = GENERATION_PROMPT
    .replace(/\{timestamp\}/g, String(timestamp))
    .replace(/\{prompt\}/g, options.prompt)
    .replace(/\{namespace\}/g, options.namespace)
    .replace(/\{caseCount\}/g, String(options.caseCount));

  // Use a dedicated session for generation
  const sessionId = `deveval-gen-${timestamp}`;

  const result = await client.prompt({
    sessionId,
    text: filledPrompt,
    modelProvider: options.modelProvider,
    modelId: options.modelId,
  });

  // Collect the assistant response via the shared SSE consumer
  const sseResult = await consumeAgentSse({
    client,
    sessionId: result.sessionId,
    userId: "deveval-system",
    chatRepo: null,
    signal: AbortSignal.timeout(180_000),
  });

  const assistantText = sseResult.resultText || sseResult.taskReportText;
  if (!assistantText) {
    throw new Error("LLM returned empty response for fault generation");
  }

  // Parse JSON from response (handle markdown code blocks)
  const jsonStr = extractJson(assistantText);
  const cases: GeneratedCase[] = JSON.parse(jsonStr);

  // Validate and sanitize
  return cases.slice(0, options.caseCount).map((c, i) => ({
    title: c.title || `Case ${i + 1}`,
    podName: c.podName || `deveval-case-${i + 1}-${timestamp}`,
    namespace: c.namespace || options.namespace,
    faultType: c.faultType || "unknown",
    kubectlInject: c.kubectlInject || "",
    diagnosticSteps: Array.isArray(c.diagnosticSteps) ? c.diagnosticSteps : [],
    expectedAnswer: c.expectedAnswer || "",
    workOrders: Array.isArray(c.workOrders) ? c.workOrders.slice(0, 3) : [],
  }));
}

/** Extract JSON array from text that may contain markdown code blocks */
function extractJson(text: string): string {
  // Try to find JSON array directly
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) return arrayMatch[0];

  // Try inside code block
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    const inner = codeBlockMatch[1].trim();
    const innerArray = inner.match(/\[[\s\S]*\]/);
    if (innerArray) return innerArray[0];
    return inner;
  }

  throw new Error("Failed to extract JSON from LLM response");
}
