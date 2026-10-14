import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createApp } from "./app.mjs";
import { JsonRepository } from "./repository.mjs";
import { createAgentSystem, JsonRunRepository } from "./agents/index.mjs";
import { describeProvider } from "./agents/providers/index.mjs";

const currentDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(currentDir, "..");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const runtimeDir = join(rootDir, ".runtime");
const repository = new JsonRepository(join(runtimeDir, "state.json"));

const runRepository = new JsonRunRepository(join(runtimeDir, "runs.json"));
// 开发模式下给每次 Agent 调用留出可见耗时，便于观察「运行中」状态。
const stepDelayMs = Number(process.env.AGENT_STEP_DELAY_MS ?? 140);
const agents = createAgentSystem({ repository, runRepository, env: process.env, stepDelayMs });

const server = createServer(createApp({ repository, staticDir: join(rootDir, "dist"), agents }));

server.on("error", async (error) => {
  if (error.code === "EADDRINUSE") {
    const checkHost = host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "[::1]" : host.includes(":") ? `[${host}]` : host;
    const address = `http://${checkHost}:${port}`;
    let existingService = false;
    try {
      const response = await fetch(`${address}/api/v1/health`, { signal: AbortSignal.timeout(1500) });
      const health = response.ok ? await response.json() : null;
      existingService = health?.status === "ok" && health?.service === "zhixing-api";
    } catch {
      // 无法确认服务身份时，保留占用进程并给出换端口指引。
    }
    if (existingService) {
      console.log(`知行舱已经在运行：${address}/#/overview`);
      console.log("无需重复启动；本次命令未新建服务器，也未应用新的模型或 API Key 配置。");
      console.log("需要重启时，请先在原服务终端按 Ctrl+C，再执行 npm.cmd run dev。");
      return;
    }
    console.error(`启动失败：${host}:${port} 端口已被占用，无法确认占用者是知行舱。`);
    console.error("请检查占用程序，或在 PowerShell 设置 $env:PORT = '4181' 后重新启动，并使用对应端口访问。");
  } else {
    console.error(`启动失败（${error.code || "UNKNOWN"}）：${error.message}`);
  }
  process.exitCode = 1;
});

server.listen(port, host, () => {
  const listeningPort = server.address().port;
  const provider = describeProvider(agents.provider);
  console.log(`知行舱已启动：http://${host}:${listeningPort}`);
  console.log(`API 健康检查：http://${host}:${listeningPort}/api/v1/health`);
  console.log(`Agent Provider：${provider.requested} → ${provider.used}${provider.degraded ? `（降级：${provider.reason}）` : ""}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
