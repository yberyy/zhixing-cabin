import { pathToFileURL } from "node:url";

export async function checkHealth({
  url = `http://127.0.0.1:${process.env.PORT || 4173}/api/v1/health`,
  timeoutMs = 3000
} = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const health = await response.json();
  if (health?.status !== "ok" || health?.service !== "zhixing-api") {
    throw new Error("Unexpected health response");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkHealth().catch((error) => {
    console.error(`Health check failed: ${error.message}`);
    process.exitCode = 1;
  });
}
