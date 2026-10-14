import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JsonRepository, seedState } from "../server/repository.mjs";
import { JsonRunRepository } from "../server/agents/run-repository.mjs";

test("concurrent cold-start updates retain every task in memory and on disk", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zhixing-state-"));
  try {
    const path = join(directory, "state.json");
    await writeFile(path, JSON.stringify(seedState));
    const repository = new JsonRepository(path);
    await Promise.all(Array.from({ length: 8 }, (_, index) => repository.update((state) => {
      const task = { id: `concurrent-${index}`, title: `task ${index}` };
      state.tasks.push(task);
      return task;
    })));
    const memory = await repository.getState();
    const disk = JSON.parse(await readFile(path, "utf8"));
    assert.equal(memory.tasks.length, seedState.tasks.length + 8);
    assert.deepEqual(disk, memory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent cold-start run saves retain every run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zhixing-run-load-"));
  try {
    const path = join(directory, "runs.json");
    await writeFile(path, JSON.stringify({ runs: [] }));
    const repository = new JsonRunRepository(path);
    await Promise.all(Array.from({ length: 8 }, (_, index) => repository.save({
      id: `run-${index}`, goal: "test", status: "completed", createdAt: new Date().toISOString()
    })));
    assert.equal((await repository.list()).length, 8);
    assert.equal(JSON.parse(await readFile(path, "utf8")).runs.length, 8);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("state and run repositories recover after a failed disk write", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zhixing-write-recovery-"));
  try {
    for (const kind of ["state", "runs"]) {
      const path = join(directory, `${kind}.json`);
      const repository = kind === "state" ? new JsonRepository(path) : new JsonRunRepository(path);
      if (kind === "state") await repository.load();
      else await repository.summary();
      await mkdir(`${path}.tmp`);
      const write = () => kind === "state"
        ? repository.update((state) => (state.reviews.push({ id: "recovery" }), true))
        : repository.save({ id: "recovery", status: "completed", createdAt: new Date().toISOString() });
      await assert.rejects(write);
      assert.equal(kind === "state" ? (await repository.getState()).reviews.length : (await repository.list()).length, 0);
      await rm(`${path}.tmp`, { recursive: true, force: true });
      await write();
      const disk = JSON.parse(await readFile(path, "utf8"));
      assert.equal(kind === "state" ? disk.reviews.length : disk.runs.length, 1);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
