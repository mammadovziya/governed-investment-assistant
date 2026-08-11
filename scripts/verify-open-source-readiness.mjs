import { execFile } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();

const requiredFiles = [
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_NOTICES.md",
  "CITATION.cff",
  "CHANGELOG.md",
  "README.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "SUPPORT.md",
  ".editorconfig",
  ".gitattributes",
  ".gitleaksignore",
  ".nvmrc",
  ".env.example",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/dependabot.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/codeql.yml",
  ".github/workflows/dependency-review.yml",
  ".github/workflows/gitleaks.yml",
  "scripts/verify-markdown-links.mjs",
  "docs/PUBLISHING.md",
  "docs/assets/social-preview.svg",
  "docs/assets/social-preview.png"
];

const failures = [];

for (const relative of requiredFiles) {
  const absolute = path.join(projectRoot, relative);
  const metadata = await stat(absolute).catch(() => null);
  if (metadata === null || !metadata.isFile() || metadata.size === 0) {
    failures.push(`missing or empty required file: ${relative}`);
  }
}

const packageJson = JSON.parse(
  await readFile(path.join(projectRoot, "package.json"), "utf8")
);
if (packageJson.private !== true) {
  failures.push("package.json must keep private=true to prevent accidental npm publication");
}
if (packageJson.license !== "Apache-2.0") {
  failures.push("package.json license must match LICENSE (Apache-2.0)");
}
if (
  typeof packageJson.description !== "string" ||
  packageJson.description.length < 80
) {
  failures.push("package.json needs a descriptive, search-friendly description");
}
if (
  !Array.isArray(packageJson.keywords) ||
  new Set(packageJson.keywords).size < 10
) {
  failures.push("package.json needs at least ten unique discoverability keywords");
}
if (packageJson.scripts?.["open-source:verify"] === undefined) {
  failures.push("package.json must expose the open-source:verify command");
}
if (packageJson.scripts?.["license:verify"] === undefined) {
  failures.push("package.json must expose the license:verify command");
}

const { stdout } = await execFileAsync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
    cwd: projectRoot,
    encoding: "buffer",
    maxBuffer: 16 * 1024 * 1024
  }
);
const publicationFiles = stdout
  .toString("utf8")
  .split("\0")
  .filter(Boolean);

const forbiddenTrackedPath = /(?:^|\/)(?:tmp|dist|coverage|node_modules|playwright-report|test-results)\//u;
const forbiddenTrackedState =
  /(?:^|\/)(?!\.env\.example$)(?:\.env(?:\..+)?|[^/]+\.(?:db|sqlite|sqlite3|duckdb)(?:[-.].*)?|[^/]+\.jsonl|[^/]+\.log)$/iu;

for (const relative of publicationFiles) {
  if (forbiddenTrackedPath.test(relative)) {
    failures.push(`generated/private path is tracked: ${relative}`);
  }
  if (forbiddenTrackedState.test(relative)) {
    failures.push(`runtime state or secret-bearing file is tracked: ${relative}`);
  }
}

for (const relative of requiredFiles.filter((file) =>
  file.startsWith(".github/workflows/")
)) {
  const contents = await readFile(path.join(projectRoot, relative), "utf8");
  for (const line of contents.split(/\r?\n/u)) {
    const action = /^\s*uses:\s+([^#\s]+)@([^#\s]+)/u.exec(line);
    if (action !== null && !/^[a-f0-9]{40}$/u.test(action[2] ?? "")) {
      failures.push(
        `GitHub Action is not pinned to a full commit SHA in ${relative}: ${action[1]}`
      );
    }
  }
}

const textExtensions = new Set([
  ".cjs",
  ".cff",
  ".css",
  ".d.ts",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
  ".txt",
  ".yml",
  ".yaml"
]);
const localIdentityPatterns = [
  /\/Users\/[^/\s]+/u,
  /(?:^|[\s`"'(])\/home\/[^/\s]+/u,
  /[A-Za-z]:\\Users\\[^\\\s]+/u
];

for (const relative of publicationFiles) {
  const extension = relative.endsWith(".d.ts")
    ? ".d.ts"
    : path.extname(relative).toLowerCase();
  if (!textExtensions.has(extension)) continue;
  const absolute = path.join(projectRoot, relative);
  const metadata = await stat(absolute).catch(() => null);
  if (
    metadata === null ||
    !metadata.isFile() ||
    metadata.size > 2 * 1024 * 1024
  ) {
    continue;
  }
  const content = await readFile(absolute, "utf8").catch(() => null);
  if (content === null) continue;
  if (localIdentityPatterns.some((pattern) => pattern.test(content))) {
    failures.push(`local workstation path appears in tracked text: ${relative}`);
  }
}

const ignoredRuntimeExamples = [
  ".env.local",
  ".mastra-storage-private-v2.db",
  ".mastra-observability-shared.duckdb",
  ".assistant-v3-audit.jsonl",
  "tmp/open-source-check.txt"
];
for (const relative of ignoredRuntimeExamples) {
  try {
    await execFileAsync("git", ["check-ignore", "--quiet", relative], {
      cwd: projectRoot
    });
  } catch {
    failures.push(`.gitignore does not cover expected local state: ${relative}`);
  }
}

await access(path.join(projectRoot, "README.md"));
const readme = await readFile(path.join(projectRoot, "README.md"), "utf8");
for (const expected of [
  "Apache-2.0",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "customiz"
]) {
  if (!readme.toLowerCase().includes(expected.toLowerCase())) {
    failures.push(`README.md is missing public-repository topic: ${expected}`);
  }
}

if (failures.length > 0) {
  throw new Error([
    "Open-source readiness verification failed.",
    ...failures.map((failure) => `- ${failure}`)
  ].join("\n"));
}

process.stdout.write(
  `Open-source readiness verification passed (${publicationFiles.length} publication files checked).\n`
);
