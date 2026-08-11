import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let serveHandlerEntry;
try {
  serveHandlerEntry = require.resolve("serve-handler");
} catch (error) {
  if (
    error instanceof Error &&
    "code" in error &&
    error.code === "MODULE_NOT_FOUND"
  ) {
    process.stdout.write(
      "Mastra Studio dependencies are omitted; no dev-server patch is required.\n"
    );
    process.exit(0);
  }
  throw error;
}
const serveHandlerRequire = createRequire(serveHandlerEntry);
const minimatchEntry = serveHandlerRequire.resolve("minimatch");
const vulnerableImport = "const minimatch = require('minimatch');";
const reviewedImport = "const {minimatch} = require('minimatch');";

const minimatchPackagePath = serveHandlerRequire.resolve(
  "minimatch/package.json"
);
const minimatchPackage = JSON.parse(
  await readFile(minimatchPackagePath, "utf8")
);
if (minimatchPackage.version !== "10.2.5") {
  throw new Error(
    `Studio dependency patch expected minimatch 10.2.5, found ${String(
      minimatchPackage.version
    )} at ${minimatchEntry}`
  );
}

const source = await readFile(serveHandlerEntry, "utf8");
if (source.includes(vulnerableImport)) {
  await writeFile(
    serveHandlerEntry,
    source.replace(vulnerableImport, reviewedImport),
    "utf8"
  );
} else if (!source.includes(reviewedImport)) {
  throw new Error(
    "serve-handler changed its minimatch import; review the Studio dependency patch"
  );
}

const verifiedSource = await readFile(serveHandlerEntry, "utf8");
if (!verifiedSource.includes(reviewedImport)) {
  throw new Error("Studio dependency patch verification failed");
}

process.stdout.write(
  "Mastra Studio serve-handler uses the reviewed minimatch 10.2.5 API.\n"
);
