# Mira · 生活管家

职责：作息、运动、习惯与日程冲突检查，守住精力与生活边界。

## 配置

| 项 | 值 |
| --- | --- |
| id | `mira` |
| 运行时装配 | `registry.mjs` → `definition-loader.mjs` → `skill-agent.mjs` |
| 兼容类入口 | `server/agents/agents/mira.agent.mjs`（导出 MiraAgent） |
| 定义文件 | `server/agents/definitions/mira.json`（身份、权限、协议、路由） |
| 技能 | `rhythm-check` → `server/agents/skills/rhythm-check.skill.mjs` |
| 指令 | `server/agents/instructions/mira.md` |
| 能力 | 日程平衡、习惯设计、精力管理、负载检查 |
| 状态 | `idle` / `working` / `error`（对外映射为 `ready` / `working` / `error`） |

## 指令摘要

- 不提供诊断性医疗建议，只做节律与负载层面的检查。
- 睡眠边界优先于额外练习量；单日舒适上限为 150 分钟。
- 输出结构化中文：`summary`、`steps[3]`、`proposals`、`handoffs`、`metrics{loadMinutes,overload,sleepReady}`。

## 输入输出协议

- 输入：`goal`、`context.state.habits`、`context.state.tasks`、`handoff.payload.estimatedMinutes`，并可读取共享上下文中的 `agent.atlas.metrics`。
- 输出：`summary`、`steps[3]`、`proposals[]`、`handoffs[]`、`metrics{loadMinutes,unfinishedMinutes,fromAtlas,overload,sleepReady,moveReady}`、`sources[]`。

## 工具权限

| 工具 | 权限 |
| --- | --- |
| `state:read` | allow |
| `tasks:create` | low risk，每轮最多 1 条 |
| `tasks:update` | deny |
| `tasks:archive` | 高影响，必须用户确认；用于归档同名重复的任务（软删除，可恢复） |
| `schedule:reblock` | 高影响，必须用户确认；定位到具体任务时执行真实调整，定位不到时生成调整建议任务 |
| `goals:recalibrate` | deny |

## 运行状态与 handoff

- 负载偏高时 handoff 给 Nova 校准本周目标优先级（`payload.loadMinutes`）。
- 负载偏高且 Atlas 存在时，Orchestrator 会记录「学习时长与作息边界」冲突并给出调和方案。
- 失败时返回错误消息，由编排层隔离。

## 调用场景与数据范围

定义中的作息、运动、生活、精力、安排、时间块等关键词可触发；Atlas 也可能交接学习量检查。输入是未归档任务、习惯完成标记，以及 Atlas 的估算；没有接入真实日历、睡眠设备或健康记录。

rules 模式的 loadMinutes = 所有未完成任务的预计分钟数 + Atlas 新增学习分钟估算。当前任务没有严格的日期筛选，因此该值是工作台负载启发式，不是精确的当天可用时段。150 分钟阈值和 23:30/22:30 边界是固定的演示策略，不是医疗建议、个体化诊断或模型自学出的规则。

## 规则、提案与共享约束

| 条件 | 提案或信息 | 是否直接写入 |
| --- | --- | --- |
| 有运动习惯且尚未完成 | 新增晚饭后散步 30 分钟任务 | 在 Mira 的一条自动额度与运行总额度内可自动执行 |
| loadMinutes > 150 | 建议把最长未完成任务减去 25 分钟，最低保留 15 分钟 | 必须确认；通过 schedule:reblock 工具授权 |
| 存在同名未完成任务，较新的重复项来自 Agent | 建议归档其中一个重复任务 | 必须确认，软删除并允许恢复 |
| 每次分析 | 声明睡眠约束；过载时补充负载约束 | 写入运行级共享记忆，不等于修改日历 |
| 过载且允许 handoff | 请求 Nova 校准优先级 | 由 Orchestrator 调度，最多一轮、不重复已参与 Agent |

Mira 没有 tasks:update 权限。它只能通过获批的 schedule:reblock 执行该类具体调整；工具层仍校验目标任务存在且未归档。找不到可定位的日程对象时，调整可能表现为新增“调整建议任务”，界面必须如实展示实际 effect。

## 输出示例

以下仅展示提案形状，不代表真实业务数据已改变：

```json
{
  "type": "reschedule_block",
  "risk": "high",
  "title": "给学习任务留出休息空间",
  "payload": {"targetTaskId": "task-example", "changes": {"duration": "20 分钟"}}
}
```

用户拒绝时不写任务；目标失效或权限不足时提案应失败并保留原因，不能显示已执行。模型把同样动作标成 low，也仍然必须确认。

## 模型与开发期边界

rules 行为来自 rhythm-check.skill.mjs；远端模型成功时根据 instructions/mira.md 与摘要生成建议。两个模式共用工具权限，但模型指标可能不完整，当前冲突检测仍依赖 Atlas/Mira 的固定指标字段，并非通用冲突推理。

OpenCode 的 `.opencode/agents/mira.md` 仅审查生活领域代码与边界，不运行产品任务。验证重点：负载 handoff、约束进入 memory、获批调整真实修改任务、归档可恢复和无权限动作被拒绝，见 tests/agents.test.mjs。
