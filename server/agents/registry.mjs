import { loadAgentDefinitions } from "./definition-loader.mjs";
import { buildAgents } from "./skill-agent.mjs";
import { resolveSkill } from "./skills/index.mjs";

/** 内置 Agent 的稳定展示顺序；定义目录中的其它 Agent 追加在其后。 */
export const AGENT_ORDER = ["atlas", "mira", "nova"];

export class AgentRegistry {
  constructor(agents = []) {
    this.agents = new Map(agents.map((agent) => [agent.id, agent]));
  }

  /** 由 Agent 定义装配注册表；未知技能在装配时报错。 */
  static fromDefinitions(definitions, { skillResolver = resolveSkill } = {}) {
    return new AgentRegistry(buildAgents(definitions, { skillResolver }));
  }

  /** 从 `server/agents/definitions/*.json` 读取并装配。 */
  static createDefault(options = {}) {
    return AgentRegistry.fromDefinitions(loadAgentDefinitions(options), options);
  }

  get(id) {
    return this.agents.get(id) || null;
  }

  has(id) {
    return this.agents.has(id);
  }

  list() {
    const ordered = AGENT_ORDER.map((id) => this.agents.get(id)).filter(Boolean);
    const extra = [...this.agents.values()].filter((agent) => !AGENT_ORDER.includes(agent.id));
    return [...ordered, ...extra];
  }

  listIds() {
    return this.list().map((agent) => agent.id);
  }

  describe() {
    return this.list().map((agent) => agent.describe());
  }

  /** 服务端重启或测试隔离时使用。 */
  reset() {
    for (const agent of this.list()) {
      agent.status = "idle";
      agent.currentTask = "待命";
      agent.lastError = null;
    }
  }
}
