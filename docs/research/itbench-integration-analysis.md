# ITBench → Siclaw 集成分析报告

> 调研目标：分析如何将 ITBench 的 SRE 场景和评分机制系统性地引入 Siclaw 回归测试框架。

---

## 一、两个系统的对比总览

| 维度 | ITBench | Siclaw 当前 |
|------|---------|-------------|
| **场景数量** | SRE 42 个（开源 37 个） | sample-cases 6 个 + itbench-sre 4 个 = 10 个 |
| **故障注入** | Ansible playbook + Chaos Mesh + Feature Flag | kubectl apply YAML |
| **评估维度** | 4 维：NTAM-定位、NTAM-传播链、MTTD、MTTR + pass@1 | 2 维：commands(1-5)、conclusion(1-5) |
| **部分正确** | NTAM 提供连续 0-1.0 拓扑感知评分 | 无部分正确，仅 1-5 整数打分 |
| **传播链** | groundtruth_v1.yaml 显式编码 propagation chain | 仅在期望结论自然语言中描述 |
| **ground truth 格式** | 结构化 YAML：entities + alerts + solutions + propagations | 自然语言 markdown：根因 + 修复建议 |
| **难度分级** | 公式 ∛(chain_len × steps × tech_count)，Easy/Medium/Hard | 工单描述的 green/yellow/red |
| **多解路径** | solutions 数组支持多条独立解法路径 | 单一期望结论 |
| **时间维度** | MTTD/MTTR 精确到秒 | 仅记录 durationMs（整个 case 耗时） |
| **拓扑信息** | Kubernetes topology monitor + networkx 图分析 | 无 |

---

## 二、ITBench Case 转换为 Siclaw 格式

### 2.1 可直接转换的场景（reproducible = true）

以下 ITBench 故障类型可以用 Siclaw 的 `kubectl apply` 注入方式直接复现，无需 Ansible 或 Chaos Mesh：

| ITBench fault ID | 对应 Siclaw faultType | 注入方式 | 难度 |
|---|---|---|---|
| `nonexistent-kubernetes-workload-container-image` | ImagePullBackOff | 修改 Deployment image 字段 | Easy |
| `unsupported-architecture-kubernetes-workload-container-image` | ExecFormatError | 使用 arm64 image 在 amd64 节点 | Easy |
| `invalid-kubernetes-workload-container-command` | CrashLoopBackOff-BadCommand | 错误的 command/args | Easy |
| `modified-kubernetes-workload-container-environment-variable` | CrashLoopBackOff-BadEnvVar | 错误的环境变量值 | Medium |
| `insufficient-kubernetes-workload-container-resources` | OOMKilled / CPUThrottle | 极低的 limits | Medium |
| `unassigned-kubernetes-workload-container-resource-limits` | Unbounded-Resources | 不设 limits | Easy |
| `nonexistent-kubernetes-workload-persistent-volume-claim` | PVC-NotFound | 引用不存在的 PVC | Easy |
| `nonexistent-kubernetes-workload-node` | NodeSelector-Mismatch | 错误的 nodeSelector | Easy |
| `modified-target-port-kubernetes-service` | Service-PortMismatch | Service targetPort 不匹配容器 | Medium |
| `ingress-port-blocking-network-policy` | NetworkPolicy-Block | NetworkPolicy 拒绝入向流量 | Medium |
| `failing-name-resolution-kubernetes-workload-dns-policy` | DNS-ResolvFail | 设置 dnsPolicy: None + 空 dnsConfig | Medium |
| `scaled-to-zero-kubernetes-workload` | ScaledToZero | replicas: 0 | Easy |
| `misconfigured-kubernetes-workload-container-readiness-probe` | ReadinessProbe-Fail | 错误的 readinessProbe | Medium |
| `misconfigured-kubernetes-horizontal-pod-autoscaler` | HPA-Misconfigured | 错误的 HPA targetAverageUtilization | Medium |
| `insufficient-kubernetes-resource-quota` | ResourceQuota-Exceeded | namespace 配额过低 | Medium |
| `cordoned-kubernetes-worker-node` | Node-Cordoned | kubectl cordon | Medium |
| `hanging-kubernetes-workload-init-container` | InitContainer-Hang | init container 永不退出 | Medium |
| `crashing-kubernetes-workload-init-container` | InitContainer-Crash | init container exit 1 | Easy |
| `valkey-workload-changed-password` | Redis-AuthFail | 修改 Redis/Valkey 密码 | Medium |

**转换示例** — ITBench scenario_20 → Siclaw case:

```yaml
# ITBench groundtruth.yaml 中:
entities:
  - apiVersion: apps/v1
    kind: Deployment
    metadata:
      name: product-catalog
      namespace: otel-demo-app
solutions:
  - - steps:
      - command: kubectl rollout undo deployment/product-catalog -n otel-demo-app
        text: Rollback the product-catalog deployment

# 转换为 Siclaw case:
id: itb-badimage-001
reproducible: true
faultType: ImagePullBackOff
注入 YAML → 一个 Deployment YAML with image: nonexistent-tag
工单描述 → 从 ITBench alert (KubePodNotReady) 改写成中文工单
题解 kubectl → 从 solutions 中提取 kubectl 命令
期望结论 → 从 groundtruth_v1.yaml 的 fault + propagations 改写
```

### 2.2 需要 knowledge-QA 模式的场景

以下故障类型涉及集群级操作或外部依赖，不适合在共享测试集群直接注入：

| ITBench fault ID | 原因 | 转换策略 |
|---|---|---|
| `opentelemetry-demo-feature-flag` | 需要 OpenTelemetry Demo 全套微服务 | knowledge-QA + 集群现状 |
| `scheduled-chaos-mesh-experiment` | 需要 Chaos Mesh CRD | knowledge-QA + 集群现状 |
| `strict-mutual-tls-istio-service-mesh-enforcement` | 需要 Istio service mesh | knowledge-QA + 集群现状 |
| `traffic-denying-istio-gateway-authorization-policy` | 需要 Istio + Gateway | knowledge-QA + 集群现状 |
| `disabled-istio-ambient-mode-kubernetes-namespace` | 需要 Istio ambient mode | knowledge-QA + 集群现状 |
| `kubernetes-api-server-request-surge` | 影响控制面，不安全 | knowledge-QA + 集群现状 |
| `priority-kubernetes-workload-priority-preemption` | 需要多 PriorityClass + 资源竞争 | knowledge-QA + 集群现状 |
| `valkey-workload-out-of-memory` | 需要真实 Valkey 实例 + 数据灌入 | knowledge-QA + 集群现状 |

### 2.3 转换流程标准化

对每个 ITBench scenario，转换步骤如下：

```
1. 读取 scenario.yaml → 提取 faultType、注入参数
2. 读取 groundtruth_v1.yaml → 提取:
   a. fault[].condition + fault[].changed → 编写「根因」
   b. propagations[] → 编写因果链描述 (A→B→C→...)
   c. groups[].root_cause=true → 确定根因实体
   d. alerts[] → 改写工单描述
3. 读取 groundtruth.yaml → 提取:
   a. solutions[].steps[].command → 题解 kubectl
   b. entities[] → 涉及的 K8s 资源清单
4. 判断 reproducible:
   a. 能用单一 YAML apply 复现 → reproducible: true
   b. 需要微服务拓扑/CRD/集群级操作 → reproducible: false
5. 从 ITBench 的 propagation chain 长度 + solution steps 数量 → 设定 passThreshold
6. 如果因果链 ≥ 3 步 → 编写自定义评分规则 (### 评分规则)
```

### 2.4 建议的批量转换优先级

**Phase 1 — 直接注入类 (reproducible=true)，覆盖核心故障类型 (预计 12-15 个 case)**

| 优先级 | 故障分类 | ITBench scenarios | 预计 Siclaw case 数 |
|--------|---------|-------------------|---------------------|
| P0 | Image 问题 | 20, 23 | 2（已有 itb-badimage-001, itb-badarch-004） |
| P0 | 容器启动失败 | 16, 新增 invalid-command | 2（已有 itb-badenvvar-002，需补 bad-command） |
| P0 | 资源限制 | 新增 insufficient-resources, OOM | 2（已有 oom-basic-001，需补 CPU throttle） |
| P1 | 存储问题 | 新增 nonexistent-PVC | 1 |
| P1 | 网络策略 | 新增 network-policy-block | 1 |
| P1 | 调度失败 | 新增 node-selector-mismatch, cordon | 2 |
| P1 | Probe 配置 | 新增 readiness-probe-fail | 1（已有 probe 类 case） |
| P1 | 服务端口 | 新增 service-port-mismatch | 1 |
| P2 | Init 容器 | 新增 init-hang, init-crash | 2 |
| P2 | DNS | 新增 dns-policy-fail | 1 |

**Phase 2 — Knowledge-QA 类 (reproducible=false)，覆盖复杂多因果场景 (预计 8-10 个 case)**

| 优先级 | 故障分类 | ITBench scenarios | 预计 Siclaw case 数 |
|--------|---------|-------------------|---------------------|
| P0 | Feature Flag 级联 | 1, 3 | 2（已有 itb-highcpu-flag-003） |
| P0 | Chaos Mesh 注入 | 18, 26, 27 | 3 |
| P1 | HPA + Quota 死锁 | 新增复合场景 | 1（已有 hpa-quota-deadlock-005） |
| P1 | Service Mesh mTLS | Istio 类 | 2 |
| P2 | API Server 过载 | k8s-api-surge | 1 |

---

## 三、ITBench 评分机制分析与 Siclaw 适配

### 3.1 ITBench 的四维评分体系

```
┌─────────────────────────────────────────────────────┐
│                 ITBench SRE 评分                      │
├─────────────┬───────────────────────────────────────┤
│ Diagnosis   │ 1. NTAM Fault Localization (0-1.0)    │
│             │    → 根因定位的拓扑距离评分              │
│             │ 2. NTAM Fault Propagation (0-1.0)      │
│             │    → 传播链还原的完整度评分              │
│             │ 3. MTTD — Mean Time to Diagnosis (秒)  │
│             │    → 诊断速度                           │
├─────────────┼───────────────────────────────────────┤
│ Mitigation  │ 4. pass@1 (binary 0/1)                │
│             │    → alert 是否被清除                   │
│             │ 5. MTTR — Mean Time to Repair (秒)     │
│             │    → 修复速度                           │
└─────────────┴───────────────────────────────────────┘
```

### 3.2 Siclaw 当前的两维评分

```
┌──────────────────────────────────────────────┐
│           Siclaw 当前评分                       │
├─────────────┬────────────────────────────────┤
│ commands    │ 诊断路径评分 (1-5 整数)          │
│             │ LLM 对 kubectl 命令正确性的判断   │
├─────────────┼────────────────────────────────┤
│ conclusion  │ 结论评分 (1-5 整数)              │
│             │ LLM 对根因分析正确性的判断        │
└─────────────┴────────────────────────────────┘
```

### 3.3 差距分析

| 能力 | ITBench | Siclaw | 差距 |
|------|---------|--------|------|
| **根因定位精度** | NTAM 基于拓扑图计算距离，连续值 | LLM 主观打分 1-5 | 缺少结构化的根因比对 |
| **传播链评估** | 显式编码 propagation chain，逐节点评分 | 仅在自定义评分规则中用自然语言描述 | 缺少结构化传播链字段 |
| **部分正确** | NTAM 提供平滑的连续分值 | 整数跳跃 (3→4 是 20% 的差异) | 颗粒度不足 |
| **时间效率** | MTTD/MTTR 精确到秒 | 仅 case 整体耗时 | 缺少诊断/修复阶段细分 |
| **多解路径** | groundtruth 中 solutions 数组支持多条路径 | 单一期望答案 | agent 走不同正确路径可能被低评 |
| **修复验证** | pass@1 = alert 是否真正清除 | 无（agent 不修复，仅诊断） | Siclaw 定位是诊断 copilot，不做修复 |

### 3.4 推荐的评分增强方案

#### 方案 A：结构化根因 + 传播链字段（推荐）

在 case frontmatter 中增加结构化字段，让 LLM 评分有更精确的参考：

```yaml
id: itb-badenvvar-016
# ... 现有字段 ...

# ——— 新增字段 ———
rootCauseEntity:
  kind: Deployment
  name: shipping
  namespace: otel-demo-app
  field: spec.containers[0].env[?name=QUOTE_ADDR].value
  expected: "quote:8080"
  actual: "quote:0000"

propagationChain:
  - source: "shipping Deployment (env QUOTE_ADDR=quote:0000)"
    target: "shipping Pod (CrashLoopBackOff / 连接 quote:0000 失败)"
    condition: "TCP connect to port 0 is refused"
  - source: "shipping Pod"
    target: "checkout Service (HighRequestErrorRate)"
    condition: "shipping service unavailable, checkout cannot complete order"
  - source: "checkout Service"
    target: "frontend Service (HighRequestErrorRate)"
    condition: "checkout failure cascades to frontend"

faultCategory: "Configuration Setting"  # 对应 ITBench 的 6 大类

solutionPaths:
  - name: "rollback"
    steps:
      - "kubectl rollout undo deployment/shipping -n {namespace}"
  - name: "fix-env"
    steps:
      - "kubectl set env deployment/shipping QUOTE_ADDR=quote:8080 -n {namespace}"
      - "kubectl rollout restart deployment/shipping -n {namespace}"

complexity:
  chainLength: 3
  resolutionSteps: 1
  techDiversity: 1
  level: "Medium"  # ∛(3 × 1 × 1) ≈ 1.44
```

#### 方案 B：增强 evaluator 的评分维度

将 evaluator.ts 从 2 维扩展到 4 维，更接近 ITBench 的评估粒度：

```typescript
interface ScoreResult {
  // 现有维度
  scoreCommands: number;      // 1-5: 诊断路径正确性
  scoreConclusion: number;    // 1-5: 根因识别准确性

  // 新增维度
  scorePropagation: number;   // 1-5: 因果链还原完整度
  scoreRemediation: number;   // 1-5: 修复建议可行性

  scoreReasoning: string;
}
```

**新增维度评分标准：**

**Propagation Chain Score (1-5):**
- 5: 完整还原所有因果链节点 + 正确因果方向
- 4: 还原 ≥80% 节点，因果方向正确
- 3: 还原 ≥50% 节点，可能混淆方向
- 2: 仅识别起点和终点，中间链路缺失
- 1: 未识别任何传播关系

**Remediation Score (1-5):**
- 5: 给出可直接执行的修复命令 + 正确的回滚/修复策略 + 验证步骤
- 4: 修复方向正确、命令可执行，缺少验证
- 3: 修复方向正确但命令不完整或有小错误
- 2: 仅给出模糊建议，无具体命令
- 1: 修复建议错误或缺失

#### 方案 C：引入近似 NTAM 的评分（高级，可选）

对于有 `propagationChain` 字段的 case，在 LLM 评分之外增加一个**规则化的部分正确评分**：

```typescript
function computeSimplifiedNTAM(
  expectedChain: PropagationNode[],
  agentMentionedEntities: string[]
): number {
  // 1. 根因节点（chain[0]）权重最高
  const rootCauseWeight = 0.4;
  const chainNodeWeight = 0.6 / (expectedChain.length - 1);
  
  let score = 0;
  for (let i = 0; i < expectedChain.length; i++) {
    const weight = i === 0 ? rootCauseWeight : chainNodeWeight;
    if (agentMentionedEntity(agentMentionedEntities, expectedChain[i])) {
      score += weight;
    }
  }
  return score; // 0.0 - 1.0
}
```

这个简化版本不需要完整的 Kubernetes 拓扑图（ITBench 用 networkx 计算），而是用**传播链上的节点命中率**作为近似。根因节点的权重高于中间节点，与 ITBench NTAM 的"node importance factor"对齐。

### 3.5 推荐实施路径

```
Phase 1 (立即可做):
├── 在 case frontmatter 增加 propagationChain 字段
├── 在 case frontmatter 增加 solutionPaths 支持多解
├── 在 case frontmatter 增加 complexity 分级
├── evaluator.ts 增加 scorePropagation 维度
└── passThreshold 增加 propagation 阈值

Phase 2 (中期):
├── 拆分 durationMs → diagnosisTimeMs + totalTimeMs
├── 实现简化版 NTAM (基于传播链节点命中)
├── reporter.ts 增加难度分级统计和雷达图
└── 批量转换 ITBench 场景 (Phase 1 的 12-15 个)

Phase 3 (远期):
├── 引入 Kubernetes topology monitor (参考 ITBench 实现)
├── 实现完整 NTAM (需要 networkx 或等效 TS 图库)
├── 支持 Chaos Mesh CRD 注入 (需要测试集群部署 Chaos Mesh)
└── 添加 pass@1 修复验证 (agent 不仅诊断还执行修复)
```

---

## 四、具体对 Siclaw 的改进建议

### 4.1 Case 格式增强

**现有 frontmatter 保持不变，新增可选字段：**

```yaml
# ——— 新增可选字段（向后兼容，解析器缺省跳过）———

rootCauseEntity:                    # 结构化根因（替代纯自然语言）
  kind: Deployment
  name: shipping
  field: spec.containers[0].env[?name=QUOTE_ADDR].value

propagationChain:                   # 因果传播链
  - source: "..."
    target: "..."
    condition: "..."

solutionPaths:                      # 多解路径（替代单一期望结论）
  - name: "rollback"
    steps: ["kubectl rollout undo ..."]
  - name: "fix-in-place"
    steps: ["kubectl set env ...", "kubectl rollout restart ..."]

faultCategory: "Configuration Setting"  # ITBench 6 大故障类别之一
# 可选值: Change, Configuration Setting, Resource Saturation,
#         Resource Unavailable, Latency, Other

complexity:                         # 场景复杂度
  chainLength: 3                    # 传播链长度
  resolutionSteps: 1                # 修复步骤数
  techDiversity: 1                  # 涉及技术数
  level: "Medium"                   # Easy / Medium / Hard
```

### 4.2 Evaluator 增强

```
当前评分 prompt:
  "Score commands (1-5) and conclusion (1-5)"

增强后评分 prompt:
  "Score 4 dimensions:
   1. commands (1-5) — 诊断路径
   2. conclusion (1-5) — 根因识别
   3. propagation (1-5) — 因果链还原
   4. remediation (1-5) — 修复建议质量
   
   If propagationChain is provided, check each node.
   If solutionPaths is provided, accept ANY valid path."
```

### 4.3 Reporter 增强

**现有报告格式保持，新增列和统计：**

```markdown
| Case | 难度 | 故障类别 | 命令分 | 结论分 | 传播链分 | 修复分 | 阈值 | 耗时 | 结果 |
```

**新增汇总统计：**
```markdown
## 按难度分布
| 难度 | 总数 | 通过 | 通过率 |
| Easy | 5 | 5 | 100% |
| Medium | 8 | 6 | 75% |
| Hard | 2 | 0 | 0% |

## 按故障类别分布
| 类别 | 总数 | 平均结论分 | 平均传播链分 |
| Configuration Setting | 4 | 4.2 | 3.8 |
| Resource Saturation | 3 | 3.7 | 2.5 |
```

### 4.4 passThreshold 增强

```yaml
# 现有
passThreshold:
  commands: 3
  conclusion: 4

# 增强后
passThreshold:
  commands: 3
  conclusion: 4
  propagation: 3     # 新维度，可选，缺省不检查
  remediation: 0     # 0 = 不作为通过条件
```

---

## 五、ITBench 评分机制的核心洞察

### 5.1 NTAM 的本质思想

NTAM 解决的核心问题是：**当 agent 没有完全正确时，如何量化"接近正确"的程度**。

传统 pass@1 是 0/1 二值的 — agent 要么完全正确，要么完全失败。但在复杂的微服务故障中，agent 可能：
- 定位到了受影响的服务，但没有追溯到根因（部分正确）
- 识别了因果链中的 3/5 个节点（大部分正确）
- 找到了正确的区域但搞错了具体字段（几乎正确）

NTAM 的做法是：
1. 把整个 K8s 集群建模为**有向拓扑图**（Pod→Service→Deployment→...）
2. 用**图距离**衡量 agent 预测的故障实体与真实根因之间的"远近"
3. **根因节点权重最高**，越远离根因的节点贡献越少
4. 最终归一化到 [0, 1.0]

### 5.2 Siclaw 不需要完整 NTAM

Siclaw 的诊断场景通常在**单一 namespace** 内，资源拓扑远比 ITBench 的 OpenTelemetry Demo（10+ 微服务）简单。对 Siclaw 而言：

- **根因定位**：可以用结构化的 `rootCauseEntity` + LLM 判断来替代拓扑距离计算
- **传播链**：可以用显式的 `propagationChain` 数组 + LLM 逐节点对比来替代 NTAM 的图遍历
- **部分正确**：通过 LLM 的 1-5 分制已经能区分"完全正确"/"大部分正确"/"部分正确"/"基本错误"

真正值得引入的是 **NTAM 的思想**（结构化根因比对 + 传播链逐节点评分 + 根因加权），而非其实现（需要实时拓扑图 + networkx 计算）。

### 5.3 ITBench 的多解路径思想

ITBench 的 `solutions` 数组是一个关键设计：

```yaml
solutions:
  - - steps:                          # 解法 1: rollback
      - command: kubectl rollout undo deployment/shipping -n ns
  - - steps:                          # 解法 2: 手动修复
      - command: kubectl edit deployment/shipping -n ns
  - - steps:                          # 解法 3: set env
      - command: kubectl set env deployment/shipping QUOTE_ADDR=quote:8080 -n ns
```

这意味着 agent 走任何一条正确路径都应该得到高分。Siclaw 当前的单一 `期望结论` 可能低评了走不同路径但同样正确的 agent。引入 `solutionPaths` 可以解决这个问题。

### 5.4 时间维度的价值

ITBench 的 MTTD/MTTR 揭示了一个 Siclaw 当前忽略的维度：**诊断效率**。

两个 agent 都能得到 conclusion=5，但一个用 30 秒、另一个用 5 分钟 — 在真实 SRE 场景中差异巨大。建议 Siclaw 至少拆分出 `diagnosisTimeMs`（从 agent session 创建到首次正确命令之间的时间）。

---

## 六、总结

| 改进点 | 价值 | 实施难度 | 建议优先级 |
|--------|------|---------|-----------|
| 增加 propagationChain 字段 | 高 — 结构化评估因果链推理能力 | 低 — 仅改 parser + evaluator prompt | P0 |
| 增加 solutionPaths 多解 | 高 — 避免错误低评正确解法 | 低 — 仅改 evaluator prompt | P0 |
| 增加 scorePropagation 维度 | 高 — 区分"找到根因"vs"理解全链" | 中 — 改 evaluator + reporter | P0 |
| 批量转换 ITBench reproducible 场景 | 高 — 从 10 个 case 扩展到 25+ | 中 — 每个 case 需手写工单和翻译 | P1 |
| 增加 complexity 分级 | 中 — 分层分析 agent 能力上限 | 低 — 仅加 frontmatter 字段 | P1 |
| 增加 faultCategory 分类 | 中 — 按故障类型分析弱项 | 低 — 仅加 frontmatter 字段 | P1 |
| 拆分诊断时间 diagnosisTimeMs | 中 — 评估诊断效率 | 中 — 需改 runner 的事件处理 | P2 |
| 简化版 NTAM | 中 — 更精确的部分正确评分 | 高 — 需要实体提取 + 匹配算法 | P2 |
| scoreRemediation 维度 | 低 — Siclaw 定位诊断不修复 | 低 — 仅改 evaluator prompt | P2 |
| 完整 NTAM + 拓扑图 | 低 — 对 Siclaw 场景 ROI 不足 | 很高 — 需要实时集群拓扑采集 | P3 |
