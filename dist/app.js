const STORAGE_KEY = "zhixing-cabin-state-v1";

const seedState = {
  tasks: [
    { id: "task-1", title: "高等数学 · 极限与连续", category: "学习", duration: "45 分钟", assignee: "atlas", status: "doing", createdAt: "2026-10-13T01:00:00.000Z" },
    { id: "task-2", title: "整理英语阅读生词", category: "学习", duration: "25 分钟", assignee: "self", status: "todo", createdAt: "2026-10-13T01:10:00.000Z" },
    { id: "task-3", title: "晚饭后散步 30 分钟", category: "生活", duration: "30 分钟", assignee: "mira", status: "todo", createdAt: "2026-10-13T01:20:00.000Z" },
    { id: "task-4", title: "梳理本周课程重点", category: "成长", duration: "25 分钟", assignee: "nova", status: "done", createdAt: "2026-10-12T10:00:00.000Z" },
    { id: "task-5", title: "背诵 30 个核心词汇", category: "学习", duration: "25 分钟", assignee: "atlas", status: "done", createdAt: "2026-10-12T11:00:00.000Z" },
    { id: "task-6", title: "准备明天的课程资料", category: "生活", duration: "15 分钟", assignee: "self", status: "todo", createdAt: "2026-10-13T02:00:00.000Z" }
  ],
  habits: [
    { id: "habit-water", name: "喝水", target: "8 杯", completed: true, streak: 9, icon: "droplets" },
    { id: "habit-reading", name: "阅读", target: "30 分钟", completed: true, streak: 12, icon: "book-open" },
    { id: "habit-exercise", name: "运动", target: "30 分钟", completed: false, streak: 4, icon: "dumbbell" },
    { id: "habit-sleep", name: "早睡", target: "23:30", completed: false, streak: 6, icon: "moon" }
  ],
  agents: [
    { id: "atlas", name: "Atlas", role: "学习教练", status: "working", currentTask: "正在整理极限章节的知识地图", accent: "blue", initial: "A" },
    { id: "mira", name: "Mira", role: "生活管家", status: "ready", currentTask: "今日作息与习惯已检查", accent: "coral", initial: "M" },
    { id: "nova", name: "Nova", role: "成长顾问", status: "ready", currentTask: "本周复盘框架已准备", accent: "green", initial: "N" }
  ],
  reviews: []
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const escapeHtml = (value) => String(value).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));
const saveLocalState = (state) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用时保持内存态。
  }
  return state;
};

class ApiClient {
  constructor() {
    this.mode = "api";
  }

  localState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || clone(seedState);
    } catch {
      return clone(seedState);
    }
  }

  saveLocal(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return state;
  }

  async request(path, options = {}) {
    if (this.mode === "local") throw new Error("LOCAL_MODE");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1300);
    try {
      const response = await fetch(`/api/v1${path}`, {
        ...options,
        signal: controller.signal,
        headers: options.body ? { "content-type": "application/json", ...options.headers } : options.headers
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "请求失败");
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getState() {
    try {
      const state = await this.request("/state");
      this.mode = "api";
      return state;
    } catch {
      this.mode = "local";
      const state = this.localState();
      return { ...state, tasks: (state.tasks || []).filter((task) => !task.archivedAt) };
    }
  }

  async createTask(input) {
    if (this.mode === "api") return this.request("/tasks", { method: "POST", body: JSON.stringify(input) });
    const state = this.localState();
    const task = { id: `task-${Date.now()}`, ...input, status: "todo", createdAt: new Date().toISOString() };
    state.tasks.unshift(task);
    this.saveLocal(state);
    return task;
  }

  async updateTask(id, changes) {
    const payload = typeof changes === "string" ? { status: changes } : changes;
    if (this.mode === "api") return this.request(`/tasks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) });
    const state = this.localState();
    const task = state.tasks.find((item) => item.id === id);
    if (task) Object.assign(task, payload, { updatedAt: new Date().toISOString() });
    this.saveLocal(state);
    return task;
  }

  async archiveTask(id) {
    if (this.mode === "api") return this.request(`/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
    const state = this.localState();
    const task = state.tasks.find((item) => item.id === id);
    if (task) {
      task.archivedAt = new Date().toISOString();
      task.archivedBy = "user";
    }
    this.saveLocal(state);
    return task;
  }

  async listArchivedTasks() {
    if (this.mode === "api") return this.request("/tasks/archived");
    return { tasks: this.localState().tasks.filter((task) => task.archivedAt) };
  }

  async restoreTask(id) {
    if (this.mode === "api") return this.request(`/tasks/${encodeURIComponent(id)}/restore`, { method: "POST" });
    const state = this.localState();
    const task = state.tasks.find((item) => item.id === id);
    if (task) {
      delete task.archivedAt;
      delete task.archivedBy;
      task.updatedAt = new Date().toISOString();
    }
    this.saveLocal(state);
    return task;
  }

  async toggleHabit(id) {
    if (this.mode === "api") return this.request(`/habits/${encodeURIComponent(id)}/toggle`, { method: "POST" });
    const state = this.localState();
    const habit = state.habits.find((item) => item.id === id);
    if (habit) habit.completed = !habit.completed;
    this.saveLocal(state);
    return habit;
  }

  async dispatch(command, agentId = "auto") {
    if (this.mode === "api") return this.request(`/agents/${agentId}/dispatch`, { method: "POST", body: JSON.stringify({ command }) });
    const agent = /学习|复习|课程|数学|英语/.test(command) ? "atlas" : /睡|运动|饮食|生活|作息/.test(command) ? "mira" : "nova";
    const names = { atlas: "Atlas", mira: "Mira", nova: "Nova" };
    return { agentId: agent, agentName: names[agent], status: "completed", summary: "已整理为清晰的下一步", steps: ["明确完成标准", "安排一个 25 分钟行动", "执行后快速复盘"] };
  }

  async getAgentSystem() {
    if (this.mode === "api") return this.request("/agents");
    return {
      provider: { requested: "browser", used: "browser", label: "浏览器内置规则", mode: "local", available: true, degraded: true, reason: "离线模式：使用浏览器内置确定性规则" },
      agents: appState.agents.map((agent) => ({ ...LOCAL_AGENT_META[agent.id], ...agent, displayStatus: agent.status, protocol: { input: [], output: [] }, instruction: "离线模式不使用服务端 Agent 指令。" })),
      capabilities: { handoff: false, sharedMemory: false, confirmation: true, parallel: false, failureIsolation: true },
      runStatuses: ["running", "completed", "failed", "awaiting_confirmation", "partially_confirmed"],
      runs: { total: readLocalRuns().length, byStatus: {} }
    };
  }

  async startAgentRun(goal, options = {}) {
    if (this.mode === "api") return this.request("/agents/runs", { method: "POST", body: JSON.stringify({ goal, ...options }) });
    return startLocalRun(goal, options.strategy || "auto");
  }

  async listAgentRuns() {
    if (this.mode === "api") return this.request("/agents/runs");
    return { runs: readLocalRuns().map(summarizeLocalRun).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) };
  }

  async getAgentRun(id) {
    if (this.mode === "api") return this.request(`/agents/runs/${encodeURIComponent(id)}`);
    return readLocalRuns().find((run) => run.id === id) || null;
  }

  async confirmAgentRun(id, decisions) {
    if (this.mode === "api") return this.request(`/agents/runs/${encodeURIComponent(id)}/confirm`, { method: "POST", body: JSON.stringify({ decisions }) });
    return confirmLocalRun(id, decisions);
  }

  async createReview(input) {
    if (this.mode === "api") return this.request("/reviews", { method: "POST", body: JSON.stringify(input) });
    const state = this.localState();
    const review = { id: `review-${Date.now()}`, ...input, createdAt: new Date().toISOString() };
    state.reviews.unshift(review);
    this.saveLocal(state);
    return review;
  }
}

const api = new ApiClient();
let appState = clone(seedState);
let currentFilter = "all";
let selectedMood = 3;
let activeView = "overview";
let focusTaskIndex = 0;
const timer = { total: 25 * 60, remaining: 25 * 60, running: false, interval: null };
let editingTaskId = null;
let confirmAction = null;
let agentSystem = null;
const VIEWS = ["overview", "tasks", "runs", "focus", "habits", "archive"];

const formatDateTime = (value) => {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  } catch {
    return "—";
  }
};

const setSelectValue = (select, value) => {
  if (![...select.options].some((option) => option.value === value)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
  select.value = value;
};

// ---- 离线模式的轻量规则编排（与服务端 Provider 契约一致，但为简化实现） ----
const RUN_STORAGE_KEY = "zhixing-cabin-runs-v1";
const LOCAL_AGENT_META = {
  atlas: { id: "atlas", name: "Atlas", role: "学习教练", accent: "blue", initial: "A", skill: "study-coach", skillLabel: "学习规划", capabilities: ["目标拆解", "知识地图", "间隔复习", "练习设计"], tools: { "state:read": "allow", "tasks:create": { risk: "low", maxPerRun: 2 }, "tasks:update": { risk: "high", requiresConfirmation: true } } },
  mira: { id: "mira", name: "Mira", role: "生活管家", accent: "coral", initial: "M", skill: "rhythm-check", skillLabel: "节律检查", capabilities: ["日程平衡", "习惯设计", "精力管理", "负载检查"], tools: { "state:read": "allow", "tasks:create": { risk: "low", maxPerRun: 1 }, "tasks:archive": { risk: "high", requiresConfirmation: true }, "schedule:reblock": { risk: "high", requiresConfirmation: true } } },
  nova: { id: "nova", name: "Nova", role: "成长顾问", accent: "green", initial: "N", skill: "trend-review", skillLabel: "趋势复盘", capabilities: ["目标校准", "趋势洞察", "复盘提炼", "优先级调整"], tools: { "state:read": "allow", "tasks:create": { risk: "low", maxPerRun: 1 }, "goals:recalibrate": { risk: "high", requiresConfirmation: true } } }
};
let localRunsCache = null;
let currentRunId = null;
let runsCache = [];

function readLocalRuns() {
  if (localRunsCache) return localRunsCache;
  try {
    localRunsCache = JSON.parse(localStorage.getItem(RUN_STORAGE_KEY)) || [];
  } catch {
    localRunsCache = [];
  }
  return localRunsCache;
}

function writeLocalRuns(runs) {
  localRunsCache = runs;
  try {
    localStorage.setItem(RUN_STORAGE_KEY, JSON.stringify(runs));
  } catch {
    // 存储不可用时保持内存态。
  }
  return runs;
}

function summarizeLocalRun(run) {
  return {
    id: run.id,
    goal: run.goal,
    status: run.status,
    strategy: run.strategy,
    provider: run.provider,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    finishedAt: run.finishedAt,
    callCount: run.calls.length,
    agentIds: [...new Set(run.calls.map((call) => call.agentId))],
    handoffCount: run.calls.filter((call) => call.viaHandoff).length,
    pendingConfirmations: run.proposals.filter((proposal) => proposal.status === "pending").length,
    conflictCount: run.conflicts.length,
    error: run.error
  };
}

function localTopic(goal) {
  return goal.replace(/^(请|帮我|帮忙|我想|我要|需要|给我)/, "").replace(/[。！？!?]+$/, "").slice(0, 18) || "当前目标";
}

function localSteps(agentId, goal) {
  const topic = localTopic(goal);
  if (agentId === "atlas") {
    return [
      { title: `写清「${topic}」的验收标准`, detail: "定义今天结束时可以自检的结果。" },
      { title: "拆成两个 25-45 分钟专注轮次", detail: "每轮结束做 5 分钟无提示回忆。" },
      { title: "用 3 道题做检验", detail: "记录错因，作为下一次复习入口。" }
    ];
  }
  if (agentId === "mira") {
    return [
      { title: "锁定 23:30 前入睡的硬边界", detail: "晚间学习在 22:30 前收尾。" },
      { title: "保留晚饭后散步 30 分钟", detail: "用短时活动恢复精力。" },
      { title: "高强度学习后插入 10 分钟活动", detail: "避免连续久坐。" }
    ];
  }
  return [
    { title: "写下目标背后的真实意图", detail: "避免只追逐数字。" },
    { title: "只保留一个今天能验证的小行动", detail: "先完成最小行动，重建推进感。" },
    { title: "周日用 10 分钟对照趋势", detail: "把完成率和状态评分放在一起看。" }
  ];
}

function selectLocalAgents(goal) {
  const learning = /学习|复习|考试|课程|数学|英语|单词|阅读|论文|知识|刷题|作业|编程|代码|题/.test(goal);
  const life = /睡|作息|运动|跑步|健身|饮食|散步|生活|精力|早睡|起床|健康|日程|安排|节奏/.test(goal);
  const growth = /复盘|目标|习惯|坚持|趋势|成长|反思|周报|总结|调整|校准/.test(goal);
  const selected = ["atlas", "mira", "nova"].filter((id) => (id === "atlas" && learning) || (id === "mira" && life) || (id === "nova" && growth));
  return selected.length ? selected : ["atlas", "mira", "nova"];
}

function startLocalRun(goal, strategy) {
  const selected = selectLocalAgents(goal);
  const resolved = strategy === "auto" ? (selected.length > 1 && !selected.includes("atlas") ? "parallel" : "sequential") : strategy;
  const id = `run-local-${Date.now()}`;
  const createdAt = new Date().toISOString();
  const topic = localTopic(goal);
  const calls = selected.map((agentId, index) => {
    const meta = LOCAL_AGENT_META[agentId];
    return {
      id: `${id}-call-${index + 1}`,
      order: index + 1,
      agentId,
      agentName: meta.name,
      title: goal,
      viaHandoff: null,
      status: "completed",
      provider: "browser-rules",
      degraded: true,
      error: null,
      startedAt: createdAt,
      finishedAt: createdAt,
      durationMs: 8 + index * 4,
      input: { goal, reason: null, handoff: null, allowHandoff: false },
      output: {
        agentId,
        agentName: meta.name,
        status: "completed",
        summary: `${meta.name} 已给出建议（离线模式，确定性规则）。`,
        steps: localSteps(agentId, goal).map((step, i) => ({ id: `${agentId}-step-${i + 1}`, ...step, risk: "low", source: agentId })),
        artifacts: [],
        proposals: [],
        handoffs: [],
        notes: ["离线模式：本结果由浏览器内置规则生成，不代表模型推理。"],
        sources: ["浏览器内置规则"],
        metrics: {}
      }
    };
  });

  const proposals = [];
  const applied = [];
  if (selected.includes("atlas")) {
    proposals.push({ id: `${id}-proposal-1`, agentId: "atlas", type: "create_task", risk: "low", requiresConfirmation: false, title: `制定「${topic}」学习单元`, detail: "离线模式：低风险新增已直接写入任务流。", payload: { title: `复习：${topic}`, category: "学习", duration: "45 分钟", assignee: "atlas" }, status: "applied" });
    const task = { id: `task-${Date.now()}`, title: `复习：${topic}`, category: "学习", duration: "45 分钟", assignee: "atlas", status: "todo", createdAt, source: "agent", origin: `${id}-proposal-1` };
    appState.tasks.unshift(task);
    applied.push({ id: `${id}-proposal-1`, agentId: "atlas", type: "create_task", summary: `已写入任务流：${task.title}`, targetId: task.id, appliedAt: createdAt });
    saveLocalState(appState);
  }
  if (selected.includes("mira")) {
    proposals.push({ id: `${id}-proposal-2`, agentId: "mira", type: "reschedule_block", risk: "high", requiresConfirmation: true, title: "压缩晚间学习时段", detail: "负载偏高，建议缩短 25 分钟以保护睡眠边界。", payload: { action: "trim_block", minutes: 25 }, status: "pending" });
  }
  if (selected.includes("nova")) {
    proposals.push({ id: `${id}-proposal-3`, agentId: "nova", type: "goal_recalibration", risk: "high", requiresConfirmation: true, title: "收窄本周首要目标", detail: "建议只保留一个首要目标，其余延后。", payload: { suggestedFocus: "保留一个最重要目标" }, status: "pending" });
  }

  const pending = proposals.filter((proposal) => proposal.status === "pending");
  const recommendations = [];
  if (selected.includes("atlas") && selected.includes("mira")) {
    recommendations.push({ title: "以睡眠优先，压缩 1 个学习轮次", detail: "Atlas 新增学习与 Mira 的作息约束存在冲突。", source: "Orchestrator", agentId: null });
  }
  calls.forEach((call) => {
    if (recommendations.length < 3 && call.output.steps[0]) {
      recommendations.push({ title: call.output.steps[0].title, detail: call.output.steps[0].detail, source: call.agentName, agentId: call.agentId });
    }
  });

  const run = {
    id,
    goal,
    source: "user",
    strategy: resolved,
    status: pending.length ? "awaiting_confirmation" : "completed",
    provider: { requested: "browser", used: "browser", label: "浏览器内置规则", mode: "local", available: true, degraded: true, reason: "离线模式" },
    plan: {
      id: `${id}-plan`,
      summary: `离线模式将目标拆为 ${calls.length} 个子任务。`,
      strategy: resolved,
      tasks: calls.map((call) => ({ id: `${id}-task-${call.order}`, agentId: call.agentId, title: `${call.agentName} · ${topic}`, dependsOn: [] }))
    },
    calls,
    messages: [
      { id: `${id}-msg-1`, runId: id, at: createdAt, from: "user", to: "orchestrator", type: "goal", summary: `收到目标：${goal}`, payload: {} },
      { id: `${id}-msg-2`, runId: id, at: createdAt, from: "orchestrator", to: "*", type: "plan", summary: `计划：${calls.length} 个 Agent`, payload: {} },
      ...calls.map((call) => ({ id: `${id}-msg-${call.order + 2}`, runId: id, at: createdAt, from: "orchestrator", to: call.agentId, type: "task", summary: `派发任务给 ${call.agentName}`, payload: {} }))
    ],
    confirmations: [],
    memory: {
      runId: id,
      goal,
      facts: [{ key: "goal", value: goal, source: "user", at: createdAt, history: [] }],
      constraints: [],
      conflicts: recommendations.length && recommendations[0].source === "Orchestrator"
        ? [{ id: `${id}-conflict-1`, agents: ["atlas", "mira"], topic: "学习时长与作息边界", detail: "学习新增与作息约束存在冲突。", resolution: recommendations[0].title }]
        : []
    },
    conflicts: recommendations.length && recommendations[0].source === "Orchestrator"
      ? [{ id: `${id}-conflict-1`, agents: ["atlas", "mira"], topic: "学习时长与作息边界", detail: "学习新增与作息约束存在冲突。", resolution: recommendations[0].title }]
      : [],
    applied,
    proposals,
    result: {
      summary: `Orchestrator 调用 ${calls.length} 个 Agent${pending.length ? `，${pending.length} 项高影响调整等待你确认` : "，方案可直接执行"}。`,
      recommendations: recommendations.slice(0, 3),
      notes: ["离线模式：结果由浏览器内置规则生成。"],
      durationMs: calls.reduce((sum, call) => sum + call.durationMs, 0)
    },
    error: null,
    createdAt,
    updatedAt: createdAt,
    finishedAt: createdAt
  };
  const runs = [run, ...readLocalRuns()].slice(0, 50);
  writeLocalRuns(runs);
  return run;
}

function confirmLocalRun(id, decisions) {
  const runs = readLocalRuns();
  const run = runs.find((item) => item.id === id);
  if (!run) throw new Error("没有找到该运行记录");
  const map = new Map(decisions.map((item) => [item.proposalId, item.decision]));
  run.confirmations = run.confirmations || [];
  for (const proposal of run.proposals) {
    if (proposal.status !== "pending" || !map.has(proposal.id)) continue;
    const decision = map.get(proposal.id);
    if (decision === "approve") {
      proposal.status = "applied";
      const task = { id: `task-${Date.now()}-${proposal.id.slice(-2)}`, title: `调整：${proposal.title}`, category: "成长", duration: "25 分钟", assignee: proposal.agentId, status: "todo", createdAt: new Date().toISOString(), source: "agent", origin: proposal.id };
      appState.tasks.unshift(task);
      run.applied.push({ id: proposal.id, agentId: proposal.agentId, type: proposal.type, summary: `已写入任务流：${task.title}`, targetId: task.id, appliedAt: new Date().toISOString(), confirmed: true });
    } else {
      proposal.status = "rejected";
    }
    run.confirmations.push({ proposalId: proposal.id, decision, at: new Date().toISOString() });
  }
  saveLocalState(appState);
  const remaining = run.proposals.filter((proposal) => proposal.status === "pending").length;
  run.status = remaining ? "awaiting_confirmation" : run.proposals.some((proposal) => proposal.status === "rejected") ? "partially_confirmed" : "completed";
  run.updatedAt = new Date().toISOString();
  writeLocalRuns(runs);
  return run;
}


const icons = () => window.lucide?.createIcons({ attrs: { "aria-hidden": "true" } });
const categoryClass = (category) => category === "生活" ? "life" : category === "成长" ? "growth" : "";
const assigneeName = (id) => ({ atlas: "A", mira: "M", nova: "N", self: "我" }[id] || "我");

function setDate() {
  const now = new Date();
  const dateText = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(now);
  document.querySelector("#fullDate").textContent = dateText;
  const hour = now.getHours();
  document.querySelector("#greeting").textContent = `${hour < 11 ? "早上" : hour < 14 ? "中午" : hour < 18 ? "下午" : "晚上"}好，林同学`;
}

function renderAll() {
  renderTasks();
  renderAgents();
  renderHabits();
  renderChart();
  icons();
}

function renderTasks() {
  const done = appState.tasks.filter((task) => task.status === "done").length;
  document.querySelector("#doneCount").textContent = done;
  document.querySelector("#totalCount").textContent = appState.tasks.length;
  document.querySelector("#taskNavCount").textContent = appState.tasks.filter((task) => task.status !== "done").length;
  document.querySelector("#dayProgress").style.width = `${appState.tasks.length ? Math.round(done / appState.tasks.length * 100) : 0}%`;

  const todayList = document.querySelector("#todayTaskList");
  todayList.innerHTML = appState.tasks.slice(0, 6).map((task) => `
    <div class="task-item ${task.status === "done" ? "done" : ""}">
      <button class="task-check" data-task-toggle="${escapeHtml(task.id)}" aria-label="${task.status === "done" ? "恢复" : "完成"}${escapeHtml(task.title)}"><i data-lucide="check"></i></button>
      <div class="task-copy"><strong class="task-title">${escapeHtml(task.title)}</strong><span class="task-meta"><span class="category-tag ${categoryClass(task.category)}">${escapeHtml(task.category)}</span>${escapeHtml(task.duration)} · ${task.status === "doing" ? "进行中" : task.status === "done" ? "已完成" : "待开始"}</span></div>
      <span class="assignee-mini ${escapeHtml(task.assignee)}" title="负责人">${assigneeName(task.assignee)}</span>
      <button class="start-task" data-focus-task="${escapeHtml(task.id)}" aria-label="开始专注"><i data-lucide="play"></i></button>
    </div>`).join("");

  const statusMeta = [
    { id: "todo", title: "待开始" },
    { id: "doing", title: "进行中" },
    { id: "done", title: "已完成" }
  ];
  const filtered = currentFilter === "all" ? appState.tasks : appState.tasks.filter((task) => task.category === currentFilter);
  document.querySelector("#kanbanBoard").innerHTML = statusMeta.map((column) => {
    const tasks = filtered.filter((task) => task.status === column.id);
    return `<section class="kanban-column"><div class="kanban-head"><strong>${column.title}</strong><span>${tasks.length}</span></div><div class="kanban-list">${tasks.length ? tasks.map((task) => `
      <article class="task-card"><span class="category-tag ${categoryClass(task.category)}">${escapeHtml(task.category)}</span><strong>${escapeHtml(task.title)}</strong><div class="task-card-meta"><span>${escapeHtml(task.duration)}</span><span class="assignee-mini ${escapeHtml(task.assignee)}">${assigneeName(task.assignee)}</span></div><div class="task-card-actions">
        ${task.status !== "doing" ? `<button data-task-status="doing" data-task-id="${escapeHtml(task.id)}" title="移到进行中"><i data-lucide="play"></i></button>` : ""}
        ${task.status !== "done" ? `<button data-task-status="done" data-task-id="${escapeHtml(task.id)}" title="标记完成"><i data-lucide="check"></i></button>` : `<button data-task-status="todo" data-task-id="${escapeHtml(task.id)}" title="恢复任务"><i data-lucide="rotate-ccw"></i></button>`}
        <button data-task-edit="${escapeHtml(task.id)}" title="编辑任务"><i data-lucide="pencil"></i></button>
        <button class="danger" data-task-archive="${escapeHtml(task.id)}" title="归档任务（可恢复）"><i data-lucide="archive"></i></button>
      </div></article>`).join("") : `<div class="empty-column">这里暂时很轻盈</div>`}</div></section>`;
  }).join("");
}

const TOOL_LABELS = {
  "state:read": "读取工作台",
  "tasks:create": "新增任务",
  "tasks:update": "更新任务",
  "tasks:archive": "归档任务",
  "schedule:reblock": "调整日程",
  "goals:recalibrate": "校准目标"
};

const AGENT_PURPOSES = {
  atlas: "把学习目标拆成今天能执行、后续能复习的节奏。",
  mira: "守住日程与精力边界，让计划能够持续。",
  nova: "从复盘和趋势中识别偏差，帮助你校准下一步。"
};

function displayAgents() {
  if (agentSystem?.agents?.length) {
    return agentSystem.agents.map((agent) => {
      const stateAgent = appState.agents.find((item) => item.id === agent.id);
      return stateAgent
        ? { ...agent, status: stateAgent.status || agent.status, currentTask: stateAgent.currentTask || agent.currentTask }
        : agent;
    });
  }
  return appState.agents.map((agent) => ({ ...LOCAL_AGENT_META[agent.id], ...agent }));
}

function toolPermission(permission) {
  if (permission === "allow") return { label: "只读", tone: "read" };
  if (permission && typeof permission === "object" && permission.requiresConfirmation) return { label: "需确认", tone: "confirm" };
  if (permission && typeof permission === "object") return { label: "可执行", tone: "allowed" };
  return null;
}

function renderAgents() {
  const agents = displayAgents();
  document.querySelector("#agentActivity").innerHTML = agents.map((agent) => `
    <div class="activity-item"><span class="agent-avatar ${escapeHtml(agent.accent || "blue")}">${escapeHtml(agent.initial || "?")}</span><div class="activity-copy"><strong>${escapeHtml(agent.name)} · ${escapeHtml(agent.role)}</strong><span>${escapeHtml(agent.currentTask || "等待新的协作目标")}</span></div><span class="activity-status ${escapeHtml(agent.status || "idle")}">${agent.status === "working" ? "执行中" : "待命"}</span></div>`).join("");
  document.querySelector("#agentCards").innerHTML = agents.map((agent) => {
    const capabilities = agent.capabilities || [];
    const tools = Object.entries(agent.tools || {})
      .map(([name, permission]) => ({ name, ...toolPermission(permission) }))
      .filter((item) => item.label);
    return `
      <article class="agent-card" data-accent="${escapeHtml(agent.accent || "blue")}">
        <div class="agent-card-top"><span class="agent-avatar ${escapeHtml(agent.accent || "blue")}">${escapeHtml(agent.initial || "?")}</span><span class="agent-state">${agent.status === "working" ? "执行中" : "待命"}</span></div>
        <div class="agent-title"><div><h2>${escapeHtml(agent.name)}</h2><span class="agent-role">${escapeHtml(agent.role)}</span></div><span class="agent-skill-label">${escapeHtml(agent.skillLabel || agent.skill || "独立技能")}</span></div>
        <p class="agent-purpose">${escapeHtml(AGENT_PURPOSES[agent.id] || capabilities.slice(0, 2).join("、") || "根据当前目标提供专业协作建议。")}</p>
        <div class="agent-skill-list" aria-label="专业能力">${capabilities.map((capability) => `<span>${escapeHtml(capability)}</span>`).join("")}</div>
        <div class="agent-tool-list"><strong>工具权限</strong>${tools.map((tool) => `<span><b>${escapeHtml(TOOL_LABELS[tool.name] || tool.name)}</b><em class="${tool.tone}">${tool.label}</em></span>`).join("")}</div>
      </article>`;
  }).join("");
}

function renderHabits() {
  document.querySelector("#habitRow").innerHTML = appState.habits.map((habit) => `
    <button class="habit-button ${habit.completed ? "completed" : ""}" data-habit-id="${habit.id}"><span class="habit-icon"><i data-lucide="${habit.completed ? "check" : habit.icon}"></i></span><strong>${habit.name}</strong><small>${habit.target}</small></button>`).join("");
  document.querySelector("#habitDetailGrid").innerHTML = appState.habits.map((habit) => `
    <article class="habit-detail"><div class="habit-detail-head"><span class="habit-icon"><i data-lucide="${habit.icon}"></i></span><button class="habit-toggle ${habit.completed ? "done" : ""}" data-habit-id="${habit.id}" aria-label="切换${habit.name}"><i data-lucide="check"></i></button></div><h3>${habit.name}</h3><p>今日目标 · ${habit.target}</p><div class="habit-streak"><span>连续坚持</span><strong>${habit.streak} 天</strong></div></article>`).join("");
}

function renderChart() {
  const values = [58, 72, 45, 83, 67, 91, 76];
  const days = ["周一", "周二", "周三", "周四", "周五", "周六", "今天"];
  document.querySelector("#weekChart").innerHTML = values.map((value, index) => `<div class="chart-day ${index === 6 ? "today" : ""}"><div class="chart-bar-wrap"><span class="chart-bar" style="height:${value}%" title="完成度 ${value}%"></span></div><span>${days[index]}</span></div>`).join("");
}

const RUN_STATUS_LABEL = { running: "运行中", completed: "成功", failed: "失败", awaiting_confirmation: "等待确认", partially_confirmed: "部分确认" };
const runStatusLabel = (status) => RUN_STATUS_LABEL[status] || status;
const agentMeta = (id) => displayAgents().find((agent) => agent.id === id) || LOCAL_AGENT_META[id] || { id, name: id, accent: "blue", initial: "?" };

function renderRunList(runs) {
  runsCache = runs;
  const nav = document.querySelector("#runNavCount");
  if (nav) {
    const pending = runs.filter((run) => run.status === "awaiting_confirmation").length;
    nav.textContent = runs.length;
    nav.title = pending ? `${pending} 次运行等待确认` : "运行记录";
  }
  const container = document.querySelector("#runList");
  if (!container) return;
  if (!runs.length) {
    container.innerHTML = `<div class="run-empty"><i data-lucide="inbox"></i><span>还没有运行记录<br>在上方输入一个目标开始协作</span></div>`;
    icons();
    return;
  }
  container.innerHTML = runs.map((run) => `
    <button class="run-list-item ${run.id === currentRunId ? "active" : ""}" data-run-open="${escapeHtml(run.id)}">
      <strong>${escapeHtml(run.goal)}</strong>
      <span class="run-list-meta">
        <span class="status-chip ${escapeHtml(run.status)}">${runStatusLabel(run.status)}</span>
        <span>${run.callCount} 次调用</span>
        ${run.conflictCount ? `<span>${run.conflictCount} 处冲突</span>` : ""}
        ${run.pendingConfirmations ? `<span>${run.pendingConfirmations} 待确认</span>` : ""}
      </span>
    </button>`).join("");
  icons();
}

function renderRunDetail(run) {
  const container = document.querySelector("#runDetail");
  if (!container) return;
  container.classList.toggle("empty-state", !run);
  if (!run) {
    container.innerHTML = `<div class="run-empty"><i data-lucide="route"></i><span>选择左侧一次运行<br>查看 Orchestrator 的拆解与调用过程</span></div>`;
    icons();
    return;
  }
  const provider = run.provider || {};
  const plan = run.plan || { tasks: [] };
  const conflicts = run.conflicts || [];
  const pendingProposals = (run.proposals || []).filter((proposal) => proposal.status === "pending" && proposal.actionable !== false);
  const calls = run.calls || [];

  const callsHtml = calls.map((call) => {
    const meta = agentMeta(call.agentId);
    const output = call.output || {};
    const steps = (output.steps || []).map((step) => `<li><span>${escapeHtml(step.title)}</span></li>`).join("");
    return `
    <article class="run-call ${call.status === "failed" ? "failed" : ""}">
      <div class="run-call-head">
        <span class="agent-avatar ${meta.accent}">${meta.initial}</span>
        <div class="run-call-title"><strong>#${call.order} ${escapeHtml(call.agentName)}</strong><span>${escapeHtml(call.title || run.goal)}</span></div>
        <span class="status-chip ${call.status === "completed" ? "completed" : "failed"}">${call.status === "completed" ? "完成" : "失败"}</span>
      </div>
      <div class="run-call-tags">
        ${call.viaHandoff ? `<span class="tag handoff">handoff ← ${escapeHtml(call.viaHandoff.from)}</span>` : ""}
        ${call.provider ? `<span class="tag">${escapeHtml(call.provider)}${call.degraded ? " · 降级" : ""}</span>` : ""}
        ${typeof call.durationMs === "number" ? `<span class="tag">${call.durationMs} ms</span>` : ""}
      </div>
      ${output.summary ? `<p class="run-hint">${escapeHtml(output.summary)}</p>` : ""}
      ${steps ? `<ul class="run-call-steps">${steps}</ul>` : ""}
      ${call.error ? `<p class="run-call-error">错误：${escapeHtml(call.error)}</p>` : ""}
    </article>`;
  }).join("");

  const conflictsHtml = conflicts.map((conflict) => `
    <div class="run-conflict"><strong>冲突 · ${escapeHtml(conflict.topic)}（${escapeHtml(conflict.agents.join(" / "))}）</strong><p>${escapeHtml(conflict.detail)}</p><p>处理：${escapeHtml(conflict.resolution)}</p></div>`).join("");

  // 建议分四类渲染：已处理（带结果标签）、不可执行（只说明原因）、队列内（可确认）、低优先级（折叠后可单独执行）。
  const settledLabel = { applied: "已执行", rejected: "已放弃", failed: "执行失败" };
  const proposalCard = (proposal) => {
    const reason = proposal.blockedReason ? `<p class="proposal-blocked">${escapeHtml(proposal.blockedReason)}</p>` : "";
    if (settledLabel[proposal.status]) {
      return `<div class="run-proposal"><strong>${escapeHtml(proposal.title)} · ${settledLabel[proposal.status]}</strong><p>${escapeHtml(proposal.detail)}</p></div>`;
    }
    if (proposal.status === "unsupported" || proposal.actionable === false) {
      return `<div class="run-proposal blocked"><strong>${escapeHtml(proposal.title)} · 不可执行</strong><p>${escapeHtml(proposal.detail)}</p>${reason}</div>`;
    }
    if (proposal.status === "deferred") {
      return `<div class="run-proposal"><strong>${escapeHtml(proposal.title)}</strong><p>${escapeHtml(proposal.detail)}</p>${reason}<div class="proposal-actions"><button class="approve quiet" data-run-decision="approve" data-run-proposal="${escapeHtml(proposal.id)}" data-run-id="${escapeHtml(run.id)}">仍然执行</button></div></div>`;
    }
    return `<div class="run-proposal"><strong>${escapeHtml(proposal.title)}</strong><p>${escapeHtml(proposal.detail)}</p>${reason}<div class="proposal-actions"><button class="approve" data-run-decision="approve" data-run-proposal="${escapeHtml(proposal.id)}" data-run-id="${escapeHtml(run.id)}">确认执行</button><button class="reject" data-run-decision="reject" data-run-proposal="${escapeHtml(proposal.id)}" data-run-id="${escapeHtml(run.id)}">暂不执行</button></div></div>`;
  };
  const allProposals = run.proposals || [];
  const queueProposals = allProposals
    .filter((proposal) => proposal.status === "pending")
    .sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9));
  const deferredProposals = allProposals.filter((proposal) => proposal.status === "deferred");
  const settledProposals = allProposals.filter((proposal) => !["pending", "deferred"].includes(proposal.status));  const proposalsHtml = [...queueProposals, ...settledProposals].map(proposalCard).join("");
  const deferredHtml = deferredProposals.length
    ? `<details class="run-proposals run-deferred"><summary>另有 ${deferredProposals.length} 条较低优先级建议（未列入确认队列，可单独执行）</summary>${deferredProposals.map(proposalCard).join("")}</details>`
    : "";

  const recommendations = (run.result?.recommendations || []).map((item) => `
    <div class="run-final-item"><span class="source">${escapeHtml(item.source)}</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></div>`).join("");

  const memoryFacts = (run.memory?.facts || []).slice(-8).map((fact) => `<span>${escapeHtml(fact.key)} ← ${escapeHtml(fact.source)}</span>`).join("");
  const memoryConstraints = (run.memory?.constraints || []).map((constraint) => `<span>约束 · ${escapeHtml(constraint.label)} ← ${escapeHtml(constraint.agentId || "system")}</span>`).join("");
  const messages = (run.messages || []).slice(-10).map((message) => `<li>${escapeHtml(message.from)} → ${escapeHtml(message.to)}：${escapeHtml(message.summary)}</li>`).join("");

  container.innerHTML = `
    <div class="run-detail-head">
      <div><h3>${escapeHtml(run.goal)}</h3><p>${escapeHtml(run.id)} · ${run.strategy === "parallel" ? "并行" : "串行"} · ${escapeHtml(provider.label || provider.used || "")}${provider.degraded ? "（已降级）" : ""}</p></div>
      <span class="status-chip ${escapeHtml(run.status)}">${runStatusLabel(run.status)}</span>
    </div>
    ${run.status === "running" ? `<p class="run-hint"><i data-lucide="loader-circle" class="spin"></i> 协作进行中，Orchestrator 正在拆分与调用…</p>` : ""}
    ${run.error ? `<p class="run-call-error">运行失败：${escapeHtml(run.error.message)}</p>` : ""}
    <div class="run-summary">${escapeHtml(run.result?.summary || plan.summary || "等待结果")}</div>
    <div class="run-section"><h4>执行计划</h4><div class="run-memory">${plan.tasks.map((task) => `<span>${escapeHtml(task.agentId)} · ${escapeHtml(task.title)}</span>`).join("") || "<span>暂无</span>"}</div></div>
    <div class="run-section"><h4>调用轨迹</h4><div class="run-timeline">${callsHtml || `<p class="run-hint">暂无调用</p>`}</div></div>
    ${conflictsHtml ? `<div class="run-section"><h4>冲突与调和</h4>${conflictsHtml}</div>` : ""}
    ${proposalsHtml ? `<div class="run-section"><h4>建议与确认</h4><div class="run-proposals">${proposalsHtml}</div></div>` : ""}
    ${deferredHtml ? `<div class="run-section">${deferredHtml}</div>` : ""}
    ${pendingProposals.length > 1 ? `<div class="run-section"><button class="secondary-button" data-run-approve-all="${escapeHtml(run.id)}">全部确认（${pendingProposals.length}）</button></div>` : ""}
    ${recommendations ? `<div class="run-section"><h4>合并方案</h4><div class="run-final">${recommendations}</div></div>` : ""}
    <div class="run-section"><h4>共享上下文</h4><div class="run-memory">${memoryConstraints}${memoryFacts || (memoryConstraints ? "" : "<span>暂无</span>")}</div></div>
    ${messages ? `<div class="run-section"><h4>协作消息</h4><ul class="run-notes">${messages}</ul></div>` : ""}
    ${(run.result?.notes || []).length ? `<div class="run-section"><h4>备注</h4><ul class="run-notes">${run.result.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul></div>` : ""}
  `;
  icons();
}

async function refreshRunList() {
  try {
    const { runs } = await api.listAgentRuns();
    renderRunList(runs);
    if (!currentRunId && runs.length && activeView === "runs") await loadRun(runs[0].id);
  } catch {
    // 保留已有列表。
  }
}

let runPollTimer = null;

function scheduleRunPolling(id) {
  clearTimeout(runPollTimer);
  runPollTimer = setTimeout(async () => {
    try {
      const run = await api.getAgentRun(id);
      if (currentRunId !== id || !run) return;
      renderRunDetail(run);
      if (run.status === "running") {
        scheduleRunPolling(id);
        return;
      }
      await refreshRunList();
      appState = await api.getState();
      renderTasks();
      renderAgents();
      icons();
    } catch {
      // 轮询失败时停止，用户可手动刷新。
    }
  }, 450);
}

async function loadRun(id) {
  try {
    const run = await api.getAgentRun(id);
    if (!run) return;
    currentRunId = id;
    renderRunDetail(run);
    renderRunList(runsCache);
    if (run.status === "running") scheduleRunPolling(id);
  } catch (error) {
    showToast(error.message);
  }
}

async function startRun(goal, strategy) {
  if (!goal.trim()) return showToast("先写下你想推进的目标");
  const button = document.querySelector("#runGoalSend");
  if (button) {
    button.disabled = true;
    button.innerHTML = `<i data-lucide="loader-circle" class="spin"></i>`;
    icons();
  }
  try {
    const run = await api.startAgentRun(goal.trim(), { strategy });
    currentRunId = run.id;
    // 写入专属链接，但不触发重新渲染，避免打断轮询。
    history.replaceState(null, "", `#/runs/${encodeURIComponent(run.id)}`);
    renderRunDetail(run);
    await refreshRunList();
    if (run.status === "running") scheduleRunPolling(run.id);
    showToast(run.status === "awaiting_confirmation" ? "方案已生成，有高影响调整需要你确认" : "协作完成");
  } catch (error) {
    showToast(error.message);
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = `<i data-lucide="play"></i>`;
      icons();
    }
  }
}

async function refreshAfterDecision(runId) {
  const run = await api.getAgentRun(runId);
  renderRunDetail(run);
  await refreshRunList();
  appState = await api.getState();
  renderTasks();
  renderAgents();
  icons();
}

async function decideProposal(runId, proposalId, decision) {
  try {
    await api.confirmAgentRun(runId, [{ proposalId, decision }]);
    await refreshAfterDecision(runId);
    showToast(decision === "approve" ? "已按你的决定执行" : "已跳过该建议");
  } catch (error) {
    showToast(error.message);
  }
}

async function approveAll(runId) {
  try {
    const run = await api.getAgentRun(runId);
    const pending = (run.proposals || []).filter((proposal) => proposal.status === "pending");
    if (!pending.length) return;
    await api.confirmAgentRun(runId, pending.map((proposal) => ({ proposalId: proposal.id, decision: "approve" })));
    await refreshAfterDecision(runId);
    showToast("已确认全部高影响调整");
  } catch (error) {
    showToast(error.message);
  }
}

async function loadAgentSystem() {
  try {
    const system = await api.getAgentSystem();
    agentSystem = system;
    const badge = document.querySelector("#providerBadge");
    if (badge) {
      const provider = system.provider || {};
      badge.classList.toggle("degraded", Boolean(provider.degraded));
      badge.querySelector("span").textContent = provider.degraded
        ? `${provider.label || provider.used} · 已降级为 ${provider.used}`
        : (provider.label || provider.used || "规则引擎");
      badge.title = provider.reason || "当前 Agent 推理来源";
    }
    const status = document.querySelector(".status-pill");
    if (status) status.lastChild.textContent = `${system.agents?.length || 0} 个 Agent 在线`;
    renderAgents();
    icons();
  } catch {
    // 保持默认徽标。
  }
}

function parseRoute() {
  const raw = String(location.hash || "").replace(/^#\/?/, "");
  const [view, param] = raw.split("/");
  const resolved = view === "agents" ? "runs" : view;
  return { view: VIEWS.includes(resolved) ? resolved : "overview", param: param ? decodeURIComponent(param) : null };
}

function switchView(view) {
  activeView = view;
  document.querySelectorAll(".view").forEach((element) => element.classList.toggle("active", element.id === `view-${view}`));
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  const quickAdd = document.querySelector("#quickAddButton");
  if (quickAdd) quickAdd.classList.toggle("context-hidden", view === "runs");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/** 导航：写入 hash，由 hashchange 统一渲染，保证每个视图都有可打开的专属链接。 */
function navigate(view, param) {
  const target = param ? `#/${view}/${encodeURIComponent(param)}` : `#/${view}`;
  if (location.hash === target) applyRoute();
  else location.hash = target;
}

/** 进入运行轨迹但未指定 runId 时，自动打开最近一次运行。 */
async function openLatestRun() {
  try {
    const { runs } = await api.listAgentRuns();
    renderRunList(runs);
    if (!runs.length) {
      currentRunId = null;
      renderRunDetail(null);
      return;
    }
    const latest = runs[0];
    currentRunId = latest.id;
    // 写入专属链接，但不触发重新渲染。
    history.replaceState(null, "", `#/runs/${encodeURIComponent(latest.id)}`);
    renderRunDetail(await api.getAgentRun(latest.id));
    if (latest.status === "running") scheduleRunPolling(latest.id);
  } catch (error) {
    showToast(error.message);
  }
}

/** 解析当前 hash 并渲染对应视图；刷新与粘贴链接都走这里。 */
function applyRoute() {
  const { view, param } = parseRoute();
  switchView(view);
  if (view === "runs") {
    if (param) loadRun(param);
    else openLatestRun();
  }
  if (view === "archive") renderArchive();
}

function openModal(id) {
  const modal = document.querySelector(id);
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  setTimeout(() => modal.querySelector("input, textarea")?.focus(), 100);
}

function closeModals() {
  document.querySelectorAll(".modal-backdrop.open").forEach((modal) => {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  });
  confirmAction = null;
  editingTaskId = null;
}

function openCreateTask() {
  editingTaskId = null;
  document.querySelector("#taskModalTitle").textContent = "添加一个行动";
  document.querySelector("#taskForm").reset();
  openModal("#taskModal");
}

function openEditTask(id) {
  const task = appState.tasks.find((item) => item.id === id);
  if (!task) return;
  editingTaskId = id;
  document.querySelector("#taskModalTitle").textContent = `编辑「${task.title}」`;
  document.querySelector("#taskTitle").value = task.title;
  document.querySelector("#taskCategory").value = task.category;
  setSelectValue(document.querySelector("#taskDuration"), task.duration);
  setSelectValue(document.querySelector("#taskAgent"), task.assignee);
  openModal("#taskModal");
}

function askConfirm(message, acceptLabel, action) {
  confirmAction = action;
  document.querySelector("#confirmText").textContent = message;
  document.querySelector("#confirmAccept").innerHTML = `<i data-lucide="check"></i>${acceptLabel}`;
  openModal("#confirmModal");
  icons();
}

function confirmArchive(id) {
  const task = appState.tasks.find((item) => item.id === id);
  if (!task) return;
  askConfirm(`归档「${task.title}」？归档是软删除，之后可以在归档箱恢复。`, "确认归档", async () => {
    try {
      await api.archiveTask(id);
      appState.tasks = appState.tasks.filter((item) => item.id !== id);
      renderTasks();
      icons();
      await renderArchive();
      showToast(`已归档：${task.title}`);
    } catch (error) {
      showToast(error.message);
    }
  });
}

async function restoreTask(id) {
  try {
    const task = await api.restoreTask(id);
    appState = await api.getState();
    renderTasks();
    icons();
    await renderArchive();
    showToast(task ? `已恢复：${task.title}` : "任务已恢复");
  } catch (error) {
    showToast(error.message);
  }
}

async function renderArchive() {
  const list = document.querySelector("#archiveList");
  if (!list) return;
  try {
    const { tasks } = await api.listArchivedTasks();
    const navCount = document.querySelector("#archiveNavCount");
    if (navCount) navCount.textContent = tasks.length;
    const label = document.querySelector("#archiveCountLabel");
    if (label) label.textContent = `${tasks.length} 项`;
    if (!tasks.length) {
      list.innerHTML = `<div class="run-empty"><i data-lucide="archive"></i><span>归档箱是空的<br>被归档的任务会出现在这里，可随时恢复</span></div>`;
      icons();
      return;
    }
    list.innerHTML = tasks
      .map(
        (task) => `
      <div class="archive-item">
        <div class="archive-copy"><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(task.category)} · ${escapeHtml(task.duration)} · 归档于 ${formatDateTime(task.archivedAt)}${task.archivedBy ? ` · 由 ${escapeHtml(task.archivedBy)}` : ""}</span></div>
        <button class="archive-restore" data-task-restore="${escapeHtml(task.id)}"><i data-lucide="rotate-ccw"></i>恢复</button>
      </div>`
      )
      .join("");
    icons();
  } catch (error) {
    showToast(error.message);
  }
}

let toastTimeout;
function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.querySelector("span").textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("show"), 2800);
}

async function changeTask(id, status) {
  const task = appState.tasks.find((item) => item.id === id);
  if (!task) return;
  try {
    await api.updateTask(id, status);
    task.status = status;
    renderTasks();
    icons();
    showToast(status === "done" ? `完成：${task.title}` : "任务状态已更新");
  } catch (error) {
    showToast(error.message);
  }
}

async function toggleHabit(id) {
  try {
    const updated = await api.toggleHabit(id);
    const habit = appState.habits.find((item) => item.id === id);
    if (habit) habit.completed = updated.completed;
    renderHabits();
    icons();
    showToast(`${updated.name} · ${updated.completed ? "今日已完成" : "已取消"}`);
  } catch (error) {
    showToast(error.message);
  }
}

function formatTimer(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function renderTimer() {
  const value = formatTimer(timer.remaining);
  document.querySelector("#timerDisplay").textContent = value;
  document.querySelector("#focusRoomTimer").textContent = value;
  document.querySelector("#timerLabel").textContent = timer.running ? "保持节奏" : timer.remaining < timer.total ? "已暂停" : "准备专注";
  const offset = 433.54 * (1 - timer.remaining / timer.total);
  document.querySelector("#timerArc").style.strokeDashoffset = offset;
  document.querySelectorAll("#timerButton, #focusRoomButton").forEach((button) => {
    button.innerHTML = `<i data-lucide="${timer.running ? "pause" : "play"}"></i><span>${timer.running ? "暂停一下" : timer.remaining < timer.total ? "继续专注" : "开始这一轮"}</span>`;
  });
  icons();
}

function toggleTimer() {
  timer.running = !timer.running;
  if (timer.running) {
    timer.interval = setInterval(() => {
      timer.remaining -= 1;
      if (timer.remaining <= 0) {
        clearInterval(timer.interval);
        timer.running = false;
        timer.remaining = timer.total;
        showToast("这一轮完成了，起来活动一下吧");
      }
      renderTimer();
    }, 1000);
  } else {
    clearInterval(timer.interval);
  }
  renderTimer();
}

function chooseFocusTask(taskId) {
  const available = appState.tasks.filter((task) => task.status !== "done");
  const task = appState.tasks.find((item) => item.id === taskId) || available[focusTaskIndex % Math.max(available.length, 1)];
  if (!task) return;
  focusTaskIndex = Math.max(0, available.findIndex((item) => item.id === task.id));
  document.querySelector("#focusTaskName").textContent = task.title;
  document.querySelector("#focusRoomTask").textContent = task.title;
}

async function sendCommand(command) {
  if (!command.trim()) return showToast("先告诉 Agent 你想推进什么");
  document.querySelector("#agentCommand").value = "";
  const goal = command.trim();
  const runGoal = document.querySelector("#runGoal");
  if (runGoal) runGoal.value = goal;
  navigate("runs");
  await startRun(goal, document.querySelector("#runStrategy")?.value || "auto");
}

function bindEvents() {
  document.addEventListener("click", async (event) => {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) navigate(viewButton.dataset.view);
    const viewTarget = event.target.closest("[data-view-target]");
    if (viewTarget) navigate(viewTarget.dataset.viewTarget);
    if (event.target.closest("[data-add-task], #quickAddButton")) openCreateTask();
    if (event.target.closest("#reviewButton")) openModal("#reviewModal");
    if (event.target.closest("[data-close-modal]")) closeModals();
    if (event.target.classList.contains("modal-backdrop")) closeModals();

    const taskToggle = event.target.closest("[data-task-toggle]");
    if (taskToggle) {
      const task = appState.tasks.find((item) => item.id === taskToggle.dataset.taskToggle);
      if (task) await changeTask(task.id, task.status === "done" ? "todo" : "done");
    }
    const statusButton = event.target.closest("[data-task-status]");
    if (statusButton) await changeTask(statusButton.dataset.taskId, statusButton.dataset.taskStatus);
    const habitButton = event.target.closest("[data-habit-id]");
    if (habitButton) await toggleHabit(habitButton.dataset.habitId);
    const focusButton = event.target.closest("[data-focus-task]");
    if (focusButton) { chooseFocusTask(focusButton.dataset.focusTask); navigate("focus"); }
    const editButton = event.target.closest("[data-task-edit]");
    if (editButton) openEditTask(editButton.dataset.taskEdit);
    const archiveButton = event.target.closest("[data-task-archive]");
    if (archiveButton) confirmArchive(archiveButton.dataset.taskArchive);
    const restoreButton = event.target.closest("[data-task-restore]");
    if (restoreButton) await restoreTask(restoreButton.dataset.taskRestore);
    const runOpen = event.target.closest("[data-run-open]");
    if (runOpen) navigate("runs", runOpen.dataset.runOpen);
    const runDecision = event.target.closest("[data-run-decision]");
    if (runDecision) await decideProposal(runDecision.dataset.runId, runDecision.dataset.runProposal, runDecision.dataset.runDecision);
    const approveAllButton = event.target.closest("[data-run-approve-all]");
    if (approveAllButton) await approveAll(approveAllButton.dataset.runApproveAll);
    const moodButton = event.target.closest("[data-mood]");
    if (moodButton) {
      selectedMood = [...moodButton.parentElement.children].indexOf(moodButton) + 1;
      moodButton.parentElement.querySelectorAll("button").forEach((button) => button.classList.toggle("selected", button === moodButton));
    }
  });

  document.querySelectorAll(".filter").forEach((button) => button.addEventListener("click", () => {
    currentFilter = button.dataset.filter;
    document.querySelectorAll(".filter").forEach((item) => item.classList.toggle("active", item === button));
    renderTasks();
    icons();
  }));

  document.querySelector("#taskForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = { title: document.querySelector("#taskTitle").value.trim(), category: document.querySelector("#taskCategory").value, duration: document.querySelector("#taskDuration").value, assignee: document.querySelector("#taskAgent").value };
    try {
      if (editingTaskId) {
        const updated = await api.updateTask(editingTaskId, input);
        const task = appState.tasks.find((item) => item.id === editingTaskId);
        if (task && updated) Object.assign(task, updated);
        closeModals();
        event.target.reset();
        renderTasks();
        icons();
        showToast("任务已更新");
        return;
      }
      const task = await api.createTask(input);
      appState.tasks.unshift(task);
      renderTasks();
      icons();
      closeModals();
      event.target.reset();
      showToast("已加入任务流");
    } catch (error) { showToast(error.message); }
  });

  document.querySelector("#confirmAccept").addEventListener("click", async () => {
    const action = confirmAction;
    confirmAction = null;
    closeModals();
    if (action) await action();
  });

  document.querySelector("#reviewForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const review = await api.createReview({ win: document.querySelector("#reviewWin").value.trim(), adjust: document.querySelector("#reviewAdjust").value.trim(), mood: selectedMood });
      appState.reviews.unshift(review);
      closeModals();
      event.target.reset();
      showToast("复盘已保存，今天辛苦了");
    } catch (error) { showToast(error.message); }
  });

  document.querySelector("#sendCommand").addEventListener("click", () => sendCommand(document.querySelector("#agentCommand").value));
  document.querySelector("#agentCommand").addEventListener("keydown", (event) => { if (event.key === "Enter") sendCommand(event.target.value); });
  document.querySelector("#runGoalSend").addEventListener("click", () => startRun(document.querySelector("#runGoal").value, document.querySelector("#runStrategy").value));
  document.querySelector("#runGoal").addEventListener("keydown", (event) => { if (event.key === "Enter") startRun(event.target.value, document.querySelector("#runStrategy").value); });
  document.querySelector("#runRefresh").addEventListener("click", refreshRunList);
  document.querySelector("#briefAllButton").addEventListener("click", () => sendCommand("请一起整理我今天最重要的学习、生活和成长行动"));
  document.querySelector("#timerButton").addEventListener("click", toggleTimer);
  document.querySelector("#focusRoomButton").addEventListener("click", toggleTimer);
  document.querySelector("#cycleTaskButton").addEventListener("click", () => {
    const available = appState.tasks.filter((task) => task.status !== "done");
    focusTaskIndex = (focusTaskIndex + 1) % Math.max(available.length, 1);
    chooseFocusTask(available[focusTaskIndex]?.id);
  });
  document.querySelector("#adoptSuggestion").addEventListener("click", () => {
    openCreateTask();
    document.querySelector("#taskTitle").value = "上午 9:00 完成最难的学习任务";
    document.querySelector("#taskCategory").value = "学习";
    document.querySelector("#taskAgent").value = "atlas";
  });
  document.querySelector("#notificationButton").addEventListener("click", () => showToast("没有未读通知，专心做自己的事吧"));
  document.querySelector("#profileButton").addEventListener("click", () => showToast(`当前为${api.mode === "api" ? "服务端持久化" : "本地离线"}模式`));
  document.querySelector("#menuButton").addEventListener("click", () => showToast("请使用底部导航切换模块"));
  document.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "n" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) openModal("#taskModal");
    if (event.key === "Escape") closeModals();
  });
}

async function init() {
  setDate();
  appState = await api.getState();
  renderAll();
  bindEvents();
  renderRunDetail(null);
  chooseFocusTask();
  renderTimer();
  window.addEventListener("hashchange", applyRoute);
  await loadAgentSystem();
  applyRoute();
  await renderArchive();
  setTimeout(icons, 250);
  if (api.mode === "local") showToast("当前使用本地离线模式，数据会保存在此浏览器");
}

document.addEventListener("DOMContentLoaded", init);
