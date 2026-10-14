import { RemoteProvider } from "./remote-providers.mjs";

/** OpenAI 兼容 HTTP Provider。配置后发起请求，密钥仅在服务端读取。 */
export class OpenAIProvider extends RemoteProvider {
  constructor(config = {}) {
    const hasKey = Boolean(config.apiKey);
    super(
      {
        endpoint: hasKey ? config.baseUrl || "https://api.openai.com/v1/chat/completions" : "",
        apiKey: config.apiKey || "",
        model: config.model || "gpt-4o-mini",
        timeoutMs: config.timeoutMs,
        fallback: config.fallback,
        unavailableReason: "未配置 OPENAI_API_KEY，已退回确定性规则引擎"
      },
      { id: "openai", label: "OpenAI 兼容接口", mode: "remote" }
    );
  }
}
