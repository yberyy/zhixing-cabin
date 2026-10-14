import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readDeepSeekEnv } from "../scripts/start-deepseek.mjs";

const testKey = "test-key-not-real";
const config = {
  AI_PROVIDER: "openai",
  OPENAI_API_KEY: testKey,
  OPENAI_BASE_URL: "https://api.deepseek.com/chat/completions",
  OPENAI_MODEL: "deepseek-flash",
  MODEL_TIMEOUT_MS: "120000"
};

async function withConfig(values, run) {
  const dir = await mkdtemp(join(tmpdir(), "zhixing deepseek-"));
  const file = join(dir, ".env");
  try {
    await writeFile(file, Object.entries(values).map(([key, value]) => `${key}="${value}"`).join("\r\n"), "utf8");
    await run(file, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("DeepSeek launcher loads a quoted env file in preference to stale terminal settings", async () => {
  await withConfig(config, async (file) => {
    const inherited = { AI_PROVIDER: "rules", OPENAI_API_KEY: "stale-key", PORT: "4182" };
    const env = readDeepSeekEnv(file, inherited);
    assert.equal(env.AI_PROVIDER, "openai");
    assert.equal(env.OPENAI_API_KEY, testKey);
    assert.equal(env.OPENAI_BASE_URL, config.OPENAI_BASE_URL);
    assert.equal(env.OPENAI_MODEL, config.OPENAI_MODEL);
    assert.equal(env.MODEL_TIMEOUT_MS, "120000");
    assert.equal(env.PORT, "4182");
    assert.equal(inherited.AI_PROVIDER, "rules");
  });
});

test("DeepSeek launcher refuses missing or placeholder keys and non-DeepSeek endpoints", async () => {
  for (const values of [
    { ...config, OPENAI_API_KEY: "" },
    { ...config, OPENAI_API_KEY: "replace-with-your-deepseek-key" },
    { ...config, AI_PROVIDER: "rules" },
    ...[
      "https://api.deepseek.com",
      "http://api.deepseek.com/chat/completions",
      "https://api.openai.com/v1/chat/completions",
      "https://api.deepseek.com.example.org/chat/completions",
      "https://api.deepseek.com/chat/completions?key=not-a-real-key",
      "https://someone:password@api.deepseek.com/chat/completions"
    ].map((OPENAI_BASE_URL) => ({ ...config, OPENAI_BASE_URL }))
  ]) {
    await withConfig(values, async (file) => {
      assert.throws(() => readDeepSeekEnv(file, {}), (error) => {
        assert.equal(error.message.includes(testKey), false);
        assert.equal(error.message.includes("password"), false);
        return true;
      });
    });
  }
  await withConfig(config, async (file, dir) => {
    assert.throws(() => readDeepSeekEnv(join(dir, "missing.env"), {}), /未找到.*\.env/);
  });
});

test("DeepSeek launcher starts from another working directory without logging the key", async () => {
  await withConfig(config, async (file, dir) => {
    await mkdir(join(dir, "scripts"));
    await mkdir(join(dir, "server"));
    const launcher = join(dir, "scripts/start-deepseek.mjs");
    await copyFile(fileURLToPath(new URL("../scripts/start-deepseek.mjs", import.meta.url)), launcher);
    const batch = join(dir, "start-deepseek.cmd");
    await copyFile(fileURLToPath(new URL("../start-deepseek.cmd", import.meta.url)), batch);
    await writeFile(join(dir, "server/index.mjs"), [
      'if (process.env.AI_PROVIDER !== "openai") throw new Error("Wrong provider");',
      `if (process.env.OPENAI_API_KEY !== ${JSON.stringify(testKey)}) throw new Error("Wrong credentials");`,
      'console.log("SERVER_STARTED");'
    ].join("\n"));
    for (const valid of [true, false]) {
      if (!valid) await writeFile(file, "AI_PROVIDER=openai\nOPENAI_API_KEY=\n");
      const commands = [[process.execPath, [launcher]]];
      if (process.platform === "win32") {
        commands.push([process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `""${batch}""`]]);
      }
      for (const [command, args] of commands) {
        const child = spawn(command, args, {
          cwd: tmpdir(), env: { ...process.env, AI_PROVIDER: "rules" }, windowsHide: true,
          windowsVerbatimArguments: command !== process.execPath,
          stdio: ["pipe", "pipe", "pipe"]
        });
        child.stdin.end("\n");
        let output = "";
        for (const stream of [child.stdout, child.stderr]) {
          stream.setEncoding("utf8");
          stream.on("data", (chunk) => { output += chunk; });
        }
        const [code] = await once(child, "close");
        assert.equal(code, valid ? 0 : 1, output);
        assert.equal(output.includes("SERVER_STARTED"), valid);
        assert.equal(output.includes(testKey), false);
        if (!valid) assert.match(output, /OPENAI_API_KEY=/);
      }
    }
  });
});
