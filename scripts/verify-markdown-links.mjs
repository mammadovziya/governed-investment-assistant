import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();

const { stdout } = await execFileAsync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
    cwd: projectRoot,
    encoding: "buffer",
    maxBuffer: 16 * 1024 * 1024
  }
);

const markdownFiles = stdout
  .toString("utf8")
  .split("\0")
  .filter((file) => file.endsWith(".md"));
const failures = [];

for (const relative of markdownFiles) {
  const absolute = path.join(projectRoot, relative);
  const source = await readFile(absolute, "utf8");
  const withoutFencedCode = source.replace(/```[\s\S]*?```/gu, "");
  const linkPattern =
    /!?\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\)/gu;

  for (const match of withoutFencedCode.matchAll(linkPattern)) {
    const rawTarget = (match[1] ?? "").replace(/^<|>$/gu, "");
    if (
      rawTarget === "" ||
      rawTarget.startsWith("#") ||
      /^[a-z][a-z0-9+.-]*:/iu.test(rawTarget)
    ) {
      continue;
    }

    const fileTarget = rawTarget.split("#", 1)[0] ?? "";
    let decodedTarget;
    try {
      decodedTarget = decodeURIComponent(fileTarget);
    } catch {
      failures.push(`${relative}: invalid percent-encoding in ${rawTarget}`);
      continue;
    }

    const resolved = path.resolve(path.dirname(absolute), decodedTarget);
    if (
      resolved !== projectRoot &&
      !resolved.startsWith(`${projectRoot}${path.sep}`)
    ) {
      failures.push(`${relative}: link leaves the repository: ${rawTarget}`);
      continue;
    }

    const metadata = await stat(resolved).catch(() => null);
    if (metadata === null) {
      failures.push(`${relative}: missing local link target: ${rawTarget}`);
    }
  }
}

if (failures.length > 0) {
  throw new Error([
    "Markdown link verification failed.",
    ...failures.map((failure) => `- ${failure}`)
  ].join("\n"));
}

process.stdout.write(
  `Markdown link verification passed (${markdownFiles.length} files checked).\n`
);
