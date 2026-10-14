import { randomUUID } from "node:crypto";
import { MessageBus } from "./message-bus.mjs";
import { SharedMemory } from "./shared-memory.mjs";
import { describeProvider } from "./providers/index.mjs";
import { loadInstructionFile } from "./definition-loader.mjs";
import { TOOL_FOR_PROPOSAL } from "./tools.mjs";
import { clone, delay, now, truncate, uniqueBy } from "./utils.mjs";

const STRATEGIES = new Set(["auto", "sequential", "parallel"]);
const MAX_AUTO_APPLY = 3;
const MAX_HANDOFF_ROUNDS = 1;
/** 单次运行最多推进到确认队列的建议数，其余标记为 deferred 保留在轨迹里。 */
const MAX_PENDING_CONFIRMATIONS = 3;
/** 确认队列的优先级：数值越小越重要。 */
const PROPOSAL_PRIORITY = {
  reschedule_block: 0,
  update_task: 1,
  delete_task: 2,
  goal_recalibration: 3,
  create_task: 4
};
const proposalRank = (proposal) => PROPOSAL_PRIORITY[proposal.type] ?? 9;

/**
 * 统一确认队列规则：为每条建议补上排序权重；不受支持的动作类型标记为 unsupported；
 * 超出上限的待确认建议标记为 deferred。运行创建时与读取旧轨迹时都调用，
 * 保证历史运行与新运行表现一致，也不会留下必然失败的按钮。
 */
export function queuePendingProposals(proposals = []) {
  const ranked = proposals.map((proposal) => ({ ...proposal, priority: proposal.priority ?? proposalRank(proposal) }));
  const queue = ranked.filter(
    (proposal) => proposal.status === "pending" && Object.prototype.hasOwnProperty.call(TOOL_FOR_PROPOSAL, proposal.type)
  );
  const keep = new Set(
    [...queue]
      .sort((a, b) => a.priority - b.priority)
      .slice(0, MAX_PENDING_CONFIRMATIONS)
      .map((proposal) => proposal.id)
  );
  return ranked.map((proposal) => {
    if (proposal.status !== "pending") return proposal;
    if (!Object.prototype.hasOwnProperty.call(TOOL_FOR_PROPOSAL, proposal.type)) {
      return {
        ...proposal,
        status: "unsupported",
        blockedReason: `工具层不支持的动作类型「${proposal.type}」，无法执行；说明保留在轨迹中，仅作参考。`
      };
    }
    if (!keep.has(proposal.id)) {
      return {
        ...proposal,
        status: "deferred",
        deferredReason: `本轮待确认建议已达 ${MAX_PENDING_CONFIRMATIONS} 条上限，未列入确认队列；如需执行可在轨迹中单独确认。`
      };
    }
    return proposal;
  });
}

const ORCHESTRATOR_INSTRUCTION = loadInstructionFile("orchestrator.md");

/**
 * 兼容旧接口的关键词路由：优先使用 Agent 定义中的 `routing` 关键词。
 * 未匹配时选择声明了 `routingDefault` 的 Agent；无注册表时退回内置关键词。
 */
export function routeCommand(goal, registry) {
  if (registry) {
    const agents = registry.list();
    const matched = agents.find((agent) => (agent.routing || []).some((keyword) => goal.includes(keyword)));
    if (matched) return matched.id;
    const fallback = agents.find((agent) => agent.routingDefault) || agents[agents.length - 1];
    if (fallback) return fallback.id;
  }
  if (/学习|复习|课程|考试|数学|英语|阅读/u.test(goal)) return "atlas";
  if (/睡|运动|饮食|散步|作息|生活/u.test(goal)) return "mira";
  return "nova";
}

function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

export class Orchestrator {
  constructor({ registry, provider, tools, runRepository, repository, stepDelayMs = 0 }) {
    this.registry = registry;
    this.provider = provider;
    this.tools = tools;
    this.runRepository = runRepository;
    this.repository = repository;
    this.stepDelayMs = stepDelayMs;
    this.confirmationQueues = new Map();
  }

  describe() {
    return {
      provider: describeProvider(this.provider),
      orchestrator: {
        id: "orchestrator",
        name: "Orchestrator",
        role: "编排者",
        instruction: ORCHESTRATOR_INSTRUCTION,
        instructionFile: "server/agents/instructions/orchestrator.md",
        capabilities: ["目标拆解", "任务分配", "handoff 调度", "冲突调和", "结果合并", "人工确认"]
      },
      agents: this.registry.describe(),
      capabilities: { handoff: true, sharedMemory: true, confirmation: true, parallel: true, failureIsolation: true },
      runStatuses: ["running", "completed", "failed", "awaiting_confirmation", "partially_confirmed"]
    };
  }

  /** 生成执行计划：拆分目标、选择专业 Agent、决定串行或并行。 */
  plan(goal, { agentIds, strategy = "auto" } = {}) {
    const requested = Array.isArray(agentIds) ? agentIds.filter((id) => this.registry.has(id)) : [];
    const allIds = this.registry.listIds();
    const matched = this.registry
      .list()
      .filter((agent) => (agent.routing || []).some((keyword) => goal.includes(keyword)))
      .map((agent) => agent.id);
    const selected = allIds.filter((id) =>
      (requested.length ? requested : matched.length ? matched : allIds).includes(id)
    );
    // Atlas 的输出会被 Mira / Nova 的检查复用，因此默认串行以携带共享上下文；
    // 无依赖的 Agent 组合默认并行，可用 strategy 显式覆盖。
    const effectiveStrategy = strategy !== "auto"
      ? strategy
      : selected.length > 1 && !selected.includes("atlas")
        ? "parallel"
        : "sequential";
    const planId = `plan-${randomUUID()}`;
    const tasks = selected.map((agentId, index) => {
      const agent = this.registry.get(agentId);
      return {
        id: `${planId}-task-${index + 1}`,
        agentId,
        title: `${agent.name} · ${truncate(goal, 40)}`,
        dependsOn: effectiveStrategy === "sequential" && index > 0 ? [`${planId}-task-${index}`] : []
      };
    });
    return {
      id: planId,
      summary: `Orchestrator 将目标拆为 ${tasks.length} 个子任务，采用${effectiveStrategy === "parallel" ? "并行" : "串行"}协作。`,
      strategy: effectiveStrategy,
      tasks
    };
  }

  /**
   * 创建并启动一次运行。
   * 返回 { run, completion }：run 是初始快照，completion 在运行结束后 resolve 最终轨迹。
   */
  async createRun({ goal, strategy = "auto", agentIds, allowHandoff = true, source = "user" } = {}) {
    const cleanGoal = String(goal || "").trim();
    if (cleanGoal.length < 2 || cleanGoal.length > 500) {
      throw httpError(400, "INVALID_GOAL", "目标需为 2-500 字");
    }
    if (!STRATEGIES.has(strategy)) throw httpError(400, "INVALID_STRATEGY", "协作策略无效");

    const plan = this.plan(cleanGoal, { agentIds, strategy });
    const id = `run-${randomUUID()}`;
    const timestamp = now();
    const run = {
      id,
      goal: cleanGoal,
      source,
      strategy: plan.strategy,
      status: "running",
      provider: describeProvider(this.provider),
      plan,
      calls: [],
      messages: [],
      confirmations: [],
      memory: { runId: id, goal: cleanGoal, facts: [], constraints: [], conflicts: [] },
      conflicts: [],
      applied: [],
      proposals: [],
      result: null,
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      finishedAt: null
    };

    const session = {
      bus: new MessageBus({ runId: id, sink: (message) => run.messages.push(message) }),
      memory: new SharedMemory({ runId: id })
    };
    session.memory.goal = cleanGoal;

    await this.persist(run);
    const completion = this.#execute(run, session, { allowHandoff }).catch((error) => {
      run.status = "failed";
      run.error = { code: error.code || "RUN_FAILED", message: error.message };
      run.finishedAt = now();
      run.updatedAt = now();
      return run;
    });
    return { run: clone(run), completion };
  }

  async #execute(run, session, { allowHandoff }) {
    const startedAt = Date.now();
    try {
      const state = await this.tools.readState();
      const context = { state, runId: run.id, goal: run.goal };
      session.memory.set("goal", run.goal, "user");
      session.memory.set(
        "userState",
        { tasks: state.tasks?.length || 0, habits: state.habits?.length || 0, reviews: state.reviews?.length || 0 },
        "tools"
      );
      session.bus.publish({ from: "user", to: "orchestrator", type: "goal", summary: `收到目标：${truncate(run.goal, 80)}` });
      session.bus.publish({ from: "orchestrator", to: "*", type: "plan", summary: run.plan.summary, payload: { strategy: run.plan.strategy } });

      const firstRound = await this.#runBatch(run, session, context, run.plan.tasks, { allowHandoff });
      if (allowHandoff) await this.#runHandoffs(run, session, context, firstRound);
      await this.#finalize(run, session, startedAt);
    } catch (error) {
      run.status = "failed";
      run.error = { code: error.code || "RUN_FAILED", message: error.message };
      run.finishedAt = now();
      run.updatedAt = now();
      session.bus.publish({ from: "orchestrator", to: "user", type: "error", summary: `运行失败：${error.message}` });
      await this.persist(run);
    }
    await this.#syncAgents(run);
    return run;
  }

  async #runBatch(run, session, context, tasks, defaults = {}) {
    const base = run.calls.length;
    const prepared = tasks.map((task, index) => ({
      allowHandoff: defaults.allowHandoff !== false,
      viaHandoff: false,
      fromAgent: null,
      ...task,
      order: base + index + 1
    }));
    const execute = (task) => this.#runCall(run, session, context, task);
    let results;
    if (run.strategy === "parallel" && prepared.length > 1) {
      results = await Promise.all(prepared.map(execute));
    } else {
      results = [];
      for (const task of prepared) results.push(await execute(task));
    }
    return results.flatMap((result) => result.handoffs || []);
  }

  async #runCall(run, session, context, task) {
    const agent = this.registry.get(task.agentId);
    const call = {
      id: `${run.id}-call-${task.order}`,
      order: task.order,
      agentId: task.agentId,
      agentName: agent.name,
      title: truncate(task.reason || task.title || run.goal, 60),
      viaHandoff: task.viaHandoff ? { from: task.fromAgent, reason: truncate(task.reason || "", 120) } : null,
      status: "running",
      input: {
        goal: run.goal,
        reason: task.reason || null,
        handoff: task.handoff || null,
        allowHandoff: task.allowHandoff !== false
      },
      output: null,
      error: null,
      provider: null,
      degraded: false,
      degradationReason: null,
      startedAt: now(),
      finishedAt: null,
      durationMs: null
    };
    run.calls.push(call);
    await this.persist(run);
    agent.setStatus("working", call.title);
    this.#syncAgentState(task.agentId, "working", call.title);
    session.bus.publish({
      from: "orchestrator",
      to: task.agentId,
      type: task.viaHandoff ? "handoff" : "task",
      summary: task.viaHandoff
        ? `${task.fromAgent} 交接给 ${agent.name}：${call.title}`
        : `派发任务给 ${agent.name}：${call.title}`,
      payload: call.input
    });

    const callStartedAt = Date.now();
    await delay(this.stepDelayMs);
    try {
      const response = await agent.execute({ input: call.input, context: { ...context, memory: session.memory.snapshot() }, provider: this.provider });
      call.status = "completed";
      call.output = response.output;
      call.provider = response.provider;
      call.degraded = Boolean(response.degraded);
      call.degradationReason = response.degraded ? response.reason || null : null;
      call.finishedAt = now();
      call.durationMs = Date.now() - callStartedAt;
      session.memory.set(`agent.${task.agentId}.summary`, response.output.summary, task.agentId);
      if (response.output.metrics) session.memory.set(`agent.${task.agentId}.metrics`, response.output.metrics, task.agentId);
      for (const constraint of response.output.constraints || []) {
        session.memory.addConstraint({ ...constraint, agentId: task.agentId });
        session.bus.publish({ from: task.agentId, to: "*", type: "constraint", summary: `声明约束：${constraint.label}` });
      }
      session.bus.publish({ from: task.agentId, to: "orchestrator", type: "result", summary: response.output.summary });
      const handoffs = [];
      for (const handoff of response.output.handoffs) {
        if (!this.registry.has(handoff.to)) continue;
        session.memory.set(`handoff.${task.agentId}->${handoff.to}`, handoff.reason, task.agentId);
        session.bus.publish({ from: task.agentId, to: handoff.to, type: "handoff-request", summary: handoff.reason });
        handoffs.push(handoff);
      }
      return { call, handoffs };
    } catch (error) {
      // 失败隔离：单个 Agent 异常不会中断整次运行。
      call.status = "failed";
      call.error = error.message;
      call.finishedAt = now();
      call.durationMs = Date.now() - callStartedAt;
      session.memory.set(`error.${task.agentId}`, { message: error.message, at: now() }, "orchestrator");
      session.bus.publish({ from: task.agentId, to: "orchestrator", type: "error", summary: `执行失败：${error.message}` });
      return { call, handoffs: [] };
    } finally {
      await this.persist(run);
    }
  }

  async #runHandoffs(run, session, context, handoffs) {
    // 已经参与过本轮计划的 Agent 不再重复调用，handoff 只用于补齐缺失的专业视角。
    const called = new Set(run.calls.map((call) => call.agentId));
    let round = 0;
    let pending = uniqueBy(
      handoffs.filter((handoff) => !called.has(handoff.to)),
      (handoff) => handoff.to
    );
    while (pending.length && round < MAX_HANDOFF_ROUNDS) {
      round += 1;
      const current = pending;
      pending = [];
      const tasks = current.map((handoff) => ({
        agentId: handoff.to,
        reason: handoff.reason,
        handoff: { from: handoff.from, reason: handoff.reason, payload: handoff.payload },
        viaHandoff: true,
        fromAgent: handoff.from,
        allowHandoff: false
      }));
      await this.#runBatch(run, session, context, tasks, { allowHandoff: false });
    }
  }

  #detectConflicts(run, outputs) {
    const conflicts = [];
    const atlas = outputs.get("atlas");
    const mira = outputs.get("mira");
    if (atlas && mira && mira.metrics?.overload) {
      conflicts.push({
        id: `${run.id}-conflict-1`,
        agents: ["atlas", "mira"],
        topic: "学习时长与作息边界",
        detail: `Atlas 计划新增约 ${atlas.metrics?.estimatedMinutes || 0} 分钟学习，Mira 判断当日负载 ${mira.metrics?.loadMinutes || 0} 分钟偏高${mira.metrics?.sleepReady === false ? "，且早睡尚未完成" : ""}。`,
        resolution: "以睡眠与可持续节奏优先：压缩 1 个学习轮次，把剩余内容顺延到第 2 天。"
      });
    }
    return conflicts;
  }

  async #finalize(run, session, startedAt) {
    const outputs = new Map();
    for (const call of run.calls) {
      if (call.output && !outputs.has(call.agentId)) outputs.set(call.agentId, call.output);
    }

    run.conflicts = this.#detectConflicts(run, outputs);
    for (const conflict of run.conflicts) session.memory.addConflict(conflict);

    run.proposals = [];
    run.applied = [];
    let autoApplied = 0;
    const autoAppliedByAgent = new Map();
    for (const [agentId, output] of outputs) {
      const agent = this.registry.get(agentId);
      for (const proposal of output.proposals) {
        const record = clone(proposal);
        record.priority = proposalRank(proposal);
        const permission = agent?.permissionFor(TOOL_FOR_PROPOSAL[proposal.type]);
        const highImpact = proposal.type !== "create_task" || permission?.risk === "high";
        if (highImpact) record.risk = "high";
        const requiresConfirmation = highImpact || proposal.requiresConfirmation || permission?.requiresConfirmation;
        const maxPerRun = permission && typeof permission === "object" ? Number(permission.maxPerRun) || Infinity : Infinity;
        const usedByAgent = autoAppliedByAgent.get(agentId) || 0;
        if (!requiresConfirmation && proposal.risk === "low" && autoApplied < MAX_AUTO_APPLY && usedByAgent < maxPerRun) {
          const applied = await this.tools.applyProposal({ proposal, agent });
          if (applied.ok) {
            record.status = "applied";
            autoApplied += 1;
            autoAppliedByAgent.set(agentId, usedByAgent + 1);
            run.applied.push({
              id: proposal.id,
              agentId,
              type: proposal.type,
              effect: applied.effect,
              summary: applied.summary,
              targetId: applied.targetId,
              appliedAt: now()
            });
          } else {
            record.status = "pending";
            record.requiresConfirmation = true;
            record.detail = truncate(`${record.detail}（${applied.reason}）`, 220);
          }
        } else {
          record.status = "pending";
          record.requiresConfirmation = true;
        }
        run.proposals.push(record);
      }
    }

    const recommendations = [];
    for (const conflict of run.conflicts) {
      recommendations.push({ title: conflict.resolution, detail: conflict.detail, source: "Orchestrator", agentId: null });
    }
    const buckets = [...outputs.entries()].map(([agentId, output]) => ({
      agentId,
      source: output.agentName,
      steps: clone(output.steps)
    }));
    let cursor = 0;
    let guard = 0;
    while (recommendations.length < 3 && buckets.some((bucket) => bucket.steps.length) && guard < 24) {
      guard += 1;
      const bucket = buckets[cursor % Math.max(buckets.length, 1)];
      cursor += 1;
      const step = bucket?.steps.shift();
      if (step) recommendations.push({ title: step.title, detail: step.detail, source: bucket.source, agentId: bucket.agentId });
    }

    const failedCalls = run.calls.filter((call) => call.status === "failed");
    // 控制确认数量：只把优先级最高的若干条推进确认队列，其余保留在轨迹里等待单独处理。
    run.proposals = queuePendingProposals(run.proposals);
    const deferred = run.proposals.filter((proposal) => proposal.status === "deferred").length;
    const pending = run.proposals.filter((proposal) => proposal.status === "pending").length;
    const providerDegraded = run.calls.some((call) => call.degraded);
    if (providerDegraded) {
      const reasons = [...new Set(run.calls.filter((call) => call.degraded).map((call) => call.degradationReason).filter(Boolean))];
      run.provider = { ...run.provider, used: "rules", degraded: true, reason: reasons.join("；") || run.provider.reason };
    }

    const summaryParts = [`Orchestrator 调用 ${outputs.size} 个 Agent`];
    if (run.conflicts.length) summaryParts.push(`调和 ${run.conflicts.length} 处冲突`);
    if (pending) summaryParts.push(`${pending} 项高影响调整等待你确认`);
    else summaryParts.push("方案可直接执行");
    if (failedCalls.length) summaryParts.push(`${failedCalls.length} 个 Agent 失败已隔离`);
    if (providerDegraded) summaryParts.push(`已降级到 ${run.provider.used}`);

    run.memory = session.memory.snapshot();
    run.result = {
      summary: `${summaryParts.join("，")}。`,
      recommendations: recommendations.slice(0, 3),
      notes: [
        ...failedCalls.map((call) => `${call.agentName} 未返回结果：${call.error}`),
        deferred ? `另有 ${deferred} 条较低优先级建议未列入确认队列，可在轨迹中单独执行。` : null,
        providerDegraded ? `模型降级原因：${run.provider.reason}` : null
      ].filter(Boolean),
      durationMs: Date.now() - startedAt
    };

    if (outputs.size === 0) {
      run.status = "failed";
      run.error = { code: "ALL_AGENTS_FAILED", message: "所有 Agent 均执行失败" };
    } else if (pending) {
      run.status = "awaiting_confirmation";
    } else {
      run.status = "completed";
    }
    run.finishedAt = now();
    run.updatedAt = now();
    session.bus.publish({ from: "orchestrator", to: "user", type: "result", summary: run.result.summary });
    await this.persist(run);
  }

  /** 兼容旧接口：单 Agent 派发，返回旧的响应形状。 */
  async dispatchLegacy({ command, agentId = "auto" }) {
    const target = agentId === "auto" ? routeCommand(command, this.registry) : agentId;
    if (!this.registry.has(target)) throw httpError(404, "AGENT_NOT_FOUND", "没有找到该 Agent");
    const { completion } = await this.createRun({ goal: command, agentIds: [target], strategy: "sequential", allowHandoff: false, source: "legacy-dispatch" });
    const run = await completion;
    const call = run.calls.find((item) => item.agentId === target && item.output);
    const steps = call ? call.output.steps.map((step) => step.title) : [];
    while (steps.length < 3) steps.push("明确下一步的最小行动");
    return {
      id: run.id,
      runId: run.id,
      agentId: target,
      agentName: this.registry.get(target).name,
      status: run.status === "failed" ? "failed" : "completed",
      summary: call?.output?.summary || "已整理下一步行动",
      steps: steps.slice(0, 3),
      createdAt: run.createdAt
    };
  }

  /** 用户确认高影响操作。 */
  async confirmRun(runId, decisions = []) {
    if (!Array.isArray(decisions) || !decisions.length || decisions.some((item) =>
      !item || typeof item.proposalId !== "string" || !item.proposalId.trim() || !["approve", "reject"].includes(item.decision)
    ) || new Set(decisions.map((item) => item.proposalId)).size !== decisions.length) {
      throw httpError(400, "INVALID_DECISION", "每个确认项必须包含唯一 proposalId 和明确的 approve / reject 决定");
    }
    // 同一运行的确认按顺序读取最新轨迹，避免双击或并发请求重复执行。
    const previous = this.confirmationQueues.get(runId) || Promise.resolve();
    const operation = previous.catch(() => {}).then(() => this.#confirmRun(runId, decisions));
    this.confirmationQueues.set(runId, operation);
    try {
      return await operation;
    } finally {
      if (this.confirmationQueues.get(runId) === operation) this.confirmationQueues.delete(runId);
    }
  }

  async #confirmRun(runId, decisions) {
    const run = await this.runRepository.get(runId);
    if (!run) throw httpError(404, "RUN_NOT_FOUND", "没有找到该运行记录");
    const pendingProposals = run.proposals.filter((proposal) => proposal.status === "pending" || proposal.status === "deferred");
    if (!pendingProposals.length) throw httpError(409, "RUN_NOT_PENDING", "该运行没有待确认事项");
    const decisionMap = new Map(decisions.map((item) => [item.proposalId, item.decision]));
    const matched = pendingProposals.filter((proposal) => decisionMap.has(proposal.id));
    if (!matched.length) throw httpError(400, "INVALID_DECISION", "没有匹配到任何待确认事项");
    // 在改动任何状态之前先校验：工具层不支持的动作类型不允许进入执行流程，
    // 避免用户点了「确认执行」才发现必然失败。
    const unsupported = matched.filter((proposal) => !Object.prototype.hasOwnProperty.call(TOOL_FOR_PROPOSAL, proposal.type));
    if (unsupported.length) {
      throw httpError(
        400,
        "PROPOSAL_NOT_ACTIONABLE",
        `以下建议的动作类型不受支持，无法执行：${unsupported.map((proposal) => proposal.type).join("、")}。请改为在轨迹中查看说明。`
      );
    }

    run.confirmations = run.confirmations || [];
    for (const proposal of matched) {
      const decision = decisionMap.get(proposal.id);
      const agent = this.registry.get(proposal.agentId);
      if (decision === "approve") {
        const applied = await this.tools.applyProposal({ proposal, agent });
        proposal.status = applied.ok ? "applied" : "failed";
        if (applied.ok) {
          run.applied.push({
            id: proposal.id,
            agentId: proposal.agentId,
            type: proposal.type,
            effect: applied.effect,
            summary: applied.summary,
            targetId: applied.targetId,
            appliedAt: now(),
            confirmed: true
          });
        } else {
          proposal.detail = truncate(`${proposal.detail}（执行失败：${applied.reason}）`, 220);
        }
      } else {
        proposal.status = "rejected";
      }
      run.confirmations.push({ proposalId: proposal.id, decision, at: now() });
    }

    const remaining = run.proposals.filter((proposal) => proposal.status === "pending").length;
    const rejected = run.proposals.some((proposal) => proposal.status === "rejected");
    const failed = run.proposals.some((proposal) => proposal.status === "failed");
    if (remaining) run.status = "awaiting_confirmation";
    else if (failed) run.status = "failed";
    else run.status = rejected ? "partially_confirmed" : "completed";
    run.updatedAt = now();
    if (run.messages) {
      run.messages.push({
        id: `msg-${randomUUID()}`,
        runId: run.id,
        at: now(),
        from: "user",
        to: "orchestrator",
        type: "confirmation",
        summary: `用户处理了 ${matched.length} 项高影响建议`,
        payload: matched.map((proposal) => ({ proposalId: proposal.id, decision: decisionMap.get(proposal.id) }))
      });
    }
    await this.runRepository.save(run);
    return run;
  }

  async persist(run) {
    run.updatedAt = now();
    return this.runRepository.save(run);
  }

  #syncAgentState(agentId, status, currentTask) {
    this.repository
      .update((state) => {
        const agent = (state.agents || []).find((item) => item.id === agentId);
        if (agent) {
          agent.status = status;
          agent.currentTask = truncate(currentTask, 50);
        }
        return agent || null;
      })
      .catch(() => {});
  }

  async #syncAgents(run) {
    for (const agent of this.registry.list()) {
      if (agent.status === "working") agent.setStatus("idle");
    }
    const lastSummaries = new Map();
    for (const call of run.calls) {
      if (call.output) lastSummaries.set(call.agentId, call.output.summary);
    }
    try {
      await this.repository.update((state) => {
        for (const agent of state.agents || []) {
          if (lastSummaries.has(agent.id)) {
            agent.status = "ready";
            agent.currentTask = truncate(lastSummaries.get(agent.id), 50);
          }
        }
        return true;
      });
    } catch {
      // 状态同步失败不应影响运行结果。
    }
  }
}
