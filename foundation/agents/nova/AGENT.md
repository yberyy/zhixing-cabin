# Nova · 成长顾问

职责：周复盘、目标校准、趋势洞察与优先级调整。

## 配置

| 项 | 值 |
| --- | --- |
| id | `nova` |
| 运行时装配 | `registry.mjs` → `definition-loader.mjs` → `skill-agent.mjs` |
| 兼容类入口 | `server/agents/agents/nova.agent.mjs`（导出 NovaAgent） |
| 定义文件 | `server/agents/definitions/nova.json`（身份、权限、协议、路由） |
| 技能 | `trend-review` → `server/agents/skills/trend-review.skill.mjs` |
| 指令 | `server/agents/instructions/nova.md` |
| 能力 | 目标校准、趋势洞察、复盘提炼、优先级调整 |
| 状态 | `idle` / `working` / `error`（对外映射为 `ready` / `working` / `error`） |

## 指令摘要

- 不把短期波动包装成确定结论，使用「倾向于」「可能」等限定词。
- 目标校准属于高影响操作，必须等待用户确认。
- 样本少于 3 个任务时不据完成度提出校准建议，并在 `summary`/`notes` 说明统计口径与不足；统计为累计快照，不按自然周截取。
- 输出结构化中文：`summary`、`steps[3]`、`proposals`、`metrics{completionRate,sampleSize,enoughData,moodAverage}`。

## 输入输出协议

- 输入：`goal`、`context.state.tasks`、`context.state.reviews`、`handoff.payload.loadMinutes`，并可读取共享上下文中的 `agent.mira.metrics`。
- 输出：`summary`、`steps[3]`、`proposals[]`、`metrics{completionRate,sampleSize,enoughData,moodAverage,reviewCount,validMoodCount,loadMinutes,needsRecalibration}`、`notes[]`、`sources[]`。零任务时 `completionRate` 为 `null`，不再折算为 0。

## 工具权限

| 工具 | 权限 |
| --- | --- |
| `state:read` | allow |
| `tasks:create` | low risk，每轮最多 1 条 |
| `tasks:update` | deny |
| `tasks:archive` | deny |
| `schedule:reblock` | deny |
| `goals:recalibrate` | 高影响，必须用户确认 |

## 运行状态

- 完成度低于 60%（且样本不少于 3 个任务）或负载高于 150 分钟时，产出目标收窄建议（高影响，待确认）；负载判定不受样本量限制。
- 落地时只新增一条 `聚焦：…` 任务，不修改既有目标或优先级，摘要会明确说明这一点。
- 不发起 handoff；失败时返回错误消息，由编排层隔离。

## 触发条件与统计口径

- 复盘、目标、趋势、成长等定义关键词可触发，也能由 Mira handoff 或 agentIds 显式调用。
- routingDefault 用于兼容旧版单 Agent 指令路由；不能据此推断新运行无关键词时只调用 Nova。新运行无匹配时由 Orchestrator 选择全部角色。
- completionRate = 未归档任务中 done 数 / 未归档任务总数，四舍五入成百分比；无任务时为 0。这不是按自然周截取的周完成率。
- moodAverage 是当前输入复盘评分的平均值，缺少复盘为 null；没有心理诊断含义。
- loadMinutes 来自 handoff 或共享事实中的 Mira 指标。规则没有自动获取用户真实空闲时间。

## rules 技能的输出与写入效果

三个行动分别帮助用户说明真实意图、选择一个能验证的行动、安排一次简短复盘。完成率低于 60% 或负载超过 150 分钟时，提出 goal_recalibration，附上完成率/负载与建议理由。

**当前目标校准的实际写入效果是新增一条成长类聚焦任务。** 项目还没有独立 Goal 对象，批准建议不会自动删除其他任务、延期整个目标树、更新学期计划或写入第三方目标管理器。实际 effect 为 recorded_goal_focus，需要在轨迹中显示。

Nova 虽声明可低风险新增一条普通任务，但当前 trend-review 规则主要输出高影响目标校准，不保证每次都会生成普通任务。

## 输出示例

下面是示例分析片段，不是用户的实际完成率或已执行动作：

```json
{
  "metrics": {"completionRate": 40, "moodAverage": null, "reviewCount": 0, "loadMinutes": 180, "needsRecalibration": true},
  "proposals": [{"type": "goal_recalibration", "risk": "high", "title": "收窄本周首要目标", "payload": {"suggestedFocus": "先完成一个重要行动", "completionRate": 40, "loadMinutes": 180}}]
}
```

拒绝提案时不新增聚焦任务；并发批准同一提案不得创建两条任务。数据少时必须说明统计口径与不足，不能把固定 confidence 值解释成经过校准的模型置信度。

## 模型、记忆与开发期边界

openai/local 成功时使用 instructions/nova.md 与输入摘要，而不是执行 trend-review 的确定性函数。该模式不自动训练个人模型，也不跨运行积累独立长期记忆；它能读取的是提供给本次运行的任务/复盘和运行级共享上下文。

OpenCode 的 Nova 来自 `.opencode/agents/nova.md`，只用于审查成长领域实现。验证重点：建议带来源、数据不足时不编造、目标校准等待确认、重复确认不重复写入与失败隔离。
