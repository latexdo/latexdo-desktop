import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Feed contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error("Feed contains an unsupported JSON value.");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isReleaseSlugForVersion(release, version) {
  if (typeof release !== "string" || typeof version !== "string") return false;
  if (release === `v${version}`) return true;
  return new RegExp(
    `^v${escapeRegExp(version)}-build\\.\\d+\\.\\d+\\.[a-f0-9]{12}$`,
  ).test(release);
}

const feedPath = path.resolve(
  process.argv[2] ?? "public-downloads/updates/latest.json",
);
const publicKeyPath = path.resolve(process.argv[3] ?? "build/update-public-key.pem");
const minimumValidityDays = Number(process.env.LATEXDO_UPDATE_MIN_VALIDITY_DAYS ?? "0");
if (
  !Number.isSafeInteger(minimumValidityDays) ||
  minimumValidityDays < 0 ||
  minimumValidityDays > 365
) {
  throw new Error("LATEXDO_UPDATE_MIN_VALIDITY_DAYS must be an integer from 0 to 365.");
}
const payload = JSON.parse(await readFile(feedPath, "utf8"));
const signature = payload.signature;
if (
  payload.schemaVersion !== 2 ||
  payload.product !== "LatexDo" ||
  payload.channel !== "stable" ||
  !/^\d+\.\d+\.\d+$/.test(payload.version ?? "") ||
  !isReleaseSlugForVersion(payload.release, payload.version) ||
  !/^[a-f0-9]{40}$/.test(payload.commit ?? "") ||
  signature?.algorithm !== "ed25519" ||
  !/^[a-f0-9]{16}$/.test(signature.keyId ?? "") ||
  !/^[A-Za-z0-9+/]{86}==$/.test(signature.value ?? "")
) {
  throw new Error("Update feed signature metadata is invalid.");
}
const publishedAt = Date.parse(payload.publishedAt);
const expiresAt = Date.parse(payload.expiresAt);
const now = Date.now();
if (
  !Number.isFinite(publishedAt) ||
  !Number.isFinite(expiresAt) ||
  expiresAt <= publishedAt ||
  publishedAt > now + 10 * 60 * 1_000 ||
  expiresAt <= now
) {
  throw new Error("Update feed freshness metadata is invalid or expired.");
}
if (expiresAt - now < minimumValidityDays * 24 * 60 * 60 * 1_000) {
  throw new Error(
    `Update feed has less than ${minimumValidityDays} days of remaining validity.`,
  );
}

delete payload.signature;
const publicKey = createPublicKey(await readFile(publicKeyPath, "utf8"));
if (publicKey.asymmetricKeyType !== "ed25519") {
  throw new Error("Update feed verification key is not Ed25519.");
}
const keyId = createHash("sha256")
  .update(publicKey.export({ type: "spki", format: "der" }))
  .digest("hex")
  .slice(0, 16);
if (signature.keyId !== keyId) throw new Error("Update feed key ID does not match.");
if (
  !verify(
    null,
    Buffer.from(canonicalJson(payload)),
    publicKey,
    Buffer.from(signature.value, "base64"),
  )
) {
  throw new Error("Update feed signature is invalid.");
}

console.log(`Verified update feed ${feedPath} with key ${keyId}.`);
