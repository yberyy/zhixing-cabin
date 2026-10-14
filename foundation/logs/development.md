# 开发日志

## 2026-10-13 · Foundation v0.1

### 决策

- 采用原生 Web 前端与 Node.js 内置 HTTP 服务，减少 MVP 安装成本。
- 引入 API Client 双模式：服务端在线时使用 REST API，否则使用 localStorage。
- 将 Agent 能力设计为明确职责的领域服务，当前规则引擎可替换为未来模型网关。
- 将 BRD、PRD、OpenAPI、Skills 和架构图纳入仓库，作为持续协作底座。

### 验证

- `npm run check` 通过：4 个 JavaScript 文件语法检查成功，6 个 API 行为测试全部通过。
- Chrome 桌面 1440×1000 与移动布局截图检查通过：主界面正常渲染，响应式布局无内容重叠。
- 四个项目 Skill 的名称、YAML frontmatter、描述与占位符已人工检查；机器无 Python，未运行官方 `quick_validate.py`。
- Sites 站点身份已创建并写入 `.openai/hosting.json`；源码凭证过期后，续签接口连续返回传输错误，暂未完成源码上传与私有部署。

### 遗留

- 生产部署暂为静态离线模式；服务端持久化用于本地完整运行。
- 下一阶段可迁移至 D1，并加入用户身份隔离。

## 2026-10-13 · 多 Agent 编排与运行轨迹 v0.2

### 决策

- 将 Agent 引擎独立到 `server/agents/`：registry、orchestrator、message bus、shared memory、run repository、providers、tools。每个 Agent 拥有独立配置、指令、输入输出协议、工具权限与运行状态，不再用一个函数冒充多 Agent。
- 引入统一 `ModelProvider` 接口：默认 `rules`（确定性、无网络无密钥），预留 `local` 与 `openai`。以 `AI_PROVIDER` 切换；缺少密钥或端点时显式降级到 `rules` 并在轨迹标记 `degraded`，绝不把规则结果描述为模型推理。
- 采用「建议 → 用户确认 → 执行」三段式：低风险新增任务可自动写入；`reschedule_block`、`goal_recalibration` 等高影响动作进入 `awaiting_confirmation`，经 `POST /agents/runs/:id/confirm` 后才由工具层执行。
- 含 Atlas 的依赖组合默认串行（通过 Shared Memory 传递时长估算），无依赖组合默认并行；handoff 仅用于补齐未参与计划的专业视角，深度上限 1 轮，避免重复调用。
- 失败隔离：单个 Agent 异常只记录 `calls[].error` 并继续，全部失败才将运行标记为 `failed`。
- 运行轨迹持久化到 `.runtime/runs.json`，与业务状态 `.runtime/state.json` 分离；旧接口 `/agents/:id/dispatch` 保留并改为经 Orchestrator 执行（禁用 handoff），响应形状不变。
- 前端新增「运行轨迹」视图，仅通过 `apiClient` 访问；离线模式提供等价的浏览器内置规则运行与确认流程。

### 验证

- `npm run check` 通过：23 个文件语法检查成功；21 个 API/Agent 行为测试全部通过（含单 Agent、多 Agent 编排、handoff、共享上下文、失败隔离、等待确认、运行持久化、Provider 降级）。
- HTTP 端到端实测：`POST /agents/runs` 返回 `running` 轨迹，轮询后进入 `awaiting_confirmation`（3 次调用、1 处冲突、2 项待确认），确认后状态推进为 `completed` 并写入任务流；`GET /agents/runs` 列表与详情一致。
- 响应式检查（同源 iframe 测量 documentElement.scrollWidth 与所有元素的右边界）：360 / 390 / 414 / 600 / 768 / 820 / 900 / 1000 / 1049 / 1100 / 1280 / 1440 宽度下，总览、任务、Agent、运行轨迹、习惯五个视图均无横向溢出与元素越界。
- 修复合成的既有布局缺陷：≤1050px 概览网格缺少 `minmax(0, …)` 与 `.activity-copy` 缺少 `min-width: 0`，在约 900–1049px 与 360–390px 造成横向溢出。
- 浏览器控制台无 error；运行轨迹视图在 360px 移动视口渲染 3 张调用卡片与确认按钮。

### 遗留

- `local` / `openai` Provider 仅实现调用与降级路径，未在真实模型端点做质量评测；生产接入前需评估提示词与成本。
- 高影响动作的执行是「写入一条调整任务」的受控近似，尚未对接真实日历或外部系统。
- 离线模式使用浏览器内置简化规则，与 `rules` Provider 的冲突调和结果不完全一致；离线 handoff 未实现。
- 视口 320px（低于 PRD 支持的 360px 下限）因 `body { min-width: 320px }` 会出现 15px 横向滚动，属既有行为，未在本轮改动。
- `.runtime/` 为本地运行时数据，不进入版本库；部署与多用户隔离仍待 D1 阶段。

## 2026-10-13 · Agent 配置驱动改造（定义 + 技能 + 指令）

### 决策

- 把 Agent 拆成三份来源：`definitions/*.json`（身份、工具权限、输入输出协议、路由关键词、启用开关）、`skills/*.skill.mjs`（领域行为）、`instructions/*.md`（提示词）。此前三者混在 Agent 子类的构造函数与 `rules()` 中。
- 三个 `rules()` 抽取为纯函数技能并注册到 `server/agents/skills/index.mjs`。技能不依赖 Agent 实例，可被多个 Agent 复用。
- 领域路由从 Orchestrator 内的硬编码正则改为读取定义的 `routing` 关键词；`routingDefault: true` 声明无命中时的兜底 Agent（nova）。旧接口 `routeCommand(goal)` 保留无注册表的内置关键词分支，兼容既有调用。
- 行为变化（有意）：旧派发接口现在按定义关键词路由，含「安排 / 节奏 / 时间块」等生活类措辞的目标会命中 Mira，此前会落到 Nova。既有关键词用例（学习类→Atlas）行为不变。
- 启动即校验：未知技能、未知工具、缺必填字段、非法 `risk`、重复 id、非法 JSON、指令文件缺失，统一以 `AGENT_DEFINITION_INVALID` 失败，不做运行时静默降级。
- 刻意不配置化：编排策略、handoff 深度上限、风险分级与确认规则、失败隔离、合并条数上限——这些属于安全与编排策略。
- 补全 `SharedMemory.constraints` 空壳：Mira 声明「23:30 前入睡」与「单日负载不超过 150 分钟」约束，写入共享上下文、消息总线（`constraint`）与运行轨迹。
- Orchestrator 指令外置到 `instructions/orchestrator.md`，并通过 `GET /api/v1/agents` 的 `orchestrator.instruction` 暴露。

### 验证

- `npm run check`：语法检查 34 个文件通过；**33 个测试全部通过**（原 21 个 + 新增 12 个定义/路由测试）。
- 新增 `tests/definitions.test.mjs` 覆盖：定义加载与装配、未知技能、未知工具、缺字段、非法 `risk`、重复 id、非法 JSON、指令文件缺失、禁用 Agent 排除、路由与兜底、自定义 Agent 端到端、指令文件与定义一致性。
- 端到端实测"加定义即扩展"：仅在定义目录增加 `ledger.json`（复用 `trend-review` 技能 + 自有 `routing`）后，无需修改 Orchestrator，`routeCommand` 即可路由到 `ledger`，运行轨迹出现该 Agent 调用，并按同一确认流程产出待确认建议。
- 共享上下文链路实测（串行）：Atlas `estimatedMinutes=70` → Mira `loadMinutes=185`（其中 `fromAtlas=70`）→ Nova 读到 `loadMinutes=185`；约束与 `constraint` 消息均落库。
- 并行策略依赖链断开实测：`fromAtlas=0`、`loadMinutes=115`、冲突数为 0，确认「含 Atlas 默认串行」是共享上下文生效的前提。
- 响应式与前端回归：共享上下文区块新增约束展示，未新增溢出（沿用既有边界测量方式）。

### 遗留

- handoff 目标（atlas→mira、mira→nova）仍硬编码在技能内部，未从定义声明；新增 Agent 无法自助声明"需要谁校验"。
- 技能只能整份复用，不能组合或参数化（例如同一技能换阈值）。
- 定义文件没有配套 JSON Schema 供编辑器校验，校验发生在启动时。
- `rules` 模式下 `instruction` 不参与推理，接入 `local`/`openai` 后才生效，届时需要提示词回归评测。
- 断言失败时曾用 PowerShell 文本重写测试文件导致 UTF-8 损坏，已改为只用编辑/写入工具处理含中文的源码。

## 2026-10-13 · 任务编辑 / 归档 / 专属链接

### 决策

- 删除采用**软删除（归档）**：任务新增 `archivedAt`/`archivedBy`，从 `/state` 与 Agent 读取状态中过滤，`GET /tasks/archived` 列出，`POST /tasks/:id/restore` 恢复。理由：个人成长数据不可逆删除的代价高于清理收益。
- 补齐**任务编辑**：`PATCH /tasks/:id` 支持名称 / 领域 / 预计时长 / 负责人 / 状态，服务端逐字段校验（长度、枚举），无有效字段返回 `NO_CHANGES`。
- Agent 工具从 4 个扩到 6 个：新增 `tasks:update`、`tasks:archive`。删除对 Agent 开放但必须确认（用户选择）；实际授权 Mira（生活清单去重），Atlas / Nova 为 deny，保持每个声明权限都被真实使用。
- 修正此前的**语义不实**：`reschedule_block` 与 `goal_recalibration` 原先最终都只是"新建一条任务"。现在 `reschedule_block` 带 `targetTaskId` 时执行真实字段修改，定位不到才退化为建议任务并如实标注；`goal_recalibration` 的效果名改为 `recorded_goal_focus`，摘要明确是"记录校准并写入聚焦任务"。
- 新能力由技能驱动：Atlas 拆分超过 60 分钟的长任务（真实改时长，需确认），Mira 归档同名重复任务（软删除，需确认）。
- `maxPerRun` 从文档变成强制：Orchestrator 自动应用低风险建议时按 Agent + 工具计数。
- 前端引入 **hash 路由**：视图与单次运行都有专属链接（`#/tasks`、`#/archive`、`#/runs/:runId`），可直接打开、刷新保持、支持前进后退；归档箱从弹窗改为独立页面。
- 归档走确认弹窗；编辑复用任务弹窗并区分新建/编辑模式；离线（localStorage）模式同步支持编辑、归档与恢复。

### 验证

- `npm run check`：语法 39 个文件通过；**37 个测试通过**（新增 4 个：字段编辑校验、归档/列表/恢复、归档确认流、权限与目标守卫）。
- API 端到端实测：编辑 `task-2` 字段生效；`DELETE task-3` 后 `/state` 由 6 变 5、归档列表为 1；`restore` 后恢复为 6。
- 浏览器实测：编辑弹窗预填并就地更新（任务数 6→6，未新建）；归档确认弹窗文案正确，确认后看板 6→5、归档角标为 1；`#/archive` 正确列出并成功恢复；发起协作后地址自动变为 `#/runs/run-8ffb53bd…`，整页加载该链接直接渲染该次轨迹（3 次调用、等待确认）。
- 响应式：360 / 414 / 768 / 900 / 1049 / 1440 下 tasks / archive / runs 三视图零横向溢出、零元素越界。
- 浏览器控制台无 error。

### 顺带修复

- 发现并修复真实缺陷：服务端对 `.js` / `.css` 返回 `public, max-age=3600`，而项目无构建步骤、资源无内容指纹，导致浏览器长时间运行旧代码（本轮排查即被此问题误导过一次）。现改为 HTML/CSS/JS 一律 `no-cache`。

### 遗留

- 归档箱没有永久删除入口：数据只增不减，长期会累积，尚无清理策略。
- 编辑只覆盖任务的名称/领域/时长/负责人；习惯与复盘仍不可编辑。
- 静态资源 `no-cache` 只能约束之后的请求；已缓存旧 `app.js` 的浏览器需强刷一次才会更新。
- 未知 hash 会回落到总览，没有 404 提示；hash 路由不参与服务端渲染。

## 2026-10-14 · 接手检查：原生 Agent 层规范化 + 运行列表修复

### 决策

- OpenCode 原生 Agent 从 V1 字段（`agent` / `prompt` / `permission` / `color: "primary"` / `task` / `command`）迁移到 V2 形式：Agent 定义下沉为 `.opencode/agents/*.md`（frontmatter 使用 `permissions` 规则数组、`color` 六位十六进制、`subagent` 动作），`opencode.jsonc` 只保留 `commands` / `watcher` / `permissions`。依据 V2 agents 文档中明确列出的弃用字段清单。
- 为四个开发期 Agent 编写**独立的开发期提示词**，开头即声明“开发期只读审查 / 与产品运行时 Agent 角色一致、用途不同”。此前开发期 Agent 直接复用 `foundation/agents/*/AGENT.md`（产品文档）作为提示词，会让子 Agent 误以为自己在产出产品建议。产品文档仍作为这些子 Agent 的**读取对象**被引用。
- 不设置 `default_agent`：保持 `build` 为默认，避免影响既有会话；开发期 Orchestrator 通过显式选择使用，它被授权调用 atlas / mira / nova，并被限制只能加载四个开发 Skill。
- 不重新登记 `skills` 数组：`.opencode/skills/` 的自动发现已生效，重复登记会造成同名 ID 覆盖，反而绕开薄封装。
- 在 `AGENTS.md` 增加「两套 Agent 的分层」章节，明确两层的定义位置、用途、作用对象与权限声明处。

### 验证

- 原生配置结构校验（脚本）：`opencode.jsonc` 可解析且无残留 V1 字段；4 个 agent 文件的 frontmatter 含合法 `mode`、十六进制 `color`、`action/resource/effect` 三元组；orchestrator 的 `subagent` 规则为 `* deny` + atlas/mira/nova allow，三个子 Agent 均为 `edit deny` 且只允许各自领域 Skill；7 个 Skill 的 frontmatter 合法。
- 实际调用三个子 Agent（后台 subagent）核对提示词来源、Skill 白名单与写权限隔离，结论见下节。
- `npm run check`：语法 39 个文件通过；**41 个测试全部通过**（新增“运行列表缺省返回全部且最新在前”用例）。
- 产品层 API 端到端：`POST /agents/runs`（sync）→ `awaiting_confirmation`；计划 `atlas → mira`，第 3 次调用为 `mira → nova` 的 handoff；共享上下文含 2 条约束与 2 条 handoff 事实；1 处 `atlas x mira` 冲突；3 条低风险动作自动写入；3 条高影响待确认。批准 `reschedule_block` 后目标任务时长由 45 分钟真实改为 20 分钟，运行转为 `partially_confirmed`。
- 浏览器：#/runs 自动打开最近一次运行并把地址改写为 `#/runs/<runId>`；失败运行渲染红色调用卡与“运行失败：所有 Agent 均执行失败”；等待确认运行渲染 3 张调用卡、`handoff ← mira` 标签、冲突块、2 条约束 chips、2 个待确认按钮。
- 响应式：390px 与 1440px 下 overview/tasks/runs/focus/habits/archive 六个视图均无横向溢出；归档页读数等于视口宽是因为该视图无竖向滚动条，实测 `scrollLeft` 不可移动。
- 离线降级：以无 API 的静态服务托管 `dist/`，前端回落 localStorage，徽标显示“浏览器内置规则 · 已降级为 browser”，新建、编辑、确认归档、归档页恢复、运行轨迹空态均正常。

### 修复

- `GET /api/v1/agents/runs` 缺省 `limit` 时 `Number(null)` 得 `0`，被当成合法值夹到 1，导致运行列表默认只返回 1 条。改为空参数按缺省 20 处理，并补测试覆盖缺省 / `limit=1` / 空 `limit=` 三种情况。
- 新增「进入运行轨迹自动打开最近一次运行」能力（`openLatestRun`），使 `#/runs` 成为可用入口而不是空态。

### 遗留

- 浏览器控制台出现 `ERR_TUNNEL_CONNECTION_FAILED`：`index.html` 仍从 unpkg 引入 lucide、从 Google Fonts 引入字体；当前网络下图标依赖缓存命中。核心交互不依赖它们（`icons()` 有可选链保护），但离线首访会缺图标，建议后续本地化图标与字体。
- 开发期 Agent 的 markdown 定义写在会话中途，是否立即生效取决于 OpenCode 的配置重载时机；若子 Agent 仍读到旧提示词，重启服务后即可生效。
- 归档箱仍无永久删除入口，`archivedAt` 数据只增不减。
- 本轮验证产生了演示数据（3 次运行、13 个任务，其中多数为 Agent 自动创建），未做清理。

## 2026-10-13 · 开发环境配置（.opencode）

### 决策

- 新增 `.opencode/opencode.jsonc`，只配置 OpenCode 编码助手，**不影响产品运行时**：`server/` 与 `dist/` 均不读取该文件。产品内 Agent 的定义仍在 `server/agents/` 与 `foundation/agents/`。
- `skills: ["./foundation/skills"]` 让仓库内四个开发 Skill 真正被 OpenCode 加载（ID 取目录名）。此前它们只是仓库文档，OpenCode 不会自动发现。
- 未使用 `instructions` 字段：V2 接受该字段但不加载条目，项目指令继续统一由 `AGENTS.md` 承担。
- `watcher.ignore` 排除 `.runtime/`、`.qa/`、`node_modules/`，减少运行期数据导致的无关刷新。
- 新增 `/check`、`/dev`、`/trace` 三个命令模板，复用既有 Skill 与 API。
- `permissions` 仅保留 `git push *` → `ask` 一条高影响规则，其余不改动默认行为。
- 命名刻意的取舍：不把产品 Agent 定义写成 `opencode.json`，避免与 OpenCode 自身 schema 冲突（OpenCode 会向上搜索并解析同名文件）；产品的配置化目录计划使用 `server/agents/definitions/*.json`。

### 验证

- JSONC 语法校验通过：剥离整行注释后 `JSON.parse` 成功，顶层字段为 `$schema / skills / watcher / commands / permissions`。
- 字段名与语义按 OpenCode V2 官方文档核对（`/v2/docs/config`、`/v2/docs/skills`），未使用可能描述 V1 的 `config.json` schema 推断字段。
- Skill 加载**已实测生效**：写入配置后，当前会话立即出现 `product-development`、`quality-testing`、`agent-logging`、`architecture-diagrams` 四个可用 Skill，说明 `skills` 指向被正确解析、目录与 frontmatter 结构符合要求。
- 未验证项：三个自定义命令（`/check`、`/dev`、`/trace`）与 `permissions` 规则的实际触发行为未在本会话内执行；本机 `opencode` CLI 不在 PATH，无法用 CLI 回读解析后的配置。

### 遗留

- 命令与权限规则的运行效果需在真实交互中确认；若 `/check` 等未出现，检查命令名冲突与配置目录优先级（`.opencode/` 覆盖同级直接配置）。
- 若后续新增产品侧配置化，配置文件应使用独立命名（如 `server/agents/definitions/*.json`），不要复用 `opencode.json`。

## 2026-10-14 · 协作中心与 OpenCode 原生 Agent 接入

### 决策

- 将旧的「Agent 团队」与「运行轨迹」合并为一个“协作中心”：目标输入、最近运行、自动选中的运行详情和专业 Agent 权限位于同一流程；协作策略收进高级设置，移动导航由 6 项收敛为 5 项。
- Agent 卡片改为读取 `/api/v1/agents` 的运行时注册表，展示真实 `skill`、capabilities 与非 deny 工具权限，删除会与后端漂移的固定介绍和伪静态“团队共识”。
- `local` / `openai` 消息加入运行级共享事实、约束与冲突；只发送当前值，不发送 `history`，兼顾协作完整性与输入大小。
- 用户确认的工具动作执行失败时，提案详情记录原因，运行最终标记为 `failed`；仍有其它待确认项时保持 `awaiting_confirmation`。
- 以当前 OpenCode schema 重建开发配置：配置移到根目录 `opencode.jsonc`，使用 `agent` / `command` / `permission`，注册 Orchestrator 主 Agent 与 Atlas / Mira / Nova 子 Agent；`.opencode/skills/` 提供指向 foundation 规范的开发 Skill 和三个领域 Skill。
- 明确双层边界：OpenCode Agent 服务于仓库开发，产品 Agent 仍由 `server/agents/definitions + skills + instructions` 装配，两者共享角色说明但不共享运行状态。

### 验证

- `npm.cmd run check` 通过：29 个脚本语法检查成功，39 个 API、Agent、定义加载与持久化测试全部通过；新增远端 Provider 共享上下文和确认执行失败状态测试。
- OpenCode JSONC 可解析，远端官方 schema 包含本配置使用的 `$schema / agent / command / watcher / permission` 顶层字段；本机没有 `opencode` CLI，未实测 TUI 中的 Agent 切换和三个命令。
- 浏览器实测：1440px 桌面与 CDP 模拟的真实 390×844 移动视口均自动选择最近运行；390px 下 `scrollWidth = clientWidth = 390`，3 张 Agent 卡片、5 个移动导航项均存在，控制台无 error。
- 离线静态服务实测：API 404 后正确切换到浏览器规则，展示三个领域 Skill，390px 无横向溢出且无脚本异常。
- 视觉调整为中性灰白底、深青主操作、蓝 / 珊瑚 / 绿 Agent 状态色，并提高协作区任务、轨迹、提案和权限信息字号。

### 遗留

- 共享记忆仍是单次运行级；跨运行的长期个人事实目前来自任务、习惯与复盘状态，尚无独立的可编辑长期记忆库。
- 冲突检测仍只覆盖 Atlas 与 Mira 的学习负载冲突；新增 Agent 的通用冲突声明协议尚未实现。
- OpenCode CLI 不在 PATH，需在真实 OpenCode 环境确认 `@atlas`、`@mira`、`@nova`、`/check`、`/dev`、`/trace` 的交互入口。

## 2026-10-14 · 协作中心信息层级与响应式整理

### 决策

- 协作中心按“认识团队 → 发起协作 → 查看运行轨迹”排序。专业 Agent 的职责、能力与工具权限先于目标输入出现，使用户在提交目标前能理解系统会如何分工以及哪些动作需要确认。
- Agent 卡片保留来自运行时注册表的能力和工具数据；仅为固定角色补充一行职责说明。权限文案统一为“只读 / 可执行 / 需确认”，不再把运行次数限制当作用户可见的主要权限说明。
- Agent 卡片使用自适应网格：桌面与中等宽度尽量保持并列，移动端才切为单列，避免 1050px 左右出现三张过长的堆叠卡片。

### 验证

- `npm.cmd run check` 通过：29 个脚本语法检查通过，41 个测试全部通过。
- 使用本机 Chrome DevTools Protocol 实测 `#/runs`：1440px 下团队区位于协作输入之前，三张卡片并列；390px 下 `scrollWidth = bodyWidth = 390`，卡片单列、底部导航宽度为 390px，无横向溢出。

## 2026-10-14 · 总览与运行轨迹栅格修复

### 决策

- 总览主网格从按内容顶部对齐改为按行拉齐；专注与习惯面板改为纵向弹性布局，使其内部内容在同高卡片中保持自然间距，而不是留下不对称的空白。
- 运行轨迹取消窄左栏加长右栏的布局。最近运行改为横向选择带，详情占满下一行；宽屏下 Agent 调用、提案和建议采用自适应多列，窄屏回退为单列。

### 验证

- `npm.cmd run check` 通过：29 个脚本语法检查通过，41 个测试全部通过。
- Chrome DevTools Protocol 实测 1440px：今日计划与专注时间均为 `top 216 / bottom 706`，协作动态与生活习惯均为 `top 724 / bottom 1073`；运行历史宽 1072px，详情位于其下方并占满同宽，三张调用卡并列。
- 实测 390px：总览与协作中心 `scrollWidth = 390`，主卡和运行详情宽度为 358px，运行历史和详情均单列。

## 2026-10-14 · 代码审查与目录清理

### 决策与修复

- 运行时风险由动作类型和工具权限判定，模型的低风险标注不能使归档、日程调整或目标校准自动执行；显式要求确认的新增任务同样等待确认。
- 确认请求拒绝缺失、非法或重复决定，同一运行的确认串行处理，避免并发执行同一提案。
- 业务与轨迹 Repository 共用各自的初始化任务并串行提交写入，修复冷启动并发覆盖；写入成功才更新内存，失败后队列可继续工作。
- 保存运行级异常的 failed 终态；端点调用失败后记录真实 rules 来源、运行级降级标记与具体原因。OpenAPI 同步新增调用级降级原因并允许定义驱动的 Agent id。
- 非对象 JSON 请求返回 400；测试的本地路径改用 fileURLToPath，并验证静态资源可以真实读取。
- 清理无引用的旧样式，并修复长目标下调用卡片的最小宽度撑大移动视口的问题。
- 无引用的 QA 浏览器配置与截图共 4037 个文件、152.55MB 已移出项目。批量永久删除被自动审批阻止，因此存入 `%TEMP%/zhixing-cleanup-20261014/` 供恢复；保留用户数据、部署关联、开发配置及仍有引用的兼容入口。
- 增加环境文件与 QA 图片的忽略规则；语法检查覆盖 tests；README 和 `docs/PROJECT_REVIEW.md` 说明目录职责、检查范围与遗留问题。

### 验证

- 回归用例在修复前实际失败；最终 `npm.cmd run check` 通过：33 个脚本语法检查、51 个行为测试全部通过。
- 使用 Chrome 检查 1440px 与 390px 的总览、协作中心及新增任务弹窗。桌面没有溢出、同行卡片底边一致；390px 两页的 scrollWidth 均为 390；协作详情在历史列表下方且同宽；弹窗位于视口内，未捕获脚本异常。
- 浏览器配置与截图位于系统临时目录，没有重新引入项目内缓存。未在本轮创建演示任务、运行或删除业务数据。

### 遗留

- 部分总览和专注统计仍是演示值，外部 CDN 图标/字体仍需本地化，前端单文件职责仍较集中。
- JSON Repository 和确认队列只覆盖单进程；跨进程并发、跨文件事务及崩溃恢复去重需数据库支持。
- 当前目录没有 Git 元数据，无法提供历史差异；OpenCode TUI 的配置加载与权限行为未实测。

## 2026-10-14 · 文档补全与模型接入说明

### 决策与文档更新

- README 补全 Windows 环境检查、进入项目、启动服务、启动成功输出、健康检查、保持终端、停止/重启和连接拒绝/端口占用排障；明确网址本身不会启动服务器。
- 说明环境变量注入、npm run dev 不自动读取 .env、显式 --env-file 启动、完整模型端点格式、重启要求及恢复 rules 的方法。
- 区分 HTTP 模型通道已实现、全局配置可用、单次真实调用成功三种证据。说明远端的数据流、请求次数、故障降级，以及配置 Key 不会提供检索/训练/长期记忆/真实历史统计等能力。
- BRD 增加业务假设、使用场景、优先级、指标统计口径、成本和交付边界；PRD 增加页面验收、权限、单次执行协议、状态含义、数据与配置口径、可复现验收场景及现有缺口。
- 根 AGENTS 与四份产品 AGENT.md 增加启动口径、具体规则/阈值、输入输出示例、实际装配路径、工具写入效果、共享记忆与开发期边界。澄清 Orchestrator 是代码规划，Nova 校准当前落地为聚焦任务而非独立 Goal 库。
- 删除 Provider 注释中容易引起误解的“预留”措辞；运行逻辑保持原有实现。

### 验证与当前接入状态

- 只检查配置存在性，没有输出密钥：本次终端未检测到 OPENAI_API_KEY，根目录无 .env；运行中 4173 的 /api/v1/agents 返回 rules → rules、degraded=false。未配置或使用真实付费 Key。
- 新增本机模拟成功端点用例，验证服务器发送 Bearer 凭证、指定模型、专业角色指令与 JSON mode，成功运行记录为 openai，密钥不出现在公开描述或轨迹中。模拟凭证仅为测试字符串，不代表真实账户联调。
- `npm.cmd run check` 通过：33 个脚本语法检查、52 个行为测试通过；8 份主文档代码围栏完整，2 个 Markdown 相对文件链接存在。
- 本机 Node.js 24 使用 `--env-file=.env.example` 可读取 rules 配置。OpenAI 环境变量与 JSON mode 说明对照官方 Quickstart、Structured Outputs 文档核对。
- 没有进行真实账户的密钥、模型权限、余额、网络或费用验证；这些只能通过用户配置后的一次实际非降级运行确认。

## 2026-10-14 · 重复启动与端口占用提示

- 4173 已有知行舱服务时，重复启动现在先读取健康检查，再打印可用网址并正常退出，不再抛出未处理的 EADDRINUSE 异常。明确告知本次未创建新服务、未应用新的 Provider/Key，配置更新仍需停止旧服务后重启。
- 无法确认占用者是知行舱时，输出端口占用和换端口指引并以失败码退出；不结束原占用进程。端口为 0 的测试启动打印实际分配端口。
- README 同步重复启动语义。新增真实子进程测试覆盖已有知行舱与其他程序占用两条路径；`npm.cmd run check` 通过，34 个脚本语法检查、54 个测试全部通过。

## 2026-10-14 · Docker 配置与使用文档

### 实现与决策

- 新增 Dockerfile，以 Node 24 Debian slim、node 用户运行现有单进程服务。只复制 package、server、dist 与健康检查脚本，无第三方依赖安装或前端构建步骤；.dockerignore 用白名单排除 Key、本机数据、缓存与开发配置。
- 新增 compose.yaml：固定英文项目名以兼容中文路径，单 app 服务，内部 HOST=0.0.0.0/PORT=4173，宿主机仅绑定 127.0.0.1，默认 DOCKER_PORT=4181 以避开 npm 的 4173。
- 命名卷 runtime-data 挂载 /app/.runtime，和 npm 数据独立；使用 init、unless-stopped 与 30 秒停止宽限。环境变量在运行时显式传入，默认无 Key 的 rules；不把密钥烘焙到镜像。
- 新增原生 Node 健康检查，要求 HTTP 成功、status=ok、service=zhixing-api，包含超时与非零退出语义；Dockerfile 声明 HEALTHCHECK。
- README 增加 Docker 入口，docs/DOCKER.md 详细说明安装、首次启动、健康状态、日志、停止/更新、配置与端口、备份/迁移、权限及排障；.env.example、PRD 与架构说明同步更新。备份目录加入忽略规则，修复 README 指向不存在检查报告的链接，改为已有开发日志。

### 验证

- `npm.cmd run check` 通过：36 个脚本语法检查、57 个行为测试通过；新增健康检查正常、错误服务、HTTP 故障、超时与命令退出码验证。
- 使用官方 compose-spec JSON Schema 与 PyYAML/jsonschema 校验 compose.yaml；核对默认宿主机端口、服务绑定、模型配置默认表达式和持久化卷；Dockerfile 的所有 COPY 来源存在，文档 4 个相对链接存在、代码围栏完整。
- 按镜像最小文件集合在系统临时目录装配并启动：静态资源、健康/API、Agent 定义与指令装配、rules 调用均可用；新建临时任务和轨迹后重启可恢复。该测试没有写项目现有业务数据，不代替实际容器验证。
- 现有 4173 本地服务的健康检查脚本通过，未停止或修改该服务。

### 验证限制

- 本机未检测到 Docker CLI、Desktop 或 Engine。临时获取独立 Compose CLI 因下载超时未完成，因此没有运行 Compose CLI config、镜像构建、Linux 容器健康/非 root 权限、数据卷生命周期或容器网络端到端测试。
- 文档明确了上述限制；Docker 环境安装并启动后，按 config --quiet、up --build --wait、ps 与备份/迁移步骤继续实机验证。未注入任何真实模型 Key，也未验证付费调用。

## 2026-10-14 · DeepSeek 兼容接入与请求超时

- 复用现有 openai 协议适配器，通过 DeepSeek 完整 Chat Completions URL、模型名和 DeepSeek Key 配置产品运行时，不新增 Provider 枚举，不改变权限、确认规则或开发期 OpenCode 配置。
- 新增 MODEL_TIMEOUT_MS 并经两个远端适配器和 Compose 透传；默认保持 8000ms，接受 1..300000 的整数，非法值回退默认。请求超时中止网络操作并记录包含毫秒值的降级原因，仍使用 rules 回退且不自动重试。
- README、Docker 使用说明和 .env.example 增加 DeepSeek 示例、120000ms 单次超时、完整端点、容器重建和真实调用验证说明；PRD 与产品 Orchestrator 说明同步。模型示例 deepseek-flash 依据本次读取的 DeepSeek 官方接入和 Chat Completions 文档，账户可用性仍需验证。
- `npm.cmd run check` 通过：36 个脚本语法检查、59 个行为测试。模拟成功端点核对 DeepSeek 模型与请求路径、Bearer 凭证、角色指令、JSON 输出参数和密钥不泄露；新增两个适配器超时配置边界及慢端点中止/降级测试。
- 未配置真实 Key、未发起 DeepSeek 付费请求；本机仍未检测到 Docker CLI，容器构建与线上模型联调仍未验证。未改变正在运行的服务配置或用户数据。

## 2026-10-14 · 子 Agent 审查整改：权限收紧与 Nova 口径修正

### 决策

- **开发期子 Agent 收紧为真只读**：Nova 的隔离实测显示 `edit: deny` 生效（运行时无写工具），但 `shell: ask` 在非交互子会话中未被拦截，`Set-Content` 成功写盘。三个领域子 Agent 的 `shell` 改为 `deny`，提示词同步写明「需要测试证据时请 Orchestrator 执行并转述」，隔离不再依赖审批链路是否可用。
- **Nova 触发校准需要最小样本**：原实现把零任务折算为完成度 0%，会凭 `completionRate < 60` 产出高影响校准建议。现要求 `sampleSize >= 3` 才据完成度触发；负载 > 150 分钟是独立证据，不受样本量限制。
- **零任务不再折算为 0**：`completionRate` 在无任务时为 `null`，`summary` 说明「暂无可统计的任务，未做完成度判断」。
- **撤销含义不明的 `confidence` 常量**（0.72 / 0.68 / 0.64）：该值无推导依据也无测试，三个技能的 `metrics` 中一并移除。
- **统计口径如实标注**：`summary` 与 `notes` 写明「累计快照，不按自然周截取」，提案标题由「收窄本周首要目标」改为「收窄当前首要目标」；`instructions/nova.md` 同步加入样本量条款。
- **状态评分只统计合法值**：`mood` 先过滤为 1-5 整数再取平均，暴露 `validMoodCount`，不再把缺失/非法值折算为 0 分。
- **`recorded_goal_focus` 措辞与行为对齐**：摘要改为「已新增聚焦任务：…（未修改现有目标与优先级）」，新建任务标题前缀由「校准目标：」改为「聚焦：」，避免读作目标已被改写。

### 验证

- 新增 `tests/skill-guardrails.test.mjs`（8 个用例）：零任务不产出校准建议且完成度为 `null`、样本不足时抑制完成度校准但保留负载触发、足够样本时建议含样本量、非法状态评分被过滤、口径写明累计快照且不再出现「本周完成率」、三个技能均无 `confidence`、目标校准落地措辞、无关键词匹配时 `plan` 回退到全部 Agent。
- `npm.cmd run check`：语法 37 个文件、**67 个行为测试全部通过**（原有 59 + 新增 8）。
- 实时运行核对：`POST /agents/runs` 指定 `agentIds: ["nova"]`，返回 `summary` 为「任务完成度约 13%，暂无复盘记录。统计为累计快照，不按自然周截取。」，`metrics` 含 `sampleSize/ enoughData` 且无 `confidence`，`notes` 给出口径计数，提案描述带「样本 16 个」。
- 开发期 Agent 配置结构校验通过：三个子 Agent 的 `permissions` 为 `edit deny` + `shell deny` + `subagent deny` + 各自领域 `skill allow`。

### 遗留

- 开发期子 Agent 因而无法自行运行测试，只能做静态审查；运行证据需由 Orchestrator 提供。这是有意的权限取舍。
- `capabilities` 与开发期 Skill 白名单仍未随 `server/agents/definitions/*.json` 自动同步，新增 Agent 需手动补 `.opencode/agents/*.md`。
- Nova 指出的「累计快照」与真实周窗口的差距未消除，仅改为如实措辞；实现周窗口属后续版本。
- 本轮验证产生的运行与任务数据未清理。

## 2026-10-14 · DeepSeek 本机一键启动

- 新增 start-deepseek.cmd 与 npm run start:deepseek，从固定的项目根目录读取本机 .env；专用启动器以文件配置优先，避免旧终端变量覆盖。通用 npm 与 Docker 启动逻辑不变，不修改产品 Agent 的权限和行为。
- 为当前用户准备不含真实 Key 的本机 .env，预填 DeepSeek 配置；密钥只需填写一次，不进入启动脚本。该文件已被 Git 与 Docker 构建上下文忽略；README 明确它仍是不可分享的明文敏感文件。
- 启动前拒绝空/常见占位 Key、错误 Provider 及非官方 HTTPS 完整端点，错误提示不包含密钥或端点参数。配置检查不发送付费请求，不代表真实联调通过；已有进程仍由原端口检查提示，不强制结束。
- README、PRD 和 .env.example 同步说明 Node.js 20.12+、双击入口、文件优先级、保持窗口和重启要求。
- `npm.cmd run check` 通过：39 个脚本语法检查、当前仓库 78 个测试全部通过；新增 3 个启动测试，含隔离临时目录中的真实 Node 与 Windows cmd 入口、带空格路径、跨目录启动、退出码、配置拒绝和不输出密钥。文档链接及代码围栏检查通过。
- 未填入或打印真实 Key，未发起真实 DeepSeek 请求，未启动或重启当前业务服务、未写现有业务数据；用户填写本机 Key 后仍需通过一次非降级运行完成线上验证。

## 2026-10-14 · 真实模型首轮联调：三处缺陷修复

### 背景

用户在本机 `.env` 填入 DeepSeek Key 后，由 `scripts/start-deepseek.mjs` 启动。本次完成了三级证据中的全部三级，并在真实模型路径上发现并修复三处缺陷。

### 决策与修复

- **发给模型的字段清单改由 Agent 输出协议驱动**：`toChatMessages` 原先固定写死 `summary/steps/proposals/handoffs/notes`，导致模型永远不返回 `constraints`，共享上下文的约束通道在远端模式下静默失效。现从 `agent.protocol.output` 生成字段清单，并显式给出 `constraints`/`metrics` 的形状说明。
- **把允许的动作类型写进提示词**：真实模型首轮返回了 `dedupe`、`defer`、`schedule`、`plan_consolidation`、`habit_anchor` 等自造类型。这些类型不在工具层白名单内，用户在界面点「确认执行」只会得到执行失败。现在请求中列出 `proposals[].type` 的允许取值（取自 `TOOL_FOR_PROPOSAL`），并声明 `risk` 只有 low/high、`handoffs[].to` 只能是三个 Agent。
- **归一化阶段做防御性过滤**：`BaseAgent.normalize` 丢弃不在白名单内的建议类型，并把被丢弃的类型写入 `notes`；`risk` 收敛为 low/high（模型返回 `medium` 等一律按 high 处理）。这样即使模型不守约定，也不会生成"批准后必然失败"的建议。
- **Mira 减负算法改为收敛**：原先固定"减 25 分钟"或"最长任务减 20 分钟"，实测 8×20 分钟（160 分钟）只减 5 分钟、调后仍 155，且步骤文案与实际改动不符、无残差标注。现按 `超出量` 计算真实减负量、下限 15 分钟、把 `resultingLoadMinutes`/`residualMinutes` 写入建议载荷，压不到上限时在步骤、建议与摘要三处如实标注剩余超限量。
- **`parseMinutes` 支持小时写法**：原先只取首个数字，`"2 小时"` 被读成 2 分钟，会低估负载 58 分钟以上并绕过 150 分钟上限。现识别 `N 小时 / N h / N hours`（含小数），其余回退分钟解析。
- **打断"新增→归档"循环**：Mira 每轮都会新增同名「晚饭后散步 30 分钟」，下一轮又把重复项作为归档建议。现在已存在同名未完成任务时不再新增。
- **无习惯记录不再默认判为已完成**：`sleepReady`/`moveReady` 在缺少对应习惯时记为 `null`，摘要与备注区分「未记录」与「未完成」，避免凭空断言睡眠未达标。
- **长任务拆分改为收敛到 25-45 分钟轮次上限**：`>60` 触发但目标值固定为 45（原为「减 20」，90 分钟任务被建议改成 70，仍在轮次上限之外）；措辞明确"剩余内容另起一轮"。
- **路由关键词去噪**：`atlas.json` 去掉过宽的 `题`，改为 `错题/题目/练习题/真题/大题`，避免"我有个问题想问"误命中学习教练。
- **`tasks:create` 补标题校验**：与 REST API 的 1-60 字校验对齐，空标题不再写入任务流。
- **声明与实现对齐**：三个定义的 `protocol.output` 与三个 `instructions/*.md` 的输出字段清单补齐 `constraints/notes/sources/metrics`；Nova 的措辞发现（零样本、`recorded_goal_focus`、`confidence` 常量、非法状态评分、累计快照口径）在前一提交已修，本轮把样本量条款同步进 `instructions/nova.md` 与产品文档。

### 验证

- 三级证据全部通过：① `GET /api/v1/agents` 返回 `requested=openai, used=openai, degraded=false`；② 一次真实运行的两个调用均 `provider=openai, degraded=false`（atlas 37.8s、mira 25.6s）；③ 无降级原因需要排查（`provider.reason=null`）。
- **修复前后真实模型对比**：修复前同目标运行产出 6 条待确认建议，其中 5 条为自造类型、`constraints=0`；修复后同一路径产出 `constraints=4`（均由 Mira 声明）、**自造类型 0 条**、建议类型全部落在白名单内。
- `npm.cmd run check`：81 个行为测试全部通过（新增 4 个：字段清单与动作类型、未知类型丢弃留痕、非法 risk 收敛、扣减/小时解析与服务端已有用例）。
- 界面核对：`#/runs` 自动打开最近一次运行，Provider 徽标为「OpenAI 兼容接口」，调用卡显示 `openai 36657 ms` / `openai 25603 ms`，无控制台错误、无横向溢出。

### 遗留

- **真实模型会产出偏多的待确认建议**（本次同目标 10 条建议、9 条待确认），低风险提示词约束不生效；当前未对 `pending` 数量设上限，建议后续按优先级截断或聚合。
- 修复前那次运行仍留在轨迹里，其中 5 条自造类型建议无法执行成功，属修复前产物。
- `.env` 中的 DeepSeek Key 由用户本机维护，不入库；本轮只读取存在性与启动结果，未打印任何密钥内容。
- 云端模型的内容质量未做系统评测，仅验证了通道、字段契约与降级路径。

## 2026-10-14 · 展示前收尾：确认队列限额、旧运行不可执行项、服务归属

### 决策与修复

- **确认队列限额为 3 条并按优先级排序**：单次运行把最重要的三条推进确认队列，其余标记为 `deferred`（保留在轨迹中、可单独执行，不再堆在首屏）。优先级权重固定在代码中：`reschedule_block` 0 → `update_task` 1 → `delete_task` 2 → `goal_recalibration` 3 → `create_task` 4；同权重保持原始顺序。限额与 BRD「每次最多返回 3 个可执行步骤」的认知负担约束保持一致。
- **配额规则对历史运行同样生效**：队列规则抽成 `queuePendingProposals()`，在运行结束时与**读取轨迹时**都调用，因此修复前留下的 9 条待确认旧运行现在也只展示 3 条、其余折叠。
- **不受支持的动作类型不再占用队列**：新增 `unsupported` 状态。模型自造的 `dedupe`/`defer`/`schedule`/`plan_consolidation`/`habit_anchor` 一律标记为不可执行、给出原因、**不渲染任何按钮**；确认接口对这些类型返回 400 `PROPOSAL_NOT_ACTIONABLE`，且在校验通过前不改动任何状态。
- **派生状态修正**：历史运行若停留在 `awaiting_confirmation` 但已无任何可确认项，读取时按实际队列修正为 `completed` 并追加说明，避免"等待确认"与实际不符。
- **前端四类渲染**：已处理（已执行/已放弃/执行失败）、不可执行（虚线卡片 + 原因）、确认队列（确认执行/暂不执行）、低优先级（`<details>` 折叠 + 仍然执行）。修复了 `applied` 建议被误标为「不可执行」的渲染错误。
- **README 增加「演示时的服务归属」**：明确演示/交接/排错时应在自己可见的终端启动，说明编码助手在后台启动的进程无法被用户 `Ctrl+C` 停止、看不到实时日志。

### 验证

- `npm.cmd run check`：**83 个行为测试全部通过**（新增 2 个：确认队列按优先级截断到上限并保留 deferred；旧运行不受支持类型不可执行、确认接口报 `PROPOSAL_NOT_ACTIONABLE` 且不改动数据）。
- 接口实测（rules 模式，不消耗模型额度）：8 次运行全部套用同一队列规则——某次真实模型运行由 9 条待确认降为「3 条队列 + 6 条延后」；修复前含自造类型的运行降为「0 条队列 + 6 条不可执行」。
- 浏览器实测四条运行：确认队列 3 条按钮为「确认执行/暂不执行」、折叠区 6 条「仍然执行」、`applied` 正确显示「已执行」、旧运行全部显示「不可执行」且**零按钮**；无控制台错误、无横向溢出（390px/1440px）。
- 契约同步：`RunProposal` 增加 `priority`、`deferredReason`、`actionable`、`blockedReason`，`status` 增加 `deferred`/`unsupported`；确认接口注明 `400 PROPOSAL_NOT_ACTIONABLE` 语义。

### 遗留

- 限额为固定常量（3 条），未按 Agent 或场景可配。
- 真实模型仍会产出偏多建议（本次某次运行 10 条），超出部分现在折叠而非丢弃，但用户可能需要展开查看。
- 历史运行中已被标记 `unsupported` 的建议仍以原始文本留在轨迹里，没有提供"删除该建议"的入口。
- 本轮把服务停回了未运行状态；演示前需由用户在自己的窗口启动。
