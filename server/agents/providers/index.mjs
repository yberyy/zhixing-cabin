import { RulesProvider } from "./rules-provider.mjs";
import { LocalProvider } from "./local-provider.mjs";
import { OpenAIProvider } from "./openai-provider.mjs";

export { ModelProvider } from "./provider.mjs";
export { RulesProvider } from "./rules-provider.mjs";
export { LocalProvider } from "./local-provider.mjs";
export { OpenAIProvider } from "./openai-provider.mjs";
export { RemoteProvider } from "./remote-providers.mjs";

export const SUPPORTED_PROVIDERS = ["rules", "local", "openai"];

/**
 * 依据环境变量解析 Provider。默认 rules，系统在没有任何模型配置时也能完整运行。
 * AI_PROVIDER=rules|local|openai
 * LOCAL_MODEL_URL / LOCAL_MODEL_NAME
 * OPENAI_API_KEY / OPENAI_MODEL / OPENAI_BASE_URL
 */
export function resolveProvider(env = process.env) {
  const requested = String(env.AI_PROVIDER || "rules").trim().toLowerCase();
  const rules = new RulesProvider();
  if (requested === "local") {
    return new LocalProvider({ baseUrl: env.LOCAL_MODEL_URL, model: env.LOCAL_MODEL_NAME, timeoutMs: env.MODEL_TIMEOUT_MS, fallback: rules });
  }
  if (requested === "openai") {
    return new OpenAIProvider({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL, baseUrl: env.OPENAI_BASE_URL, timeoutMs: env.MODEL_TIMEOUT_MS, fallback: rules });
  }
  return rules;
}

/** 把 Provider 状态整理为可公开的运行时描述（不含密钥）。 */
export function describeProvider(provider) {
  const info = provider.describe();
  return {
    requested: info.id,
    used: info.degraded ? "rules" : info.id,
    label: info.label,
    mode: info.mode,
    available: info.available,
    degraded: info.degraded,
    reason: info.reason
  };
}
