import { SkillAgent } from "../skill-agent.mjs";
import { loadAgentDefinition } from "../definition-loader.mjs";
import { resolveSkill } from "../skills/index.mjs";

/**
 * 兼容入口：Nova 由 `definitions/nova.json` + 技能 `trend-review` 装配。
 * 行为逻辑在 `skills/trend-review.skill.mjs`，指令在 `instructions/nova.md`。
 */
export class NovaAgent extends SkillAgent {
  constructor(options = {}) {
    const definition = loadAgentDefinition("nova", options);
    super(definition, resolveSkill(definition.skill));
  }
}
