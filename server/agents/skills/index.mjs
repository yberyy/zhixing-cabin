import { studyCoachSkill } from "./study-coach.skill.mjs";
import { rhythmCheckSkill } from "./rhythm-check.skill.mjs";
import { trendReviewSkill } from "./trend-review.skill.mjs";

/** 具名技能注册表：Agent 定义通过 `skill` 字段引用，未知技能在启动时即报错。 */
export const SKILLS = new Map(
  [studyCoachSkill, rhythmCheckSkill, trendReviewSkill].map((skill) => [skill.id, skill])
);

export const SKILL_IDS = [...SKILLS.keys()];

export function hasSkill(id) {
  return SKILLS.has(id);
}

export function resolveSkill(id) {
  const skill = SKILLS.get(id);
  if (!skill) {
    throw Object.assign(new Error(`未注册的技能：${id}（可用：${SKILL_IDS.join(", ")}）`), { code: "AGENT_SKILL_NOT_FOUND" });
  }
  return skill;
}

export function describeSkills() {
  return [...SKILLS.values()].map((skill) => ({ id: skill.id, label: skill.label, description: skill.description }));
}
