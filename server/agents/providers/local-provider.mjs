import { RemoteProvider } from "./remote-providers.mjs";

/** 本地模型 HTTP Provider，接收完整的 OpenAI 兼容 Chat Completions 端点。 */
export class LocalProvider extends RemoteProvider {
  constructor(config = {}) {
    super(
      {
        endpoint: config.baseUrl || "",
        model: config.model || "local-model",
        timeoutMs: config.timeoutMs,
        fallback: config.fallback,
        unavailableReason: "未配置 LOCAL_MODEL_URL，已退回确定性规则引擎"
      },
      { id: "local", label: "本地模型端点", mode: "local" }
    );
  }
}
