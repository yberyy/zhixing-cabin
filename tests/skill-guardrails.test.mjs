import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRepository, seedState } from "../server/repository.mjs";
import { AgentRegistry, BaseAgent, MemoryRunRepository, createAgentSystem, createTools, resolveSkill, SKILL_IDS } from "../server/agents/index.mjs";
import { parseMinutes } from "../server/agents/utils.mjs";

const trendReview = resolveSkill("trend-review");

const makeState = ({ tasks = [], reviews = [], habits } = {}) => ({
  ...JSON.parse(JSON.stringify(seedState)),
  tasks,
  reviews,
  ...(habits ? { habits } : {})
});

const task = (id, status, extra = {}) => ({
  id,
  title: `任务 ${id}`,
  category: "学习",
  duration: "25 分钟",
  assignee: "self",
  status,
  createdAt: "2026-10-14T00:00:00.000Z",
  ...extra
});

test("trend-review 在零任务时不产出校准建议，也不给出完成度", () => {
  const output = trendReview.rules({ goal: "复盘一下最近的状态" }, { state: makeState({ tasks: [] }) });
  assert.equal(output.metrics.completionRate, null, "零任务时不得把完成度折算为 0");
  assert.equal(output.metrics.sampleSize, 0);
  assert.equal(output.metrics.enoughData, false);
  assert.equal(output.proposals.some((proposal) => proposal.type === "goal_recalibration"), false, "零样本不得提出高影响校准建议");
  assert.match(output.summary, /暂无|未做完成度判断/);
  assert.ok(output.notes.some((note) => note.includes("样本量不足")), "应说明样本不足");
});

test("trend-review 在样本不足时抑制完成度校准，但仍保留负载触发的校准", () => {
  const small = trendReview.rules({ goal: "复盘" }, { state: makeState({ tasks: [task("t1", "todo")] }) });
  assert.equal(small.metrics.enoughData, false);
  assert.equal(small.proposals.length, 0, "单个任务不足以判断计划过载");
  assert.match(small.summary, /样本仅 1 个/);

  const overloaded = trendReview.rules(
    { goal: "复盘", handoff: { from: "mira", payload: { loadMinutes: 200 } } },
    { state: makeState({ tasks: [task("t1", "todo")] }) }
  );
  assert.equal(overloaded.proposals.length, 1, "负载偏高是独立证据，不受样本量限制");
  assert.match(overloaded.proposals[0].detail, /负载 200 分钟偏高/);
});

test("trend-review 在有足够样本时给出带样本量的校准建议", () => {
  const tasks = [task("t1", "done"), task("t2", "todo"), task("t3", "todo"), task("t4", "todo"), task("t5", "done")];
  const output = trendReview.rules({ goal: "复盘本周目标" }, { state: makeState({ tasks }) });
  assert.equal(output.metrics.sampleSize, 5);
  assert.equal(output.metrics.enoughData, true);
  assert.equal(output.metrics.completionRate, 40);
  assert.equal(output.proposals.length, 1);
  assert.equal(output.proposals[0].type, "goal_recalibration");
  assert.match(output.proposals[0].detail, /样本 5 个/);
  assert.equal(output.proposals[0].payload.sampleSize, 5);
});

test("trend-review 只统计合法的 1-5 状态评分", () => {
  const reviews = [{ mood: 4 }, { mood: 0 }, { mood: 7 }, { mood: "x" }, { mood: null }, { mood: 2 }];
  const output = trendReview.rules({ goal: "复盘" }, { state: makeState({ tasks: [task("t1", "done")], reviews }) });
  assert.equal(output.metrics.validMoodCount, 2, "只有 4 和 2 合法");
  assert.equal(output.metrics.moodAverage, 3);
  assert.equal(output.metrics.reviewCount, 6);
});

test("统计口径写明为累计快照，不再使用「本周完成率」措辞", () => {
  const output = trendReview.rules({ goal: "复盘" }, { state: makeState({ tasks: [task("t1", "done")] }) });
  assert.match(output.summary, /累计快照/);
  const texts = [output.summary, ...output.steps.map((step) => step.title + step.detail)].join(" ");
  assert.equal(/本周完成度|本周的任务完成率/.test(texts), false);
});

test("技能 metrics 中不再包含含义不明的 confidence 常量", () => {
  for (const id of SKILL_IDS) {
    const skill = resolveSkill(id);
    const output = skill.rules({ goal: "复习数学", allowHandoff: false }, { state: makeState({ tasks: [task("t1", "todo")] }) });
    assert.equal("confidence" in output.metrics, false, `${id} 不应再输出 confidence`);
  }
});

test("目标校准落地时明确说明只新增聚焦任务、未修改现有目标", async () => {
  const repository = new MemoryRepository(seedState);
  const tools = createTools({ repository });
  const agent = AgentRegistry.createDefault().get("nova");
  const applied = await tools.applyProposal({
    agent,
    proposal: {
      id: "nova-proposal-1",
      agentId: "nova",
      type: "goal_recalibration",
      payload: { suggestedFocus: "保留一个最重要目标" }
    }
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.effect, "recorded_goal_focus");
  assert.match(applied.summary, /未修改现有目标与优先级/);
  const created = (await repository.getState()).tasks.find((item) => item.id === applied.targetId);
  assert.ok(created.title.startsWith("聚焦："), `新建任务标题不应暗示目标已被修改：${created.title}`);
});

test("无关键词匹配时 plan 回退到全部 Agent（并保留 routingDefault 只作用于旧接口）", () => {
  const system = createAgentSystem({
    repository: new MemoryRepository(seedState),
    runRepository: new MemoryRunRepository(),
    env: { AI_PROVIDER: "rules" }
  });
  const plan = system.orchestrator.plan("随便聊聊最近的状态", {});
  assert.equal(plan.tasks.length, 3, "无关键词匹配时应覆盖全部专业 Agent");

  const matched = system.orchestrator.plan("帮我拆解数学复习计划", {});
  assert.deepEqual(matched.tasks.map((item) => item.agentId), ["atlas"]);
});

// ---- Mira 审查整改（2026-10-14）----
const rhythmCheck = resolveSkill("rhythm-check");

test("parseMinutes 支持小时写法，不再把「2 小时」读成 2 分钟", () => {
  assert.equal(parseMinutes("2 小时"), 120);
  assert.equal(parseMinutes("1.5 小时"), 90);
  assert.equal(parseMinutes("3h"), 180);
  assert.equal(parseMinutes("45 分钟"), 45);
  assert.equal(parseMinutes("90"), 90);
  assert.equal(parseMinutes("未定"), 25);
  assert.equal(parseMinutes(""), 25);
});

test("小时写法不再击穿 150 分钟负载上限", () => {
  const tasks = [task("t1", "todo", { duration: "2 小时", category: "学习" })];
  const output = rhythmCheck.rules({ goal: "今天怎么安排" }, { state: makeState({ tasks, habits: [] }) });
  assert.equal(output.metrics.loadMinutes, 120, "2 小时应折算 120 分钟");
  assert.equal(output.metrics.overload, false);
});

test("减负方案真正把负载压回上限内，并在步骤文案里给出实际减少量", () => {
  const tasks = [task("t1", "todo", { title: "长任务", duration: "200 分钟", category: "学习" })];
  const output = rhythmCheck.rules({ goal: "今天怎么安排" }, { state: makeState({ tasks, habits: [] }) });
  assert.equal(output.metrics.excess, 50);
  const trim = output.proposals.find((proposal) => proposal.type === "reschedule_block");
  assert.ok(trim, "负载超限应产出调整建议");
  assert.equal(trim.payload.changes.duration, "150 分钟");
  assert.equal(trim.payload.resultingLoadMinutes, 150);
  assert.equal(trim.payload.residualMinutes, 0);
  assert.equal(output.steps[1].title, "给今天减负 50 分钟", "步骤文案必须与实际改动一致");
  assert.match(output.steps[1].detail, /调整为 150 分钟/);
  assert.doesNotMatch(output.steps[1].detail, /仍超出上限/);
  assert.match(output.summary, /调整后回到上限内/);
});

test("压不到上限时如实标注剩余超限量，不宣称已解决", () => {
  const tasks = Array.from({ length: 8 }, (_, index) => task(`t${index}`, "todo", { duration: "20 分钟", category: "学习" }));
  const output = rhythmCheck.rules({ goal: "今天怎么安排" }, { state: makeState({ tasks, habits: [] }) });
  assert.equal(output.metrics.loadMinutes, 160);
  assert.equal(output.metrics.excess, 10);
  assert.equal(output.metrics.plannedReductionMinutes, 5);
  assert.equal(output.metrics.residualMinutes, 5);
  const trim = output.proposals.find((proposal) => proposal.type === "reschedule_block");
  assert.equal(trim.payload.resultingLoadMinutes, 155);
  assert.match(trim.detail, /仍超出上限 5 分钟/);
  assert.match(output.steps[1].detail, /仍超出上限 5 分钟/);
  assert.match(output.summary, /仍有 5 分钟超出上限/);
});

test("已有同名散步任务时不再重复新增，打断新增/归档循环", () => {
  const habits = [{ id: "habit-exercise", name: "运动", target: "30 分钟", completed: false, streak: 4 }];
  const existing = [task("t1", "todo", { title: "晚饭后散步 30 分钟", category: "生活", duration: "30 分钟" })];
  const withExisting = rhythmCheck.rules({ goal: "今天怎么安排" }, { state: makeState({ tasks: existing, habits }) });
  assert.equal(withExisting.proposals.some((proposal) => proposal.type === "create_task"), false, "同名任务已存在时不应再次新增");
  assert.equal(withExisting.proposals.some((proposal) => proposal.type === "delete_task"), false, "自己刚建议过的任务不应立即归档");

  const withoutExisting = rhythmCheck.rules({ goal: "今天怎么安排" }, { state: makeState({ tasks: [], habits }) });
  assert.equal(withoutExisting.proposals.some((proposal) => proposal.type === "create_task"), true, "确实缺失时才新增");
});

test("同名重复只归档 Agent 创建的那条，用户手工任务永不被选中", () => {
  const userOnly = [
    task("u1", "todo", { title: "整理笔记", createdAt: "2026-10-13T00:00:00.000Z" }),
    task("u2", "todo", { title: "整理笔记", createdAt: "2026-10-14T00:00:00.000Z" })
  ];
  const noTarget = rhythmCheck.rules({ goal: "今天怎么安排" }, { state: makeState({ tasks: userOnly, habits: [] }) });
  assert.equal(noTarget.proposals.some((proposal) => proposal.type === "delete_task"), false, "两条用户任务都不得被自动归档");

  const mixed = [
    task("u1", "todo", { title: "整理笔记", createdAt: "2026-10-13T00:00:00.000Z" }),
    task("a1", "todo", { title: "整理笔记", createdAt: "2026-10-14T00:00:00.000Z", source: "agent", agentId: "mira" })
  ];
  const targeted = rhythmCheck.rules({ goal: "今天怎么安排" }, { state: makeState({ tasks: mixed, habits: [] }) });
  const archive = targeted.proposals.find((proposal) => proposal.type === "delete_task");
  assert.equal(archive.payload.targetTaskId, "a1", "只应归档较新的 Agent 任务");
});

test("模型返回未支持的动作类型时被丢弃并留痕，而不是等用户批准后失败", () => {
  const agent = AgentRegistry.createDefault().get("mira");
  const output = agent.normalize(
    {
      summary: "模型输出",
      proposals: [
        { type: "dedupe", risk: "high", title: "合并重复条目" },
        { type: "create_task", risk: "low", title: "新增散步", payload: { title: "晚饭后散步 30 分钟" } },
        { type: "defer", risk: "high", title: "顺延到后天" }
      ]
    },
    { goal: "今天怎么安排" }
  );
  assert.equal(output.proposals.length, 1, "只保留工具层支持的动作类型");
  assert.equal(output.proposals[0].type, "create_task");
  assert.match(output.notes.join(" "), /已忽略工具层不支持的建议类型：dedupe、defer/);
});

test("模型返回非法 risk 时按 high 处理，仍必须确认", () => {
  const agent = AgentRegistry.createDefault().get("nova");
  const output = agent.normalize({ proposals: [{ type: "goal_recalibration", risk: "medium", title: "校准", payload: {} }] }, {});
  assert.equal(output.proposals[0].risk, "high");
  assert.equal(output.proposals[0].requiresConfirmation, true);
});

test("发给模型的请求带上了输出协议字段与允许的动作类型", async () => {
  const { createServer } = await import("node:http");
  const { once } = await import("node:events");
  const { OpenAIProvider } = await import("../server/agents/providers/openai-provider.mjs");
  let captured = null;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      captured = JSON.parse(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ summary: "模型摘要", steps: [], proposals: [], handoffs: [], constraints: [{ id: "c1", label: "23:30 前入睡", detail: "测试" }], metrics: {} }) } }]
      }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const { port } = server.address();
    const provider = new OpenAIProvider({ apiKey: "test-key-not-real", baseUrl: `http://127.0.0.1:${port}/chat/completions` });
    const agent = AgentRegistry.createDefault().get("mira");
    const response = await provider.complete({
      agent,
      input: { goal: "今天怎么安排" },
      context: { state: { tasks: [], habits: [], reviews: [] } }
    });
    const promptText = captured.messages.map((message) => message.content).join("\n");
    assert.match(promptText, /constraints/, "必须要求模型返回 constraints");
    for (const action of ["create_task", "update_task", "reschedule_block", "delete_task", "goal_recalibration"]) {
      assert.match(promptText, new RegExp(action), `必须告知模型允许的动作类型：${action}`);
    }
    assert.equal(response.degraded, false);
    assert.equal(response.structured.constraints[0].label, "23:30 前入睡");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("确认队列按优先级截断到上限，其余标记为 deferred 并保留在轨迹里", async () => {
  class ChattyAgent extends BaseAgent {
    constructor() {
      super({
        id: "mira",
        name: "Mira",
        role: "生活管家",
        accent: "coral",
        initial: "M",
        capabilities: ["测试"],
        tools: { "state:read": "allow" },
        protocol: { input: [], output: [] },
        routing: ["安排"],
        instruction: "用于验证确认队列上限的测试 Agent"
      });
    }

    rules() {
      const proposal = (type, title) => ({ type, risk: "high", title, detail: "d", payload: {} });
      return {
        status: "completed",
        summary: "测试输出",
        // 插入顺序刻意与优先级相反
        proposals: [
          proposal("goal_recalibration", "校准目标"),
          proposal("create_task", "新增任务"),
          proposal("delete_task", "归档重复项"),
          proposal("update_task", "调整任务时长"),
          proposal("reschedule_block", "压缩负载")
        ]
      };
    }
  }
  const registry = new AgentRegistry([new ChattyAgent()]);
  const system = createAgentSystem({ repository: new MemoryRepository(seedState), runRepository: new MemoryRunRepository(), registry, env: { AI_PROVIDER: "rules" } });
  const { completion } = await system.orchestrator.createRun({ goal: "帮我安排今天", allowHandoff: false });
  const run = await completion;
  const pending = run.proposals.filter((item) => item.status === "pending");
  const deferred = run.proposals.filter((item) => item.status === "deferred");
  assert.equal(pending.length, 3, "确认队列不得超过上限");
  assert.deepEqual(pending.map((item) => item.type).sort(), ["delete_task", "reschedule_block", "update_task"], "保留的应是最重要的三类");
  assert.deepEqual(pending.map((item) => item.priority).sort((a, b) => a - b), [0, 1, 2], "保留的应是最重要的三条（前端按 priority 排序展示）");
  assert.equal(deferred.length, 2);
  assert.deepEqual(deferred.map((item) => item.type).sort(), ["create_task", "goal_recalibration"], "低优先级的建议被延后");
  assert.ok(deferred.every((item) => item.deferredReason.includes("上限")), "延后的建议要说明原因");
  assert.equal(run.status, "awaiting_confirmation");
  assert.ok(run.result.notes.some((note) => note.includes("2 条较低优先级建议")));
});

test("旧运行里不受支持的动作类型不可执行，确认接口给出明确原因且不改动数据", async () => {
  const { createServer } = await import("node:http");
  const { once } = await import("node:events");
  const { createApp } = await import("../server/app.mjs");
  const repository = new MemoryRepository(seedState);
  const runRepository = new MemoryRunRepository();
  const agents = createAgentSystem({ repository, runRepository, env: { AI_PROVIDER: "rules" } });
  await runRepository.save({
    id: "run-legacy",
    goal: "历史运行（修复前产生）",
    source: "user",
    strategy: "sequential",
    status: "awaiting_confirmation",
    provider: { requested: "openai", used: "openai", label: "OpenAI 兼容接口", mode: "remote", available: true, degraded: false, reason: null },
    plan: { id: "plan-legacy", summary: "s", strategy: "sequential", tasks: [] },
    calls: [],
    messages: [],
    confirmations: [],
    memory: { runId: "run-legacy", goal: "历史运行（修复前产生）", facts: [], constraints: [], conflicts: [] },
    conflicts: [],
    applied: [],
    proposals: [
      { id: "p-invented", agentId: "mira", type: "dedupe", risk: "high", requiresConfirmation: true, title: "合并重复条目", detail: "模型自造类型", payload: {}, status: "pending" },
      { id: "p-valid", agentId: "mira", type: "reschedule_block", risk: "high", requiresConfirmation: true, title: "压缩任务", detail: "合法类型且 Mira 有 schedule:reblock 权限", payload: { action: "trim_block", targetTaskId: "task-1", changes: { duration: "20 分钟" } }, status: "pending" }
    ],
    result: null,
    error: null,
    createdAt: "2026-10-14T00:00:00.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
    finishedAt: null
  });

  const server = createServer(createApp({ repository, staticDir: new URL("../dist", import.meta.url).pathname, agents }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const detail = await (await fetch(`${baseUrl}/api/v1/agents/runs/run-legacy`)).json();
    const invented = detail.proposals.find((item) => item.id === "p-invented");
    assert.equal(invented.actionable, false, "不受支持的类型必须标记为不可执行");
    assert.match(invented.blockedReason, /不支持的动作类型/);
    const valid = detail.proposals.find((item) => item.id === "p-valid");
    assert.equal(valid.actionable, true);

    const before = (await repository.getState()).tasks.find((item) => item.id === "task-1").duration;
    const refused = await fetch(`${baseUrl}/api/v1/agents/runs/run-legacy/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decisions: [{ proposalId: "p-invented", decision: "approve" }] })
    });
    assert.equal(refused.status, 400);
    assert.equal((await refused.json()).error.code, "PROPOSAL_NOT_ACTIONABLE");
    const afterRefusal = await runRepository.get("run-legacy");
    assert.equal(afterRefusal.proposals.find((item) => item.id === "p-invented").status, "pending", "被拒绝的请求不得改动状态");
    assert.equal(afterRefusal.confirmations.length, 0);
    assert.equal((await repository.getState()).tasks.find((item) => item.id === "task-1").duration, before);

    const accepted = await fetch(`${baseUrl}/api/v1/agents/runs/run-legacy/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decisions: [{ proposalId: "p-valid", decision: "approve" }] })
    });
    assert.equal(accepted.status, 200, "合法建议仍可执行，守卫不应误伤");
    const after = (await repository.getState()).tasks.find((item) => item.id === "task-1");
    assert.equal(after.duration, "20 分钟");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("缺少习惯记录时不把睡眠/运动默认判为已完成", () => {
  const tasks = [task("t1", "todo", { duration: "60 分钟", category: "学习" })];
  const output = rhythmCheck.rules({ goal: "今天怎么安排" }, { state: makeState({ tasks, habits: [] }) });
  assert.equal(output.metrics.sleepReady, null);
  assert.equal(output.metrics.moveReady, null);
  assert.match(output.notes.join(" "), /未找到入睡相关的习惯记录/);
  assert.doesNotMatch(output.summary, /早睡尚未完成/, "没有记录时不得断言睡眠未完成");
  assert.doesNotMatch(output.notes.join(" "), /早睡习惯：未完成/, "没有记录时不得写成未完成");
});
