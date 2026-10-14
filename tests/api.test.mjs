import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createApp } from "../server/app.mjs";
import { MemoryRepository, seedState } from "../server/repository.mjs";

async function withServer(run) {
  const repository = new MemoryRepository(seedState);
  const server = createServer(createApp({ repository, staticDir: fileURLToPath(new URL("../dist", import.meta.url)) }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("returns the seeded application state", () => withServer(async (baseUrl) => {
  const response = await fetch(`${baseUrl}/api/v1/state`);
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.equal(state.tasks.length, 6);
  assert.equal(state.agents.length, 3);
}));

test("creates and persists a valid task", () => withServer(async (baseUrl) => {
  const created = await fetch(`${baseUrl}/api/v1/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "复习概率论", category: "学习", duration: "45 分钟", assignee: "atlas" })
  });
  assert.equal(created.status, 201);
  const task = await created.json();
  assert.equal(task.status, "todo");
  const state = await (await fetch(`${baseUrl}/api/v1/state`)).json();
  assert.ok(state.tasks.some((item) => item.id === task.id));
}));

test("rejects an invalid task", () => withServer(async (baseUrl) => {
  const response = await fetch(`${baseUrl}/api/v1/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "", category: "未知" })
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_TASK");
}));

test("rejects non-object JSON bodies with a client error", () => withServer(async (baseUrl) => {
  for (const payload of [null, [], "text", 42]) {
    const response = await fetch(`${baseUrl}/api/v1/tasks`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload)
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_BODY");
  }
}));

test("serves the frontend assets from the platform filesystem path", () => withServer(async (baseUrl) => {
  for (const path of ["/", "/app.js", "/styles.css"]) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-cache");
    assert.ok((await response.text()).length > 100);
  }
}));

test("updates a task and rejects an unknown task", async () => withServer(async (baseUrl) => {
  const updated = await fetch(`${baseUrl}/api/v1/tasks/task-2`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "done" })
  });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).status, "done");
  const missing = await fetch(`${baseUrl}/api/v1/tasks/missing`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "done" })
  });
  assert.equal(missing.status, 404);
}));

test("edits task fields and validates each of them", () => withServer(async (baseUrl) => {
  const edited = await fetch(`${baseUrl}/api/v1/tasks/task-2`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "整理英语阅读高频词", category: "生活", duration: "15 分钟", assignee: "mira" })
  });
  assert.equal(edited.status, 200);
  const task = await edited.json();
  assert.equal(task.title, "整理英语阅读高频词");
  assert.equal(task.category, "生活");
  assert.equal(task.duration, "15 分钟");
  assert.equal(task.assignee, "mira");
  assert.ok(task.updatedAt);

  const invalidCategory = await fetch(`${baseUrl}/api/v1/tasks/task-2`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ category: "未知" })
  });
  assert.equal(invalidCategory.status, 400);
  assert.equal((await invalidCategory.json()).error.code, "INVALID_CATEGORY");

  const emptyTitle = await fetch(`${baseUrl}/api/v1/tasks/task-2`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "   " })
  });
  assert.equal(emptyTitle.status, 400);
  assert.equal((await emptyTitle.json()).error.code, "INVALID_TITLE");

  const noChanges = await fetch(`${baseUrl}/api/v1/tasks/task-2`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(noChanges.status, 400);
  assert.equal((await noChanges.json()).error.code, "NO_CHANGES");
}));

test("archives a task, hides it from state and restores it", () => withServer(async (baseUrl) => {
  const removed = await fetch(`${baseUrl}/api/v1/tasks/task-3`, { method: "DELETE" });
  assert.equal(removed.status, 200);
  const archived = await removed.json();
  assert.ok(archived.archivedAt);
  assert.equal(archived.archivedBy, "user");

  const state = await (await fetch(`${baseUrl}/api/v1/state`)).json();
  assert.equal(state.tasks.some((task) => task.id === "task-3"), false, "归档任务不出现在工作台状态里");

  const archivedList = await (await fetch(`${baseUrl}/api/v1/tasks/archived`)).json();
  assert.equal(archivedList.tasks.length, 1);
  assert.equal(archivedList.tasks[0].id, "task-3");

  const restored = await fetch(`${baseUrl}/api/v1/tasks/task-3/restore`, { method: "POST" });
  assert.equal(restored.status, 200);
  const restoredTask = await restored.json();
  assert.equal(restoredTask.archivedAt, undefined);
  const afterRestore = await (await fetch(`${baseUrl}/api/v1/state`)).json();
  assert.ok(afterRestore.tasks.some((task) => task.id === "task-3"));

  const missing = await fetch(`${baseUrl}/api/v1/tasks/missing`, { method: "DELETE" });
  assert.equal(missing.status, 404);
  const missingRestore = await fetch(`${baseUrl}/api/v1/tasks/missing/restore`, { method: "POST" });
  assert.equal(missingRestore.status, 404);
}));

test("routes an agent command and returns actionable steps", () => withServer(async (baseUrl) => {
  const response = await fetch(`${baseUrl}/api/v1/agents/auto/dispatch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: "帮我拆解明天的数学复习计划" })
  });
  assert.equal(response.status, 202);
  const result = await response.json();
  assert.equal(result.agentId, "atlas");
  assert.equal(result.steps.length, 3);
}));

test("toggles a habit and saves a review", () => withServer(async (baseUrl) => {
  const habit = await fetch(`${baseUrl}/api/v1/habits/habit-exercise/toggle`, { method: "POST" });
  assert.equal(habit.status, 200);
  assert.equal((await habit.json()).completed, true);
  const review = await fetch(`${baseUrl}/api/v1/reviews`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ win: "完成了重点任务", adjust: "早点开始", mood: 4 })
  });
  assert.equal(review.status, 201);
  assert.equal((await review.json()).mood, 4);
}));
