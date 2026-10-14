import { clone, now } from "./utils.mjs";

/**
 * 单次运行的共享上下文。
 * Agent 通过它读取彼此沉淀的事实、约束与冲突，避免各自为政。
 * 所有写入都带来源（provenance），历史值保留在 history 中。
 */
export class SharedMemory {
  constructor({ runId } = {}) {
    this.runId = runId;
    this.goal = null;
    this.facts = [];
    this.constraints = [];
    this.conflicts = [];
  }

  set(key, value, source = "system") {
    const existing = this.facts.find((fact) => fact.key === key);
    if (existing) {
      existing.history = [...(existing.history || []), { value: existing.value, source: existing.source, at: existing.at }];
      existing.value = value;
      existing.source = source;
      existing.at = now();
    } else {
      this.facts.push({ key, value, source, at: now(), history: [] });
    }
    return this;
  }

  get(key) {
    const fact = this.facts.find((item) => item.key === key);
    return fact ? fact.value : null;
  }

  addConstraint(constraint) {
    this.constraints.push({ ...constraint, at: now() });
    return this;
  }

  addConflict(conflict) {
    this.conflicts.push(clone(conflict));
    return this;
  }

  snapshot() {
    return {
      runId: this.runId,
      goal: this.goal,
      facts: clone(this.facts),
      constraints: clone(this.constraints),
      conflicts: clone(this.conflicts)
    };
  }
}
