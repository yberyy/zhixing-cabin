const GOAL_PREFIX = /^(请|帮我|帮我一下|帮忙|我想|我要|需要|给我|替我|能不能|可以|麻烦)/u;
const GOAL_SUFFIX = /(吧|呢|吗|啊|哦|一下|一些)?[。！？!?]*$/u;

export function truncate(value, max) {
  const text = String(value ?? "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

/**
 * 把任务时长文本解析为分钟数。
 * 支持「N 小时 / N h」与「N 分钟」，避免把「2 小时」误读为 2 分钟而低估负载。
 */
export function parseMinutes(value) {
  const text = String(value ?? "");
  const hours = text.match(/(\d+(?:\.\d+)?)\s*(?:小时|个小时|hours|hour|hrs|hr|h)(?![a-z])/i);
  if (hours) {
    const fromHours = Math.round(Number(hours[1]) * 60);
    if (Number.isFinite(fromHours) && fromHours > 0) return fromHours;
  }
  const match = text.match(/(\d+)/);
  if (!match) return 25;
  const minutes = Number(match[1]);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 25;
}

export function topicFromGoal(goal) {
  const cleaned = String(goal ?? "")
    .replace(GOAL_PREFIX, "")
    .replace(GOAL_SUFFIX, "")
    .replace(/[。！？!?，,、；;：:]+$/u, "")
    .trim();
  return truncate(cleaned || String(goal ?? "当前目标"), 24);
}

export function uniqueBy(items, keyOf) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

export function now() {
  return new Date().toISOString();
}

export function delay(ms) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export const clone = (value) => JSON.parse(JSON.stringify(value));
