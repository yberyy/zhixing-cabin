import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MemoryRepository, seedState } from "../server/repository.mjs";
import {
  AgentRegistry,
  DEFAULT_DEFINITIONS_DIR,
  DEFAULT_INSTRUCTIONS_DIR,
  MemoryRunRepository,
  SKILL_IDS,
  createAgentSystem,
  loadAgentDefinition,
  loadAgentDefinitions,
  routeCommand
} from "../server/agents/index.mjs";

const BUILT_IN_FILES = ["atlas.json", "mira.json", "nova.json"];
const BUILT_IN_INSTRUCTIONS = ["atlas.md", "mira.md", "nova.md"];

function baseDefinition(overrides = {}) {
  return {
    id: "atlas",
    name: "Atlas",
    role: "学习教练",
    skill: "study-coach",
    instruction: "atlas.md",
    capabilities: ["目标拆解"],
    protocol: { input: ["goal"], output: ["summary"] },
    tools: { "state:read": "allow" },
    routing: ["学习"],
    ...overrides
  };
}

async function withTempConfig(run) {
  const dir = await mkdtemp(join(tmpdir(), "zhixing-defs-"));
  try {
    const definitionsDir = join(dir, "definitions");
    const instructionsDir = join(dir, "instructions");
    await mkdir(definitionsDir, { recursive: true });
    await mkdir(instructionsDir, { recursive: true });
    await run({ definitionsDir, instructionsDir, dir });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeAgent({ definitionsDir, instructionsDir }, fileName, definition, { writeInstruction = true } = {}) {
  await writeFile(join(definitionsDir, fileName), JSON.stringify(definition, null, 2), "utf8");
  if (writeInstruction && typeof definition.instruction === "string") {
    await writeFile(join(instructionsDir, definition.instruction), `测试指令：${definition.name} 仅用于校验。`, "utf8");
  }
}

async function copyBuiltIns({ definitionsDir, instructionsDir }) {
  for (const fileName of BUILT_IN_FILES) {
    await writeFile(join(definitionsDir, fileName), await readFile(join(DEFAULT_DEFINITIONS_DIR, fileName), "utf8"), "utf8");
  }
  for (const fileName of BUILT_IN_INSTRUCTIONS) {
    await writeFile(join(instructionsDir, fileName), await readFile(join(DEFAULT_INSTRUCTIONS_DIR, fileName), "utf8"), "utf8");
  }
}

/** 定义加载是同步过程，这里直接捕获同步抛错。 */
function expectInvalid(fn, matcher) {
  let error;
  try {
    fn();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, "应当抛出 AgentDefinitionError，但实际没有抛错");
  assert.equal(error.code, "AGENT_DEFINITION_INVALID");
  assert.match(error.message, matcher);
}

test("loads and validates the built-in agent definitions", () => {
  const definitions = loadAgentDefinitions();
  assert.deepEqual(definitions.map((item) => item.id), ["atlas", "mira", "nova"]);
  for (const definition of definitions) {
    assert.ok(SKILL_IDS.includes(definition.skill), `${definition.id} 的技能应已注册`);
    assert.ok(definition.instruction.length > 20);
    assert.ok(definition.routing.length > 0, `${definition.id} 需要路由关键词`);
    assert.equal(typeof definition.instructionFile, "string");
    assert.equal(definition.enabled, true);
  }
  assert.equal(definitions.find((item) => item.id === "nova").routingDefault, true);
  assert.equal(definitions.find((item) => item.id === "atlas").tools["goals:recalibrate"], "deny");
  assert.equal(definitions.find((item) => item.id === "atlas").tools["tasks:archive"], "deny");
  assert.equal(definitions.find((item) => item.id === "mira").tools["tasks:archive"].requiresConfirmation, true);
  assert.equal(definitions.find((item) => item.id === "mira").tools["tasks:archive"].maxPerRun, 1);
});

test("assembles agents with skill, instruction and routing metadata", () => {
  const registry = AgentRegistry.createDefault();
  const described = registry.describe();
  assert.deepEqual(described.map((agent) => agent.id), ["atlas", "mira", "nova"]);
  assert.deepEqual(described.map((agent) => agent.skill), ["study-coach", "rhythm-check", "trend-review"]);
  assert.equal(described[0].instructionFile, "atlas.md");
  assert.equal(described[0].definitionFile, "atlas.json");
  assert.ok(described[0].routing.includes("复习"));
  assert.equal(registry.get("atlas").skillId, "study-coach");
});

test("exposes the externalized orchestrator instruction", () => {
  const system = createAgentSystem({
    repository: new MemoryRepository(seedState),
    runRepository: new MemoryRunRepository(),
    env: { AI_PROVIDER: "rules" }
  });
  const described = system.describe();
  assert.equal(described.orchestrator.id, "orchestrator");
  assert.match(described.orchestrator.instruction, /Orchestrator/);
  assert.equal(described.orchestrator.instructionFile, "server/agents/instructions/orchestrator.md");
});

test("rejects an unknown skill at load time", async () => {
  await withTempConfig(async (dirs) => {
    await writeAgent(dirs, "atlas.json", baseDefinition({ skill: "no-such-skill" }));
    expectInvalid(() => loadAgentDefinitions(dirs), /未注册的技能/);
  });
});

test("rejects an unknown tool at load time", async () => {
  await withTempConfig(async (dirs) => {
    await writeAgent(dirs, "atlas.json", baseDefinition({ tools: { "state:read": "allow", "shell:run": "allow" } }));
    expectInvalid(() => loadAgentDefinitions(dirs), /未知工具/);
  });
});

test("rejects a definition with a missing required field or bad tool risk", async () => {
  await withTempConfig(async (dirs) => {
    await writeAgent(dirs, "atlas.json", baseDefinition({ role: "" }));
    expectInvalid(() => loadAgentDefinitions(dirs), /缺少必填字段 role/);
    await writeAgent(dirs, "atlas.json", baseDefinition({ tools: { "tasks:create": { risk: "medium" } } }));
    expectInvalid(() => loadAgentDefinitions(dirs), /risk 只能是 low 或 high/);
  });
});

test("rejects duplicate agent ids", async () => {
  await withTempConfig(async (dirs) => {
    await writeAgent(dirs, "atlas.json", baseDefinition());
    await writeAgent(dirs, "atlas-2.json", baseDefinition({ name: "Atlas 复制" }));
    expectInvalid(() => loadAgentDefinitions(dirs), /id "atlas" 重复/);
  });
});

test("rejects invalid JSON and missing instruction files with the offending file name", async () => {
  await withTempConfig(async (dirs) => {
    await writeFile(join(dirs.definitionsDir, "atlas.json"), "{ \"id\": ", "utf8");
    expectInvalid(() => loadAgentDefinitions(dirs), /atlas\.json 校验失败：不是合法 JSON/);
    await writeAgent(dirs, "atlas.json", baseDefinition({ instruction: "missing.md" }), { writeInstruction: false });
    expectInvalid(() => loadAgentDefinitions(dirs), /找不到 Agent 指令文件/);
  });
});

test("excludes disabled definitions from the registry", async () => {
  await withTempConfig(async (dirs) => {
    await writeAgent(dirs, "atlas.json", baseDefinition({ enabled: false }));
    await writeAgent(dirs, "mira.json", baseDefinition({ id: "mira", name: "Mira", role: "生活管家", skill: "rhythm-check", instruction: "mira.md", routing: ["作息"] }));
    const definitions = loadAgentDefinitions(dirs);
    assert.deepEqual(definitions.map((item) => item.id), ["mira"]);
    assert.throws(() => loadAgentDefinition("atlas", dirs), (error) => error.code === "AGENT_DEFINITION_INVALID");
  });
});

test("routes by definition keywords and falls back to routingDefault", () => {
  const registry = AgentRegistry.createDefault();
  assert.equal(routeCommand("帮我安排明天的数学复习", registry), "atlas");
  assert.equal(routeCommand("今晚想早点睡，调整一下作息", registry), "mira");
  assert.equal(routeCommand("周末复盘一下这周的目标", registry), "nova");
  assert.equal(routeCommand("随便聊聊最近的状态", registry), "nova");
  assert.equal(routeCommand("帮我拆解数学复习计划"), "atlas");
  assert.equal(routeCommand(""), "nova");
});

test("a definition-only agent joins orchestration without touching the orchestrator", async () => {
  await withTempConfig(async (dirs) => {
    await copyBuiltIns(dirs);
    await writeAgent(dirs, "ledger.json", {
      id: "ledger",
      name: "Ledger",
      role: "财务管家",
      accent: "yellow",
      skill: "trend-review",
      instruction: "ledger.md",
      capabilities: ["预算复盘"],
      protocol: { input: ["goal"], output: ["summary", "steps"] },
      tools: { "state:read": "allow", "tasks:create": { risk: "low", maxPerRun: 1 } },
      routing: ["记账", "预算", "开销"]
    });

    const definitions = loadAgentDefinitions({ definitionsDir: dirs.definitionsDir, instructionsDir: dirs.instructionsDir });
    const registry = AgentRegistry.fromDefinitions(definitions);
    assert.deepEqual(registry.listIds(), ["atlas", "mira", "nova", "ledger"]);
    assert.equal(routeCommand("帮我看看这个月的预算", registry), "ledger");

    const system = createAgentSystem({
      repository: new MemoryRepository(seedState),
      runRepository: new MemoryRunRepository(),
      registry,
      env: { AI_PROVIDER: "rules" }
    });
    const { completion } = await system.orchestrator.createRun({ goal: "帮我看看记账和预算" });
    const run = await completion;
    assert.equal(run.calls.length, 1);
    assert.equal(run.calls[0].agentId, "ledger");
    assert.equal(run.calls[0].status, "completed");
    assert.equal(run.calls[0].output.steps.length, 3);
    // 复用趋势技能会产出高影响建议，必须等待用户确认
    assert.equal(run.status, "awaiting_confirmation");
    assert.equal(run.proposals.length, 1);
    assert.equal(run.proposals[0].agentId, "ledger");
    assert.equal(run.proposals[0].type, "goal_recalibration");
    const described = system.describe().agents.find((agent) => agent.id === "ledger");
    assert.equal(described.role, "财务管家");
    assert.equal(described.skill, "trend-review");
  });
});

test("bundled instructions stay in sync with the definitions", async () => {
  const definitions = loadAgentDefinitions();
  for (const definition of definitions) {
    const bundled = (await readFile(join(DEFAULT_INSTRUCTIONS_DIR, definition.instructionFile), "utf8")).trim();
    assert.equal(bundled, definition.instruction, `${definition.id} 的指令应与文件一致`);
  }
});
