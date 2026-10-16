import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const deployedDownloadsUrl = new URL(
  process.argv[2] ?? "https://latexdo.org/downloads/",
);
const publicDownloadsUrl = new URL(
  process.env.LATEXDO_PUBLIC_DOWNLOADS_URL ?? deployedDownloadsUrl.href,
);
const retries = Number(process.env.LATEXDO_VERIFY_RETRIES ?? 24);
const delayMs = Number(process.env.LATEXDO_VERIFY_DELAY_MS ?? 10_000);
const expectedCommit =
  process.env.LATEXDO_RELEASE_COMMIT ?? process.env.GITHUB_SHA ?? "";
const expectedRepository = process.env.GITHUB_REPOSITORY ?? "latexdo/latexdo";
const expectedVersion = JSON.parse(
  await readFile(path.join(process.cwd(), "package.json"), "utf8"),
).version;
const updatePublicKey = createPublicKey(
  await readFile(path.join(process.cwd(), "build", "update-public-key.pem"), "utf8"),
);
if (updatePublicKey.asymmetricKeyType !== "ed25519") {
  throw new Error("The update verification key must be Ed25519.");
}
const expectedUpdateKeyId = createHash("sha256")
  .update(updatePublicKey.export({ type: "spki", format: "der" }))
  .digest("hex")
  .slice(0, 16);
const expectedReleaseSlug = normalizeReleaseSlug(
  process.env.LATEXDO_RELEASE_SLUG ?? `v${expectedVersion.replace(/^v/i, "")}`,
);
const deployedReleaseDownloadsUrl = new URL(
  `${expectedReleaseSlug}/`,
  deployedDownloadsUrl,
);
const deployedDownloadsIndexUrl = new URL("index.html", deployedDownloadsUrl);
const deployedReleaseDownloadsIndexUrl = new URL(
  "index.html",
  deployedReleaseDownloadsUrl,
);
const deployedReleaseManifestUrl = new URL(
  "manifest.json",
  deployedReleaseDownloadsUrl,
);
const expectedReleaseDownloadsUrl = new URL(
  `${expectedReleaseSlug}/`,
  publicDownloadsUrl,
);
const expectedReleaseManifestUrl = new URL(
  "manifest.json",
  expectedReleaseDownloadsUrl,
);
const expectedReleaseAssetBaseUrl = new URL(
  `${
    process.env.LATEXDO_RELEASE_ASSET_BASE_URL ??
    `https://github.com/${expectedRepository}/releases/download/${expectedReleaseSlug}`
  }/`.replace(/\/+$/, "/"),
);
const deployedLatestUpdateFeedUrl = new URL(
  "../updates/latest.json",
  deployedDownloadsUrl,
);
const deployedVersionUpdateFeedUrl = new URL(
  `../updates/${expectedReleaseSlug}.json`,
  deployedDownloadsUrl,
);
const deployedReleaseIndexUrl = new URL("releases.json", deployedDownloadsUrl);
const verifyRunId =
  process.env.GITHUB_RUN_ID ?? process.env.LATEXDO_VERIFY_RUN_ID ?? Date.now();

const requiredIds = new Set(["macos-arm64", "macos-x64", "windows-x64", "linux-x64"]);
const sha256Pattern = /^[a-f0-9]{64}$/;
const updateSignaturePattern = /^[A-Za-z0-9+/]{86}==$/;
const updateClockSkewMs = 10 * 60 * 1_000;

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Update feed contains a non-finite number.");
    }
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
  throw new Error("Update feed contains an unsupported value.");
}

function normalizeReleaseSlug(value) {
  const slug = String(value).trim();
  if (!slug || slug.includes("/") || slug.includes("\\") || slug.includes("..")) {
    throw new Error(`Invalid release slug: ${value}`);
  }
  return slug;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchOk(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "cache-control": "no-cache",
      "user-agent": `latexdo-deploy-verifier/${expectedVersion}`,
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response;
}

function cacheBustedUrl(url, attempt) {
  const value = new URL(url.href);
  const tokenParts = [expectedCommit || expectedVersion, verifyRunId, attempt].filter(
    Boolean,
  );
  value.searchParams.set("deploy_verify", tokenParts.join("-"));
  return value;
}

function assertManifest(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Manifest is not an object.");
  }
  if (value.schemaVersion !== 1) {
    throw new Error("Manifest schemaVersion must be 1.");
  }
  if (value.product !== "LatexDo") {
    throw new Error("Manifest product must be LatexDo.");
  }
  if (value.version !== expectedVersion) {
    throw new Error(
      `Manifest version ${value.version ?? "<missing>"} does not match ${expectedVersion}.`,
    );
  }
  if (!/^[a-f0-9]{40}$/.test(value.commit ?? "")) {
    throw new Error("Update feed commit must be a full Git SHA.");
  }
  if (value.repository !== expectedRepository) {
    throw new Error("Update feed repository does not match the expected repository.");
  }
  if (expectedCommit && value.commit !== expectedCommit) {
    throw new Error(
      `Manifest commit ${value.commit ?? "<missing>"} does not match ${expectedCommit}.`,
    );
  }
  if (!Array.isArray(value.files)) {
    throw new Error("Manifest files must be an array.");
  }
  if (value.downloadsPage !== expectedReleaseDownloadsUrl.href) {
    throw new Error(
      `Manifest downloadsPage must point to ${expectedReleaseDownloadsUrl.href}.`,
    );
  }

  const files = value.files;
  const ids = new Set(files.map((file) => file.id));
  for (const id of requiredIds) {
    if (!ids.has(id)) {
      throw new Error(`Manifest is missing ${id}.`);
    }
  }

  for (const file of files) {
    if (
      typeof file.url !== "string" ||
      !file.url.startsWith(expectedReleaseAssetBaseUrl.href)
    ) {
      throw new Error(`Invalid URL for ${file.id}.`);
    }
    if (typeof file.size !== "number" || file.size <= 0) {
      throw new Error(`Invalid size for ${file.id}.`);
    }
    if (typeof file.sha256 !== "string" || !sha256Pattern.test(file.sha256)) {
      throw new Error(`Invalid SHA-256 for ${file.id}.`);
    }
  }

  return files;
}

function assertUpdateFeed(value, manifestFiles) {
  if (!value || typeof value !== "object") {
    throw new Error("Update feed is not an object.");
  }
  if (value.schemaVersion !== 2) {
    throw new Error("Update feed schemaVersion must be 2.");
  }
  if (value.product !== "LatexDo") {
    throw new Error("Update feed product must be LatexDo.");
  }
  if (value.channel !== "stable") {
    throw new Error("Update feed channel must be stable.");
  }
  if (value.release !== expectedReleaseSlug) {
    throw new Error("Update feed release does not match the expected version.");
  }
  if (value.version !== expectedVersion) {
    throw new Error(
      `Update feed version ${value.version ?? "<missing>"} does not match ${expectedVersion}.`,
    );
  }
  const publishedAt = Date.parse(value.publishedAt);
  const expiresAt = Date.parse(value.expiresAt);
  const now = Date.now();
  if (
    typeof value.publishedAt !== "string" ||
    typeof value.expiresAt !== "string" ||
    !Number.isFinite(publishedAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= publishedAt ||
    publishedAt > now + updateClockSkewMs ||
    expiresAt <= now
  ) {
    throw new Error("Update feed freshness window is invalid or expired.");
  }
  if (expectedCommit && value.commit !== expectedCommit) {
    throw new Error(
      `Update feed commit ${value.commit ?? "<missing>"} does not match ${expectedCommit}.`,
    );
  }
  if (value.releaseUrl !== expectedReleaseDownloadsUrl.href) {
    throw new Error("Update feed releaseUrl does not match the release URL.");
  }
  if (value.downloadsPage !== expectedReleaseDownloadsUrl.href) {
    throw new Error("Update feed downloadsPage does not match the release URL.");
  }
  if (value.manifestUrl !== expectedReleaseManifestUrl.href) {
    throw new Error("Update feed manifestUrl does not match the release manifest.");
  }
  if (!Array.isArray(value.files)) {
    throw new Error("Update feed files must be an array.");
  }

  const signature = value.signature;
  if (
    !signature ||
    typeof signature !== "object" ||
    signature.algorithm !== "ed25519" ||
    signature.keyId !== expectedUpdateKeyId ||
    typeof signature.value !== "string" ||
    !updateSignaturePattern.test(signature.value)
  ) {
    throw new Error("Update feed signature metadata is invalid.");
  }
  const unsignedFeed = { ...value };
  delete unsignedFeed.signature;
  if (
    !verify(
      null,
      Buffer.from(canonicalJson(unsignedFeed)),
      updatePublicKey,
      Buffer.from(signature.value, "base64"),
    )
  ) {
    throw new Error("Update feed signature verification failed.");
  }

  for (const file of manifestFiles) {
    const updateFile = value.files.find((entry) => entry?.id === file.id);
    if (!updateFile) {
      throw new Error(`Update feed is missing ${file.id}.`);
    }
    for (const field of ["filename", "url", "size", "sha256"]) {
      if (updateFile[field] !== file[field]) {
        throw new Error(`Update feed ${file.id} ${field} does not match the manifest.`);
      }
    }
  }
}

function assertReleaseIndex(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Release index is not an object.");
  }
  if (value.schemaVersion !== 1) {
    throw new Error("Release index schemaVersion must be 1.");
  }
  if (value.product !== "LatexDo") {
    throw new Error("Release index product must be LatexDo.");
  }
  if (!Array.isArray(value.releases)) {
    throw new Error("Release index releases must be an array.");
  }

  const release = value.releases.find((item) => item?.tag === expectedReleaseSlug);
  if (!release) {
    throw new Error(`Release index is missing ${expectedReleaseSlug}.`);
  }
  if (release.downloadsPage !== expectedReleaseDownloadsUrl.href) {
    throw new Error("Release index downloadsPage does not match the release URL.");
  }
  if (release.manifestUrl !== expectedReleaseManifestUrl.href) {
    throw new Error("Release index manifestUrl does not match the release manifest.");
  }
}

async function verifyOnce(attempt) {
  await fetchOk(cacheBustedUrl(deployedDownloadsIndexUrl, attempt));

  const manifestUrl = new URL("manifest.json", deployedDownloadsUrl);
  const manifestResponse = await fetchOk(cacheBustedUrl(manifestUrl, attempt));
  const files = assertManifest(await manifestResponse.json());

  await fetchOk(cacheBustedUrl(deployedReleaseDownloadsIndexUrl, attempt));
  const releaseManifestResponse = await fetchOk(
    cacheBustedUrl(deployedReleaseManifestUrl, attempt),
  );
  assertManifest(await releaseManifestResponse.json());

  const latestUpdateFeedResponse = await fetchOk(
    cacheBustedUrl(deployedLatestUpdateFeedUrl, attempt),
  );
  assertUpdateFeed(await latestUpdateFeedResponse.json(), files);

  const versionUpdateFeedResponse = await fetchOk(
    cacheBustedUrl(deployedVersionUpdateFeedUrl, attempt),
  );
  assertUpdateFeed(await versionUpdateFeedResponse.json(), files);

  const releaseIndexResponse = await fetchOk(
    cacheBustedUrl(deployedReleaseIndexUrl, attempt),
  );
  assertReleaseIndex(await releaseIndexResponse.json());

  const checksumsUrl = new URL("SHA256SUMS.txt", deployedDownloadsUrl);
  const checksums = await (await fetchOk(cacheBustedUrl(checksumsUrl, attempt))).text();
  for (const file of files) {
    const checksumPath = file.filename;
    if (!checksums.includes(file.sha256) || !checksums.includes(checksumPath)) {
      throw new Error(`Latest checksums file does not include ${checksumPath}.`);
    }
  }

  const releaseChecksumsUrl = new URL("SHA256SUMS.txt", deployedReleaseDownloadsUrl);
  const releaseChecksums = await (
    await fetchOk(cacheBustedUrl(releaseChecksumsUrl, attempt))
  ).text();
  for (const file of files) {
    const checksumPath = file.filename;
    if (
      !releaseChecksums.includes(file.sha256) ||
      !releaseChecksums.includes(checksumPath)
    ) {
      throw new Error(`Release checksums file does not include ${checksumPath}.`);
    }
  }

  await Promise.all(
    files.map(async (file) => {
      const response = await fetchOk(file.url, { method: "HEAD" });
      const length = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(length) && length > 0 && length !== file.size) {
        throw new Error(
          `${file.filename} content-length ${length} does not match manifest size ${file.size}.`,
        );
      }
    }),
  );
}

let lastError = null;
let verified = false;
for (let attempt = 1; attempt <= retries; attempt += 1) {
  try {
    await verifyOnce(attempt);
    console.log(`Verified deployed downloads at ${deployedDownloadsUrl.href}`);
    verified = true;
    break;
  } catch (error) {
    lastError = error;
    console.log(
      `Deployment verification attempt ${attempt}/${retries} failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    if (attempt < retries) {
      await sleep(delayMs);
    }
  }
}

if (!verified) throw lastError ?? new Error("Deployment verification failed.");
