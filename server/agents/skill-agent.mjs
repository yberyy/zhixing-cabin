import { BaseAgent } from "./base-agent.mjs";
import { loadAgentDefinition } from "./definition-loader.mjs";
import { resolveSkill } from "./skills/index.mjs";

/**
 * 由「定义文件 + 具名技能」装配出的 Agent。
 * 定义负责身份、权限、协议、路由与指令；技能负责领域行为。
 */
export class SkillAgent extends BaseAgent {
  constructor(definition, skill) {
    super({
      id: definition.id,
      name: definition.name,
      role: definition.role,
      accent: definition.accent,
      initial: definition.initial,
      capabilities: definition.capabilities,
      tools: definition.tools,
      protocol: definition.protocol,
      instruction: definition.instruction,
      routing: definition.routing,
      routingDefault: definition.routingDefault
    });
    this.skillId = skill.id;
    this.skill = skill;
    this.definitionFile = definition.sourceFile;
    this.instructionFile = definition.instructionFile;
  }

  rules(input, context) {
    return this.skill.rules(input, context);
  }

  describe() {
    return {
      ...super.describe(),
      skill: this.skillId,
      skillLabel: this.skill.label,
      routing: this.routing,
      routingDefault: this.routingDefault,
      definitionFile: this.definitionFile,
      instructionFile: this.instructionFile
    };
  }
}

/** 按定义 id 装配一个 Agent。 */
export function createSkillAgent(id, options = {}) {
  const definition = loadAgentDefinition(id, options);
  return new SkillAgent(definition, resolveSkill(definition.skill));
}

/** 从定义列表批量装配。 */
export function buildAgents(definitions, { skillResolver = resolveSkill } = {}) {
  return definitions.map((definition) => new SkillAgent(definition, skillResolver(definition.skill)));
}
