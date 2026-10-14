# Docker 使用说明

Docker 版将网页和 Node REST API 放进同一个容器，默认使用无需 Key 的 rules。你需要先启动 Docker Desktop，再运行 Compose；浏览器网址本身不会启动容器。

## 1. 安装和环境检查

Windows 用户按 [Docker Desktop 官方安装说明](https://docs.docker.com/desktop/setup/install/windows-install/) 安装，按提示准备 WSL 2 并使用 Linux 容器。安装系统组件时可能需要重新启动电脑；本项目不会自动安装 Docker 或修改系统虚拟化设置。

启动 Docker Desktop，等它的引擎就绪，再打开新的 PowerShell：

```powershell
docker version
docker compose version
```

`docker version` 必须能读取 Client 和 Server；只显示 Client 或出现无法连接 daemon，表示 Docker 引擎尚未就绪。Compose 需要支持 `up --wait`；较旧版本应通过更新 Docker Desktop 获得该功能。

本轮开发环境未安装 Docker Desktop 或 Docker Engine，因此没有实际构建、启动镜像。compose.yaml 已通过官方 Compose Specification JSON Schema 校验，应用和健康检查测试已通过；尚未使用完整 Compose CLI 校验或实际执行 build/up，需在 Docker 环境可用后按下方步骤验证。

## 2. 第一次启动

在存放 Dockerfile 与 compose.yaml 的项目根目录打开 PowerShell。如果终端尚不在项目中，先调整当前目录；本机示例：

```powershell
Set-Location -LiteralPath 'D:\课程\自我学习生活多agent管理平台'
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 90
docker compose ps
```

第一次启动会拉取 `node:24-bookworm-slim` 并构建本地镜像，需要联网。当前项目没有第三方 npm 依赖，不需要额外安装 SDK 或执行 npm install。

`config --quiet` 只校验，不显示展开后的 Key。`up` 创建并启动 app 与数据卷；`--wait` 等待健康检查通过后返回。app 显示 healthy 后打开：

- 今日总览：<http://127.0.0.1:4181/#/overview>
- 协作中心：<http://127.0.0.1:4181/#/runs>
- 健康检查：<http://127.0.0.1:4181/api/v1/health>

```powershell
Invoke-RestMethod http://127.0.0.1:4181/api/v1/health
```

应返回 status=ok、service=zhixing-api。首次使用不需要 .env 或模型 Key。`-d` 是后台运行，PowerShell 关闭后容器仍可工作；Docker Desktop 关闭或电脑关机后，网址会暂时不可用。

## 3. 日常启动、停止、日志与更新

以下命令按需要分别使用：

| 操作 | 在项目目录执行 |
| --- | --- |
| 再次启动或恢复 | `docker compose up -d --wait --wait-timeout 90` |
| 查看状态 | `docker compose ps` |
| 查看最近日志 | `docker compose logs --tail 100 app` |
| 持续跟踪日志 | `docker compose logs -f app`，Ctrl+C 只退出日志查看 |
| 停止容器并保留数据 | `docker compose stop` |
| 重启进程，保持原来的环境变量 | `docker compose restart app` |
| 删除容器和项目网络，保留数据卷 | `docker compose down` |
| 修改代码后重新构建并启动 | `docker compose up -d --build --wait --wait-timeout 90` |
| 修改 .env/模型/Key 后重建容器 | `docker compose up -d --force-recreate --wait --wait-timeout 90` |

镜像包含构建时的代码快照，不挂载源代码，因此刷新浏览器不能使容器自动获得后续代码修改，需要重新 build。修改 .env 后，仅 restart 也不会应用新环境，必须重新创建容器。

容器使用 unless-stopped 重启策略。Docker 引擎恢复后，未被显式停止的容器可以再次运行；你主动 stop/down 后用 up 恢复最明确。健康检查失败会标为 unhealthy，不会仅因该标记自动重启应用。

## 4. 端口和访问范围

| 启动方式 | 浏览器端口 | 服务内部端口 | 数据位置 |
| --- | --- | --- | --- |
| npm.cmd run dev | 4173 | 4173 | 本机 `.runtime/` |
| Docker Compose | 4181 | 4173 | Docker 命名卷 runtime-data |

Docker 默认绑定 `127.0.0.1:4181`，仅本机能访问。应用当前没有账户隔离或访问认证，不建议直接把端口暴露到公网。容器里设置 HOST=0.0.0.0 是为了让 Docker 能连接容器内部的服务，不等于宿主机向所有地址公开端口。

如果 4181 已被其他程序占用，可以在当前终端修改 Docker 专用宿主机端口：

```powershell
$env:DOCKER_PORT = '4182'
docker compose up -d --wait --wait-timeout 90
```

随后打开 `http://127.0.0.1:4182/#/overview`。也可以在 .env 中写 DOCKER_PORT=4182。容器内部 PORT 仍固定为 4173；本机 npm 使用的 PORT 不决定 Docker 版宿主机端口。

容器日志通常显示 `http://0.0.0.0:4173`，那是容器内部监听地址。浏览器使用宿主机的 4181 或你配置的 DOCKER_PORT，不能照搬日志中的 0.0.0.0 地址。

## 5. API Key 与模型配置

默认规则模式没有模型费用。启用远端模型会发送用户目标与必要上下文，并可能产生服务商费用；Key 有效性仍需一次实际非降级运行验证，具体能力边界见 [README](../README.md#模型配置与-api-key)。

在本机根目录准备 .env；下面的命令只在文件不存在时创建，避免覆盖现有配置：

```powershell
if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
notepad .env
```

在 .env 中编辑这些值，仅在本机输入真实 Key：

```dotenv
DOCKER_PORT=4181
AI_PROVIDER=openai
OPENAI_API_KEY=replace-with-your-own-key
OPENAI_MODEL=gpt-4o-mini
OPENAI_BASE_URL=https://api.openai.com/v1/chat/completions
```

占位 Key 不能使用。模型名是当前代码默认值，必须选择账户有权限且兼容本项目请求参数的模型；端点要求完整的 Chat Completions URL。更改后执行：

```powershell
docker compose config --quiet
docker compose up -d --force-recreate --wait --wait-timeout 90
```

Compose 会读取根目录 .env 做变量替换，再通过 compose.yaml 的 environment 白名单传给服务器。PowerShell 已存在的同名环境变量优先于 .env；如果文件已经改成 openai 而仍使用 rules，先检查当前终端的 AI_PROVIDER，移除你不再需要的旧变量或使用一个干净的新终端。

这与 npm.cmd run dev 不自动加载 .env 是两种不同启动方式。修改 Key 无需构建镜像；Key 也不能写进 Dockerfile、build args 或前端。镜像构建上下文排除了环境文件，管理员仍可通过 Docker 查看容器环境，所以不要分享包含展开值的 compose config 或 inspect 输出。

### 使用 DeepSeek

不需要 OpenAI Key 或额外 SDK。AI_PROVIDER=openai 在本项目表示兼容协议适配器，实际请求发送给你设置的 OPENAI_BASE_URL。DeepSeek 官方的 [接入说明](https://api-docs.deepseek.com/) 与 [Chat Completions 文档](https://api-docs.deepseek.com/api/create-chat-completion/) 给出端点、模型名及 JSON 输出参数；本项目已发送 JSON mode 与返回 JSON 的指令。

在上面准备好的 .env 中替换对应值，不要在文件末尾重复添加同名变量：

```dotenv
DOCKER_PORT=4181
AI_PROVIDER=openai
OPENAI_API_KEY=replace-with-your-deepseek-key
OPENAI_MODEL=deepseek-flash
OPENAI_BASE_URL=https://api.deepseek.com/chat/completions
MODEL_TIMEOUT_MS=120000
```

把占位符改成自己的 DeepSeek Key，模型名按官方文档及账户权限选择。**这里需要完整端点，不能只填 https://api.deepseek.com。** 不要设置 AI_PROVIDER=deepseek，当前没有该枚举，会落回默认 rules。

首次使用本轮代码需构建镜像，并创建采用新环境的容器：

```powershell
docker compose config --quiet
docker compose up -d --build --force-recreate --wait --wait-timeout 90
docker compose ps
```

打开 `http://127.0.0.1:4181/#/runs`，提交一次目标，再检查该次运行的真实来源。以后只修改 Key、模型或超时而未修改代码时，无需 --build，但仍需 --force-recreate。--wait-timeout 90 等待的是服务健康，不是模型生成；健康检查不会验证 Key，也不会调用付费模型。

MODEL_TIMEOUT_MS 是单次模型请求超时，默认 8000ms，接受 1..300000 的整数，非法值回退 8000。示例放宽为 120 秒以容纳远端生成；多个专业 Agent 顺序运行会累计耗时。超时仍明确降级，当前没有自动重试；应在轨迹查看原因，不能把规则结果当成 DeepSeek 输出。

配置只影响产品运行时，和开发期 OpenCode 的 opencode.jsonc 独立。使用 DeepSeek 会向 DeepSeek 发送目标及必要上下文，并产生该服务商的费用。Key 留在本机 .env，不发送给 OpenAI；不要公开容器环境或分享真实 Key。本轮只验证了本地模拟接口，未使用真实 DeepSeek Key 联调。

### 验证调用和恢复 rules

先访问 `http://127.0.0.1:4181/api/v1/agents` 查看 Provider 配置，再在协作中心主动运行一个目标。该次运行 used=openai、degraded=false 才表示实际使用了远端模型；401、429、超时或无效 JSON 会降级为 rules 并记录原因。

恢复免费规则模式时，把 .env 的 AI_PROVIDER 改为 rules，清除不再需要的 Key，重新执行 force-recreate 启动命令。若你还在 PowerShell 中设置了相同变量，也要同步清理或打开新终端。

### 使用宿主机上的本地模型

Docker Desktop 的容器中，127.0.0.1 指的是容器自身。若模型服务运行在 Windows 宿主机，可使用 Docker Desktop 提供的 host.docker.internal，例如：

```dotenv
AI_PROVIDER=local
LOCAL_MODEL_URL=http://host.docker.internal:11434/v1/chat/completions
LOCAL_MODEL_NAME=your-installed-model-name
```

上述端口仅为示例，需使用你实际启动的兼容模型服务地址和模型名。宿主机服务必须允许来自容器的连接，必要时检查监听地址与防火墙；本项目不会自动安装或启动模型。Linux 原生 Docker 环境的宿主机地址配置可能不同。

## 6. 数据持久化与备份

`runtime-data` 命名卷挂载到 `/app/.runtime`，默认实际卷名为 `zhixing-cabin_runtime-data`。state.json 与 runs.json 保存在这里，普通 stop、down、重新构建或重建容器都会保留它们。卷生命周期独立于容器，详见 [Docker Volumes](https://docs.docker.com/engine/storage/volumes/)。

**不要把 `docker compose down -v` 当作日常停止命令：-v 会删除数据卷及其中的数据。** 删除 Docker Desktop 数据、手动删除卷也会导致数据丢失。

为了得到一致的两份 JSON，备份前先停止 app；以下操作复制到本机新的时间戳目录：

```powershell
docker compose stop app
$backupDirectory = Join-Path (Get-Location).Path ('backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
docker compose cp app:/app/.runtime/. "$backupDirectory"
docker compose up -d --wait --wait-timeout 90
```

备份目录含个人数据，已加入 Git 忽略规则；可再复制到你自己的备份介质。新建容器只有通过首页/API 读取状态或创建运行后才一定产生对应 JSON，空卷或缺少某个文件不代表旧文件被删除。

## 7. 从 npm 版迁移已有任务

Docker 不会自动导入本机 .runtime，也不会把这些文件打包到镜像。以下操作会替换 Docker 卷中的同名 JSON，适合首次迁移；如果 Docker 里已有要保留的记录，先按上一节备份。

1. 在原 npm 服务终端按 Ctrl+C 停止写入，保留本机 .runtime。
2. 先按首次启动完成 Docker 镜像和卷初始化，然后停止 app。
3. 确认本机 state.json 存在，再复制数据并修正容器用户权限：

```powershell
docker compose stop app
docker compose cp ./.runtime/state.json app:/app/.runtime/state.json
if (Test-Path -LiteralPath './.runtime/runs.json') {
    docker compose cp ./.runtime/runs.json app:/app/.runtime/runs.json
}
docker compose run --rm --no-deps --user root --entrypoint sh app -c 'chown -R node:node /app/.runtime'
docker compose up -d --wait --wait-timeout 90
```

打开 Docker 的 4181 页面检查任务与运行记录。本机原始 .runtime 不会被上述复制操作删除。恢复旧备份时同样先停止并备份当前 Docker 数据，再按实际路径复制两份 JSON、修正权限并启动。

Docker 数据与 npm 数据独立时可以各自运行；只有你另行手工共享同一份 JSON 目录时，才必须避免两份服务同时写它。

## 8. 常见问题

| 现象 | 检查与处理 |
| --- | --- |
| docker 命令不存在 | 安装 Docker Desktop，重开 PowerShell，检查 docker version |
| 无法连接 Docker daemon | 启动 Docker Desktop，等待引擎就绪；按其提示检查 WSL |
| 报 Windows/Linux 镜像不匹配 | 本项目基于 Linux Node 镜像，切换为 Linux 容器 |
| 拉取镜像失败 | 检查 Docker 引擎的网络/代理；不要把镜像下载失败误认为应用启动失败 |
| 找不到 Compose 配置 | 先进入包含 compose.yaml 的项目根目录 |
| 4181 被占用 | 修改 DOCKER_PORT，重新 up，并访问新端口 |
| 网页提示连接拒绝 | 检查 Docker Desktop、docker compose ps 和 logs，确认使用 4181 而不是 npm 的 4173 |
| app 为 unhealthy 或启动等待超时 | 先看 logs，再执行 docker compose exec app node scripts/healthcheck.mjs；超时后容器可能仍存在，检查 ps，不要只反复打开网址 |
| 修改 .env 后无效 | 使用 force-recreate，并检查终端同名变量是否覆盖 .env |
| 修改代码后没变化 | 重新 up --build；当前镜像没有源代码热重载 |
| Docker 启动后看不到 npm 原有任务 | 两者使用独立数据，按迁移步骤导入，注意浏览器访问的是哪个端口 |
| 写数据报 EACCES | 导入文件后按迁移步骤修正 /app/.runtime 的 node 用户所有权 |

## 9. 配置文件职责

- Dockerfile：Node 24 Debian slim 运行环境，只复制应用需要的文件，以 node 用户启动 Node。
- compose.yaml：固定英文项目名，避免中文目录产生项目名歧义；一个 app 实例、宿主机本地端口映射、运行时配置、持久化卷和重启策略。
- .dockerignore：运行文件白名单，环境文件、缓存、本机数据和开发期 Agent 配置不进入构建上下文。
- scripts/healthcheck.mjs：在容器内请求本机健康端点，验证状态和服务标识，超时或异常时返回失败退出码。

只有一个应用容器，没有额外引入数据库、Nginx 或云服务。JSON 持久化仍是单进程方案，Docker 不会自动解决多实例事务、用户认证或模型费用控制。

## 官方参考

- [Compose 环境变量与优先级](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)
- [Docker Desktop 连接宿主机服务](https://docs.docker.com/desktop/features/networking/networking-how-tos/#connect-a-container-to-a-service-on-the-host)
- [端口发布与绑定地址](https://docs.docker.com/get-started/docker-concepts/running-containers/publishing-ports/)
