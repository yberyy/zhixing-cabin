import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const seedState = {
  tasks: [
    { id: "task-1", title: "高等数学 · 极限与连续", category: "学习", duration: "45 分钟", assignee: "atlas", status: "doing", createdAt: "2026-10-13T01:00:00.000Z" },
    { id: "task-2", title: "整理英语阅读生词", category: "学习", duration: "25 分钟", assignee: "self", status: "todo", createdAt: "2026-10-13T01:10:00.000Z" },
    { id: "task-3", title: "晚饭后散步 30 分钟", category: "生活", duration: "30 分钟", assignee: "mira", status: "todo", createdAt: "2026-10-13T01:20:00.000Z" },
    { id: "task-4", title: "梳理本周课程重点", category: "成长", duration: "25 分钟", assignee: "nova", status: "done", createdAt: "2026-10-12T10:00:00.000Z" },
    { id: "task-5", title: "背诵 30 个核心词汇", category: "学习", duration: "25 分钟", assignee: "atlas", status: "done", createdAt: "2026-10-12T11:00:00.000Z" },
    { id: "task-6", title: "准备明天的课程资料", category: "生活", duration: "15 分钟", assignee: "self", status: "todo", createdAt: "2026-10-13T02:00:00.000Z" }
  ],
  habits: [
    { id: "habit-water", name: "喝水", target: "8 杯", completed: true, streak: 9, icon: "droplets" },
    { id: "habit-reading", name: "阅读", target: "30 分钟", completed: true, streak: 12, icon: "book-open" },
    { id: "habit-exercise", name: "运动", target: "30 分钟", completed: false, streak: 4, icon: "dumbbell" },
    { id: "habit-sleep", name: "早睡", target: "23:30", completed: false, streak: 6, icon: "moon" }
  ],
  agents: [
    { id: "atlas", name: "Atlas", role: "学习教练", status: "working", currentTask: "正在整理极限章节的知识地图", accent: "blue", initial: "A" },
    { id: "mira", name: "Mira", role: "生活管家", status: "ready", currentTask: "今日作息与习惯已检查", accent: "coral", initial: "M" },
    { id: "nova", name: "Nova", role: "成长顾问", status: "ready", currentTask: "本周复盘框架已准备", accent: "green", initial: "N" }
  ],
  reviews: []
};

const clone = (value) => JSON.parse(JSON.stringify(value));

/** 未归档任务：业务状态与 Agent 只看得到这些。 */
export const activeTasks = (state) => (state?.tasks || []).filter((task) => !task.archivedAt);

/** 对外暴露的工作台状态：隐藏归档任务。 */
export const publicState = (state) => ({ ...state, tasks: activeTasks(state) });

export class JsonRepository {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = null;
    this.loadPromise = null;
    this.updateQueue = Promise.resolve();
    this.writeQueue = Promise.resolve();
  }

  async load() {
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        try {
          this.state = JSON.parse(await readFile(this.filePath, "utf8"));
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          this.state = clone(seedState);
          await this.persist();
        }
      })().catch((error) => {
        this.loadPromise = null;
        this.state = null;
        throw error;
      });
    }
    await this.loadPromise;
    return clone(this.state);
  }

  async getState() {
    await this.load();
    return clone(this.state);
  }

  async update(mutator) {
    const operation = this.updateQueue.then(async () => {
      await this.load();
      const next = clone(this.state);
      const result = mutator(next);
      await this.persist(next);
      this.state = next;
      return clone(result);
    });
    this.updateQueue = operation.catch(() => {});
    return operation;
  }

  async persist(state = this.state) {
    const snapshot = JSON.stringify(state, null, 2);
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      await writeFile(temporaryPath, snapshot, "utf8");
      await rename(temporaryPath, this.filePath);
    });
    return this.writeQueue;
  }
}

export class MemoryRepository {
  constructor(initialState = seedState) {
    this.state = clone(initialState);
  }

  async getState() {
    return clone(this.state);
  }

  async update(mutator) {
    return clone(mutator(this.state));
  }
}
