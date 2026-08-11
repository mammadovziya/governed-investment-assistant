import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const distRoot = path.join(projectRoot, "dist");
const customerForbiddenPaths = new Set([
  "assistant-v3/index.js",
  "assistant-v3/index.js.map",
  "assistant-v3/index.d.ts",
  "assistant-v3/shadow-evaluator.js",
  "assistant-v3/shadow-evaluator.js.map",
  "assistant-v3/shadow-evaluator.d.ts",
  "assistant-v3/studio-execution.js",
  "assistant-v3/studio-execution.js.map",
  "assistant-v3/studio-execution.d.ts",
  "assistant-v3/studio-knowledge-vector.js",
  "assistant-v3/studio-knowledge-vector.js.map",
  "assistant-v3/studio-knowledge-vector.d.ts"
]);
const forbiddenRuntimeImports = ["@mastra/editor", "@mastra/memory"];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(absolute));
    } else {
      files.push(absolute);
    }
  }
  return files;
}

const files = await walk(distRoot);
const relativeFiles = files.map((file) => path.relative(distRoot, file));
const leakedCustomerForbiddenFiles = relativeFiles.filter((file) =>
  customerForbiddenPaths.has(file) ||
  file.startsWith(`assistant-v3/editor-overrides${path.sep}`)
);

const leakedImports = [];
for (const file of files.filter((candidate) => candidate.endsWith(".js"))) {
  const source = await readFile(file, "utf8");
  for (const dependency of forbiddenRuntimeImports) {
    if (source.includes(dependency)) {
      leakedImports.push(`${path.relative(distRoot, file)} -> ${dependency}`);
    }
  }
}

if (leakedCustomerForbiddenFiles.length > 0 || leakedImports.length > 0) {
  throw new Error([
    "Production dist contains private Studio/offline-evaluation code or dependencies.",
    ...leakedCustomerForbiddenFiles.map((file) => `file: ${file}`),
    ...leakedImports.map((entry) => `import: ${entry}`)
  ].join("\n"));
}

process.stdout.write(
  "Production dist excludes private Studio/offline-evaluation code and dependencies.\n"
);
