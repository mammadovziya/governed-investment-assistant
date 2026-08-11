import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const maximumFileBytes = 2 * 1024 * 1024;
const detectors = [
  {
    id: "openai-api-key",
    pattern: /\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}\b/u
  },
  {
    id: "aws-access-key",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u
  },
  {
    id: "private-key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u
  },
  {
    id: "github-token",
    pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{30,}\b/u
  }
];

const { stdout } = await execFileAsync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: projectRoot, encoding: "buffer", maxBuffer: 16 * 1024 * 1024 }
);
const files = stdout
  .toString("utf8")
  .split("\0")
  .filter(Boolean)
  .filter((file) => !file.startsWith("dist/") && !file.startsWith(".git/"));

const findings = [];
for (const relative of files) {
  const absolute = path.resolve(projectRoot, relative);
  if (!absolute.startsWith(`${projectRoot}${path.sep}`)) continue;
  const metadata = await stat(absolute).catch(() => null);
  if (metadata === null || !metadata.isFile() || metadata.size > maximumFileBytes) continue;
  const content = await readFile(absolute, "utf8").catch(() => null);
  if (content === null || content.includes("\u0000")) continue;
  for (const detector of detectors) {
    if (detector.pattern.test(content)) {
      findings.push(`${relative}: ${detector.id}`);
    }
  }
}

if (findings.length > 0) {
  throw new Error([
    "Potential credential material found in repository files.",
    ...findings
  ].join("\n"));
}

process.stdout.write(
  `Repository credential scan passed (${String(files.length)} files checked).\n`
);
