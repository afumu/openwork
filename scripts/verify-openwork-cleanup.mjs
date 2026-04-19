import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const legacyTerms = [
  ["c", "o", "r", "e", "m", "i"].join(""),
  ["c", "o", "m", "e", "t"].join(""),
  ["九", "九"].join(""),
];

const forbiddenPattern = `\\b(${legacyTerms[0]}|${legacyTerms[1]})\\b|${legacyTerms[2]}\\s*ai|${legacyTerms[2]}AI|${legacyTerms[2]}`;

const ignoredArgs = [
  "--glob",
  "!**/node_modules/**",
  "--glob",
  "!**/dist/**",
  "--glob",
  "!admin/src/iconify/data.json",
];

let output = "";

try {
  output = execFileSync("rg", ["-n", "--ignore-case", forbiddenPattern, repoRoot, ...ignoredArgs], {
    encoding: "utf8",
  });
} catch (error) {
  if (typeof error.stdout === "string") {
    output = error.stdout;
  }
  if (error.status && error.status !== 1) {
    throw error;
  }
}

const lines = output
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((line) => !line.includes("/scripts/"));

if (lines.length > 0) {
  console.error("OpenWork cleanup verification failed. Legacy terms remain:");
  for (const line of lines.slice(0, 200)) {
    console.error(line);
  }
  if (lines.length > 200) {
    console.error(`...and ${lines.length - 200} more matches`);
  }
  process.exit(1);
}

const readme = readFileSync(resolve(repoRoot, "README.md"), "utf8");
if (!/openwork/i.test(readme)) {
  console.error("OpenWork cleanup verification failed. README.md does not mention OpenWork.");
  process.exit(1);
}

console.log("OpenWork cleanup verification passed.");
