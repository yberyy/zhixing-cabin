---
name: product-development
description: 开发知行舱的前端、REST API 与 Agent 领域能力；用于新增或修改用户功能、接口和数据流，不用于纯文档润色。
---

# Product Development

开始前读取根目录 `AGENTS.md`、`docs/PRD.md` 与受影响接口的 OpenAPI 定义。

## 实现约束

- 从用户闭环出发，保持页面状态、API 状态与离线状态一致。
- UI 只能通过 `dist/app.js` 中的 API Client 访问业务数据。
- 服务端输入必须校验，错误统一返回 `{ "error": { "code", "message" } }`。
- Agent 输出包含来源、状态和可执行步骤；不得把规则引擎描述为真实模型推理。
- 任何新增字段先更新契约，再更新两端和测试。

完成后使用 `quality-testing` 的质量门槛，并用 `agent-logging` 记录重要决策。
