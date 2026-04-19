import { accessSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const legacyPrefix = ["c", "o", "r", "e", "m", "i"].join("");

const removedRuntimePaths = [
  `pi/.pi/skills/${legacyPrefix}`,
  `pi/packages/coding-agent/src/runtime/${legacyPrefix}`,
  `pi/packages/coding-agent/src/runtime/${legacyPrefix}.ts`,
  `pi/packages/coding-agent/src/runtime/${legacyPrefix}-engine.ts`,
  `pi/packages/coding-agent/src/runtime/${legacyPrefix}-routing.ts`,
  `pi/packages/coding-agent/src/runtime/${legacyPrefix}-run-history.ts`,
  `pi/packages/coding-agent/src/runtime/${legacyPrefix}-skill-compact.ts`,
];

const existingPaths = removedRuntimePaths.filter((relativePath) => {
  try {
    accessSync(resolve(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
});

if (existingPaths.length > 0) {
  console.error("OpenWork runtime cleanup failed. Removed runtime paths still exist:");
  for (const relativePath of existingPaths) {
    console.error(relativePath);
  }
  process.exit(1);
}

const runtimePattern = `${legacyPrefix}(_|\\b)|${legacyPrefix.toUpperCase()}_|runtime\\/${legacyPrefix}\\.js|skills\\/${legacyPrefix}`;
let output = "";

try {
  output = execFileSync(
    "rg",
    [
      "-n",
      "--ignore-case",
      runtimePattern,
      resolve(repoRoot, "pi"),
      "--glob",
      "!**/node_modules/**",
      "--glob",
      "!**/dist/**",
      "--glob",
      "!**/test/**",
    ],
    { encoding: "utf8" },
  );
} catch (error) {
  if (typeof error.stdout === "string") {
    output = error.stdout;
  }
  if (error.status && error.status !== 1) {
    throw error;
  }
}

const runtimeLines = output
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((line) => !line.includes("/scripts/"));

if (runtimeLines.length > 0) {
  console.error("OpenWork runtime cleanup failed. Runtime references remain:");
  for (const line of runtimeLines.slice(0, 200)) {
    console.error(line);
  }
  if (runtimeLines.length > 200) {
    console.error(`...and ${runtimeLines.length - 200} more runtime matches`);
  }
  process.exit(1);
}

console.log("OpenWork runtime cleanup verification passed.");
