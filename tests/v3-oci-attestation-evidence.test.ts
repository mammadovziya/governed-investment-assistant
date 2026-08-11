import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

function encoded(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value));
}

function digest(buffer: Buffer): string {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

async function writeBlob(layout: string, buffer: Buffer): Promise<string> {
  const observedDigest = digest(buffer);
  const hex = observedDigest.slice("sha256:".length);
  await writeFile(path.join(layout, "blobs", "sha256", hex), buffer);
  return observedDigest;
}

describe("retained OCI build attestations", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    );
  });

  it("extracts digest-verified SPDX and SLSA statements bound to the image", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "investment-assistant-oci-evidence-"));
    temporaryDirectories.push(root);
    const layout = path.join(root, "layout");
    const output = path.join(root, "evidence");
    await mkdir(path.join(layout, "blobs", "sha256"), { recursive: true });
    await writeFile(
      path.join(layout, "oci-layout"),
      JSON.stringify({ imageLayoutVersion: "1.0.0" })
    );

    const imageManifest = encoded({
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      layers: []
    });
    const imageDigest = await writeBlob(layout, imageManifest);
    const imageSubject = [{
      name: "governed-investment-assistant",
      digest: { sha256: imageDigest.slice("sha256:".length) }
    }];
    const sbom = encoded({
      _type: "https://in-toto.io/Statement/v0.1",
      subject: imageSubject,
      predicateType: "https://spdx.dev/Document",
      predicate: { spdxVersion: "SPDX-2.3" }
    });
    const provenance = encoded({
      _type: "https://in-toto.io/Statement/v0.1",
      subject: imageSubject,
      predicateType: "https://slsa.dev/provenance/v0.2",
      predicate: { buildType: "https://mobyproject.org/buildkit@v1" }
    });
    const sbomDigest = await writeBlob(layout, sbom);
    const provenanceDigest = await writeBlob(layout, provenance);
    const attestationManifest = encoded({
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      layers: [
        {
          mediaType: "application/vnd.in-toto+json",
          digest: sbomDigest,
          size: sbom.length,
          annotations: {
            "in-toto.io/predicate-type": "https://spdx.dev/Document"
          }
        },
        {
          mediaType: "application/vnd.in-toto+json",
          digest: provenanceDigest,
          size: provenance.length,
          annotations: {
            "in-toto.io/predicate-type": "https://slsa.dev/provenance/v0.2"
          }
        }
      ]
    });
    const attestationManifestDigest = await writeBlob(layout, attestationManifest);
    const imageIndex = encoded({
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.index.v1+json",
      manifests: [
        {
          mediaType: "application/vnd.oci.image.manifest.v1+json",
          digest: imageDigest,
          size: imageManifest.length,
          platform: { os: "linux", architecture: "amd64" }
        },
        {
          mediaType: "application/vnd.oci.image.manifest.v1+json",
          digest: attestationManifestDigest,
          size: attestationManifest.length,
          annotations: {
            "vnd.docker.reference.type": "attestation-manifest"
          },
          platform: { os: "unknown", architecture: "unknown" }
        }
      ]
    });
    const imageIndexDigest = await writeBlob(layout, imageIndex);
    await writeFile(path.join(layout, "index.json"), JSON.stringify({
      schemaVersion: 2,
      manifests: [{
        mediaType: "application/vnd.oci.image.index.v1+json",
        digest: imageIndexDigest,
        size: imageIndex.length,
        annotations: {
          "org.opencontainers.image.ref.name": "governed-investment-assistant:test"
        }
      }]
    }));

    await execFileAsync(process.execPath, [
      "scripts/collect-oci-attestations.mjs",
      layout,
      output,
      imageIndexDigest
    ], {
      cwd: process.cwd()
    });

    const summary = JSON.parse(
      await readFile(path.join(output, "attestation-summary.json"), "utf8")
    ) as {
      imageDigest: string;
      attestationCount: number;
      predicates: string[];
      attestations: Array<{ fileName: string }>;
    };
    expect(summary).toMatchObject({
      imageDigest: imageIndexDigest,
      attestationCount: 2,
      predicates: [
        "https://slsa.dev/provenance/v0.2",
        "https://spdx.dev/Document"
      ]
    });
    for (const { fileName } of summary.attestations) {
      await expect(readFile(path.join(output, fileName), "utf8")).resolves.toContain(
        "\"predicateType\""
      );
    }
  });
});
