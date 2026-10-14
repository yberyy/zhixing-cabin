# 知行舱

一个面向个人学习与生活管理的多 Agent 协作平台。它把任务、专注、习惯与复盘放在同一条行动链路中，由 Orchestrator 统一编排，Atlas、Mira、Nova 分别提供学习、生活与成长支持。协作过程以「运行轨迹」完整呈现，无需任何付费 API Key 即可运行。

## Docker 启动（演示与部署）

先安装并启动 [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/)，选择 Linux 容器。该方式不要求电脑另外安装 Node.js。

在项目目录的 PowerShell 中执行：

```powershell
docker version
docker compose version
docker compose up -d --build --wait --wait-timeout 90
docker compose ps
```

`docker version` 需要同时显示 Client 和 Server，`docker compose ps` 应显示 app 为 healthy。首次构建需要联网拉取 Node 镜像；未配置 Key 也能以 rules 模式运行，不需要先创建 .env。

成功后打开 **http://127.0.0.1:4181/#/overview**。Docker 默认端口是 **4181**，下方 npm 方式默认端口是 **4173**。`-d` 表示后台运行，关闭 PowerShell 不会停止容器，但 Docker Desktop 必须保持运行。

```powershell
docker compose logs --tail 50 app
docker compose stop
docker compose up -d --wait --wait-timeout 90
```

上面三条依次用于查看日志、停止、再次启动。它们应按需要分别执行，不需要每次都全部执行。任务和轨迹保存在持久化卷中，停止和重建容器会保留数据；Docker 卷与 npm 版的 `.runtime/` 是两份独立数据。

**完整步骤、API Key、换端口、更新代码、备份和数据迁移见 [Docker 使用说明](docs/DOCKER.md)。** 本机若尚未安装 Docker，请先按说明完成安装；配置文件本身不会安装或启动 Docker Desktop。

## 先启动服务器，再打开网页

以下是直接使用本机 Node.js 的方式；使用上面的 Docker 方式时不需要再执行 npm 启动同一份服务。

`127.0.0.1:4173` 指向你自己电脑上的服务。**只有服务器正在运行时，浏览器才能打开这个网址。** 打开网址不会自动启动服务器。

### 1. 检查环境并进入项目

在 Windows PowerShell 中执行：

```powershell
node --version
npm.cmd --version
Set-Location -LiteralPath '自我学习生活多agent管理平台'
```

项目需要 Node.js 20 或以上；如果移动了项目，请修改上面的路径。当前项目没有第三方 npm 依赖和前端构建步骤，不需要先执行 `npm install` 或 `npm run build`。PowerShell 中使用 `npm.cmd` 可以避免 `npm.ps1` 执行策略拦截。

### 2. 启动服务

```powershell
npm.cmd run dev
```

看到类似下面的输出才表示启动成功：

```text
知行舱已启动：http://127.0.0.1:4173
API 健康检查：http://127.0.0.1:4173/api/v1/health
Agent Provider：rules → rules
```

**保持这个终端窗口打开。** 它持续运行 Node 服务，没有返回命令提示符是正常现象。关闭终端、关闭电脑或按 `Ctrl+C` 会停止服务。

### 3. 打开浏览器并验证

打开 [今日总览](http://127.0.0.1:4173/#/overview) 或 [协作中心](http://127.0.0.1:4173/#/runs)。也可以在第二个 PowerShell 窗口执行：

```powershell
Invoke-RestMethod http://127.0.0.1:4173/api/v1/health
```

返回 `status: ok` 表示服务可访问。下次重启电脑后，重复“进入项目 → 启动服务 → 打开网页”；不需要重新创建任务或配置项目。数据保存在 `.runtime/state.json`，运行轨迹保存在 `.runtime/runs.json`，停止服务不会主动删除它们。

### 4. 停止、重启与测试

在运行服务的终端按 `Ctrl+C` 停止。修改服务端代码或模型环境变量后，重新执行 `npm.cmd run dev`；当前没有自动热重载。仅修改 HTML/CSS/浏览器 JS 时，刷新页面即可读取新文件。

质量检查使用另一个终端，不要把它误当作启动命令：

```powershell
npm.cmd run check
```

### 5. 演示时的服务归属

演示、交接或排错时，请在**你自己可见的终端**里启动服务：双击 `start-deepseek.cmd`，或在自己的窗口执行 `npm.cmd run dev`。

编码助手在后台启动的进程不会出现在你的终端里——你无法用 `Ctrl+C` 停止它，也看不到实时日志。演示前请确认：当前服务窗口属于你自己；需要更换 Provider 或 Key 时先在该窗口停止，再重新启动。

### 常见启动问题

| 现象 | 处理方式 |
| --- | --- |
| `ERR_CONNECTION_REFUSED` / Failed to Load Page | 先检查服务终端是否仍在运行；进入项目执行 `npm.cmd run dev`，再验证 `/api/v1/health` |
| 找不到 `node` / `npm.cmd` | 安装 Node.js 后重新打开终端，再检查版本 |
| 找不到 `package.json` / ENOENT | 当前目录不对，先执行上面的 Set-Location |
| `npm.ps1` 禁止运行 | 使用 `npm.cmd run dev` |
| 提示“知行舱已经在运行” | 已通过健康检查确认已有服务，直接使用提示的网址。本次启动命令会退出，不会新建服务，也不会应用新设置的模型/Key；需要更新配置时先在原终端 Ctrl+C 停止旧服务再启动 |
| 提示端口被其他程序占用，或旧版本出现 `EADDRINUSE` | 先访问健康检查，已有本项目服务时直接使用；确认为其他程序时检查占用者，或设置 `$env:PORT = '4181'` 后启动，浏览器改用 4181 |
| 改完 Key 或 Provider 后页面没有变化 | 停止旧服务，在设置好环境变量的同一个终端重新启动，再刷新网页 |

不要同时启动两个指向同一 `.runtime/` 的项目实例写数据。静态离线模式也需要有静态服务器先把页面送到浏览器；本地服务器完全停止时，网页本身无法加载，API 的离线回退逻辑也就没有机会运行。

## Agent 引擎

- 每个 Agent 由三份来源装配：`definitions/*.json`（身份、工具权限、输入输出协议、路由关键词）、`skills/*.skill.mjs`（领域行为）、`instructions/*.md`（指令）。装配与校验在启动时完成，未知技能或未知工具会立即报错。
- 新增一个专业 Agent 只需加「定义 + 指令」，复用已有技能即可，无需修改 Orchestrator。说明见 `foundation/agents/*/AGENT.md`。
- 专业 Agent 在 rules 模式执行各自的 Skill 代码；在远端模式把各自的指令与工作台摘要发送给模型，再把结构化建议交回相同的编排与工具层。
- Orchestrator 的路由、调用顺序、handoff 深度、风险判定和结果合并仍由代码负责；配置 Key 不会把编排者改成大模型规划器。

## 模型配置与 API Key

### 现在是否已经使用真实模型

代码已经实现服务端 HTTP 模型调用，但**通用启动默认是 `rules`，没有内置的真实 Key**。本机 `.env` 可以保存你自行填写的配置，专用 DeepSeek 启动器显式加载该文件；只存在配置文件不代表已调用模型。当前服务以 `/api/v1/agents` 和该次运行详情为准，不能沿用旧的 rules 检查结果判断配置是否生效。

这意味着当前建议来自项目的确定性规则，不消耗模型 API 额度。现有自动测试使用规则、临时测试端点和失败模拟，尚未使用付费 Key 完成线上端到端验证。

### 使用真实 OpenAI 兼容接口

先停止原来的服务，在**同一个 PowerShell 窗口**设置变量，再启动：

```powershell
Set-Location -LiteralPath 'D:\课程\自我学习生活多agent管理平台'
$env:AI_PROVIDER = 'openai'
$env:OPENAI_API_KEY = '<仅在本机替换为你的真实 API Key>'
$env:OPENAI_MODEL = 'gpt-4o-mini'
npm.cmd run dev
```

上面的模型名是当前代码默认值；实际使用的模型需要你的账户有权限，并兼容本项目的 Chat Completions、JSON mode 和 `temperature` 参数。Key 不要填到网页、前端代码、聊天记录或 Agent Markdown 中。环境变量方式与 [OpenAI 官方快速开始](https://developers.openai.com/api/docs/quickstart) 一致；本项目使用 Node 原生 fetch，因此无需另装 OpenAI SDK。

**只设置 Key、没有设置 `AI_PROVIDER=openai`，仍然会运行 rules。** 上述变量只在当前终端及它启动的进程中生效，关闭终端后需要重新设置。

| 环境变量 | 默认值 / 含义 |
| --- | --- |
| `AI_PROVIDER` | `rules`；也接受 `local`、`openai` |
| `OPENAI_API_KEY` | 空；openai 模式必需，只在服务端读取 |
| `OPENAI_MODEL` | 代码默认 `gpt-4o-mini`，可替换为兼容且有权限的模型 |
| `OPENAI_BASE_URL` | 默认为 `https://api.openai.com/v1/chat/completions`；当前实现要求**完整请求端点**，不是仅填域名或 `/v1` |
| `LOCAL_MODEL_URL` | local 模式的完整 OpenAI 兼容 Chat Completions 端点 |
| `LOCAL_MODEL_NAME` | local 模式模型名，代码默认 `local-model` |
| `MODEL_TIMEOUT_MS` | 单次模型请求超时，默认 8000ms；接受 1..300000 的整数，非法值回退默认；DeepSeek 示例为 120000ms |
| `PORT` / `HOST` | 默认 `4173` / `127.0.0.1` |
| `AGENT_STEP_DELAY_MS` | 默认 140；演示调用轨迹时的额外延迟，不是模型超时 |

项目的 `npm.cmd run dev` **不会自动读取 `.env`**，`.env.example` 只是变量说明模板。如果使用支持 `--env-file` 的 Node，也可以把变量写入本机 `.env`，然后用 `node --env-file=.env server/index.mjs` 显式启动；本机 Node.js 24 已支持该参数。已有进程环境变量会优先于环境文件，所以不要同时保留互相矛盾的两套配置。

### 使用 DeepSeek（无需 OpenAI Key）

DeepSeek 提供兼容接口，仍使用 `AI_PROVIDER=openai`；这里的 openai 是适配器名称，不代表请求发送给 OpenAI。服务器按照 OPENAI_BASE_URL 发请求，OPENAI_API_KEY 中填的是 **DeepSeek 的 Key**。不要设置尚未实现的 AI_PROVIDER=deepseek。

#### Windows 一键启动

已准备好本机 `.env` 时，只需打开它，把 DeepSeek Key 填到 `OPENAI_API_KEY=` 后保存，然后双击根目录 **start-deepseek.cmd**。不要把 Key 写进 .cmd、.mjs 或 .env.example；本机 .env 已被 Git 和 Docker 构建上下文忽略，仍是明文敏感文件，不要分享。

也可以在项目目录执行：

```powershell
npm.cmd run start:deepseek
```

这个专用启动器要求 Node.js 20.12 或以上（建议 24），无需 Docker；从项目根目录读取 .env，文件中的值优先于当前终端同名变量，避免旧 rules 配置覆盖已保存的模型配置。通用 npm run dev 和 Docker Compose 的原有环境变量优先级不变。

启动器会检查本机 .env 的 Key 非空、Provider 为 openai、端点为 DeepSeek 官方 HTTPS Chat Completions 地址；漏填或配置不符会停止并提示，不打印 Key。检查不代表 Key、余额和模型权限已验证，也不会自动调用付费模型。其他供应商应使用通用启动方式。

正常启动后打开 `http://127.0.0.1:4173/#/runs`（修改 PORT 后使用对应端口）。保持窗口开启，在页面主动提交目标才会调用模型；Ctrl+C 停止。修改 .env 后先停止旧服务再双击；如果提示“已经在运行”，本次没有应用新配置。不要反复双击代替重启。

#### 手动配置与 Docker

在本机 `.env` 中配置（没有文件时先从 `.env.example` 复制，不要覆盖已有配置）：

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=replace-with-your-deepseek-key
OPENAI_MODEL=deepseek-flash
OPENAI_BASE_URL=https://api.deepseek.com/chat/completions
MODEL_TIMEOUT_MS=120000
DOCKER_PORT=4181
```

端点与模型示例依据 [DeepSeek 官方接入文档](https://api-docs.deepseek.com/)。模型名须使用账户可用的官方模型；本项目要求完整的 /chat/completions 地址，与 SDK 只填 base_url 的写法不同。

- Docker：先启动 Docker Desktop，在项目目录执行 `docker compose up -d --build --force-recreate --wait --wait-timeout 90`，打开 `http://127.0.0.1:4181/#/overview`。
- 本机 Node：先在旧服务终端按 Ctrl+C，再执行 `node --env-file=.env server/index.mjs`，打开 `http://127.0.0.1:4173/#/overview`，保持终端开启。单独 npm run dev 不读取该文件。

120000ms 是每个专业 Agent 单次请求的超时，不是整轮运行时长；当前专业 Agent 顺序调用，多个角色和 handoff 会累计耗时。超时不自动重试，也不保证所有模型都能在此时间内完成。

**OpenCode 的 opencode.jsonc 只配置开发期助手，不会替网页后端配置模型。** 产品运行时要按上述 .env 配置并重启；UI 显示 openai 代表兼容适配器。不要上传 .env 或把真实 Key 发到聊天、截图、前端代码中。详细步骤见 [Docker 的 DeepSeek 配置](docs/DOCKER.md#使用-deepseek)。

### 如何判断真实调用成功

1. 启动输出的 `openai → openai` 只表示配置入口可用，**不代表密钥、模型权限或网络已经验证成功**。
2. 在第二个终端执行 `Invoke-RestMethod http://127.0.0.1:4173/api/v1/agents`，查看 provider 字段，不会返回 Key。
3. 在协作中心手动提交一次目标，打开该次运行详情。`run.provider.used=openai`、`degraded=false`，且成功调用记录的 `provider=openai`，才说明这次实际使用了模型。
4. 401、429、网络错误、达到 MODEL_TIMEOUT_MS 的超时（默认 8 秒）、响应非合法 JSON 等情况会降级为规则；查看该次运行的 provider.reason 和 calls[].degradationReason，而不是只看全局配置徽标。

### 配置成功后会改变什么

| 方面 | 当前 rules | 成功启用远端模型后 |
| --- | --- | --- |
| 领域建议 | 关键词与固定规则生成 | 模型按各 Agent 的独立指令和输入摘要生成，内容可能更灵活，质量仍需验证 |
| 模型请求 | 无外部模型请求 | 每次实际执行专业 Agent 时发送一次请求，handoff 可能追加请求 |
| 编排与权限 | 代码路由、共享记忆、工具权限与用户确认 | 继续使用相同代码规则，Key 不增加工具权限 |
| 数据流 | 模型分析在本机规则中进行 | 目标、任务/习惯/复盘摘要与当前共享上下文会发送到所配置端点 |
| 结果与耗时 | 易复现、通常较快 | 内容可能变化，依赖网络、模型与账户额度；可能产生服务商费用 |
| 错误处理 | 直接执行规则 | 请求失败或 JSON 解析失败时退回规则，并保留降级原因 |

当前输入上限为最近截取的 12 个任务、5 条复盘、12 条共享事实、8 条约束、5 条冲突，习惯列表一并传入；“截取”不代表任务一定按时间排序。历史事实版本不发送。每次合并最多返回 3 条建议，不代表只有一次模型调用，也不代表有费用上限。

不会因配置 Key 自动获得联网检索、日历连接、模型训练、跨运行长期记忆、独立的每 Agent 模型/Key 或真实历史统计。三个专业 Agent 当前共用一个 Provider/模型，以不同指令和上下文区分职责。页面上的演示趋势也不会因此变为真实分析。

远端响应使用 `response_format: {type: 'json_object'}`。这是 JSON mode，不是严格 JSON Schema 或原生函数工具调用；字段完整性仍需应用层处理，详见 [OpenAI 结构化输出说明](https://developers.openai.com/api/docs/guides/structured-outputs)。

### 恢复无需 Key 的模式

停止服务后，在准备启动的终端执行：

```powershell
$env:AI_PROVIDER = 'rules'
Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
npm.cmd run dev
```

如果另行使用 `.env` 启动，也要同步修改其 AI_PROVIDER。更多变量说明见 [.env.example](.env.example)。

## 工程导航

| 路径 | 内容 |
| --- | --- |
| `AGENTS.md` | Agent 角色、协作规则与完成定义 |
| `docs/BRD.md` | 用户机会、业务目标与指标 |
| `docs/PRD.md` | 功能范围、流程和验收标准 |
| `foundation/` | Skills、Agent 说明、架构图、设计原则与开发日志 |
| `opencode.jsonc` | OpenCode 开发命令、文件监听与全局权限 |
| `.opencode/` | 开发期 Agent 定义与 Skill 入口，不影响产品运行时 |
| `.openai/hosting.json` | 已有站点的部署关联元数据，整理目录时保留 |
| `shared/contracts/openapi.yaml` | 前后端接口契约 |
| `server/agents/` | Agent 引擎：registry、orchestrator、message bus、shared memory、run repository、providers、tools |
| `server/` | API、领域路由与 JSON Repository |
| `dist/` | 可独立运行的响应式 Web 控制台 |
| `tests/` | Node 原生行为测试 |
| `scripts/` | 工程校验脚本 |
| `Dockerfile` / `compose.yaml` / `.dockerignore` | 容器镜像、单实例部署、环境变量与构建上下文配置 |
| `docs/DOCKER.md` | Docker 首次启动、健康检查、Key、更新、备份和迁移 |
| `.runtime/` | 本机业务数据与运行轨迹，不提交、不作为缓存清理 |

目录整理与代码检查的记录见 [开发日志](foundation/logs/development.md)。浏览器测试截图和临时用户配置请写入系统临时目录，避免将缓存堆积在项目中。`.env` 等本机密钥文件已加入忽略规则，保留不含密钥的 `.env.example` 作为变量说明。

## API

基础路径为 `/api/v1`，主要接口包括：

- `GET /state`：读取完整工作台状态（不含已归档任务）
- `POST /tasks`：创建任务
- `PATCH /tasks/:id`：修改任务（名称、领域、时长、负责人、状态）
- `DELETE /tasks/:id`：归档任务（软删除，可恢复）
- `GET /tasks/archived`：列出已归档任务
- `POST /tasks/:id/restore`：从归档箱恢复
- `POST /habits/:id/toggle`：切换习惯
- `POST /reviews`：保存每日复盘
- `GET /agents`：读取 Provider 状态与 Agent 注册表
- `POST /agents/runs`：创建多 Agent 协作运行（默认异步返回 `running`，`sync=true` 时等待终态）
- `GET /agents/runs`：运行摘要列表
- `GET /agents/runs/:runId`：运行轨迹详情
- `POST /agents/runs/:runId/confirm`：确认或拒绝高影响建议
- `POST /agents/:id/dispatch`：兼容旧版的单 Agent 派发

完整定义见 `shared/contracts/openapi.yaml`。
