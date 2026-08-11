import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const OCI_INDEX_MEDIA_TYPES = new Set([
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json"
]);
const OCI_MANIFEST_MEDIA_TYPES = new Set([
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json"
]);
const IN_TOTO_MEDIA_TYPE = "application/vnd.in-toto+json";
const SPDX_PREDICATE_TYPE = "https://spdx.dev/Document";
const SLSA_PREDICATE_PREFIX = "https://slsa.dev/provenance/";
const MAXIMUM_ATTESTATION_BYTES = 64 * 1024 * 1024;
const DIGEST_PATTERN = /^sha256:([a-f0-9]{64})$/u;

function requiredArgument(index, description) {
  const value = process.argv[index]?.trim();
  if (!value) {
    throw new Error(`Missing ${description}.`);
  }
  return value;
}

function asRecord(value, description) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${description} must be a JSON object.`);
  }
  return value;
}

function digestHex(value, description) {
  const match = DIGEST_PATTERN.exec(value);
  if (!match?.[1]) {
    throw new Error(`${description} must be a canonical sha256 digest.`);
  }
  return match[1];
}

function descriptorFrom(value, description) {
  const record = asRecord(value, description);
  if (
    typeof record.mediaType !== "string" ||
    typeof record.digest !== "string"
  ) {
    throw new Error(`${description} has an invalid media type or digest.`);
  }
  digestHex(record.digest, `${description} digest`);
  return record;
}

function jsonDocument(buffer, description) {
  try {
    return asRecord(JSON.parse(buffer.toString("utf8")), description);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${description} is not valid JSON.`);
    }
    throw error;
  }
}

function predicateKind(predicateType) {
  if (predicateType === SPDX_PREDICATE_TYPE) return "sbom";
  if (predicateType.startsWith(SLSA_PREDICATE_PREFIX)) return "provenance";
  return "other";
}

function subjectDigests(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const digests = [];
  for (const candidate of value) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      return null;
    }
    const digest = candidate.digest;
    if (
      typeof digest !== "object" ||
      digest === null ||
      Array.isArray(digest) ||
      typeof digest.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(digest.sha256)
    ) {
      return null;
    }
    digests.push(`sha256:${digest.sha256}`);
  }
  return digests;
}

const layoutDirectory = path.resolve(requiredArgument(2, "OCI layout directory"));
const outputDirectory = path.resolve(requiredArgument(3, "attestation output directory"));
const expectedImageDigest = requiredArgument(4, "expected image digest");
digestHex(expectedImageDigest, "Expected image digest");

const ociLayout = jsonDocument(
  await readFile(path.join(layoutDirectory, "oci-layout")),
  "OCI layout descriptor"
);
if (ociLayout.imageLayoutVersion !== "1.0.0") {
  throw new Error("Unsupported OCI image-layout version.");
}

const index = jsonDocument(
  await readFile(path.join(layoutDirectory, "index.json")),
  "OCI index"
);
if (!Array.isArray(index.manifests) || index.manifests.length === 0) {
  throw new Error("OCI index contains no manifests.");
}

async function verifiedBlob(digest, maximumBytes, description) {
  const hex = digestHex(digest, `${description} digest`);
  const filePath = path.join(layoutDirectory, "blobs", "sha256", hex);
  const metadata = await stat(filePath);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maximumBytes) {
    throw new Error(`${description} has an invalid size.`);
  }
  const buffer = await readFile(filePath);
  const observed = createHash("sha256").update(buffer).digest("hex");
  if (observed !== hex) {
    throw new Error(`${description} content does not match its OCI digest.`);
  }
  return { buffer, filePath, hex };
}

const queue = index.manifests.map((value, indexPosition) =>
  descriptorFrom(value, `OCI index manifest ${indexPosition}`)
);
const visitedManifests = new Set();
const observedDescriptorDigests = new Set(queue.map(({ digest }) => digest));
const attestationLayers = new Map();
const imageManifestDigests = new Set();

while (queue.length > 0) {
  const descriptor = queue.shift();
  if (!descriptor || visitedManifests.has(descriptor.digest)) continue;
  visitedManifests.add(descriptor.digest);

  if (
    !OCI_INDEX_MEDIA_TYPES.has(descriptor.mediaType) &&
    !OCI_MANIFEST_MEDIA_TYPES.has(descriptor.mediaType)
  ) {
    continue;
  }

  const manifestBlob = await verifiedBlob(
    descriptor.digest,
    8 * 1024 * 1024,
    "OCI manifest"
  );
  const manifest = jsonDocument(manifestBlob.buffer, "OCI manifest");

  if (OCI_INDEX_MEDIA_TYPES.has(descriptor.mediaType)) {
    if (!Array.isArray(manifest.manifests) || manifest.manifests.length === 0) {
      throw new Error("OCI image index contains no child manifests.");
    }
    for (const [childIndex, value] of manifest.manifests.entries()) {
      const child = descriptorFrom(value, `OCI child manifest ${childIndex}`);
      observedDescriptorDigests.add(child.digest);
      queue.push(child);
    }
    continue;
  }

  if (!Array.isArray(manifest.layers)) {
    throw new Error("OCI image manifest has no layer list.");
  }
  let containsAttestations = false;
  for (const [layerIndex, value] of manifest.layers.entries()) {
    const layer = descriptorFrom(value, `OCI manifest layer ${layerIndex}`);
    const annotations =
      typeof layer.annotations === "object" &&
      layer.annotations !== null &&
      !Array.isArray(layer.annotations)
        ? layer.annotations
        : {};
    if (
      layer.mediaType === IN_TOTO_MEDIA_TYPE ||
      typeof annotations["in-toto.io/predicate-type"] === "string"
    ) {
      containsAttestations = true;
      attestationLayers.set(layer.digest, layer);
    }
  }
  if (!containsAttestations) {
    imageManifestDigests.add(descriptor.digest);
  }
}

if (!observedDescriptorDigests.has(expectedImageDigest)) {
  throw new Error("Expected image digest is not present in the OCI index.");
}
if (attestationLayers.size === 0) {
  throw new Error("OCI image contains no attached in-toto attestations.");
}

await mkdir(outputDirectory, { recursive: true });
const retained = [];
for (const [digest, descriptor] of attestationLayers) {
  const blob = await verifiedBlob(
    digest,
    MAXIMUM_ATTESTATION_BYTES,
    "in-toto attestation"
  );
  const statement = jsonDocument(blob.buffer, "in-toto attestation");
  const subjects = subjectDigests(statement.subject);
  if (
    typeof statement._type !== "string" ||
    typeof statement.predicateType !== "string" ||
    subjects === null
  ) {
    throw new Error("Attached attestation has an invalid in-toto statement.");
  }
  if (subjects.some((subjectDigest) => !imageManifestDigests.has(subjectDigest))) {
    throw new Error("Attached attestation is not bound to an OCI image manifest.");
  }
  const annotations =
    typeof descriptor.annotations === "object" &&
    descriptor.annotations !== null &&
    !Array.isArray(descriptor.annotations)
      ? descriptor.annotations
      : {};
  const annotatedPredicate = annotations["in-toto.io/predicate-type"];
  if (
    typeof annotatedPredicate === "string" &&
    annotatedPredicate !== statement.predicateType
  ) {
    throw new Error("Attestation predicate does not match its OCI annotation.");
  }
  const kind = predicateKind(statement.predicateType);
  const fileName = `${kind}-${blob.hex}.intoto.json`;
  await copyFile(blob.filePath, path.join(outputDirectory, fileName));
  retained.push({
    kind,
    predicateType: statement.predicateType,
    digest,
    fileName
  });
}

if (!retained.some(({ kind }) => kind === "sbom")) {
  throw new Error("OCI image is missing its SPDX SBOM attestation.");
}
if (!retained.some(({ kind }) => kind === "provenance")) {
  throw new Error("OCI image is missing its SLSA provenance attestation.");
}

retained.sort((left, right) =>
  left.predicateType.localeCompare(right.predicateType) ||
  left.digest.localeCompare(right.digest)
);
const summary = {
  schemaVersion: "governed-investment-assistant.oci-attestation-evidence.v1",
  imageDigest: expectedImageDigest,
  attestationCount: retained.length,
  predicates: [...new Set(retained.map(({ predicateType }) => predicateType))],
  attestations: retained
};
await writeFile(
  path.join(outputDirectory, "attestation-summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 }
);

process.stdout.write(
  `Verified and retained ${retained.length} OCI attestation statement(s).\n`
);
