# Orchestrator · 编排 Agent

职责：理解用户目标、拆解任务、调用专业 Agent、合并冲突并标注来源。Orchestrator 不直接产出领域建议，也不绕过用户执行高影响操作。

## 配置

| 项 | 值 |
| --- | --- |
| id | `orchestrator` |
| 代码 | `server/agents/orchestrator.mjs` |
| 指令 | `server/agents/instructions/orchestrator.md` |
| 定义文件 | 无（编排者不由 `definitions/` 装配） |
| 依赖 | `registry`、`provider`、`tools`、`runRepository`、`repository` |
| 运行状态 | 无独立持久状态；运行状态记录在 `AgentRun.status` |

## 指令摘要

- 内置三角色时通常拆为 1-3 个子任务；实际数量取决于启用的定义与匹配结果，不硬编码为三个。
- 含 Atlas 的依赖组合默认串行（携带共享上下文），其余默认并行，可用 `strategy` 覆盖。
- 合并结果最多返回 3 条建议（对齐 BRD 的认知负担约束），每条标注来源 Agent。
- 高影响写操作进入 `awaiting_confirmation`，等待用户确认后才执行。

## 输入输出协议

- 输入：`{ goal, strategy: auto|sequential|parallel, agentIds?, allowHandoff? }`
- 输出：`AgentRun`（见 `shared/contracts/openapi.yaml`）。包含 `plan`、`calls`、`messages`、`memory`、`conflicts`、`applied`、`proposals`、`result`。

## 工具权限

- `state:read`：读取工作台状态。
- 通过 `tools.applyProposal` 代专业 Agent 执行获批动作；本身不直接写业务状态。

## 运行状态

`running → completed | failed | awaiting_confirmation → completed | partially_confirmed | failed`

- 单个 Agent 失败：记录 `calls[].error` 并继续（失败隔离）。
- 全部 Agent 失败：`failed` + `error.code = ALL_AGENTS_FAILED`。
- 用户批准的工具动作执行失败：提案标记 `failed` 并保留失败原因；全部确认处理完后运行标记为 `failed`。

## 协作流程

1. 生成 `plan`，向消息总线发布 `goal` / `plan` 消息。
2. 按策略执行首批调用，每个 Agent 产出结构化结果。
3. 处理 handoff 队列（目标已在计划中的不重复调用，深度上限 1 轮）。
4. 检测冲突、汇总建议、应用低风险动作、标记待确认项。
5. 持久化 `runId`、调用顺序、输入、输出、状态、耗时与错误。

## 规划与 Provider 的实际边界

Orchestrator 当前按 routing 关键词和依赖规则生成计划，不调用 ModelProvider 进行自由规划。instructions/orchestrator.md 是角色说明与公开描述来源，当前不会作为一个额外的系统消息发送给模型。配置真实 API Key 后，产生模型请求的是每一次专业 Agent 执行。

三个内置 Agent 共用 createAgentSystem 解析的一个 Provider/模型，没有每角色独立 Key、独立模型进程或持续运行的后台人格。各次调用由专业角色的独立指令、输入输出与权限区分。OpenCode 开发期的子 Agent 则由 OpenCode 自身调度，属于另一层系统。

## 选择与交接规则

| 阶段 | 当前代码规则 |
| --- | --- |
| 显式 agentIds | 只选择注册表中存在的 id，并按注册表顺序执行 |
| 关键词匹配 | 选择所有命中各定义 routing 的角色；未命中时选择全部已启用角色 |
| auto 策略 | 多角色且没有 Atlas 时默认 parallel，其余 sequential |
| 显式策略 | sequential / parallel 可覆盖默认策略；用户选择并行时要接受分支无法读取尚未完成结果的限制 |
| handoff | 对目标去重，只调用本次尚未参与的 Agent，最多补充一轮 |
| 冲突检测 | 当前仅针对 Atlas/Mira 的学习量与负载指标；不是任意角色通用辩论 |
| 合并 | 最多三条建议，冲突调和优先，其后轮询各 Agent 的行动步骤 |

## 输入、输出与共享上下文

创建请求示例：

```json
{"goal":"帮我安排明天的数学复习和作息节奏","strategy":"auto","allowHandoff":true}
```

run 初始包含 id、goal、plan、running 状态；异步结果通过 GET /agents/runs/:runId 获取。calls 保留调用顺序、输入/输出、耗时、错误、实际 provider、degraded 与 degradationReason。memory 保留本次目标、事实、约束、冲突与来源；messages 记录任务、结果和交接事件。

业务 state 在运行开始时读取一次；串行专业 Agent 可通过 memory 看到先前结果，但并不意味着它们反复重新读取最新业务状态。自动写入在汇总阶段统一进行。跨运行只读取持久化业务数据，不自动共享整个旧运行的事实历史。

## 动作授权与用户确认

- 只允许普通 create_task 进入低风险自动分支；还必须得到工具许可，未显式要求确认，且满足整次最多三条及当前角色自动额度。
- update_task、delete_task、reschedule_block、goal_recalibration 都是高影响，不接受模型将它们标为 low 以绕过确认。
- 每条确认必须使用唯一 proposalId 和明确的 approve / reject。同一运行的确认请求排队，并在执行前读取最新轨迹，避免重复执行已处理提案。
- approval 不增加 Agent 工具权限；没有对应权限时仍执行失败。
- 仍有 pending 时保持 awaiting_confirmation；没有 pending 后，有失败为 failed，有拒绝为 partially_confirmed，其余 completed。

## Provider 状态与故障处理

Provider 由启动时的 AI_PROVIDER 选择；不自动读取根目录的 .env。如何启动和注入 Key 以 README 为准，不能在 Agent Markdown 中放密钥。

全局 describe 只描述配置可用性；端点错误、请求超时或 JSON 解析失败时，调用退回 rules，轨迹写入实际来源与降级原因。MODEL_TIMEOUT_MS 默认 8000ms，接受 1..300000 的整数，非法值回退默认；它约束单次模型请求，而非整轮运行。运行级异常必须保存 failed，不能让查询长期停在 running。单角色失败可被隔离；completed 不代表每个角色都成功，仍需查看 calls 与 result.notes。

JSON mode 不保证返回内容符合全部字段约束；当前没有严格 JSON Schema 与原生函数工具调用协议。确认队列只在单 Node 进程内有效，state.json 与 runs.json 也没有跨文件事务，不承诺进程崩溃后严格只执行一次。

## 验证清单

运行 `npm.cmd run check`。关键行为由 tests/agents.test.mjs 与 tests/repository.test.mjs 覆盖：规划与来源、handoff 上下文、错误风险标注、确认重复执行、磁盘恢复、失败终态、模型降级。测试默认不使用付费服务；是否完成真实模型联调，必须以一次非降级运行单独记录。
