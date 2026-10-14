import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createAgentSystem } from "./agents/index.mjs";
import { queuePendingProposals } from "./agents/orchestrator.mjs";
import { TOOL_FOR_PROPOSAL } from "./agents/tools.mjs";
import { publicState } from "./repository.mjs";

/**
 * 给建议补充可执行性标注：工具层不支持的动作类型、以及已达上限的 deferred 建议，
 * 前端据此禁用「确认执行」并给出原因，避免留下必然失败的按钮。
 * 队列规则对历史运行同样生效，因此旧轨迹也会被截断到上限。
 */
function decorateRun(run) {
  if (!run || !Array.isArray(run.proposals)) return run;
  const proposals = queuePendingProposals(run.proposals).map((proposal) => {
    const supported = Object.prototype.hasOwnProperty.call(TOOL_FOR_PROPOSAL, proposal.type);
    const confirmable = proposal.status === "pending" || proposal.status === "deferred";
    return {
      ...proposal,
      actionable: confirmable && supported,
      blockedReason: supported
        ? (proposal.deferredReason || null)
        : `工具层不支持的动作类型「${proposal.type}」，无法执行；说明保留在轨迹中，仅作参考。`
    };
  });
  // 历史运行可能停留在 awaiting_confirmation，但已没有任何可确认项：按实际队列修正状态，避免误导弹层。
  const result = { ...(run.result || {}) };
  let status = run.status;
  const openActionable = proposals.some((proposal) => proposal.actionable && ["pending", "deferred"].includes(proposal.status));
  if (status === "awaiting_confirmation" && !openActionable) {
    status = "completed";
    result.notes = [...(result.notes || []), "该运行已没有可执行的待确认建议（其余建议的动作类型不受支持或已被处理）。"];
  }
  return { ...run, status, result, proposals };
}

const categories = new Set(["学习", "生活", "成长"]);
const statuses = new Set(["todo", "doing", "done"]);
const strategies = new Set(["auto", "sequential", "parallel"]);

const json = (response, status, payload) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(payload));
};

const fail = (response, status, code, message) => json(response, status, { error: { code, message } });

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32_768) throw Object.assign(new Error("请求体过大"), { status: 413, code: "PAYLOAD_TOO_LARGE" });
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("请求体必须是有效 JSON"), { status: 400, code: "INVALID_JSON" });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw Object.assign(new Error("请求体必须是 JSON 对象"), { status: 400, code: "INVALID_BODY" });
  }
  return body;
}

function normalizeDecisions(body) {
  return body.decisions !== undefined ? body.decisions : body.proposalId ? [body] : [];
}

export function createApp({ repository, staticDir, agents, stepDelayMs = 0 } = {}) {
  const agentSystem = agents || createAgentSystem({ repository, env: process.env, stepDelayMs });

  return async function handle(request, response) {
    const url = new URL(request.url, "http://localhost");
    try {
      if (url.pathname === "/api/v1/health" && request.method === "GET") {
        return json(response, 200, { status: "ok", service: "zhixing-api", timestamp: new Date().toISOString() });
      }

      if (url.pathname === "/api/v1/state" && request.method === "GET") {
        return json(response, 200, publicState(await repository.getState()));
      }

      if (url.pathname === "/api/v1/tasks/archived" && request.method === "GET") {
        const state = await repository.getState();
        return json(response, 200, { tasks: (state.tasks || []).filter((task) => task.archivedAt) });
      }

      if (url.pathname === "/api/v1/tasks" && request.method === "POST") {
        const body = await readBody(request);
        const title = typeof body.title === "string" ? body.title.trim() : "";
        if (!title || title.length > 60 || !categories.has(body.category)) {
          return fail(response, 400, "INVALID_TASK", "请提供 1-60 字的任务名称和有效领域");
        }
        const task = {
          id: `task-${randomUUID()}`,
          title,
          category: body.category,
          duration: String(body.duration || "25 分钟").slice(0, 20),
          assignee: String(body.assignee || "self").slice(0, 20),
          status: "todo",
          createdAt: new Date().toISOString()
        };
        await repository.update((state) => (state.tasks.unshift(task), task));
        return json(response, 201, task);
      }

      const taskMatch = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)$/);
      if (taskMatch && request.method === "PATCH") {
        const body = await readBody(request);
        const targetId = decodeURIComponent(taskMatch[1]);
        const changes = {};
        if (body.status !== undefined) {
          if (!statuses.has(body.status)) return fail(response, 400, "INVALID_STATUS", "任务状态无效");
          changes.status = body.status;
        }
        if (body.title !== undefined) {
          const title = typeof body.title === "string" ? body.title.trim() : "";
          if (!title || title.length > 60) return fail(response, 400, "INVALID_TITLE", "任务名称需为 1-60 字");
          changes.title = title;
        }
        if (body.category !== undefined) {
          if (!categories.has(body.category)) return fail(response, 400, "INVALID_CATEGORY", "领域无效");
          changes.category = body.category;
        }
        if (body.duration !== undefined) {
          const duration = String(body.duration).trim();
          if (!duration || duration.length > 20) return fail(response, 400, "INVALID_DURATION", "预计时长需为 1-20 字");
          changes.duration = duration;
        }
        if (body.assignee !== undefined) {
          const assignee = String(body.assignee).trim();
          if (!assignee || assignee.length > 20) return fail(response, 400, "INVALID_ASSIGNEE", "负责人无效");
          changes.assignee = assignee;
        }
        if (!Object.keys(changes).length) return fail(response, 400, "NO_CHANGES", "请提供要修改的字段");
        const task = await repository.update((state) => {
          const found = (state.tasks || []).find((item) => item.id === targetId && !item.archivedAt);
          if (!found) return null;
          Object.assign(found, changes, { updatedAt: new Date().toISOString() });
          return found;
        });
        return task ? json(response, 200, task) : fail(response, 404, "TASK_NOT_FOUND", "没有找到该任务");
      }

      if (taskMatch && request.method === "DELETE") {
        const targetId = decodeURIComponent(taskMatch[1]);
        const task = await repository.update((state) => {
          const found = (state.tasks || []).find((item) => item.id === targetId && !item.archivedAt);
          if (!found) return null;
          found.archivedAt = new Date().toISOString();
          found.archivedBy = "user";
          return found;
        });
        return task ? json(response, 200, task) : fail(response, 404, "TASK_NOT_FOUND", "没有找到该任务");
      }

      const restoreMatch = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/restore$/);
      if (restoreMatch && request.method === "POST") {
        const targetId = decodeURIComponent(restoreMatch[1]);
        const task = await repository.update((state) => {
          const found = (state.tasks || []).find((item) => item.id === targetId && item.archivedAt);
          if (!found) return null;
          delete found.archivedAt;
          delete found.archivedBy;
          found.updatedAt = new Date().toISOString();
          return found;
        });
        return task ? json(response, 200, task) : fail(response, 404, "TASK_NOT_FOUND", "没有找到该任务");
      }

      const habitMatch = url.pathname.match(/^\/api\/v1\/habits\/([^/]+)\/toggle$/);
      if (habitMatch && request.method === "POST") {
        const habit = await repository.update((state) => {
          const found = state.habits.find((item) => item.id === decodeURIComponent(habitMatch[1]));
          if (found) found.completed = !found.completed;
          return found || null;
        });
        return habit ? json(response, 200, habit) : fail(response, 404, "HABIT_NOT_FOUND", "没有找到该习惯");
      }

      // ---- Agent 系统：运行轨迹 ----
      if (url.pathname === "/api/v1/agents" && request.method === "GET") {
        return json(response, 200, { ...agentSystem.describe(), runs: await agentSystem.runRepository.summary() });
      }

      if (url.pathname === "/api/v1/agents/runs" && request.method === "POST") {
        const body = await readBody(request);
        const goal = typeof body.goal === "string" ? body.goal.trim() : "";
        if (goal.length < 2 || goal.length > 500) return fail(response, 400, "INVALID_GOAL", "目标需为 2-500 字");
        const strategy = strategies.has(body.strategy) ? body.strategy : "auto";
        const agentIds = Array.isArray(body.agentIds)
          ? body.agentIds.map((id) => String(id)).filter((id) => agentSystem.registry.has(id))
          : undefined;
        const { run, completion } = await agentSystem.orchestrator.createRun({
          goal,
          strategy,
          agentIds,
          allowHandoff: body.allowHandoff !== false
        });
        const sync = body.sync === true || url.searchParams.get("sync") === "1";
        if (sync) return json(response, 202, decorateRun(await completion));
        completion.catch(() => {});
        return json(response, 202, decorateRun(run));
      }

      if (url.pathname === "/api/v1/agents/runs" && request.method === "GET") {
        const rawLimit = url.searchParams.get("limit");
        const parsed = rawLimit === null || rawLimit.trim() === "" ? Number.NaN : Number(rawLimit);
        const limit = Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), 100) : 20;
        return json(response, 200, { runs: await agentSystem.runRepository.list({ limit }) });
      }

      const runMatch = url.pathname.match(/^\/api\/v1\/agents\/runs\/([^/]+)$/);
      if (runMatch && request.method === "GET") {
        const run = await agentSystem.runRepository.get(decodeURIComponent(runMatch[1]));
        return run ? json(response, 200, decorateRun(run)) : fail(response, 404, "RUN_NOT_FOUND", "没有找到该运行记录");
      }

      const confirmMatch = url.pathname.match(/^\/api\/v1\/agents\/runs\/([^/]+)\/confirm$/);
      if (confirmMatch && request.method === "POST") {
        const body = await readBody(request);
        const decisions = normalizeDecisions(body);
        try {
          const run = await agentSystem.orchestrator.confirmRun(decodeURIComponent(confirmMatch[1]), decisions);
          return json(response, 200, decorateRun(run));
        } catch (error) {
          return fail(response, error.status || 400, error.code || "CONFIRM_FAILED", error.message);
        }
      }

      // 兼容旧接口：单 Agent 派发
      const agentMatch = url.pathname.match(/^\/api\/v1\/agents\/([^/]+)\/dispatch$/);
      if (agentMatch && request.method === "POST") {
        const body = await readBody(request);
        const command = typeof body.command === "string" ? body.command.trim() : "";
        const requestedId = decodeURIComponent(agentMatch[1]);
        if (command.length < 2 || command.length > 500) return fail(response, 400, "INVALID_COMMAND", "指令需为 2-500 字");
        if (requestedId !== "auto" && !agentSystem.registry.has(requestedId)) return fail(response, 404, "AGENT_NOT_FOUND", "没有找到该 Agent");
        const result = await agentSystem.orchestrator.dispatchLegacy({ command, agentId: requestedId });
        return json(response, 202, result);
      }

      if (url.pathname === "/api/v1/reviews" && request.method === "POST") {
        const body = await readBody(request);
        const mood = Number(body.mood);
        if (!Number.isInteger(mood) || mood < 1 || mood > 5) return fail(response, 400, "INVALID_MOOD", "状态评分需为 1-5");
        const review = { id: `review-${randomUUID()}`, win: String(body.win || "").slice(0, 500), adjust: String(body.adjust || "").slice(0, 500), mood, createdAt: new Date().toISOString() };
        await repository.update((state) => (state.reviews.unshift(review), review));
        return json(response, 201, review);
      }

      if (url.pathname.startsWith("/api/")) return fail(response, 404, "ROUTE_NOT_FOUND", "接口不存在");
      return serveStatic(url.pathname, response, staticDir);
    } catch (error) {
      if (!error.status || error.status >= 500) console.error(error);
      return fail(response, error.status || 500, error.code || "INTERNAL_ERROR", error.status ? error.message : "服务暂时不可用");
    }
  };
}

async function serveStatic(pathname, response, staticDir) {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(staticDir, safePath);
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, "index.html");
    const extension = extname(filePath);
    const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" }[extension] || "application/octet-stream";
    // 无构建步骤，HTML/CSS/JS 必须每次校验，避免浏览器长期持有旧版本。
    const alwaysFresh = [".html", ".css", ".js"].includes(extension);
    response.writeHead(200, { "content-type": mime, "cache-control": alwaysFresh ? "no-cache" : "public, max-age=3600" });
    response.end(await readFile(filePath));
  } catch {
    fail(response, 404, "NOT_FOUND", "页面不存在");
  }
}
