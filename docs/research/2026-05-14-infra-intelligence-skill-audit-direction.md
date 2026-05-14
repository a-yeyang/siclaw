# Infra 智能化兴趣小组调研稿：从 Skill 审计到运维经验沉淀

> 讨论定位：这份材料不是 Siclaw skill audit 的实现说明，而是把论文调研、Siclaw 实践发现、以及 Infra 智能化兴趣小组的方向放到同一张图里，回答一个问题：**运维 Agent 如何从“会调用工具”走向“可追溯地复用经验、沉淀经验、演化经验”。**

---

## 1. 核心判断

这次 Siclaw skill audit 的实践和 Infra 智能化兴趣小组方向高度相关，尤其对应三条主线：

- **集群知识库体系构建**：audit 日志、Skill、Chat、工具调用、排障结论，是构建“运维知识图谱 / LLM Wiki”的高价值原始材料。
- **运维自动追溯与 Skill 自动生成**：Skill 本质上是把“人经验”转成 Agent 可复用能力模块；audit 让我们知道模型是否真的使用、理解、遵循了这些模块。
- **长工作流稳定性研究**：复杂排障里，Agent 容易漏步骤、跳证据、凭感觉下结论；Skill 覆盖率、证据覆盖率、流程检查点可以成为稳定性研究的客观指标。

更直接地说：**Skill 不是单纯的 prompt 文件，而是 Infra Agent 的经验接口；Skill audit 是经验接口的观测系统。**

---

## 2. 背景：Siclaw 当前的真实痛点

Siclaw 的 SRE Agent 架构不是“一个 Agent 配齐所有 skill”，而是更接近专家模式：

- 全局有 3-5X 规模的 Skill 池。
- 每个专家 Agent 只携带 0.5-1X 的 Skill。
- Skill 覆盖 Kubernetes、GPU、存储、网络、调度、告警、工具脚本、诊断流程等不同领域。

这带来一个关键问题：当 Skill 池增大、专家 Agent 分化之后，我们不能只问“模型能不能答对”，还要问：

- 它是否知道该看哪些 Skill？
- 它是否真的读了 Skill，还是凭训练知识直接操作？
- 它是否按 Skill 的流程组织证据？
- 它是否遗漏了关键检查项？
- 哪些 Skill 热、哪些冷、哪些长期被忽略？
- 哪些 Skill 看似存在，但对实际推理没有帮助？

这也是这次实践里最重要的发现：**一次排障结论正确，不代表 Agent 使用了可复用经验；如果没有审计，系统仍然是黑盒。**

---

## 3. 相关论文与项目给我们的启发

### SkillRL：从 raw trajectory 到可复用 SkillBank

SkillRL 提出的核心方向是：LLM Agent 不能只保存原始轨迹，因为原始轨迹冗余、噪声大、不利于泛化；更有价值的是从历史经验中自动蒸馏出高层、可复用的行为模式，形成层次化 SkillBank，并在强化学习过程中递归演化。

对 Siclaw 的启发：

- 排障日志和 Chat 不是最终知识形态，只是原材料。
- 真正应该沉淀的是“可复用排障路径、证据模板、风险边界、失败经验”。
- Skill 需要持续演化，而不是一次写完后长期静态存在。
- 经验沉淀不能只看成功样本，也要保留失败路径，避免 Agent 重复无效探索。

### SkillRouter：Skill 池扩大后，路由本身就是问题

SkillRouter 关注的是大规模 Skill 生态里的 skill routing：给定用户任务，系统要先找到相关 Skill，再进入规划和执行。论文中特别重要的一点是：只暴露 Skill 名称和描述会显著降低路由准确率，完整 Skill 文本是关键路由信号。

对 Siclaw 的启发：

- 我们现在的专家模式会自然遇到 Skill routing 问题。
- “Agent 配哪些 Skill”与“运行时该读哪些 Skill”应分开评估。
- 只统计最终答案不够，需要统计 expected skill、read skill、missing skill、read-before-evidence 等行为指标。
- Skill 文本质量本身会影响路由；Skill 写得不清楚，模型可能不会选择它，也可能读了但用错。

### SkillFlow：长期 Skill 演化需要同时看 usage 和 utility

SkillFlow 提供了一个面向 autonomous agents 的 lifelong skill discovery and evolution benchmark。它关注 Agent 是否能在连续任务中发现、修复、维护 Skill，并通过 trajectory-driven / rubric-driven 的 skill patches 让 Skill library 随任务推进而演化。

这篇论文里很值得注意的一点是：高 Skill 使用率不必然带来高收益。也就是说，Agent “用了 Skill”只是第一层信号，真正重要的是 Skill 是否提升任务成功、减少失败路径、帮助迁移到后续任务。

对 Siclaw 的启发：

- Skill audit 不能只统计 read count，还要进一步评估 utility。
- `usedExpectedSkills`、`missingExpectedSkills` 只是 P0 指标，后续还要接 case replay 和诊断质量评价。
- Skill 自动生成 / 自动修复应该从历史 trajectory 和 rubric 出发，而不是只让模型凭印象写新 Skill。
- 长期 Skill library 需要维护一致性、版本边界和失败修复记录。

### MemPalace / LLM Wiki：原文保留 + 结构化检索

MemPalace 的方向强调保留原始对话 / 原始上下文，并用结构化空间、语义检索、知识图谱来组织记忆。它对“LLM Wiki / 运维知识库”的启发是：不要过早只做总结，因为总结会丢失推理过程和反例。

对 Siclaw 的启发：

- Chat、tool calls、audit ledger、K8s 事件、日志片段都应该作为可回放原文保留。
- 上层再做归纳：事件类型、根因类型、证据类型、Skill 使用路径、是否成功。
- “原文证据 + 结构化摘要”比单纯 RAG 文档库更适合 SRE 场景。

### Hermes-agent / agent grows with you：Skill 与 Memory 的协同演化

Hermes-agent 的实践方向是把 skills、memory、tools、sessions 作为 Agent 可长期增长的能力面。它和我们关注的点一致：Agent 不只是调用工具，而是在不断积累上下文、沉淀技能、扩展工具边界。

对 Siclaw 的启发：

- Skill 自动生成可以作为长期方向，但必须受审计、权限和人工评审约束。
- 自动写 Skill 前，先要知道现有 Skill 是否被用、哪里不够、哪些排障路径反复出现。
- “Agent 自己开发工具”需要安全沙箱、回放验证和发布门禁。

### RTK：噪声压缩与上下文预算

RTK 主要做 CLI 输出压缩，让 Agent 少消耗上下文在低价值噪声上。对 SRE Agent 来说，日志、事件、describe、trace、metrics 都可能很长，噪声压缩和可回放摘要很关键。

对 Siclaw 的启发：

- 审计不应把所有原始输出塞回模型上下文。
- 需要区分“可审计原文存储”和“给模型看的压缩证据”。
- Skill 也可以约束每类问题应该保留哪些证据、压缩哪些噪声。

---

## 4. Siclaw 这次实践看到的现象

这次我们做的不是完整产品化 UI，而是先验证底层可观测性是否有价值。实践里已经出现了几个很有代表性的现象。

### 现象一：答对不等于用了 Skill

在一次真实 Pending pod 排查里，Agent 找到了核心原因：PVC / StorageClass / 节点状态相关问题。但 audit 显示 `skill_read=0`。

这说明：

- 模型可以凭训练知识和工具输出做出不错判断。
- 但这个过程没有沉淀为“按组织经验工作”。
- 如果没有 audit，我们会误以为 Skill 体系已经发挥作用。

### 现象二：显式要求读 Skill 会改变行为，但不能代表自然行为

当 prompt 明确要求先读相关 Skill，Agent 会读 `pvc-debug` 等 Skill。

这说明：

- Skill 本身可被模型消费。
- 但“prompt 强制读”不是最终答案，因为真实用户不会每次提醒 Agent。
- 我们需要评估自然任务下的 Skill 选择能力。

### 现象三：自然任务下开始命中 Skill，但覆盖仍不完整

在后续版本里，Agent 面对 Pending / PVC / node health 相关问题时自然读了 `pod-pending-debug`，但 audit 同时发现它没有读到 `pvc-debug`、`node-health-check` 等相关 Skill。

这说明 audit 的价值不只是“有没有用 Skill”，而是能进一步回答：

- 用的是不是关键 Skill？
- 是否遗漏了应该看的 Skill？
- Skill 阅读发生在证据采集前还是之后？
- 多 Skill 问题里，是否只命中最显眼的一个？

---

## 5. 与兴趣小组方向的对应关系

### 一页版对齐

| 兴趣小组方向 | 当前关注 | 本次调研 / Siclaw 实践的连接点 | 可形成的阶段产出 |
| --- | --- | --- | --- |
| 集群知识库体系构建 | 代码 / 文档 / 工单 / Chat，多源接入，LLM Wiki，知识冲突与版本 | audit trace 可以把“Agent 实际怎么排障”变成结构化经验源；Skill 版本可以关联到具体诊断结论 | SRE LLM Wiki 原型、RCA 知识图谱 schema、历史 case 索引 |
| 运维自动追溯与 Skill 自动生成 | 人经验转 Agent 能力模块，日志 / trace RCA，自动总结排障路径 | Skill audit 先回答“现有 Skill 是否被用、哪里缺、哪里误导”，再进入自动生成 / 更新 | Skill 使用审计、Skill evolution proposal、失败路径反模式库 |
| 长工作流稳定性研究 | 漏步骤、死循环、偏离目标，Planner / Executor，状态机 + checkpoint | expected skill、证据清单、read-before-evidence 可以作为长任务 checkpoint 指标 | Skill-based checkpoint、诊断 DAG、长任务稳定性评估集 |
| 智算中心规划智能体 | 设备规格、网络设计、机柜、电力散热、历史方案、BOM/SOP | 同样可以把规划经验做成 Skill，并审计规划过程是否引用了必要知识 | 规划 Skill Map、BOM / 拓扑生成审计、规划知识库 |

### 方向 A：集群知识库体系构建（运维知识图谱）

兴趣小组当前关注：

- 多源数据接入：代码 / 文档 / 工单 / Chat。
- 知识结构化：Karpathy LLM Wiki、运维知识图谱。
- 难点：非结构化数据标准化、知识冲突 / 版本问题。

Siclaw skill audit 可以提供一类新的结构化数据源：

- 任务类型：Pending、CrashLoop、GPU 异常、网络异常、存储异常。
- 使用行为：可用 Skill、读取 Skill、执行脚本、调用工具。
- 证据链：kubectl 事件、日志、metrics、trace、最终结论。
- 结果标签：成功、未证实、误判、需要人工介入。
- 知识版本：哪个 Skill 版本被用于哪次诊断。

因此它可以成为 LLM Wiki 的“经验索引层”：不是只存文档，而是存“这类问题过去怎么查、查到了什么、哪些 Skill 真有用”。

### 方向 B：运维自动追溯与 Skill 自动生成

兴趣小组当前关注：

- 把“人经验”转成 Agent 能力模块。
- Agent 自动总结排障路径，形成 reusable skill。
- Agent 自己开发工具，直接使用自己开发的工具。
- 风险点：安全。

Siclaw 这次实践给出的工程切入口是：

- 先审计，再生成。
- 先统计冷 / 热 Skill、遗漏 Skill、成功路径，再让 Agent 提议 Skill 更新。
- Skill 自动生成必须有回放验证、人工审核、权限边界和版本管理。

可行闭环：

1. 采集多次真实排障 audit。
2. 聚类相似任务和相似证据路径。
3. 对高频成功路径生成候选 Skill。
4. 对高频失败 / 绕路路径生成反模式提醒。
5. 用历史 case replay 验证候选 Skill 是否提升覆盖率和结论质量。
6. 人工审核后进入 Skill 池。

### 方向 C：长工作流稳定性研究

兴趣小组当前关注：

- 复杂故障诊断中漏步骤、死循环、偏离目标。
- Planner / Executor 分层。
- 状态机 + DAG workflow。
- checkpoint 机制。

Skill audit 可以把“稳定性”从主观体验变成可统计指标：

- 是否读取 expected skill。
- 是否在关键证据前读取流程 Skill。
- 是否完成 Skill 中定义的检查项。
- 是否存在重复无效工具调用。
- 是否在结论中引用实际证据。
- 是否跳过了关键反证。

这可以进一步接到 Planner / Executor：

- Planner 负责识别任务类型和 expected skill。
- Executor 按 Skill 中的证据清单执行。
- Checkpoint 判断证据是否足够，不足则禁止直接下根因结论。
- Audit 负责离线评估和持续改进。

### 方向 D：面向智算中心建设的人机协同规划智能体

这个方向虽然不是 SRE 排障，但方法论相通：

- 规划 Agent 也需要领域知识库。
- 规划流程也有 Skill：设备选型、网络拓扑、机柜容量、电力散热、BOM、历史方案。
- 规划结论也需要可追溯证据：引用厂商规格、内部 SOP、历史项目模板。

因此 Skill audit 可以扩展为“规划路径审计”：

- 这个规划是否查询了设备规格？
- 是否检查了机柜 / 电力 / 散热约束？
- 是否引用了历史项目方案？
- 是否遗漏了必须的 BOM 字段？

---

## 6. 建议的探索路线

### P0：可观测性底座

目标：先让 Agent 行为不再是黑盒。

产出：

- Skill 使用 ledger：可用 Skill、读取 Skill、脚本执行、工具调用、prompt lifecycle。
- 离线 summary：冷 / 热 Skill、expected skill 覆盖率、missing skill、read order。
- 小规模真实 case corpus：Pending、PVC、NodeNotReady、CrashLoop、GPU 等。

判断标准：

- 能回答“某次排障用了哪些 Skill、漏了哪些 Skill、证据从哪里来”。
- 能按任务类型统计 Skill 使用分布。
- 能发现“答对但未用 Skill”的情况。

### P1：任务到 Skill 的期望矩阵

目标：建立第一版 Infra RCA Skill Map。

产出：

- 任务类型 taxonomy：调度、存储、网络、GPU、镜像、权限、DNS、Ingress、资源配额。
- expected skill / related skill 映射。
- 任务样本集和评估脚本。

判断标准：

- 给定一个排障 prompt，可以判断应关注哪些 Skill。
- 能统计 expected coverage 和 missing coverage。
- 能支持专家 Agent 的 Skill 配置评估。

### P2：经验沉淀与 Skill 演化

目标：把真实排障经验转成可审核的 Skill 更新建议。

产出：

- 从 audit trace 中挖掘高频成功路径。
- 从失败 trace 中挖掘反模式。
- 自动生成 Skill patch proposal。
- 人工审核 / replay 验证机制。

判断标准：

- 新 Skill 或 Skill 更新能在历史 case 上提升覆盖率、减少绕路、降低误判。
- 生成内容有证据来源和版本边界，不是凭模型想象。

### P3：Workflow checkpoint 与长任务稳定性

目标：让 Agent 在复杂排障里少漏步骤、少跳结论。

产出：

- Planner / Executor 分层实验。
- 关键证据 checkpoint。
- 多 Skill DAG：例如 Pending -> PVC -> StorageClass -> Node -> Quota。
- “证据不足不能下结论”的运行约束。

判断标准：

- 长任务中重复调用减少。
- 关键检查项遗漏减少。
- 结论证据引用率提升。

### P4：LLM Wiki / 运维知识图谱

目标：将 Chat、工单、文档、代码、Skill、audit trace 统一成可检索、可追溯、可版本化的知识体系。

产出：

- 原文证据层：Chat / ticket / log / trace / tool output。
- 结构化索引层：任务类型、根因类型、证据类型、Skill、集群对象。
- 归纳总结层：经验卡片、Skill、runbook、反模式。
- 冲突与版本机制：哪个经验适用于哪个集群、哪个版本、哪个组件。

判断标准：

- Agent 能从知识库中找到相关历史 case。
- 人能追溯经验从何而来。
- 过时知识可以被识别和失效。

---

## 7. 推荐指标体系

### Skill 使用指标

- Skill exposure：本次任务可见 Skill 数。
- Skill read rate：实际读取 Skill 数 / 可见 Skill 数。
- Expected coverage：读取 expected Skill 数 / expected Skill 数。
- Related coverage：读取 related Skill 数 / related Skill 数。
- Missing expected Skill：应读但未读的 Skill。
- Read-before-evidence：是否在关键证据采集前读取流程 Skill。

### 诊断质量指标

- Evidence citation rate：结论中引用实际证据的比例。
- Critical checklist coverage：关键检查项覆盖率。
- Unsupported conclusion rate：无证据结论比例。
- Repeated tool loop：重复无效工具调用次数。
- Human correction rate：需要人工纠偏次数。

### Skill 价值指标

- Hot Skill：高频使用且与成功诊断相关。
- Cold Skill：长期未使用或只暴露不读取。
- Misleading Skill：读取后更容易误判或绕路。
- Update candidate：频繁被补充说明、反复缺少某类检查。
- Retire candidate：长期无人使用、内容过时、和其他 Skill 冲突。

---

## 8. 风险与边界

### 安全风险

- 自动生成 Skill 可能引入危险命令、越权操作、错误假设。
- Skill 中的脚本需要权限边界、白名单、dry-run、人工审核。
- Audit 数据可能包含集群信息、日志片段、用户输入，需要脱敏和访问控制。

### 质量风险

- 历史成功路径不一定通用，可能过拟合某个集群。
- Skill 可能过期，尤其是组件版本、部署方式、内部平台接口变化后。
- 自动总结可能丢失反例，导致 Agent 过度自信。

### 评估风险

- “读了 Skill”不等于“理解了 Skill”。
- “用了工具”不等于“证据充分”。
- “答对一次”不等于“流程可靠”。

因此评估必须组合：

- 行为审计。
- 证据覆盖。
- 历史 case replay。
- 人工抽检。
- 真实测试环境验证。

---

## 9. 对兴趣小组的建议选题

### 选题 1：Infra RCA Skill Map v0

目标：建立第一版运维任务类型到 Skill / 证据 / 工具的映射。

适合对接：

- 集群知识库体系构建。
- 运维自动追溯与 Skill 自动生成。

### 选题 2：Skill Audit Dataset v0

目标：从真实 Siclaw 排障会话中沉淀一批可回放 case，用于评估 Skill 使用和诊断质量。

适合对接：

- 长工作流稳定性研究。
- 微调 / RL / judge 评估。

### 选题 3：Skill Evolution Proposal

目标：让 Agent 基于 audit trace 提议 Skill 新增 / 修改 / 废弃，但发布必须经过人审和 replay。

适合对接：

- Hermes-agent 类 Skill 自动生成方向。
- “人经验 -> Agent 能力模块”的工程闭环。

### 选题 4：LLM Wiki for SRE Experience

目标：把 Chat、工单、日志、trace、Skill、audit 串成可追溯知识库。

适合对接：

- Karpathy LLM Wiki。
- MemPalace 类原文保留 + 结构化检索。
- 运维知识图谱。

## 10. 资源支持建议

### 自建 MaaS API

优先支持：

- audit trace 的离线 judge。
- Skill routing / expected skill 评估。
- 历史 case replay。
- Skill patch proposal 的生成与对比。

### GPU / 微调

建议放在 P1/P2 后再启动，不建议一开始就微调。

更合理的顺序是：

1. 先有真实 audit 数据。
2. 再有任务类型和 expected skill 标签。
3. 再做 judge / router / planner 的小模型实验。
4. 最后才考虑微调或 RL。

### 会议与协作

建议围绕三个问题组织讨论：

- 经验源：哪些 Chat、工单、日志、trace、代码、文档可以进入知识体系？
- 经验形态：哪些应该沉淀为 Skill，哪些应该沉淀为 Wiki，哪些应该保留为原文证据？
- 经验验证：如何证明一个 Skill 真能提升排障质量，而不是制造新的偏见？

---

## 11. 一句话结论

Siclaw 这次 Skill audit 的价值，不只是知道“Agent 调了哪些工具”，而是开始让 Infra Agent 的经验复用变得可观测、可评估、可演化。

如果兴趣小组的目标是构建长期可用的 Infra 智能化能力，那么建议把 Skill 体系看作“经验模块化”，把 audit 看作“经验是否真正进入推理过程的观测层”，再往上发展 Skill 自动生成、LLM Wiki、长工作流 checkpoint 和专家 Agent 路由。

---

## 参考

- SkillRL: Evolving Agents via Recursive Skill-Augmented Reinforcement Learning, arXiv 2602.08234: https://arxiv.org/abs/2602.08234
- SkillRouter: Skill Routing for LLM Agents at Scale, arXiv 2603.22455: https://arxiv.org/abs/2603.22455
- SkillFlow: Benchmarking Lifelong Skill Discovery and Evolution for Autonomous Agents, arXiv 2604.17308: https://arxiv.org/abs/2604.17308
- MemPalace: https://github.com/mempalace/mempalace
- Hermes Agent: https://github.com/NousResearch/hermes-agent
- RTK: https://github.com/rtk-ai/rtk
