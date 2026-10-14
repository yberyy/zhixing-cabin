/**
 * ModelProvider 统一接口。
 *
 * 所有推理来源（确定性规则、本地模型、远端 API）都实现 `complete(request)`。
 * `complete` 返回结构化结果，调用方（Agent / Orchestrator）不关心推理来源。
 *
 * request = { agent, input, context }
 * response = { provider, model, structured, text, degraded, reason, latencyMs }
 *
 * 约束：提供商只负责产生结构化建议，不直接写入业务状态；
 * 所有写操作由 Orchestrator 通过工具层在确认后执行。
 */
export class ModelProvider {
  constructor({ id, label, mode }) {
    this.id = id;
    this.label = label;
    this.mode = mode;
  }

  get available() {
    return true;
  }

  describe() {
    return {
      id: this.id,
      label: this.label,
      mode: this.mode,
      available: this.available,
      degraded: false,
      reason: null
    };
  }

  // eslint-disable-next-line no-unused-vars
  async complete(request) {
    throw Object.assign(new Error(`Provider ${this.id} 未实现 complete()`), { code: "PROVIDER_NOT_IMPLEMENTED" });
  }
}
