import { SkillAgent } from "../skill-agent.mjs";
import { loadAgentDefinition } from "../definition-loader.mjs";
import { resolveSkill } from "../skills/index.mjs";

/**
 * 兼容入口：Atlas 由 `definitions/atlas.json` + 技能 `study-coach` 装配。
 * 行为逻辑在 `skills/study-coach.skill.mjs`，指令在 `instructions/atlas.md`。
 */
export class AtlasAgent extends SkillAgent {
  constructor(options = {}) {
    const definition = loadAgentDefinition("atlas", options);
    super(definition, resolveSkill(definition.skill));
  }
}
