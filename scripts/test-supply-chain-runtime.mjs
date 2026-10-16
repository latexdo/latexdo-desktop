import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot sign a non-finite number.");
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
  throw new Error("Cannot sign an unsupported value.");
}

function immutableFeed(feed) {
  const value = { ...feed };
  delete value.publishedAt;
  delete value.expiresAt;
  delete value.signature;
  return value;
}

async function testFeedRenewal(temporaryRoot) {
  const fixtureRoot = path.join(temporaryRoot, "renewal");
  const updatesRoot = path.join(fixtureRoot, "updates");
  const downloadsRoot = path.join(fixtureRoot, "downloads");
  const release = "v1.2.3";
  const releaseRoot = path.join(downloadsRoot, release);
  await mkdir(updatesRoot, { recursive: true });
  await mkdir(releaseRoot, { recursive: true });

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
  const keyId = createHash("sha256").update(publicKeyDer).digest("hex").slice(0, 16);
  const publicKeyPath = path.join(fixtureRoot, "update-public-key.pem");
  await writeFile(publicKeyPath, publicKeyPem);

  const commit = "a".repeat(40);
  const sha256 = "b".repeat(64);
  const filename = "LatexDo-linux-x64.AppImage";
  const downloadsPage = `https://latexdo.org/downloads/${release}/`;
  const files = [
    {
      id: "linux-x64",
      label: "Linux",
      platform: "linux",
      arch: "x64",
      filename,
      note: "Fixture",
      size: 123,
      sizeLabel: "123 B",
      sha256,
      url: `https://github.com/latexdo/latexdo-desktop/releases/download/${release}/${filename}`,
    },
  ];
  const manifest = {
    schemaVersion: 1,
    product: "LatexDo",
    version: "1.2.3",
    publishedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1_000).toISOString(),
    commit,
    repository: "latexdo/latexdo-desktop",
    downloadsPage,
    files,
  };
  const unsignedFeed = {
    schemaVersion: 2,
    product: "LatexDo",
    channel: "stable",
    version: "1.2.3",
    publishedAt: manifest.publishedAt,
    expiresAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1_000).toISOString(),
    commit,
    repository: "latexdo/latexdo-desktop",
    release,
    releaseUrl: downloadsPage,
    downloadsPage,
    manifestUrl: `${downloadsPage}manifest.json`,
    files,
  };
  const originalFeed = {
    ...unsignedFeed,
    signature: {
      algorithm: "ed25519",
      keyId,
      value: sign(null, Buffer.from(canonicalJson(unsignedFeed)), privateKey).toString(
        "base64",
      ),
    },
  };
  const feedPath = path.join(updatesRoot, "latest.json");
  await writeFile(feedPath, `${JSON.stringify(originalFeed, null, 2)}\n`);
  await writeFile(
    path.join(releaseRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(path.join(releaseRoot, "SHA256SUMS.txt"), `${sha256}  ${filename}\n`);

  const renewalEnvironment = {
    ...process.env,
    LATEXDO_UPDATE_PUBLISHED_AT: new Date().toISOString(),
    LATEXDO_UPDATE_SIGNING_KEY: Buffer.from(privateKeyPem).toString("base64"),
  };
  await execFile(
    process.execPath,
    [
      path.join(root, "scripts/renew-update-feed.mjs"),
      feedPath,
      downloadsRoot,
      publicKeyPath,
    ],
    { cwd: root, env: renewalEnvironment },
  );

  const renewedFeed = JSON.parse(await readFile(feedPath, "utf8"));
  assert.deepEqual(immutableFeed(renewedFeed), immutableFeed(originalFeed));
  assert.equal(
    Date.parse(renewedFeed.expiresAt) - Date.parse(renewedFeed.publishedAt),
    30 * 24 * 60 * 60 * 1_000,
  );
  assert.ok(
    Date.parse(renewedFeed.expiresAt) - Date.now() >= 29 * 24 * 60 * 60 * 1_000,
  );
  const renewedUnsignedFeed = { ...renewedFeed };
  delete renewedUnsignedFeed.signature;
  assert.ok(
    verify(
      null,
      Buffer.from(canonicalJson(renewedUnsignedFeed)),
      createPublicKey(publicKeyPem),
      Buffer.from(renewedFeed.signature.value, "base64"),
    ),
  );
  await execFile(
    process.execPath,
    [path.join(root, "scripts/verify-update-feed.mjs"), feedPath, publicKeyPath],
    {
      cwd: root,
      env: { ...process.env, LATEXDO_UPDATE_MIN_VALIDITY_DAYS: "14" },
    },
  );

  const renewedBytes = await readFile(feedPath, "utf8");
  const mismatchedManifest = structuredClone(manifest);
  mismatchedManifest.files[0].sha256 = "c".repeat(64);
  await writeFile(
    path.join(releaseRoot, "manifest.json"),
    `${JSON.stringify(mismatchedManifest, null, 2)}\n`,
  );
  await assert.rejects(
    execFile(
      process.execPath,
      [
        path.join(root, "scripts/renew-update-feed.mjs"),
        feedPath,
        downloadsRoot,
        publicKeyPath,
      ],
      { cwd: root, env: renewalEnvironment },
    ),
  );
  assert.equal(await readFile(feedPath, "utf8"), renewedBytes);
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "latexdo-supply-chain-"));
try {
  await testFeedRenewal(temporaryRoot);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Verified signed feed renewal.");
