import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["server", "dist", "scripts", "tests"];
const files = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) walk(fullPath);
    else if (/\.(mjs|js)$/.test(entry)) files.push(fullPath);
  }
}

for (const root of roots) {
  try {
    walk(root);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

let failures = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    failures += 1;
    console.error(`语法检查失败：${file}`);
    console.error(String(error.stderr || error.message));
  }
}

if (failures) {
  console.error(`${failures} 个文件存在语法错误`);
  process.exit(1);
}
console.log(`语法检查通过：${files.length} 个文件`);
