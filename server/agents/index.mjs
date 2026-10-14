import { AgentRegistry } from "./registry.mjs";
import { Orchestrator } from "./orchestrator.mjs";
import { MemoryRunRepository } from "./run-repository.mjs";
import { createTools } from "./tools.mjs";
import { resolveProvider } from "./providers/index.mjs";

export { AgentRegistry, AGENT_ORDER } from "./registry.mjs";
export { Orchestrator, routeCommand } from "./orchestrator.mjs";
export { MemoryRunRepository, JsonRunRepository } from "./run-repository.mjs";
export { SharedMemory } from "./shared-memory.mjs";
export { MessageBus } from "./message-bus.mjs";
export { createTools, TOOL_FOR_PROPOSAL, TOOL_NAMES } from "./tools.mjs";
export { resolveProvider, describeProvider, SUPPORTED_PROVIDERS } from "./providers/index.mjs";
export { BaseAgent } from "./base-agent.mjs";
export { SkillAgent, createSkillAgent, buildAgents } from "./skill-agent.mjs";
export {
  loadAgentDefinitions,
  loadAgentDefinition,
  loadInstructionFile,
  AgentDefinitionError,
  DEFAULT_DEFINITIONS_DIR,
  DEFAULT_INSTRUCTIONS_DIR
} from "./definition-loader.mjs";
export { SKILLS, SKILL_IDS, resolveSkill, hasSkill, describeSkills } from "./skills/index.mjs";
export { AtlasAgent } from "./agents/atlas.agent.mjs";
export { MiraAgent } from "./agents/mira.agent.mjs";
export { NovaAgent } from "./agents/nova.agent.mjs";

/**
 * 组装完整的多 Agent 系统：registry + provider + tools + run repository + orchestrator。
 * 无任何模型配置时使用 rules provider，系统照常运行。
 */
export function createAgentSystem({ repository, runRepository, registry, env = process.env, stepDelayMs = 0 } = {}) {
  const agentRegistry = registry || AgentRegistry.createDefault();
  const provider = resolveProvider(env);
  const tools = createTools({ repository });
  const runs = runRepository || new MemoryRunRepository();
  const orchestrator = new Orchestrator({
    registry: agentRegistry,
    provider,
    tools,
    runRepository: runs,
    repository,
    stepDelayMs
  });
  return {
    registry: agentRegistry,
    provider,
    tools,
    runRepository: runs,
    orchestrator,
    describe: () => orchestrator.describe()
  };
}
