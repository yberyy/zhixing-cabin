import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { checkHealth } from "../scripts/healthcheck.mjs";

async function withEndpoint(handler, run) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  try {
    await run({ url: `http://127.0.0.1:${port}/api/v1/health`, port });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("health check requires a successful response from the expected service", async () => {
  await withEndpoint((request, response) => {
    assert.equal(request.url, "/api/v1/health");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok", service: "zhixing-api" }));
  }, async ({ url }) => {
    await checkHealth({ url });
  });
  for (const scenario of [
    { status: 503, body: { status: "ok", service: "zhixing-api" } },
    { status: 200, body: { status: "ok", service: "other-service" } },
    { status: 200, body: { status: "failed", service: "zhixing-api" } }
  ]) {
    await withEndpoint((request, response) => {
      response.writeHead(scenario.status, { "content-type": "application/json" });
      response.end(JSON.stringify(scenario.body));
    }, async ({ url }) => {
      await assert.rejects(() => checkHealth({ url }));
    });
  }
});

test("health check times out when a service does not respond", async () => {
  await withEndpoint(() => {}, async ({ url }) => {
    await assert.rejects(() => checkHealth({ url, timeoutMs: 50 }), { name: "TimeoutError" });
  });
});

test("container health command reports a failed probe with a nonzero exit code", async () => {
  await withEndpoint((request, response) => {
    response.writeHead(503);
    response.end();
  }, async ({ port }) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL("../scripts/healthcheck.mjs", import.meta.url))], {
      env: { ...process.env, PORT: String(port) },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const [exitCode] = await once(child, "close");
    assert.equal(exitCode, 1);
    assert.match(stderr, /Health check failed: HTTP 503/);
  });
});
