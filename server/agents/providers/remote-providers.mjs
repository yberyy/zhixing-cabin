import { ModelProvider } from "./provider.mjs";
import { RulesProvider } from "./rules-provider.mjs";
import { TOOL_FOR_PROPOSAL } from "../tools.mjs";

const REQUEST_TIMEOUT_MS = 8000;

function requestTimeout(value) {
  const timeout = Number(value);
  return Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 300000 ? timeout : REQUEST_TIMEOUT_MS;
}

export function toChatMessages(agent, input, context) {
  const state = context?.state || {};
  const memory = context?.memory || {};
  const summary = {
    goal: input?.goal || "",
    reason: input?.reason || null,
    handoff: input?.handoff || null,
    tasks: (state.tasks || []).slice(0, 12),
    habits: state.habits || [],
    reviews: (state.reviews || []).slice(0, 5),
    sharedContext: {
      goal: memory.goal || null,
      facts: (memory.facts || []).slice(-12).map(({ key, value, source }) => ({ key, value, source })),
      constraints: (memory.constraints || []).slice(-8),
      conflicts: (memory.conflicts || []).slice(-5)
    }
  };
  // 字段清单取自 Agent 自己的输出协议，避免模型漏掉 constraints 等通道。
  const fields = Array.isArray(agent?.protocol?.output) && agent.protocol.output.length
    ? agent.protocol.output
    : ["summary", "steps", "proposals", "handoffs", "notes"];
  // 只允许工具层支持的动作类型，否则批准时会失败。
  const allowedActions = Object.keys(TOOL_FOR_PROPOSAL).join(", ");
  return [
    { role: "system", content: agent.instruction },
    {
      role: "user",
      content: [
        "请依据下面的工作台状态给出结构化建议，只返回 JSON，不要输出解释性文字。",
        `JSON 字段：${fields.join(", ")}。`,
        "steps 形如 [{title,detail}]；proposals 形如 [{type,risk,title,detail,payload}]；handoffs 形如 [{to,reason,payload}]；constraints 形如 [{id,label,detail}]；metrics 为对象。",
        `proposals[].type 只能取以下值：${allowedActions}。不要发明新的动作类型；无法归类的建议请写进 notes。`,
        "risk 只能是 low 或 high；影响既有任务、日程或目标的建议必须标为 high。",
        "handoffs[].to 只能是 atlas、mira、nova 之一。",
        JSON.stringify(summary)
      ].join("\n")
    }
  ];
}

export async function callChatEndpoint({ endpoint, apiKey, model, messages, timeoutMs }) {
  const duration = requestTimeout(timeoutMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), duration);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({ model, messages, temperature: 0.2, response_format: { type: "json_object" } })
    });
    if (!response.ok) throw new Error(`模型端点返回 ${response.status}`);
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) throw new Error("模型未返回内容");
    return JSON.parse(content);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`模型请求超时（${duration}ms）`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 远端/本地模型 Provider 的公共基类。
 * - 未配置端点或密钥时，`available` 为 false，运行时会明确降级到规则引擎并标记 degraded。
 * - 已配置但调用或解析失败时，同样降级，绝不把异常抛给编排层。
 */
export class RemoteProvider extends ModelProvider {
  constructor(config, { id, label, mode }) {
    super({ id, label, mode });
    this.endpoint = config.endpoint || "";
    this.apiKey = config.apiKey || "";
    this.model = config.model || "default";
    this.timeoutMs = requestTimeout(config.timeoutMs);
    this.fallback = config.fallback || new RulesProvider();
    this.unavailableReason = config.unavailableReason || "未配置模型端点";
  }

  get available() {
    return Boolean(this.endpoint);
  }

  describe() {
    return {
      id: this.id,
      label: this.label,
      mode: this.mode,
      available: this.available,
      degraded: !this.available,
      reason: this.available ? null : this.unavailableReason
    };
  }

  async complete(request) {
    if (!this.available) return this.#degrade(request, this.unavailableReason);
    const startedAt = Date.now();
    try {
      const structured = await callChatEndpoint({
        endpoint: this.endpoint,
        apiKey: this.apiKey,
        model: this.model,
        timeoutMs: this.timeoutMs,
        messages: toChatMessages(request.agent, request.input, request.context)
      });
      return {
        provider: this.id,
        model: this.model,
        structured,
        text: structured?.summary || "",
        degraded: false,
        reason: null,
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      return this.#degrade(request, `${this.label} 调用失败：${error.message}`);
    }
  }

  async #degrade(request, reason) {
    const fallback = await this.fallback.complete(request);
    return { ...fallback, degraded: true, reason };
  }
}
