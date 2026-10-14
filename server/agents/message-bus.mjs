import { randomUUID } from "node:crypto";

/**
 * Agent 之间的消息总线。
 * 每条消息都会进入 run.messages，作为「运行轨迹」的可观察证据：
 * 谁在什么时间把什么任务交给谁，以及返回了什么。
 */
export class MessageBus {
  constructor({ runId, sink = () => {} } = {}) {
    this.runId = runId;
    this.sink = sink;
    this.log = [];
  }

  publish({ from, to = "*", type, summary, payload = {} }) {
    const message = {
      id: `msg-${randomUUID()}`,
      runId: this.runId,
      at: new Date().toISOString(),
      from,
      to,
      type,
      summary: String(summary || "").slice(0, 200),
      payload
    };
    this.log.push(message);
    this.sink(message);
    return message;
  }

  get size() {
    return this.log.length;
  }
}
