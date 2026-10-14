import { ModelProvider } from "./provider.mjs";

/**
 * 默认 Provider：确定性规则引擎。
 * 它不使用任何网络或密钥，输出由 Agent 的 `rules()` 依据输入与工作台状态推导。
 * 这是当前系统的真实推理来源，不会被描述为大模型输出。
 */
export class RulesProvider extends ModelProvider {
  constructor() {
    super({ id: "rules", label: "确定性规则引擎", mode: "deterministic" });
  }

  async complete({ agent, input, context }) {
    const startedAt = Date.now();
    if (!agent || typeof agent.rules !== "function") {
      throw Object.assign(new Error("Agent 缺少 rules() 处理器"), { code: "PROVIDER_INVALID_AGENT" });
    }
    const structured = agent.rules(input || {}, context || {});
    return {
      provider: this.id,
      model: null,
      structured,
      text: structured?.summary || "",
      degraded: false,
      reason: null,
      latencyMs: Date.now() - startedAt
    };
  }
}
