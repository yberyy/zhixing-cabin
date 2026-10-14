---
name: architecture-diagrams
description: 为知行舱创建或更新 Mermaid 架构图、数据流图和时序图；用于关系、边界或跨模块流程仅靠文字难以准确表达时。
---

# Architecture Diagrams

将源文件放入 `foundation/diagrams/`，使用 Mermaid 文本以便评审和版本控制。

- 系统边界使用 flowchart，事件顺序使用 sequenceDiagram，数据实体使用 erDiagram。
- 图中名称与 `AGENTS.md`、OpenAPI 和代码模块保持一致。
- 只画影响理解的节点；实现细节留给代码和契约。
- 变更模块所有权、数据去向或信任边界时，同步更新 `foundation/ARCHITECTURE.md`。

提交前检查 Mermaid 语法，并确认图与当前实现相符。
