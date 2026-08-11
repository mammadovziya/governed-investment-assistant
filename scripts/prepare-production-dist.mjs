import { access, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const packageManifest = path.join(projectRoot, "package.json");
const distRoot = path.join(projectRoot, "dist");

await access(packageManifest);
if (path.basename(distRoot) !== "dist" || path.dirname(distRoot) !== projectRoot) {
  throw new Error("Refusing to clean an unexpected production output path.");
}

await rm(distRoot, { recursive: true, force: true });
