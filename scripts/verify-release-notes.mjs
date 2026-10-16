import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const releasesDir = path.resolve(
  process.argv[2] ?? "public-downloads/updates/release-notes",
);
const publicKeyPath = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.resolve("build/update-public-key.pem");
const expectedVersion = process.argv[4] ?? "";
const releaseVersionPattern = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("Release notes contain a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error("Release notes contain an unsupported JSON value.");
}

const publicKeyObject = createPublicKey(await readFile(publicKeyPath, "utf8"));
if (publicKeyObject.asymmetricKeyType !== "ed25519") {
  throw new Error("Release notes verification key is not Ed25519.");
}
const keyId = createHash("sha256")
  .update(publicKeyObject.export({ type: "spki", format: "der" }))
  .digest("hex")
  .slice(0, 16);

function verifySignature(payload) {
  const signature = payload?.signature;
  if (
    signature?.algorithm !== "ed25519" ||
    !/^[a-f0-9]{16}$/.test(signature.keyId ?? "") ||
    !/^[A-Za-z0-9+/]{86}==$/.test(signature.value ?? "")
  ) {
    throw new Error("Release notes signature metadata is invalid.");
  }
  if (signature.keyId !== keyId) {
    throw new Error("Release notes signature key ID does not match.");
  }
  const unsigned = { ...payload };
  delete unsigned.signature;
  if (
    !verify(
      null,
      Buffer.from(canonicalJson(unsigned), "utf8"),
      publicKeyObject,
      Buffer.from(signature.value, "base64"),
    )
  ) {
    throw new Error("Release notes signature is invalid.");
  }
}

const indexPayload = JSON.parse(
  await readFile(path.join(releasesDir, "index.json"), "utf8"),
);
verifySignature(indexPayload);

if (
  indexPayload.schemaVersion !== 1 ||
  indexPayload.product !== "LatexDo" ||
  !Array.isArray(indexPayload.releases) ||
  indexPayload.releases.length === 0
) {
  throw new Error("Release notes index schema is invalid.");
}

let verifiedCount = 0;
for (const entry of indexPayload.releases) {
  if (!releaseVersionPattern.test(entry.version ?? "")) {
    throw new Error("Release notes index contains an invalid version.");
  }
  const version = entry.version.replace(/^v/i, "");
  if (expectedVersion && version !== expectedVersion.replace(/^v/i, "")) {
    continue;
  }
  const documentPayload = JSON.parse(
    await readFile(path.join(releasesDir, `${version}.json`), "utf8"),
  );
  if (documentPayload.version !== version) {
    throw new Error(`Release notes document ${version} has a mismatched version.`);
  }
  verifySignature(documentPayload);
  if (typeof entry.sha256 === "string" && !/^[a-f0-9]{64}$/.test(entry.sha256)) {
    throw new Error(`Release notes index has an invalid sha256 for ${version}.`);
  }
  verifiedCount += 1;
}

if (verifiedCount === 0) {
  throw new Error("No release notes documents matched the requested version.");
}

console.log(
  `Verified ${verifiedCount} signed release notes documents in ${releasesDir} with key ${keyId}.`,
);
