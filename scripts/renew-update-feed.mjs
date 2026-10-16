import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const renewalLifetimeMs = 30 * 24 * 60 * 60 * 1_000;
const minimumRemainingLifetimeMs = 14 * 24 * 60 * 60 * 1_000;
const clockSkewMs = 10 * 60 * 1_000;

const feedPath = path.resolve(
  process.argv[2] ?? "public-downloads/updates/latest.json",
);
const downloadsRoot = path.resolve(process.argv[3] ?? "public-downloads/downloads");
const publicKeyPath = path.resolve(process.argv[4] ?? "build/update-public-key.pem");
const now = Date.now();
const requestedPublishedAt =
  process.env.LATEXDO_UPDATE_PUBLISHED_AT ?? new Date(now).toISOString();
const publishedAtMs = Date.parse(requestedPublishedAt);

if (!Number.isFinite(publishedAtMs) || Math.abs(publishedAtMs - now) > clockSkewMs) {
  throw new Error("The renewal publication time must be within ten minutes of now.");
}

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
  if (value && typeof value === "object") {
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

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function publicKeyId(publicKey) {
  return createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex")
    .slice(0, 16);
}

function unsignedFeed(feed) {
  const value = { ...feed };
  delete value.signature;
  return value;
}

function immutableFeed(feed) {
  const value = unsignedFeed(feed);
  delete value.publishedAt;
  delete value.expiresAt;
  return value;
}

function assertFeedMetadata(feed) {
  if (
    !isRecord(feed) ||
    feed.schemaVersion !== 2 ||
    feed.product !== "LatexDo" ||
    feed.channel !== "stable" ||
    !/^\d+\.\d+\.\d+$/.test(feed.version ?? "") ||
    !isReleaseSlugForVersion(feed.release, feed.version) ||
    !/^[a-f0-9]{40}$/.test(feed.commit ?? "") ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(feed.repository ?? "") ||
    !Array.isArray(feed.files) ||
    feed.files.length === 0
  ) {
    throw new Error("Existing update feed metadata is invalid.");
  }

  const publishedAt = Date.parse(feed.publishedAt);
  const expiresAt = Date.parse(feed.expiresAt);
  if (
    typeof feed.publishedAt !== "string" ||
    typeof feed.expiresAt !== "string" ||
    !Number.isFinite(publishedAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= publishedAt ||
    publishedAt > now + clockSkewMs
  ) {
    throw new Error("Existing update feed freshness metadata is invalid.");
  }

  const signature = feed.signature;
  if (
    !isRecord(signature) ||
    signature.algorithm !== "ed25519" ||
    !/^[a-f0-9]{16}$/.test(signature.keyId ?? "") ||
    !/^[A-Za-z0-9+/]{86}==$/.test(signature.value ?? "")
  ) {
    throw new Error("Existing update feed signature metadata is invalid.");
  }
}

function verifyFeedSignature(feed, publicKey) {
  assertFeedMetadata(feed);
  if (feed.signature.keyId !== publicKeyId(publicKey)) {
    throw new Error("Existing update feed was signed by an unknown key.");
  }
  if (
    !verify(
      null,
      Buffer.from(canonicalJson(unsignedFeed(feed))),
      publicKey,
      Buffer.from(feed.signature.value, "base64"),
    )
  ) {
    throw new Error("Existing update feed signature is invalid.");
  }
}

function safeHttpsUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL.`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${label} must be a plain HTTPS URL.`);
  }
  return url;
}

function assertReleaseUrls(feed, manifest) {
  const downloadsPage = safeHttpsUrl(feed.downloadsPage, "Feed downloadsPage");
  if (
    downloadsPage.hostname !== "latexdo.org" ||
    downloadsPage.pathname !== `/downloads/${feed.release}/`
  ) {
    throw new Error("Feed downloadsPage does not identify its versioned release.");
  }
  if (
    feed.releaseUrl !== downloadsPage.href ||
    manifest.downloadsPage !== downloadsPage.href ||
    feed.manifestUrl !== new URL("manifest.json", downloadsPage).href
  ) {
    throw new Error("Feed release URLs do not match the immutable manifest.");
  }
}

function assertReleaseFiles(feed, manifest, checksums) {
  if (!Array.isArray(manifest.files)) {
    throw new Error("Release manifest files are missing.");
  }
  if (canonicalJson(feed.files) !== canonicalJson(manifest.files)) {
    throw new Error("Update feed files do not match the immutable release manifest.");
  }

  const checksumLines = new Set(
    checksums
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
  const ids = new Set();
  for (const file of feed.files) {
    if (
      !isRecord(file) ||
      typeof file.id !== "string" ||
      !file.id ||
      ids.has(file.id) ||
      typeof file.filename !== "string" ||
      !file.filename ||
      file.filename.includes("/") ||
      file.filename.includes("\\") ||
      file.filename.includes("..") ||
      !Number.isSafeInteger(file.size) ||
      file.size <= 0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256 ?? "")
    ) {
      throw new Error("Release manifest contains invalid file metadata.");
    }
    ids.add(file.id);

    const expectedUrl = `https://github.com/${feed.repository}/releases/download/${feed.release}/${encodeURIComponent(file.filename)}`;
    if (file.url !== expectedUrl) {
      throw new Error(`Release URL for ${file.id} does not match its immutable asset.`);
    }
    if (!checksumLines.has(`${file.sha256}  ${file.filename}`)) {
      throw new Error(`Release checksum file does not contain ${file.filename}.`);
    }
  }
  if (checksumLines.size !== feed.files.length) {
    throw new Error("Release checksum file contains an unexpected asset set.");
  }
}

const publicKey = createPublicKey(await readFile(publicKeyPath, "utf8"));
if (publicKey.asymmetricKeyType !== "ed25519") {
  throw new Error("Update feed verification key is not Ed25519.");
}

const existingFeed = parseJson(await readFile(feedPath, "utf8"), "Update feed");
verifyFeedSignature(existingFeed, publicKey);

const releaseDirectory = path.join(downloadsRoot, existingFeed.release);
const manifestPath = path.join(releaseDirectory, "manifest.json");
const checksumsPath = path.join(releaseDirectory, "SHA256SUMS.txt");
const manifest = parseJson(await readFile(manifestPath, "utf8"), "Release manifest");
const checksums = await readFile(checksumsPath, "utf8");

if (
  !isRecord(manifest) ||
  manifest.schemaVersion !== 1 ||
  manifest.product !== existingFeed.product ||
  manifest.version !== existingFeed.version ||
  manifest.commit !== existingFeed.commit ||
  manifest.repository !== existingFeed.repository
) {
  throw new Error("Release manifest identity does not match the signed update feed.");
}
assertReleaseUrls(existingFeed, manifest);
assertReleaseFiles(existingFeed, manifest, checksums);

const encodedPrivateKey = process.env.LATEXDO_UPDATE_SIGNING_KEY?.trim();
if (!encodedPrivateKey) {
  throw new Error("LATEXDO_UPDATE_SIGNING_KEY is required to renew the update feed.");
}
const privateKey = createPrivateKey(
  Buffer.from(encodedPrivateKey, "base64").toString("utf8"),
);
if (privateKey.asymmetricKeyType !== "ed25519") {
  throw new Error("LATEXDO_UPDATE_SIGNING_KEY must contain an Ed25519 private key.");
}
const signingPublicKey = createPublicKey(privateKey);
if (
  !Buffer.from(signingPublicKey.export({ type: "spki", format: "der" })).equals(
    Buffer.from(publicKey.export({ type: "spki", format: "der" })),
  )
) {
  throw new Error("Update signing key does not match build/update-public-key.pem.");
}

const renewedUnsignedFeed = {
  ...unsignedFeed(existingFeed),
  publishedAt: new Date(publishedAtMs).toISOString(),
  expiresAt: new Date(publishedAtMs + renewalLifetimeMs).toISOString(),
};
if (
  canonicalJson(immutableFeed(existingFeed)) !==
  canonicalJson(immutableFeed(renewedUnsignedFeed))
) {
  throw new Error("Update feed renewal changed immutable release metadata.");
}

const renewedFeed = {
  ...renewedUnsignedFeed,
  signature: {
    algorithm: "ed25519",
    keyId: publicKeyId(publicKey),
    value: sign(
      null,
      Buffer.from(canonicalJson(renewedUnsignedFeed)),
      privateKey,
    ).toString("base64"),
  },
};
verifyFeedSignature(renewedFeed, publicKey);
if (Date.parse(renewedFeed.expiresAt) - now < minimumRemainingLifetimeMs) {
  throw new Error("Renewed update feed has less than fourteen days of validity.");
}

const temporaryPath = `${feedPath}.${process.pid}.${Date.now()}.tmp`;
try {
  await writeFile(temporaryPath, `${JSON.stringify(renewedFeed, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o644,
    flag: "wx",
  });
  await rename(temporaryPath, feedPath);
} catch (error) {
  await unlink(temporaryPath).catch(() => undefined);
  throw error;
}

console.log(
  `Renewed ${existingFeed.release} update feed through ${renewedFeed.expiresAt}.`,
);
