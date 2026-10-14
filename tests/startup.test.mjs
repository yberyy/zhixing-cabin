import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const entry = fileURLToPath(new URL("../server/index.mjs", import.meta.url));

function launch(port) {
  const child = spawn(process.execPath, [entry], {
    cwd: root,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), AI_PROVIDER: "rules" },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const output = { stdout: "", stderr: "" };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output.stdout += chunk; });
  child.stderr.on("data", (chunk) => { output.stderr += chunk; });
  return { child, output, closed: once(child, "close") };
}

async function terminate(process) {
  if (process.child.exitCode !== null || process.child.signalCode !== null) return;
  process.child.kill();
  await process.closed;
}

test("a second startup reports the existing app and leaves it running", { timeout: 15000 }, async () => {
  const first = launch(0);
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Server did not start")), 8000);
      first.child.stdout.on("data", () => {
        const match = first.output.stdout.match(/API 健康检查：http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) { clearTimeout(timer); resolve(Number(match[1])); }
      });
      first.child.once("error", (error) => { clearTimeout(timer); reject(error); });
    });
    const second = launch(port);
    try {
      const [exitCode] = await second.closed;
      assert.equal(exitCode, 0);
      assert.match(second.output.stdout, /已经在运行/);
      assert.match(second.output.stdout, /未应用新的模型或 API Key 配置/);
      assert.equal(second.output.stderr, "");
      const health = await (await fetch(`http://127.0.0.1:${port}/api/v1/health`)).json();
      assert.equal(health.service, "zhixing-api");
    } finally {
      await terminate(second);
    }
  } finally {
    await terminate(first);
  }
});

test("a foreign occupied port reports a useful error without stopping its owner", { timeout: 10000 }, async () => {
  const foreign = createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok", service: "other-service" }));
  });
  foreign.listen(0, "127.0.0.1");
  await once(foreign, "listening");
  const port = foreign.address().port;
  const process = launch(port);
  try {
    const [exitCode] = await process.closed;
    assert.equal(exitCode, 1);
    assert.match(process.output.stderr, /端口已被占用/);
    assert.doesNotMatch(process.output.stderr, /Unhandled|node:events/);
    assert.equal(foreign.listening, true);
  } finally {
    await terminate(process);
    await new Promise((resolve) => foreign.close(resolve));
  }
});
