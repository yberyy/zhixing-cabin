import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createApp } from "../server/app.mjs";
import { MemoryRepository, seedState } from "../server/repository.mjs";
import {
  AgentRegistry,
  AtlasAgent,
  BaseAgent,
  MemoryRunRepository,
  MiraAgent,
  NovaAgent,
  createAgentSystem
} from "../server/agents/index.mjs";
import { JsonRunRepository } from "../server/agents/index.mjs";
import { toChatMessages } from "../server/agents/providers/remote-providers.mjs";
import { resolveProvider } from "../server/agents/providers/index.mjs";

function makeSystem({ registry, env, repository } = {}) {
  const repo = repository || new MemoryRepository(seedState);
  const runRepository = new MemoryRunRepository();
  const system = createAgentSystem({ repository: repo, runRepository, registry, env: env || { AI_PROVIDER: "rules" } });
  return { system, repository: repo, runRepository };
}

async function runToCompletion(system, options) {
  const { completion } = await system.orchestrator.createRun(options);
  return completion;
}

test("registry exposes independent config, instructions, tools, protocol and status", () => {
  const registry = AgentRegistry.createDefault();
  const agents = registry.describe();
  assert.deepEqual(agents.map((agent) => agent.id), ["atlas", "mira", "nova"]);
  for (const agent of agents) {
    assert.ok(agent.instruction.length > 20, `${agent.id} 需要独立指令`);
    assert.ok(Object.keys(agent.tools).length > 0, `${agent.id} 需要工具权限`);
    assert.ok(agent.protocol.input.length > 0 && agent.protocol.output.length > 0, `${agent.id} 需要输入输出协议`);
    assert.equal(agent.status, "idle");
  }
  assert.equal(registry.get("atlas").allows("tasks:create"), true);
  assert.equal(registry.get("atlas").allows("goals:recalibrate"), false);
  assert.equal(registry.get("nova").allows("goals:recalibrate"), true);
});

test("executes a single agent and returns the standard output protocol", async () => {
  const { system, repository } = makeSystem();
  const run = await runToCompletion(system, { goal: "帮我拆解明天的数学复习计划", agentIds: ["atlas"], allowHandoff: false });
  assert.equal(run.status, "completed");
  assert.equal(run.calls.length, 1);
  const [call] = run.calls;
  assert.equal(call.agentId, "atlas");
  assert.equal(call.status, "completed");
  assert.equal(call.output.agentId, "atlas");
  assert.equal(call.output.steps.length, 3);
  assert.equal(typeof call.durationMs, "number");
  assert.equal(call.provider, "rules");
  // 低风险新增任务被自动写入任务流
  assert.ok(run.applied.length >= 1);
  const state = await repository.getState();
  assert.ok(state.tasks.some((task) => task.origin === "atlas-proposal-1"));
});

test("orchestrates multiple agents and merges sourced recommendations", async () => {
  const { system } = makeSystem();
  const run = await runToCompletion(system, { goal: "帮我安排明天的数学复习和作息节奏" });
  assert.equal(run.strategy, "sequential");
  assert.deepEqual([...new Set(run.calls.map((call) => call.agentId))].sort(), ["atlas", "mira", "nova"]);
  assert.ok(run.plan.tasks.length >= 2);
  assert.ok(run.result.recommendations.length <= 3);
  for (const recommendation of run.result.recommendations) {
    assert.ok(recommendation.source, "合并结果必须标注来源");
  }
  assert.ok(run.result.recommendations.some((item) => item.source === "Orchestrator"));
});

test("handoff carries shared context into a specialist agent", async () => {
  const { system } = makeSystem();
  const run = await runToCompletion(system, { goal: "帮我拆解明天的数学复习计划" });
  const handoffCall = run.calls.find((call) => call.viaHandoff);
  assert.ok(handoffCall, "应当产生一次 handoff 调用");
  assert.equal(handoffCall.agentId, "mira");
  assert.equal(handoffCall.viaHandoff.from, "atlas");
  assert.ok(run.memory.facts.some((fact) => fact.key === "handoff.atlas->mira"));
  assert.ok(run.memory.facts.some((fact) => fact.key === "agent.atlas.metrics"));
  assert.ok(run.messages.some((message) => message.type === "handoff"));
});

test("shared memory records goal, facts and conflicts", async () => {
  const { system } = makeSystem();
  const goal = "帮我安排明天的数学复习和作息节奏";
  const run = await runToCompletion(system, { goal });
  assert.equal(run.memory.goal, goal);
  assert.equal(run.memory.facts.find((fact) => fact.key === "goal").value, goal);
  const miraMetrics = run.memory.facts.find((fact) => fact.key === "agent.mira.metrics");
  assert.ok(miraMetrics, "Mira 的指标应进入共享上下文");
  assert.ok(miraMetrics.value.loadMinutes > 150, "Mira 应读到 Atlas 沉淀的时长估算");
  assert.equal(run.conflicts.length, 1);
  assert.equal(run.memory.conflicts.length, 1);
  assert.deepEqual(run.conflicts[0].agents, ["atlas", "mira"]);
  assert.ok(run.memory.constraints.length >= 1, "Mira 应声明作息约束");
  assert.ok(run.memory.constraints.some((item) => item.label.includes("23:30") && item.agentId === "mira"));
  assert.ok(run.messages.some((message) => message.type === "constraint"));
});

test("remote providers receive the shared run context", () => {
  const messages = toChatMessages(
    { instruction: "测试指令" },
    { goal: "安排数学复习", reason: "检查负载" },
    {
      state: { tasks: [], habits: [], reviews: [] },
      memory: {
        goal: "安排数学复习",
        facts: [{ key: "agent.atlas.metrics", value: { estimatedMinutes: 120 }, source: "atlas", history: [] }],
        constraints: [{ label: "23:30 前入睡", agentId: "mira" }],
        conflicts: []
      }
    }
  );
  const payload = messages[1].content;
  assert.match(payload, /agent\.atlas\.metrics/);
  assert.match(payload, /estimatedMinutes/);
  assert.match(payload, /23:30 前入睡/);
  assert.doesNotMatch(payload, /history/);
});

test("isolates a failing agent without aborting the run", async () => {
  class BrokenAtlas extends BaseAgent {
    constructor() {
      super({
        id: "atlas",
        name: "Atlas",
        role: "学习教练",
        accent: "blue",
        initial: "A",
        capabilities: [],
        tools: { "state:read": "allow" },
        protocol: { input: [], output: [] },
        routing: ["学习", "复习", "数学"],
        instruction: "用于测试的故障 Agent"
      });
    }

    rules() {
      throw new Error("模拟推理崩溃");
    }
  }
  const registry = new AgentRegistry([new BrokenAtlas(), new MiraAgent(), new NovaAgent()]);
  const { system } = makeSystem({ registry });
  const run = await runToCompletion(system, { goal: "帮我安排数学复习和作息节奏" });
  const failed = run.calls.find((call) => call.agentId === "atlas");
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /模拟推理崩溃/);
  assert.ok(run.calls.some((call) => call.status === "completed"), "其余 Agent 应继续完成");
  assert.notEqual(run.status, "failed");
  assert.ok(run.memory.facts.some((fact) => fact.key === "error.atlas"));
});

test("marks a run failed only when every agent fails", async () => {
  class Broken extends BaseAgent {
    constructor(id, name) {
      super({ id, name, role: "测试", accent: "blue", initial: "X", capabilities: [], tools: { "state:read": "allow" }, protocol: { input: [], output: [] }, instruction: "故障 Agent" });
    }
    rules() {
      throw new Error("必然失败");
    }
  }
  const registry = new AgentRegistry([new Broken("atlas", "Atlas"), new Broken("mira", "Mira"), new Broken("nova", "Nova")]);
  const { system } = makeSystem({ registry });
  const run = await runToCompletion(system, { goal: "帮我安排数学复习和作息节奏" });
  assert.equal(run.status, "failed");
  assert.equal(run.error.code, "ALL_AGENTS_FAILED");
});

test("waits for confirmation on high-impact proposals and applies approved ones", async () => {
  const { system, repository } = makeSystem();
  const run = await runToCompletion(system, { goal: "帮我安排明天的数学复习和作息节奏" });
  assert.equal(run.status, "awaiting_confirmation");
  const pending = run.proposals.filter((proposal) => proposal.status === "pending");
  assert.ok(pending.length >= 1);
  assert.ok(pending.every((proposal) => proposal.requiresConfirmation));
  const trim = pending.find((proposal) => proposal.type === "reschedule_block");
  assert.ok(trim, "Mira 应提出可定位到具体任务的调整");
  assert.ok(trim.payload.targetTaskId, "调整必须带真实目标，而不是只生成一条新任务");

  const before = (await repository.getState()).tasks.find((task) => task.id === trim.payload.targetTaskId);
  assert.ok(before, "调整目标必须存在于任务流");
  const confirmations = pending.map((proposal) => ({
    proposalId: proposal.id,
    decision: proposal.id === trim.id ? "approve" : "reject"
  }));
  const confirmed = await system.orchestrator.confirmRun(run.id, confirmations);
  assert.equal(confirmed.proposals.find((proposal) => proposal.id === trim.id).status, "applied");
  const after = (await repository.getState()).tasks.find((task) => task.id === trim.payload.targetTaskId);
  assert.notEqual(after.duration, before.duration, "批准的调整必须真正修改任务");
  assert.equal(after.duration, trim.payload.changes.duration);
  assert.ok(confirmed.applied.some((item) => item.id === trim.id && item.confirmed && item.effect === "updated_task"));
  assert.equal(confirmed.status, "partially_confirmed");

  const persisted = await system.runRepository.get(run.id);
  assert.equal(persisted.confirmations.length, confirmations.length);
});

test("never auto-applies high-impact tools or proposals requesting confirmation", async () => {
  class MislabelledMira extends MiraAgent {
    rules() {
      return {
        proposals: [
          { type: "delete_task", risk: "low", title: "归档任务", payload: { targetTaskId: "task-1" } },
          { type: "reschedule_block", risk: "low", title: "调整时长", payload: { targetTaskId: "task-2", changes: { duration: "10 分钟" } } },
          { type: "create_task", risk: "low", requiresConfirmation: true, title: "先确认再新增", payload: { title: "先确认再新增" } }
        ]
      };
    }
  }
  const { system, repository } = makeSystem({ registry: new AgentRegistry([new MislabelledMira()]) });
  const before = await repository.getState();
  const run = await runToCompletion(system, { goal: "检查日程", agentIds: ["mira"], allowHandoff: false });
  assert.equal(run.status, "awaiting_confirmation");
  assert.equal(run.applied.length, 0);
  assert.ok(run.proposals.every((proposal) => proposal.status === "pending" && proposal.requiresConfirmation));
  assert.equal(run.proposals[0].risk, "high");
  assert.deepEqual((await repository.getState()).tasks, before.tasks);
});

test("rejects malformed decisions without changing a pending run", async () => {
  const { system, repository } = makeSystem();
  const run = await runToCompletion(system, { goal: "帮我安排明天的数学复习和作息节奏" });
  const proposal = run.proposals.find((item) => item.status === "pending");
  const before = await repository.getState();
  for (const decisions of [
    [{ proposalId: proposal.id }],
    [{ proposalId: proposal.id, decision: "aproove" }],
    [{ proposalId: proposal.id, decision: "approve" }, null],
    [{ proposalId: proposal.id, decision: "approve" }, { proposalId: proposal.id, decision: "reject" }]
  ]) {
    await assert.rejects(() => system.orchestrator.confirmRun(run.id, decisions), (error) => error.code === "INVALID_DECISION");
  }
  assert.equal((await system.runRepository.get(run.id)).confirmations.length, 0);
  assert.deepEqual((await repository.getState()).tasks, before.tasks);
});

test("serializes duplicate confirmations so a proposal executes only once", async () => {
  const { system, repository } = makeSystem();
  const run = await runToCompletion(system, { goal: "帮我安排明天的数学复习和作息节奏" });
  const proposal = run.proposals.find((item) => item.status === "pending" && item.type === "goal_recalibration");
  assert.ok(proposal);
  const countBefore = (await repository.getState()).tasks.length;
  const decisions = [{ proposalId: proposal.id, decision: "approve" }];
  const results = await Promise.allSettled([
    system.orchestrator.confirmRun(run.id, decisions),
    system.orchestrator.confirmRun(run.id, decisions)
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await repository.getState()).tasks.length, countBefore + 1);
  const stored = await system.runRepository.get(run.id);
  assert.equal(stored.confirmations.filter((item) => item.proposalId === proposal.id).length, 1);
});

test("marks the run failed when a confirmed action cannot be applied", async () => {
  const { system } = makeSystem();
  const run = await runToCompletion(system, { goal: "帮我安排明天的数学复习和作息节奏" });
  const proposal = run.proposals.find((item) => item.type === "reschedule_block");
  assert.ok(proposal);
  proposal.payload.targetTaskId = "task-missing";
  await system.runRepository.save(run);

  const decisions = run.proposals
    .filter((item) => item.status === "pending")
    .map((item) => ({ proposalId: item.id, decision: item.id === proposal.id ? "approve" : "reject" }));
  const confirmed = await system.orchestrator.confirmRun(run.id, decisions);
  const failed = confirmed.proposals.find((item) => item.id === proposal.id);
  assert.equal(failed.status, "failed");
  assert.match(failed.detail, /执行失败/);
  assert.equal(confirmed.status, "failed");
});

test("archives duplicate agent tasks as a restorable soft delete after confirmation", async () => {
  const { system, repository } = makeSystem();
  // 显式构造「用户任务 + 同名 Agent 任务」，不依赖「重复新增」这一已被移除的行为。
  await repository.update((state) => {
    state.tasks.unshift({
      id: "task-agent-dup",
      title: "晚饭后散步 30 分钟",
      category: "生活",
      duration: "30 分钟",
      assignee: "mira",
      status: "todo",
      createdAt: "2026-10-14T08:00:00.000Z",
      source: "agent",
      agentId: "mira",
      origin: "mira-proposal-1"
    });
    return true;
  });

  const run = await runToCompletion(system, { goal: "帮我安排明天的数学复习和作息节奏" });
  const proposal = run.proposals.find((item) => item.type === "delete_task");
  assert.ok(proposal, "应识别同名重复任务");
  assert.equal(proposal.payload.targetTaskId, "task-agent-dup", "只归档 Agent 创建的那条");
  assert.equal(proposal.status, "pending", "归档属于高影响操作，必须等待确认");
  assert.equal(proposal.risk, "high");
  const targetId = proposal.payload.targetTaskId;

  const confirmed = await system.orchestrator.confirmRun(run.id, [{ proposalId: proposal.id, decision: "approve" }]);
  assert.ok(confirmed.applied.some((item) => item.id === proposal.id && item.effect === "archived_task"));
  const state = await repository.getState();
  const archived = state.tasks.find((task) => task.id === targetId);
  assert.ok(archived.archivedAt, "归档是软删除，数据仍然保留");
  assert.equal(archived.archivedBy, "mira");
  const visible = await system.tools.readState();
  assert.equal(visible.tasks.some((task) => task.id === targetId), false, "Agent 不应再看到已归档任务");
  assert.ok(state.tasks.some((task) => task.id === "task-3" && !task.archivedAt), "用户手工任务不得被归档");
});

test("does not recreate the walk task when an unfinished one already exists", async () => {
  const { system, repository } = makeSystem();
  const before = (await repository.getState()).tasks.filter((task) => task.title === "晚饭后散步 30 分钟").length;
  const run = await runToCompletion(system, { goal: "帮我安排明天的数学复习和作息节奏" });
  const after = (await repository.getState()).tasks.filter((task) => task.title === "晚饭后散步 30 分钟").length;
  assert.equal(after, before, "已有同名未完成任务时不得重复新增");
  assert.equal(run.proposals.some((item) => item.type === "delete_task"), false, "自己刚建议的任务不应立刻被归档");
});

test("guards updates and archives by agent permission and target existence", async () => {
  const { system } = makeSystem();
  const state = await system.tools.readState();
  const targetId = state.tasks[0].id;

  const denied = await system.tools.applyProposal({
    proposal: { id: "p-deny", type: "delete_task", agentId: "atlas", payload: { targetTaskId: targetId } },
    agent: system.registry.get("atlas")
  });
  assert.equal(denied.ok, false);
  assert.match(denied.reason, /没有执行 tasks:archive 的权限/);

  const missing = await system.tools.applyProposal({
    proposal: { id: "p-missing", type: "update_task", agentId: "atlas", payload: { targetTaskId: "task-missing", changes: { duration: "10 分钟" } } },
    agent: system.registry.get("atlas")
  });
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /没有找到可修改的任务/);

  const noChanges = await system.tools.applyProposal({
    proposal: { id: "p-empty", type: "update_task", agentId: "atlas", payload: { targetTaskId: targetId, changes: { duration: "x".repeat(30) } } },
    agent: system.registry.get("atlas")
  });
  assert.equal(noChanges.ok, false);
  assert.match(noChanges.reason, /没有可用的修改字段/);
});

test("rejects confirmations for runs with nothing pending", async () => {
  const { system } = makeSystem();
  const run = await runToCompletion(system, { goal: "帮我拆解数学复习计划", agentIds: ["atlas"], allowHandoff: false });
  await assert.rejects(
    () => system.orchestrator.confirmRun(run.id, [{ proposalId: "atlas-proposal-1", decision: "approve" }]),
    (error) => error.code === "RUN_NOT_PENDING"
  );
  await assert.rejects(
    () => system.orchestrator.confirmRun("run-missing", [{ proposalId: "x", decision: "approve" }]),
    (error) => error.code === "RUN_NOT_FOUND"
  );
});

test("persists run traces through the JSON repository", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zhixing-runs-"));
  try {
    const filePath = join(dir, "runs.json");
    const runRepository = new JsonRunRepository(filePath);
    const repository = new MemoryRepository(seedState);
    const system = createAgentSystem({ repository, runRepository, env: { AI_PROVIDER: "rules" } });
    const run = await runToCompletion(system, { goal: "帮我拆解数学复习计划", agentIds: ["atlas"], allowHandoff: false });

    const reloaded = new JsonRunRepository(filePath);
    const stored = await reloaded.get(run.id);
    assert.ok(stored, "运行轨迹应能从磁盘恢复");
    assert.equal(stored.goal, run.goal);
    assert.equal(stored.calls.length, 1);
    const list = await reloaded.list({ limit: 10 });
    assert.equal(list.length, 1);
    assert.equal(list[0].id, run.id);
    const summary = await reloaded.summary();
    assert.equal(summary.total, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("lists runs newest first for the latest-run view", async () => {
  const runRepository = new MemoryRunRepository();
  const repository = new MemoryRepository(seedState);
  const system = createAgentSystem({ repository, runRepository, env: { AI_PROVIDER: "rules" } });
  const first = await runToCompletion(system, { goal: "帮我拆解数学复习计划", agentIds: ["atlas"], allowHandoff: false });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await runToCompletion(system, { goal: "复盘一下本周目标", agentIds: ["nova"], allowHandoff: false });
  const list = await system.runRepository.list({ limit: 10 });
  assert.equal(list.length, 2);
  assert.equal(list[0].id, second.id, "最近一次运行必须排在最前，前端据此自动打开");
  assert.equal(list[1].id, first.id);
  assert.ok(list[0].createdAt >= list[1].createdAt);
});

test("degrades to the rules provider when a model provider is requested without config", async () => {
  const { system } = makeSystem({ env: { AI_PROVIDER: "openai" } });
  const described = system.describe().provider;
  assert.equal(described.requested, "openai");
  assert.equal(described.used, "rules");
  assert.equal(described.degraded, true);
  assert.match(described.reason, /OPENAI_API_KEY/);

  const run = await runToCompletion(system, { goal: "帮我拆解数学复习计划", agentIds: ["atlas"], allowHandoff: false });
  assert.equal(run.status, "completed");
  assert.equal(run.provider.degraded, true);
  assert.equal(run.calls[0].provider, "rules");
  assert.equal(run.calls[0].degraded, true);
  assert.ok(run.result.notes.some((note) => /降级/.test(note)));
});

test("local provider without endpoint also falls back to rules", async () => {
  const { system } = makeSystem({ env: { AI_PROVIDER: "local" } });
  const described = system.describe().provider;
  assert.equal(described.requested, "local");
  assert.equal(described.used, "rules");
  assert.equal(described.degraded, true);
});

test("persists a failed run when reading the workspace state fails", async () => {
  const { system } = makeSystem();
  system.tools.readState = async () => { throw new Error("state unavailable"); };
  const run = await runToCompletion(system, { goal: "检查学习计划" });
  assert.equal(run.status, "failed");
  const stored = await system.runRepository.get(run.id);
  assert.equal(stored.status, "failed");
  assert.equal(stored.error.message, "state unavailable");
});

test("records the actual provider and reason when a configured endpoint fails", async () => {
  const endpoint = createServer((request, response) => {
    response.writeHead(503, { "content-type": "application/json" });
    response.end("{}");
  });
  endpoint.listen(0, "127.0.0.1");
  await once(endpoint, "listening");
  try {
    const { system } = makeSystem({ env: { AI_PROVIDER: "local", LOCAL_MODEL_URL: `http://127.0.0.1:${endpoint.address().port}` } });
    const run = await runToCompletion(system, { goal: "帮我拆解数学复习计划", agentIds: ["atlas"], allowHandoff: false });
    assert.equal(run.provider.requested, "local");
    assert.equal(run.provider.used, "rules");
    assert.equal(run.provider.degraded, true);
    assert.match(run.provider.reason, /503/);
    assert.equal(run.calls[0].provider, "rules");
    assert.match(run.calls[0].degradationReason, /503/);
    assert.ok(run.result.notes.some((note) => /503/.test(note)));
  } finally {
    await new Promise((resolve) => endpoint.close(resolve));
  }
});

test("calls a DeepSeek-compatible endpoint with server-side credentials and role instructions", async () => {
  let received;
  const endpoint = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = { path: request.url, authorization: request.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      summary: "本机模拟模型已完成学习分析",
      steps: [{ title: "整理复习目标", detail: "确认验收标准" }],
      proposals: [], handoffs: []
    }) } }] }));
  });
  endpoint.listen(0, "127.0.0.1");
  await once(endpoint, "listening");
  try {
    const { system } = makeSystem({ env: {
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "test-key-not-real",
      OPENAI_MODEL: "deepseek-flash",
      MODEL_TIMEOUT_MS: "120000",
      OPENAI_BASE_URL: `http://127.0.0.1:${endpoint.address().port}/chat/completions`
    } });
    const run = await runToCompletion(system, { goal: "帮我拆解数学复习计划", agentIds: ["atlas"], allowHandoff: false });
    assert.equal(received.path, "/chat/completions");
    assert.equal(received.authorization, "Bearer test-key-not-real");
    assert.equal(received.body.model, "deepseek-flash");
    assert.deepEqual(received.body.response_format, { type: "json_object" });
    assert.equal(received.body.messages[0].content, system.registry.get("atlas").instruction);
    assert.equal(run.status, "completed");
    assert.equal(run.provider.used, "openai");
    assert.equal(run.provider.degraded, false);
    assert.equal(run.calls[0].provider, "openai");
    assert.equal(run.calls[0].output.summary, "本机模拟模型已完成学习分析");
    assert.equal(JSON.stringify({ run, description: system.describe() }).includes("test-key-not-real"), false);
  } finally {
    await new Promise((resolve) => endpoint.close(resolve));
  }
});

test("configures a bounded timeout for both remote adapters and preserves the default", () => {
  for (const AI_PROVIDER of ["local", "openai"]) {
    assert.equal(resolveProvider({ AI_PROVIDER, MODEL_TIMEOUT_MS: "120000" }).timeoutMs, 120000);
    assert.equal(resolveProvider({ AI_PROVIDER, MODEL_TIMEOUT_MS: "300000" }).timeoutMs, 300000);
    for (const MODEL_TIMEOUT_MS of [undefined, "", "no", "0", "-1", "1.5", "300001", "Infinity"]) {
      assert.equal(resolveProvider({ AI_PROVIDER, MODEL_TIMEOUT_MS }).timeoutMs, 8000);
    }
  }
});

test("aborts a slow configured endpoint and records an explicit timeout degradation", async () => {
  const endpoint = createServer(() => {});
  endpoint.listen(0, "127.0.0.1");
  await once(endpoint, "listening");
  try {
    const { system } = makeSystem({ env: {
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "test-key-not-real",
      OPENAI_MODEL: "deepseek-flash",
      OPENAI_BASE_URL: `http://127.0.0.1:${endpoint.address().port}/chat/completions`,
      MODEL_TIMEOUT_MS: "100"
    } });
    const run = await runToCompletion(system, { goal: "帮我拆解数学复习计划", agentIds: ["atlas"], allowHandoff: false });
    assert.equal(run.provider.used, "rules");
    assert.equal(run.provider.degraded, true);
    assert.match(run.provider.reason, /超时.*100ms/);
    assert.match(run.calls[0].degradationReason, /超时.*100ms/);
    assert.equal(run.calls[0].provider, "rules");
  } finally {
    endpoint.closeAllConnections();
    await new Promise((resolve) => endpoint.close(resolve));
  }
});

async function withServer(agents, run) {
  const repository = new MemoryRepository(seedState);
  const server = createServer(createApp({ repository, staticDir: fileURLToPath(new URL("../dist", import.meta.url)), agents }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`, repository);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("exposes agent system, runs, run detail and confirmation over HTTP", async () => {
  const repository = new MemoryRepository(seedState);
  const agents = createAgentSystem({ repository, runRepository: new MemoryRunRepository(), env: { AI_PROVIDER: "rules" } });
  await withServer(agents, async (baseUrl) => {
    const system = await (await fetch(`${baseUrl}/api/v1/agents`)).json();
    assert.equal(system.provider.used, "rules");
    assert.equal(system.agents.length, 3);
    assert.equal(system.capabilities.handoff, true);

    const created = await fetch(`${baseUrl}/api/v1/agents/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal: "帮我安排明天的数学复习和作息节奏", sync: true })
    });
    assert.equal(created.status, 202);
    const run = await created.json();
    assert.equal(run.status, "awaiting_confirmation");
    assert.ok(run.calls.length >= 2);

    const listed = await (await fetch(`${baseUrl}/api/v1/agents/runs`)).json();
    assert.equal(listed.runs.length, 1);
    assert.equal(listed.runs[0].id, run.id);

    const detail = await (await fetch(`${baseUrl}/api/v1/agents/runs/${run.id}`)).json();
    assert.equal(detail.id, run.id);
    assert.equal(detail.result.recommendations.length <= 3, true);

    const pending = detail.proposals.filter((proposal) => proposal.status === "pending");
    for (const decision of [undefined, "aproove", true]) {
      const invalid = await fetch(`${baseUrl}/api/v1/agents/runs/${run.id}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decisions: [{ proposalId: pending[0].id, decision }] })
      });
      assert.equal(invalid.status, 400);
      assert.equal((await invalid.json()).error.code, "INVALID_DECISION");
    }
    const confirmed = await fetch(`${baseUrl}/api/v1/agents/runs/${run.id}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decisions: pending.map((proposal) => ({ proposalId: proposal.id, decision: "approve" })) })
    });
    assert.equal(confirmed.status, 200);
    const confirmedRun = await confirmed.json();
    assert.equal(confirmedRun.status, "completed");
    assert.equal(confirmedRun.proposals.every((proposal) => proposal.status !== "pending"), true);

    const again = await fetch(`${baseUrl}/api/v1/agents/runs/${run.id}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decisions: [{ proposalId: "atlas-proposal-1", decision: "approve" }] })
    });
    assert.equal(again.status, 409);
    assert.equal((await again.json()).error.code, "RUN_NOT_PENDING");
  });
});

test("lists every run by default and honours an explicit limit", async () => {
  const system = createAgentSystem({
    repository: new MemoryRepository(seedState),
    runRepository: new MemoryRunRepository(),
    env: { AI_PROVIDER: "rules" }
  });
  const agents = system;
  await withServer(agents, async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/v1/agents/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal: "帮我拆解数学复习计划", agentIds: ["atlas"], allowHandoff: false, sync: true })
    });
    assert.equal(created.status, 202);
    await fetch(`${baseUrl}/api/v1/agents/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal: "复盘一下本周目标", agentIds: ["nova"], allowHandoff: false, sync: true })
    });

    const all = await (await fetch(`${baseUrl}/api/v1/agents/runs`)).json();
    assert.equal(all.runs.length, 2, "缺省 limit 时不应被截断为 1 条");
    assert.ok(all.runs[0].createdAt >= all.runs[1].createdAt, "最近一次运行排在最前");

    const limited = await (await fetch(`${baseUrl}/api/v1/agents/runs?limit=1`)).json();
    assert.equal(limited.runs.length, 1);

    const blank = await (await fetch(`${baseUrl}/api/v1/agents/runs?limit=`)).json();
    assert.equal(blank.runs.length, 2, "空 limit 参数按缺省处理");
  });
});

test("validates run input and unknown runs over HTTP", async () => {
  const agents = createAgentSystem({ repository: new MemoryRepository(seedState), runRepository: new MemoryRunRepository(), env: { AI_PROVIDER: "rules" } });
  await withServer(agents, async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/api/v1/agents/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal: "x" })
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, "INVALID_GOAL");

    const missing = await fetch(`${baseUrl}/api/v1/agents/runs/run-missing`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, "RUN_NOT_FOUND");

    const badConfirm = await fetch(`${baseUrl}/api/v1/agents/runs/run-missing/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal(badConfirm.status, 400);
    assert.equal((await badConfirm.json()).error.code, "INVALID_DECISION");
  });
});

test("keeps the legacy single-agent dispatch contract", async () => {
  const agents = createAgentSystem({ repository: new MemoryRepository(seedState), runRepository: new MemoryRunRepository(), env: { AI_PROVIDER: "rules" } });
  await withServer(agents, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/agents/auto/dispatch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "帮我拆解明天的数学复习计划" })
    });
    assert.equal(response.status, 202);
    const result = await response.json();
    assert.equal(result.agentId, "atlas");
    assert.equal(result.steps.length, 3);
    assert.ok(result.runId);
  });
});
