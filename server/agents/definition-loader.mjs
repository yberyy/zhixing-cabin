import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_NAMES } from "./tools.mjs";
import { SKILL_IDS, hasSkill } from "./skills/index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DEFINITIONS_DIR = join(here, "definitions");
export const DEFAULT_INSTRUCTIONS_DIR = join(here, "instructions");

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const RISK_LEVELS = new Set(["low", "high"]);

export class AgentDefinitionError extends Error {
  constructor(message) {
    super(message);
    this.name = "AgentDefinitionError";
    this.code = "AGENT_DEFINITION_INVALID";
  }
}

const definitionCache = new Map();
const instructionCache = new Map();

function invalid(file, message) {
  return new AgentDefinitionError(`Agent 定义 ${file} 校验失败：${message}`);
}

/** 读取并缓存 Agent 指令文件。缺失或过短视为配置错误，启动即失败。 */
export function loadInstructionFile(fileName, { instructionsDir = DEFAULT_INSTRUCTIONS_DIR } = {}) {
  const path = join(instructionsDir, fileName);
  if (instructionCache.has(path)) return instructionCache.get(path);
  let content;
  try {
    content = readFileSync(path, "utf8").trim();
  } catch {
    throw new AgentDefinitionError(`找不到 Agent 指令文件：${path}`);
  }
  if (content.length < 10) throw new AgentDefinitionError(`Agent 指令文件内容过短：${path}`);
  instructionCache.set(path, content);
  return content;
}

function validateTools(tools, file) {
  if (tools === undefined) return { "state:read": "allow" };
  if (!tools || typeof tools !== "object" || Array.isArray(tools)) {
    throw invalid(file, "tools 必须是对象");
  }
  const normalized = {};
  for (const [name, value] of Object.entries(tools)) {
    if (!TOOL_NAMES.includes(name)) {
      throw invalid(file, `未知工具 "${name}"（可用：${TOOL_NAMES.join(", ")}）`);
    }
    if (value === "allow" || value === "deny") {
      normalized[name] = value;
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const risk = value.risk === undefined ? "high" : value.risk;
      if (!RISK_LEVELS.has(risk)) throw invalid(file, `工具 "${name}" 的 risk 只能是 low 或 high`);
      normalized[name] = { ...value, risk };
      continue;
    }
    throw invalid(file, `工具 "${name}" 的权限必须是 "allow"、"deny" 或风险对象`);
  }
  return normalized;
}

function validateStringArray(value, field, file, { required = false } = {}) {
  if (value === undefined) {
    if (required) throw invalid(file, `缺少必填字段 ${field}`);
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw invalid(file, `${field} 必须是字符串数组`);
  }
  return value.map((item) => item.trim());
}

function normalizeDefinition(raw, file, { instructionsDir }) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid(file, "定义必须是 JSON 对象");

  for (const field of ["id", "name", "role", "skill", "instruction"]) {
    if (typeof raw[field] !== "string" || !raw[field].trim()) throw invalid(file, `缺少必填字段 ${field}`);
  }
  if (!ID_PATTERN.test(raw.id)) throw invalid(file, `id "${raw.id}" 必须是小写字母开头的 kebab-case`);
  if (!hasSkill(raw.skill)) {
    throw invalid(file, `未注册的技能 "${raw.skill}"（可用：${SKILL_IDS.join(", ")}）`);
  }

  return {
    id: raw.id,
    name: raw.name.trim(),
    role: raw.role.trim(),
    accent: typeof raw.accent === "string" && raw.accent.trim() ? raw.accent.trim() : "green",
    initial: typeof raw.initial === "string" && raw.initial.trim() ? raw.initial.trim().slice(0, 1) : raw.name.trim().slice(0, 1),
    skill: raw.skill,
    instructionFile: raw.instruction,
    instruction: loadInstructionFile(raw.instruction, { instructionsDir }),
    enabled: raw.enabled !== false,
    capabilities: validateStringArray(raw.capabilities, "capabilities", file),
    protocol: {
      input: validateStringArray(raw.protocol?.input, "protocol.input", file),
      output: validateStringArray(raw.protocol?.output, "protocol.output", file)
    },
    tools: validateTools(raw.tools, file),
    routing: validateStringArray(raw.routing, "routing", file),
    routingDefault: raw.routingDefault === true,
    sourceFile: file
  };
}

function readDefinitionFile(fileName, { definitionsDir, instructionsDir }) {
  const path = join(definitionsDir, fileName);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw invalid(fileName, `不是合法 JSON（${error.message}）`);
    throw new AgentDefinitionError(`找不到 Agent 定义文件：${path}`);
  }
  return normalizeDefinition(parsed, fileName, { instructionsDir });
}

function assertUnique(ids, id, file) {
  if (ids.has(id)) throw invalid(file, `Agent id "${id}" 重复`);
  ids.add(id);
}

/** 读取并校验全部 Agent 定义，返回启用中的定义（按文件名字典序）。 */
export function loadAgentDefinitions({ definitionsDir = DEFAULT_DEFINITIONS_DIR, instructionsDir = DEFAULT_INSTRUCTIONS_DIR } = {}) {
  const cacheKey = `${definitionsDir}::${instructionsDir}`;
  if (definitionCache.has(cacheKey)) return definitionCache.get(cacheKey).map((definition) => ({ ...definition }));

  let fileNames;
  try {
    fileNames = readdirSync(definitionsDir).filter((name) => name.endsWith(".json")).sort();
  } catch {
    throw new AgentDefinitionError(`找不到 Agent 定义目录：${definitionsDir}`);
  }
  if (!fileNames.length) throw new AgentDefinitionError(`Agent 定义目录为空：${definitionsDir}`);

  const ids = new Set();
  const definitions = [];
  for (const fileName of fileNames) {
    const definition = readDefinitionFile(fileName, { definitionsDir, instructionsDir });
    assertUnique(ids, definition.id, fileName);
    if (definition.enabled) definitions.push(definition);
  }
  if (!definitions.length) throw new AgentDefinitionError("没有启用的 Agent 定义");
  definitionCache.set(cacheKey, definitions);
  return definitions.map((definition) => ({ ...definition }));
}

/** 按 id 读取单个启用中的定义。 */
export function loadAgentDefinition(id, options = {}) {
  const definition = loadAgentDefinitions(options).find((item) => item.id === id);
  if (!definition) throw new AgentDefinitionError(`没有找到 id 为 "${id}" 的启用 Agent 定义`);
  return definition;
}
