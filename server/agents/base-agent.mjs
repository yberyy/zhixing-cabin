import { truncate } from "./utils.mjs";
import { TOOL_FOR_PROPOSAL } from "./tools.mjs";

/**
 * 所有专业 Agent 的基类：独立配置、指令、输入输出协议、工具权限与运行状态。
 * 子类只需实现 `rules(input, context)`。
 */
export class BaseAgent {
  constructor(config) {
    if (!config?.id) throw new Error("Agent 需要 id");
    this.id = config.id;
    this.name = config.name;
    this.role = config.role;
    this.accent = config.accent || "blue";
    this.initial = config.initial || String(config.name || "?").slice(0, 1);
    this.capabilities = config.capabilities || [];
    this.instruction = config.instruction || "";
    this.tools = config.tools || {};
    this.protocol = config.protocol || { input: [], output: [] };
    this.status = "idle";
    this.currentTask = "待命";
    this.lastError = null;
    /** 领域路由关键词：命中则被 Orchestrator 自动选中；为空时只能显式指定。 */
    this.routing = Array.isArray(config.routing) ? config.routing : [];
    /** 无任何关键词命中时，是否作为默认 Agent 承接。 */
    this.routingDefault = config.routingDefault === true;
  }

  /** 与工作台现有 Agent 状态保持一致的展示值。 */
  get displayStatus() {
    return this.status === "idle" ? "ready" : this.status;
  }

  allows(toolName) {
    const permission = this.tools[toolName];
    return Boolean(permission) && permission !== "deny" && permission !== false;
  }

  permissionFor(toolName) {
    return this.tools[toolName] ?? null;
  }

  setStatus(status, task) {
    this.status = status;
    if (typeof task === "string") this.currentTask = truncate(task, 50);
  }

  describe() {
    return {
      id: this.id,
      name: this.name,
      role: this.role,
      accent: this.accent,
      initial: this.initial,
      status: this.status,
      displayStatus: this.displayStatus,
      currentTask: this.currentTask,
      lastError: this.lastError,
      capabilities: this.capabilities,
      tools: this.tools,
      protocol: this.protocol,
      routing: this.routing,
      routingDefault: this.routingDefault,
      instruction: this.instruction
    };
  }

  // eslint-disable-next-line no-unused-vars
  rules(input, context) {
    throw Object.assign(new Error(`${this.name} 未实现 rules()`), { code: "AGENT_NOT_IMPLEMENTED" });
  }

  /** 统一输出协议：调用方永远能拿到同样的字段结构。 */
  normalize(output, input) {
    const base = {
      status: "completed",
      summary: `${this.name} 已完成分析`,
      steps: [],
      artifacts: [],
      proposals: [],
      handoffs: [],
      constraints: [],
      notes: [],
      sources: [this.name],
      metrics: {}
    };
    const merged = { ...base, ...(output || {}) };
    merged.agentId = this.id;
    merged.agentName = this.name;
    merged.status = merged.status === "failed" ? "failed" : "completed";
    merged.steps = (merged.steps || [])
      .map((step, index) => ({
        id: step.id || `${this.id}-step-${index + 1}`,
        title: truncate(step.title ?? step, 80),
        detail: truncate(step.detail ?? "", 220),
        risk: step.risk || "low",
        source: this.id
      }))
      .filter((step) => step.title);
    merged.artifacts = (merged.artifacts || []).map((artifact, index) => ({
      id: artifact.id || `${this.id}-artifact-${index + 1}`,
      type: artifact.type || "note",
      title: truncate(artifact.title, 80),
      detail: truncate(artifact.detail ?? "", 220)
    }));
    const dropped = [];
    merged.proposals = (merged.proposals || [])
      .filter((proposal) => {
        const type = proposal?.type;
        const supported = typeof type === "string" && Object.prototype.hasOwnProperty.call(TOOL_FOR_PROPOSAL, type);
        if (!supported) dropped.push(String(type ?? "未命名"));
        return supported;
      })
      .map((proposal, index) => ({
        id: proposal.id || `${this.id}-proposal-${index + 1}`,
        agentId: this.id,
        type: proposal.type,
        // 风险等级收敛为 low / high，模型返回的其它值一律按 high 处理。
        risk: proposal.risk === "low" ? "low" : "high",
        requiresConfirmation: proposal.risk === "low" ? proposal.requiresConfirmation === true : true,
        title: truncate(proposal.title, 80),
        detail: truncate(proposal.detail ?? "", 220),
        payload: proposal.payload || {},
        status: "pending"
      }));
    if (dropped.length) {
      merged.notes = [...merged.notes, `已忽略工具层不支持的建议类型：${[...new Set(dropped)].join("、")}`];
    }
    merged.handoffs = (merged.handoffs || []).map((handoff) => ({
      from: this.id,
      to: handoff.to,
      reason: truncate(handoff.reason ?? "", 140),
      payload: handoff.payload || {}
    }));
    merged.constraints = (merged.constraints || [])
      .map((constraint, index) => ({
        id: constraint.id || `${this.id}-constraint-${index + 1}`,
        label: truncate(constraint.label ?? "", 60),
        detail: truncate(constraint.detail ?? "", 200)
      }))
      .filter((constraint) => constraint.label);
    merged.input = { goal: input?.goal || "", reason: input?.reason || null };
    return merged;
  }

  /**
   * 通过 Provider 执行一次推理，返回结构化输出。
   * Agent 只负责产生建议，不直接写入业务状态。
   */
  async execute({ input, context, provider }) {
    this.setStatus("working", input?.reason || input?.goal || "协作任务");
    try {
      const response = await provider.complete({ agent: this, input: input || {}, context: context || {} });
      const output = this.normalize(response.structured, input);
      this.setStatus("idle", output.summary);
      this.lastError = null;
      return { ...response, output };
    } catch (error) {
      this.setStatus("error", `执行失败：${error.message}`);
      this.lastError = error.message;
      throw error;
    }
  }
}
