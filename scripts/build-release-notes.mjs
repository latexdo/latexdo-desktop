import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const releaseNotesDir = path.resolve(root, process.argv[2] ?? "release-notes");
const outputDir = path.resolve(
  root,
  process.argv[3] ?? "public-downloads/updates/release-notes",
);
const publicKeyPath = path.resolve(process.argv[4] ?? "build/update-public-key.pem");
const baseUrlRoot = (
  process.env.LATEXDO_DOWNLOAD_BASE_URL ?? "https://latexdo.org"
).replace(/\/+$/, "");
const signingKey = (process.env.LATEXDO_UPDATE_SIGNING_KEY ?? "").trim();

if (!signingKey) {
  throw new Error(
    "LATEXDO_UPDATE_SIGNING_KEY is required to sign published release notes.",
  );
}

const releaseNotesSchemaVersion = 1;
const releaseNotesIndexSchemaVersion = 1;
const releaseNotesMaxHighlights = 30;
const releaseNotesMaxFixes = 100;
const releaseNotesMaxTitleLength = 500;
const releaseNotesMaxSummaryLength = 1_000;
const releaseNotesMaxHighlightTitleLength = 120;
const releaseNotesMaxHighlightDescriptionLength = 1_000;
const releaseNotesMaxFixLength = 500;
const releaseNotesMaxIndexReleases = 200;
const releaseVersionPattern = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const releaseNotesPath = "/updates/release-notes/";
const approvedHostnames = new Set(["latexdo.org", "www.latexdo.org"]);
const approvedLinkHostnames = new Set(["latexdo.org", "www.latexdo.org", "github.com"]);
const allowedHighlightCategories = new Set([
  "new",
  "ai",
  "editor",
  "compiler",
  "review",
  "updates",
  "performance",
  "security",
  "other",
]);

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

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value, maxLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isIsoishDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isApprovedPath(value, hostnames) {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      hostnames.has(parsed.hostname) &&
      parsed.pathname.startsWith(releaseNotesPath)
    );
  } catch {
    return false;
  }
}

function isApprovedLinkUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && approvedLinkHostnames.has(parsed.hostname);
  } catch {
    return false;
  }
}

function validateHighlight(value) {
  if (!isRecord(value)) return;
  if (
    !boundedString(value.id, 64) ||
    !/^[a-z0-9][a-z0-9-]*$/.test(value.id) ||
    !boundedString(value.title, releaseNotesMaxHighlightTitleLength) ||
    typeof value.description !== "string" ||
    value.description.length > releaseNotesMaxHighlightDescriptionLength ||
    !allowedHighlightCategories.has(value.category)
  ) {
    throw new Error(`Invalid release highlight ${JSON.stringify(value.id ?? null)}.`);
  }
}

function validateStringArray(value, maxCount, maxLength, label) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > maxCount) {
    throw new Error(`${label} must be an array of at most ${maxCount} strings.`);
  }
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0 || entry.length > maxLength) {
      throw new Error(`${label} contains an invalid string.`);
    }
  }
}

function validateSecurityNotes(value) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > releaseNotesMaxHighlights) {
    throw new Error("security must be an array of at most 30 notes.");
  }
  for (const note of value) {
    if (
      !isRecord(note) ||
      !boundedString(note.title, releaseNotesMaxHighlightTitleLength) ||
      typeof note.description !== "string" ||
      note.description.length > releaseNotesMaxHighlightDescriptionLength
    ) {
      throw new Error("security contains an invalid note.");
    }
    if (note.advisoryUrl !== undefined && !isApprovedLinkUrl(note.advisoryUrl)) {
      throw new Error("security contains a disallowed advisory URL.");
    }
  }
}

function validateReleaseNotesDocument(document, version) {
  if (!isRecord(document)) throw new Error("Release notes document must be an object.");
  if (document.schemaVersion !== releaseNotesSchemaVersion) {
    throw new Error("Release notes document has an invalid schemaVersion.");
  }
  if (document.product !== "LatexDo") {
    throw new Error("Release notes document has an invalid product.");
  }
  if (
    !releaseVersionPattern.test(document.version ?? "") ||
    document.version !== version
  ) {
    throw new Error("Release notes document version does not match its file.");
  }
  if (!boundedString(document.title, releaseNotesMaxTitleLength)) {
    throw new Error("Release notes document has an invalid title.");
  }
  if (
    document.summary !== undefined &&
    (typeof document.summary !== "string" ||
      document.summary.length > releaseNotesMaxSummaryLength)
  ) {
    throw new Error("Release notes document has an invalid summary.");
  }
  if (!isIsoishDate(document.publishedAt)) {
    throw new Error("Release notes document has an invalid publishedAt.");
  }
  if (!isApprovedLinkUrl(document.releaseUrl)) {
    throw new Error("Release notes document has a disallowed releaseUrl.");
  }
  if (
    !Array.isArray(document.highlights) ||
    document.highlights.length > releaseNotesMaxHighlights
  ) {
    throw new Error("Release notes document highlights are invalid.");
  }
  for (const highlight of document.highlights) validateHighlight(highlight);
  validateStringArray(
    document.fixes,
    releaseNotesMaxFixes,
    releaseNotesMaxFixLength,
    "fixes",
  );
  validateStringArray(
    document.breakingChanges,
    releaseNotesMaxFixes,
    releaseNotesMaxFixLength,
    "breakingChanges",
  );
  validateSecurityNotes(document.security);
}

function publicKeyId(publicKey) {
  return createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex")
    .slice(0, 16);
}

async function signatureFor(payload) {
  const privateKey = createPrivateKey(
    Buffer.from(signingKey, "base64").toString("utf8"),
  );
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("LATEXDO_UPDATE_SIGNING_KEY must contain an Ed25519 private key.");
  }
  const publicKey = createPublicKey(privateKey);
  const expectedPublicKey = createPublicKey(await readFile(publicKeyPath, "utf8"));
  const publicDer = publicKey.export({ type: "spki", format: "der" });
  const expectedDer = expectedPublicKey.export({ type: "spki", format: "der" });
  if (!Buffer.from(publicDer).equals(Buffer.from(expectedDer))) {
    throw new Error("Release notes signing key does not match the public key.");
  }
  const unsigned = { ...payload };
  delete unsigned.signature;
  return {
    algorithm: "ed25519",
    keyId: publicKeyId(publicKey),
    value: sign(
      null,
      Buffer.from(canonicalJson(unsigned), "utf8"),
      privateKey,
    ).toString("base64"),
  };
}

await mkdir(outputDir, { recursive: true });

const indexPath = path.join(releaseNotesDir, "index.json");
const indexPayload = JSON.parse(await readFile(indexPath, "utf8"));
if (!isRecord(indexPayload)) throw new Error("index.json must be an object.");
if (
  indexPayload.schemaVersion !== releaseNotesIndexSchemaVersion ||
  indexPayload.product !== "LatexDo" ||
  !Array.isArray(indexPayload.releases) ||
  indexPayload.releases.length === 0 ||
  indexPayload.releases.length > releaseNotesMaxIndexReleases
) {
  throw new Error("index.json schema is invalid.");
}

const publishedIndex = { ...indexPayload, releases: [] };

for (const entry of indexPayload.releases) {
  if (!isRecord(entry)) throw new Error("index.json contains a malformed entry.");
  if (
    !releaseVersionPattern.test(entry.version ?? "") ||
    !isIsoishDate(entry.publishedAt) ||
    !isApprovedPath(entry.releaseNotesUrl, approvedHostnames) ||
    !entry.releaseNotesUrl.endsWith(`/${entry.version.replace(/^v/i, "")}.json`)
  ) {
    throw new Error(`index.json has an invalid entry for ${String(entry.version)}.`);
  }
  const version = entry.version.replace(/^v/i, "");
  const sourcePath = path.join(releaseNotesDir, `${version}.json`);
  const raw = await readFile(sourcePath, "utf8");
  const document = JSON.parse(raw);
  validateReleaseNotesDocument(document, version);

  const signedDocument = { ...document, signature: await signatureFor(document) };
  const publishedPath = path.join(outputDir, `${version}.json`);
  await writeFile(publishedPath, `${JSON.stringify(signedDocument, null, 2)}\n`);

  publishedIndex.releases.push({
    ...entry,
    sha256: createHash("sha256").update(raw, "utf8").digest("hex"),
  });
}

const signedIndex = {
  ...publishedIndex,
  signature: await signatureFor(publishedIndex),
};
await writeFile(
  path.join(outputDir, "index.json"),
  `${JSON.stringify(signedIndex, null, 2)}\n`,
);

console.log(
  `Signed ${publishedIndex.releases.length} release note documents and the index into ${outputDir}.`,
);
