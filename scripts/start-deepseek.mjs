import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import * as util from "node:util";

const envFile = new URL("../.env", import.meta.url);

export function readDeepSeekEnv(file = envFile, inherited = process.env) {
  if (typeof util.parseEnv !== "function") {
    throw new Error("此启动脚本需要 Node.js 20.12 或以上版本，建议使用 Node.js 24。");
  }
  let values;
  try {
    values = util.parseEnv(readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("未找到项目根目录 .env，请按 README 的 DeepSeek 说明创建配置。");
    throw new Error("无法读取 .env，请检查文件内容与访问权限。");
  }
  // This launcher intentionally prefers the saved file over stale terminal settings.
  const env = { ...inherited, ...values };
  if (env.AI_PROVIDER?.trim().toLowerCase() !== "openai") {
    throw new Error("请在 .env 设置 AI_PROVIDER=openai；这是 DeepSeek 使用的兼容适配器。");
  }
  const key = values.OPENAI_API_KEY?.trim();
  if (!key || /^(?:replace-with|your[-_]|填|你的)/i.test(key)) {
    throw new Error("请先打开项目根目录 .env，在 OPENAI_API_KEY= 后填写你的 DeepSeek Key，保存后重新启动。");
  }
  let endpoint;
  try {
    endpoint = new URL(env.OPENAI_BASE_URL);
  } catch {
    throw new Error("请在 .env 设置 OPENAI_BASE_URL=https://api.deepseek.com/chat/completions。");
  }
  if (endpoint.protocol !== "https:" || endpoint.hostname !== "api.deepseek.com" || endpoint.port ||
      !["/chat/completions", "/v1/chat/completions"].includes(endpoint.pathname) ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("DeepSeek 启动脚本只接受官方 HTTPS Chat Completions 地址；其他服务商请使用通用启动方式。");
  }
  return {
    ...env,
    AI_PROVIDER: "openai",
    OPENAI_API_KEY: key,
    OPENAI_MODEL: env.OPENAI_MODEL?.trim() || "deepseek-flash",
    MODEL_TIMEOUT_MS: env.MODEL_TIMEOUT_MS || "120000"
  };
}

async function start() {
  let env;
  try {
    env = readDeepSeekEnv();
  } catch (error) {
    console.error(`DeepSeek 启动失败：${error.message}`);
    process.exitCode = 1;
    return;
  }
  Object.assign(process.env, env);
  console.log("已读取本机 .env；密钥不会显示。启动后请保持窗口开启，按 Ctrl+C 停止服务。");
  await import("../server/index.mjs");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch(() => {
    console.error("DeepSeek 启动失败，请检查服务文件、配置和访问权限。");
    process.exitCode = 1;
  });
}
