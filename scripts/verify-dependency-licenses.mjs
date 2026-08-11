import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const lock = JSON.parse(
  await readFile(path.join(root, "package-lock.json"), "utf8")
);

const allowedRuntimeLicenses = new Set([
  "0BSD",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MIT",
  "Unlicense",
  "(AFL-2.1 OR BSD-3-Clause)",
  "(BSD-2-Clause OR MIT OR Apache-2.0)",
  "(MIT OR CC0-1.0)",
  "(WTFPL OR MIT)"
]);

const runtimeViolations = [];
let runtimePackageCount = 0;
for (const [packagePath, metadata] of Object.entries(lock.packages ?? {})) {
  if (packagePath === "" || metadata?.dev === true) continue;
  runtimePackageCount += 1;
  const license = typeof metadata?.license === "string"
    ? metadata.license
    : "(missing)";
  if (!allowedRuntimeLicenses.has(license)) {
    runtimeViolations.push(`${packagePath}: ${license}`);
  }
}

if (runtimeViolations.length > 0) {
  throw new Error(
    `Unreviewed runtime dependency licenses:\n${runtimeViolations.join("\n")}`
  );
}

const editor = lock.packages?.["node_modules/@mastra/editor"];
if (editor !== undefined) {
  const editorLicense = await readFile(
    path.join(root, "node_modules", "@mastra", "editor", "LICENSE.md"),
    "utf8"
  );
  if (
    !editorLicense.includes("Apache License 2.0") ||
    !editorLicense.includes('directory named "ee/"')
  ) {
    throw new Error("@mastra/editor license terms changed and require review.");
  }

  async function sourceFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const resolved = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...await sourceFiles(resolved));
      } else if (/\.(?:[cm]?[jt]s|json)$/u.test(entry.name)) {
        files.push(resolved);
      }
    }
    return files;
  }

  for (const directory of ["src", "scripts", "tests"]) {
    for (const file of await sourceFiles(path.join(root, directory))) {
      const contents = await readFile(file, "utf8");
      if (/["']@mastra\/editor\/ee(?:\/|["'])/u.test(contents)) {
        throw new Error(
          `Enterprise-only @mastra/editor import is not allowed: ${path.relative(root, file)}`
        );
      }
    }
  }
}

console.log(
  `Dependency license verification passed for ${runtimePackageCount} runtime packages; ` +
  "the development-only Mastra Editor uses only its root export."
);
