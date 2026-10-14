# 知行舱 Agent 协作协议

本文件是仓库内所有 Agent 的最高级项目说明。任何改动先理解产品目标，再读取与任务匹配的 `foundation/skills/*/SKILL.md`。

## 使命

把零散的学习计划、生活习惯和个人复盘组织成一个可执行、可观察、可迭代的个人成长系统。Agent 提供建议和执行辅助，用户始终拥有最终决定权。

## 角色

| Agent | 职责 | 禁止事项 |
| --- | --- | --- |
| Orchestrator | 理解意图、拆解目标、分配任务、合并结果 | 不绕过用户直接作高影响决定 |
| Atlas | 学习规划、知识拆解、复习节奏 | 不虚构资料来源或学习进度 |
| Mira | 日程、健康习惯、精力平衡 | 不给出诊断性医疗建议 |
| Nova | 周复盘、目标校准、趋势洞察 | 不把短期波动包装为确定结论 |

每个 Agent 的独立配置、指令、输入输出协议、工具权限与运行状态见 `foundation/agents/*/AGENT.md`，实现位于 `server/agents/`。

## 两套 Agent 的分层

仓库里同时存在两套 Agent，**角色一致、用途不同**，不要混用配置与权限：

| 层 | 定义位置 | 用途 | 作用对象 | 权限声明处 |
| --- | --- | --- | --- | --- |
| 开发期（OpenCode 原生） | `opencode.jsonc`、`.opencode/agents/*.md`、`.opencode/skills/*` | 开发、领域审查、测试、文档 | 仓库文件与命令 | `.opencode/agents/*.md` 的 `permissions` |
| 产品运行时 | `server/agents/`、`foundation/agents/*/AGENT.md` | 由 REST API 调用，向用户产出建议与运行轨迹 | 用户的学习/生活数据 | `server/agents/definitions/*.json` 的 `tools` |

- 开发期 Orchestrator 通过 OpenCode 的 subagent 机制调用开发期 Atlas / Mira / Nova；产品运行时 Orchestrator 通过 `server/agents/orchestrator.mjs` 调用产品 Atlas / Mira / Nova。
- 两层的 Atlas 都负责学习、Mira 都负责生活节律、Nova 都负责复盘与目标，但开发期是**只读审查**（`edit: deny`），产品运行时是**产出建议并在确认后写入数据**。
- 修改其中一层时，不要顺带改动另一层的阈值或权限；需要同步时分别提交并在开发日志说明。

## 工作约定

1. 先读 `docs/BRD.md` 和 `docs/PRD.md`，涉及接口时再读 `shared/contracts/openapi.yaml`。
2. 每次开发选择一个主 Skill：产品开发、测试、日志或架构图。跨领域任务可组合，但不要重复规则。
3. 业务状态只能经 `apiClient` 访问；组件不得直接依赖服务端实现。
4. 高影响行为保持“建议 → 用户确认 → 执行”三段式。新增和完成普通任务属于低风险操作。
5. 修改功能后运行 `npm test`；影响界面时同时进行桌面和移动视口检查。
6. 在 `foundation/logs/development.md` 记录有长期价值的决策、验证和遗留项，不写逐命令流水账。

## Agent 运行时约定

1. Agent 只通过 `ModelProvider` 产生结构化建议，不直接写业务状态；写入统一经 `server/agents/tools.mjs`。
2. 默认使用确定性 `rules` Provider，不得把规则结果描述为大模型推理。切换方式：`AI_PROVIDER=rules|local|openai`。
3. `openai` / `local` 未提供密钥或端点时，必须显式降级到 `rules`，并在运行轨迹标记 `degraded: true` 与降级原因。
4. Orchestrator 记录 `runId`、调用顺序、输入、输出、状态、耗时与错误；单个 Agent 失败必须隔离，不中断整次运行。
5. 低风险动作（如新增普通任务）可自动写入；高影响动作必须进入 `awaiting_confirmation`，由用户确认后执行。
6. 前端不得保存任何密钥；模型调用只发生在服务端。
7. 删除一律是软删除（归档）：任务保留数据、可在归档箱恢复、不参与统计与 Agent 分析。Agent 只能通过工具层归档，且必须经用户确认。
8. 新增或修改 Agent 走「定义 + 技能 + 指令」三处：`definitions/*.json` 装配、`skills/*.skill.mjs` 行为、`instructions/*.md` 提示词。未知技能、未知工具、缺字段、重复 id 必须在启动时报错，不允许运行时静默降级。
9. 编排策略、handoff 深度、风险分级与确认规则、失败隔离固定在代码中，不配置化。
10. 前端每个视图与单次运行都必须有可直达的 hash 链接；新增视图要同时接入路由与返回入口。

## 工程边界

- `dist/`：当前无构建前端，保持浏览器原生 HTML/CSS/JS。
- `server/`：Node.js REST API 与 JSON 持久化，不向前端泄露文件系统细节。
- `server/agents/`：Agent 引擎（registry、orchestrator、definition loader、message bus、shared memory、run repository、providers、tools）。
- `server/agents/definitions/`、`server/agents/skills/`、`server/agents/instructions/`：Agent 装配配置、具名技能与指令文件。
- `shared/contracts/`：前后端共同遵循的接口契约。
- `foundation/`：可复用能力、Agent 说明、架构图、决策与工程日志。
- `tests/`：面向行为的自动测试。

## 完成定义

- 用户主流程可完成，空态、错误态和移动端可用。
- API 响应与 OpenAPI 契约一致，输入在服务端校验。
- 自动测试通过，未引入明文密钥和个人敏感数据。
- 文档、架构图或日志在行为变化时同步更新。

## 文档与启动口径

- 面向用户的启动入口以 README 为准，必须说明“进入项目 → 启动服务 → 验证健康检查 → 打开浏览器 → 保持终端运行”，不能只提供 localhost 网址。
- 当前 npm run dev 不自动读取 .env；环境变量由启动进程继承。修改 Provider、模型或 Key 后必须重启服务器，不能让文档暗示只编辑文件立即生效。
- 文档要区分“HTTP 模型通道已实现”“配置入口可用”“真实请求成功”三种证据。未进行真实账户联调时明确写未验证，不用 rules 或模拟端点结果替代。
- Key 只进入服务器环境；不得写入 Agent 指令、前端代码、业务 JSON 或开发日志。检查配置时只报告是否存在与实际 Provider，禁止输出密钥值。
- BRD 的指标是待验证目标；PRD 需标明演示统计、运行级记忆、单进程存储及模型输出校验的实际边界，不将计划或界面占位内容描述为已完成能力。
