# Atlas · 学习教练

职责：学习目标拆解、知识地图、练习设计与间隔复习节奏。

## 配置

| 项 | 值 |
| --- | --- |
| id | `atlas` |
| 运行时装配 | `registry.mjs` → `definition-loader.mjs` → `skill-agent.mjs` |
| 兼容类入口 | `server/agents/agents/atlas.agent.mjs`（导出 AtlasAgent，不是唯一装配路径） |
| 定义文件 | `server/agents/definitions/atlas.json`（身份、权限、协议、路由） |
| 技能 | `study-coach` → `server/agents/skills/study-coach.skill.mjs` |
| 指令 | `server/agents/instructions/atlas.md` |
| 能力 | 目标拆解、知识地图、间隔复习、练习设计 |
| 状态 | `idle` / `working` / `error`（对外映射为 `ready` / `working` / `error`） |

## 指令摘要

- 不虚构资料来源、课程进度或已完成的学习记录，只使用输入中的任务与上下文。
- 输出恰好 3 条可在 25-45 分钟轮次内启动的行动。
- 输出结构化中文：`summary`、`subtopics`、`reviewPlan`、`steps`、`proposals`、`handoffs`。

## 输入输出协议

- 输入：`goal`、`context.state.tasks`、`handoff.reason`、`allowHandoff`。
- 输出：`summary`、`subtopics[{title,detail}]`、`reviewPlan[{after,action}]`、`steps[3]`、`proposals[]`、`handoffs[]`、`metrics{estimatedMinutes,...}`、`sources[]`。

## 工具权限

| 工具 | 权限 |
| --- | --- |
| `state:read` | allow |
| `tasks:create` | low risk，每轮最多 2 条，自动写入任务流 |
| `tasks:update` | 高影响，必须用户确认；用于拆分超过单个专注轮次的长任务 |
| `tasks:archive` | deny（学习任务不由教练归档） |
| `schedule:reblock` | deny |
| `goals:recalibrate` | deny |

## 运行状态与 handoff

- 完成后默认向 Mira handoff：`payload.estimatedMinutes`，请求校验学习安排与作息边界。
- `allowHandoff: false`（如旧版单 Agent 派发）时不发起 handoff。
- 失败时向 Orchestrator 返回错误消息，由编排层隔离，不影响其他 Agent。

## 调用场景与数据边界

- 定义中的学习、复习、数学、英语、编程、论文等关键词可触发；也可由 agentIds 显式选择。混合目标可能同时选中其他 Agent。
- context.state.tasks 是本次运行开始时的未归档任务快照；不等同于通过课程平台验证的学习记录。
- Atlas 接收本次运行的共享记忆，但当前学习规则主要依据 goal 和任务数据。不能因存在记忆容器就声称已掌握用户长期知识水平。

## rules 技能的具体行为

1. 根据目标关键词选择数学、英语、编程、写作或通用的三个学习单元。
2. 生成三个行动和“当天 / 第 2 天 / 第 7 天”的复习建议。
3. 提议新增一个 45 分钟复习任务和一个 25 分钟错题回顾任务，estimatedMinutes 通常为 70。
4. 未完成学习任务中最长的一项超过 60 分钟时，额外提出更新时长的高影响建议，等待确认。
5. 允许 handoff 时请求 Mira 检查新增学习量对生活节律的影响；若 Mira 已参与首轮计划，编排层不会重复调用它。

复习建议里的“第 2 天”是建议文本：当前 Task 没有 dueDate，也没有定时提醒或自动生成多天日历。规则不会自行检索题库、下载课程或验证知识来源。

## 输出示例与执行含义

以下是结构化建议片段，示例不是已经执行的用户数据：

```json
{
  "summary": "已把数学复习拆为三个学习单元",
  "steps": [{"title": "先明确本轮验收标准", "detail": "用三道代表题检验理解"}],
  "proposals": [{"type": "create_task", "risk": "low", "title": "安排数学复习", "payload": {"title": "复习：数学", "category": "学习", "duration": "45 分钟", "assignee": "atlas"}}],
  "metrics": {"estimatedMinutes": 70},
  "handoffs": [{"to": "mira", "reason": "请检查学习负载", "payload": {"estimatedMinutes": 70}}]
}
```

实际 rules 输出有三个步骤；BaseAgent 补充 agentId、agentName、步骤/提案 id，Orchestrator 才决定 pending 或 applied。Atlas 本身不调用 Repository 写任务。自动新增还受整次运行最多三条的总额度约束，显式要求确认的新增也不能自动写入。

## 真实模型模式与开发期区别

成功启用 openai/local 后，Provider 使用 instructions/atlas.md 和工作台摘要生成建议，不会先执行 study-coach 的规则再训练模型。Markdown 不包含 Key，也不会自动更新；模型内容不保证与上述固定规则逐字一致，仍必须遵守工具权限和确认边界。

OpenCode 中的 Atlas 是 `.opencode/agents/atlas.md` 定义的只读开发审查角色，不负责直接运行用户的学习计划。核对行为可运行 `npm.cmd test`，重点检查单 Agent 输出、高影响误标、handoff 和工具权限相关用例。
