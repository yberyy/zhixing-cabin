import { SkillAgent } from "../skill-agent.mjs";
import { loadAgentDefinition } from "../definition-loader.mjs";
import { resolveSkill } from "../skills/index.mjs";

/**
 * 兼容入口：Mira 由 `definitions/mira.json` + 技能 `rhythm-check` 装配。
 * 行为逻辑在 `skills/rhythm-check.skill.mjs`，指令在 `instructions/mira.md`。
 */
export class MiraAgent extends SkillAgent {
  constructor(options = {}) {
    const definition = loadAgentDefinition("mira", options);
    super(definition, resolveSkill(definition.skill));
  }
}
