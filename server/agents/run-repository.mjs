import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { clone } from "./utils.mjs";

function summarize(run) {
  return {
    id: run.id,
    goal: run.goal,
    status: run.status,
    strategy: run.strategy,
    provider: run.provider,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    finishedAt: run.finishedAt ?? null,
    callCount: run.calls?.length || 0,
    agentIds: [...new Set((run.calls || []).map((call) => call.agentId))],
    handoffCount: (run.calls || []).filter((call) => call.viaHandoff).length,
    pendingConfirmations: (run.proposals || []).filter((proposal) => proposal.status === "pending").length,
    conflictCount: run.conflicts?.length || 0,
    error: run.error ?? null
  };
}

function byCreatedDesc(a, b) {
  return String(b.createdAt).localeCompare(String(a.createdAt));
}

export class MemoryRunRepository {
  constructor(initialRuns = []) {
    this.runs = new Map(initialRuns.map((run) => [run.id, clone(run)]));
  }

  async save(run) {
    this.runs.set(run.id, clone(run));
    return clone(run);
  }

  async get(id) {
    const run = this.runs.get(id);
    return run ? clone(run) : null;
  }

  async list({ limit = 20 } = {}) {
    return [...this.runs.values()]
      .sort(byCreatedDesc)
      .slice(0, limit)
      .map((run) => summarize(clone(run)));
  }

  async summary() {
    const all = [...this.runs.values()];
    const byStatus = {};
    for (const run of all) byStatus[run.status] = (byStatus[run.status] || 0) + 1;
    return { total: all.length, byStatus };
  }
}

/** 运行轨迹的 JSON 持久化，写入 .runtime/runs.json，与业务状态分离。 */
export class JsonRunRepository {
  constructor(filePath) {
    this.filePath = filePath;
    this.memory = new MemoryRunRepository();
    this.loaded = false;
    this.loadPromise = null;
    this.saveQueue = Promise.resolve();
    this.writeQueue = Promise.resolve();
  }

  async #ensureLoaded() {
    if (this.loaded) return;
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        try {
          const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
          const runs = Array.isArray(parsed) ? parsed : parsed.runs || [];
          this.memory = new MemoryRunRepository(runs);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        this.loaded = true;
      })().finally(() => { this.loadPromise = null; });
    }
    await this.loadPromise;
  }

  async #persist(runs) {
    const snapshot = JSON.stringify({ runs: [...runs.values()] }, null, 2);
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      await writeFile(temporaryPath, snapshot, "utf8");
      await rename(temporaryPath, this.filePath);
    });
    return this.writeQueue;
  }

  async save(run) {
    const snapshot = clone(run);
    const operation = this.saveQueue.then(async () => {
      await this.#ensureLoaded();
      const next = new Map(this.memory.runs);
      next.set(snapshot.id, snapshot);
      await this.#persist(next);
      return this.memory.save(snapshot);
    });
    this.saveQueue = operation.catch(() => {});
    return operation;
  }

  async get(id) {
    await this.#ensureLoaded();
    return this.memory.get(id);
  }

  async list(options) {
    await this.#ensureLoaded();
    return this.memory.list(options);
  }

  async summary() {
    await this.#ensureLoaded();
    return this.memory.summary();
  }
}
