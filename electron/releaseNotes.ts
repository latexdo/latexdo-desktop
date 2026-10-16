import {
  createHash,
  createPublicKey,
  randomUUID,
  verify as verifySignature,
} from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { compareLatexDoVersions, versionsEquivalent } from "./versions.js";

export const releaseNotesSchemaVersion = 1;
export const releaseNotesIndexSchemaVersion = 1;
export const releaseNotesMaxBytes = 256 * 1024;
export const releaseNotesMaxHighlights = 30;
export const releaseNotesMaxFixes = 100;
export const releaseNotesMaxTitleLength = 500;
export const releaseNotesMaxSummaryLength = 1_000;
export const releaseNotesMaxHighlightTitleLength = 120;
export const releaseNotesMaxHighlightDescriptionLength = 1_000;
export const releaseNotesMaxFixLength = 500;
export const releaseNotesMaxIndexReleases = 200;
export const releaseNotesFetchTimeoutMs = 10_000;
export const releaseNotesDefaultOrigin = "https://latexdo.org";
export const releaseNotesPathPrefix = "/updates/release-notes/";
const maxReleaseNotesStringLength = 2048;

export type ReleaseNotesHighlightCategory =
  | "new"
  | "ai"
  | "editor"
  | "compiler"
  | "review"
  | "updates"
  | "performance"
  | "security"
  | "other";

export interface ReleaseNotesHighlight {
  id: string;
  category: ReleaseNotesHighlightCategory;
  title: string;
  description: string;
}

export interface ReleaseNotesSecurityNote {
  title: string;
  description: string;
  advisoryUrl?: string;
}

export interface ReleaseNotesSignature {
  algorithm: "ed25519";
  keyId: string;
  value: string;
}

export interface ReleaseNotesDocument {
  schemaVersion: 1;
  product: "LatexDo";
  version: string;
  title: string;
  summary?: string;
  publishedAt: string;
  releaseUrl: string;
  highlights: ReleaseNotesHighlight[];
  fixes?: string[];
  breakingChanges?: string[];
  security?: ReleaseNotesSecurityNote[];
  signature?: ReleaseNotesSignature;
}

export interface ReleaseNotesIndexEntry {
  version: string;
  publishedAt: string;
  releaseNotesUrl: string;
  sha256: string | null;
}

export interface ReleaseNotesIndex {
  schemaVersion: 1;
  product: "LatexDo";
  releases: ReleaseNotesIndexEntry[];
  signature?: ReleaseNotesSignature;
}

const releaseVersionPattern = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function isReleaseNotesVersion(value: unknown): value is string {
  return typeof value === "string" && releaseVersionPattern.test(value);
}

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isIsoishDate(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

const approvedReleaseNotesHostnames = new Set(["latexdo.org", "www.latexdo.org"]);
const approvedReleaseNotesLinkHostnames = new Set([
  "latexdo.org",
  "www.latexdo.org",
  "github.com",
]);

export function isApprovedReleaseNotesOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === "https:" && approvedReleaseNotesHostnames.has(parsed.hostname)
    );
  } catch {
    return false;
  }
}

export function releaseNotesUrlForVersion(baseUrl: string, version: string): string {
  const normalized = version.replace(/^v/i, "");
  return `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(normalized)}.json`;
}

export function isApprovedReleaseNotesFetchUrl(value: string): boolean {
  if (value.length > maxReleaseNotesStringLength) return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      approvedReleaseNotesHostnames.has(parsed.hostname) &&
      parsed.pathname.startsWith(releaseNotesPathPrefix)
    );
  } catch {
    return false;
  }
}

export function isApprovedReleaseNotesDocumentUrl(value: string): boolean {
  if (value.length > maxReleaseNotesStringLength) return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      approvedReleaseNotesLinkHostnames.has(parsed.hostname)
    );
  } catch {
    return false;
  }
}

const allowedHighlightCategories = new Set<ReleaseNotesHighlightCategory>([
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

function releaseNotesSignatureFromPayload(
  value: unknown,
): ReleaseNotesSignature | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.algorithm !== "ed25519") return null;
  if (typeof record.keyId !== "string" || !/^[a-f0-9]{16}$/.test(record.keyId)) {
    return null;
  }
  if (typeof record.value !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(record.value)) {
    return null;
  }
  return { algorithm: "ed25519", keyId: record.keyId, value: record.value };
}

function releaseHighlightFromPayload(value: unknown): ReleaseNotesHighlight | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    record.id.length === 0 ||
    record.id.length > 64 ||
    !/^[a-z0-9][a-z0-9-]*$/.test(record.id)
  ) {
    return null;
  }
  const category = record.category;
  if (
    typeof category !== "string" ||
    !allowedHighlightCategories.has(category as ReleaseNotesHighlightCategory)
  ) {
    return null;
  }
  if (!boundedString(record.title, releaseNotesMaxHighlightTitleLength)) return null;
  if (
    typeof record.description !== "string" ||
    record.description.length > releaseNotesMaxHighlightDescriptionLength
  ) {
    return null;
  }
  return {
    id: record.id,
    category: category as ReleaseNotesHighlightCategory,
    title: record.title,
    description: record.description,
  };
}

function stringArrayFromPayload(
  value: unknown,
  maxCount: number,
  maxLength: number,
): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxCount) return null;
  const entries: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0 || entry.length > maxLength) {
      return null;
    }
    entries.push(entry);
  }
  return entries;
}

function securityNotesFromPayload(value: unknown): ReleaseNotesSecurityNote[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > releaseNotesMaxHighlights) return null;
  const notes: ReleaseNotesSecurityNote[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const record = entry as Record<string, unknown>;
    if (!boundedString(record.title, releaseNotesMaxHighlightTitleLength)) return null;
    if (
      typeof record.description !== "string" ||
      record.description.length > releaseNotesMaxHighlightDescriptionLength
    ) {
      return null;
    }
    if (record.advisoryUrl === undefined) {
      notes.push({ title: record.title, description: record.description });
      continue;
    }
    if (
      typeof record.advisoryUrl !== "string" ||
      !isApprovedReleaseNotesDocumentUrl(record.advisoryUrl)
    ) {
      return null;
    }
    notes.push({
      title: record.title,
      description: record.description,
      advisoryUrl: record.advisoryUrl,
    });
  }
  return notes;
}

export function parseReleaseNotesDocument(value: unknown): ReleaseNotesDocument | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== releaseNotesSchemaVersion) return null;
  if (record.product !== "LatexDo") return null;
  if (!isReleaseNotesVersion(record.version)) return null;
  if (!boundedString(record.title, releaseNotesMaxTitleLength)) return null;
  if (record.summary !== undefined) {
    if (
      typeof record.summary !== "string" ||
      record.summary.length > releaseNotesMaxSummaryLength
    ) {
      return null;
    }
  }
  if (!isIsoishDate(record.publishedAt)) return null;
  if (
    typeof record.releaseUrl !== "string" ||
    !isApprovedReleaseNotesDocumentUrl(record.releaseUrl)
  ) {
    return null;
  }
  if (!Array.isArray(record.highlights)) return null;
  if (record.highlights.length > releaseNotesMaxHighlights) return null;
  const highlights: ReleaseNotesHighlight[] = [];
  for (const entry of record.highlights) {
    const highlight = releaseHighlightFromPayload(entry);
    if (!highlight) return null;
    highlights.push(highlight);
  }

  const fixes = stringArrayFromPayload(
    record.fixes,
    releaseNotesMaxFixes,
    releaseNotesMaxFixLength,
  );
  if (fixes === null) return null;
  const breakingChanges = stringArrayFromPayload(
    record.breakingChanges,
    releaseNotesMaxFixes,
    releaseNotesMaxFixLength,
  );
  if (breakingChanges === null) return null;
  const security = securityNotesFromPayload(record.security);
  if (security === null) return null;

  const signature = releaseNotesSignatureFromPayload(record.signature);
  const publishedAt = record.publishedAt as string;
  const releaseUrl = record.releaseUrl;

  return {
    schemaVersion: releaseNotesSchemaVersion,
    product: "LatexDo",
    version: record.version,
    title: record.title,
    summary: record.summary,
    publishedAt,
    releaseUrl,
    highlights,
    fixes,
    breakingChanges,
    security,
    signature: signature ?? undefined,
  };
}

function indexEntryFromPayload(value: unknown): ReleaseNotesIndexEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!isReleaseNotesVersion(record.version)) return null;
  if (!isIsoishDate(record.publishedAt)) return null;
  if (
    typeof record.releaseNotesUrl !== "string" ||
    !isApprovedReleaseNotesFetchUrl(record.releaseNotesUrl)
  ) {
    return null;
  }
  let sha256: string | null = null;
  if (record.sha256 !== undefined && record.sha256 !== null) {
    if (typeof record.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(record.sha256)) {
      return null;
    }
    sha256 = record.sha256.toLowerCase();
  }
  return {
    version: record.version,
    publishedAt: record.publishedAt as string,
    releaseNotesUrl: record.releaseNotesUrl,
    sha256,
  };
}

export function parseReleaseNotesIndex(value: unknown): ReleaseNotesIndex | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== releaseNotesIndexSchemaVersion) return null;
  if (record.product !== "LatexDo") return null;
  if (
    !Array.isArray(record.releases) ||
    record.releases.length === 0 ||
    record.releases.length > releaseNotesMaxIndexReleases
  ) {
    return null;
  }
  const releases: ReleaseNotesIndexEntry[] = [];
  for (const entry of record.releases) {
    const parsed = indexEntryFromPayload(entry);
    if (!parsed) return null;
    releases.push(parsed);
  }
  const signature = releaseNotesSignatureFromPayload(record.signature);
  return {
    schemaVersion: releaseNotesIndexSchemaVersion,
    product: "LatexDo",
    releases,
    signature: signature ?? undefined,
  };
}

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Release notes contain a non-finite number.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new Error("Release notes contain an unsupported value.");
}

export async function sha256HexOfText(text: string): Promise<string> {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export async function verifyReleaseNotesSignature(
  payload: unknown,
  publicKeyPemPath: string,
): Promise<boolean> {
  const signature =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? releaseNotesSignatureFromPayload((payload as Record<string, unknown>).signature)
      : null;
  if (!signature) return false;
  try {
    const publicKey = createPublicKey(await readFile(publicKeyPemPath, "utf8"));
    if (publicKey.asymmetricKeyType !== "ed25519") return false;
    const keyId = createHash("sha256")
      .update(publicKey.export({ type: "spki", format: "der" }))
      .digest("hex")
      .slice(0, 16);
    if (keyId !== signature.keyId) return false;
    const unsigned = { ...(payload as Record<string, unknown>) };
    delete unsigned.signature;
    return verifySignature(
      null,
      Buffer.from(canonicalJson(unsigned), "utf8"),
      publicKey,
      Buffer.from(signature.value, "base64"),
    );
  } catch {
    return false;
  }
}

export async function trustedReleaseNotesFromText(
  raw: string,
  input: {
    publicKeyPemPath: string;
    pinnedSha256: string | null;
    expectedVersion: string;
  },
): Promise<ReleaseNotesDocument | null> {
  if (raw.length === 0 || raw.length > releaseNotesMaxBytes) return null;
  if (input.pinnedSha256) {
    const digest = await sha256HexOfText(raw);
    if (digest.toLowerCase() !== input.pinnedSha256.toLowerCase()) return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const document = parseReleaseNotesDocument(parsed);
  if (!document) return null;
  if (!versionsEquivalent(document.version, input.expectedVersion)) return null;
  if (!input.pinnedSha256) {
    const signed = await verifyReleaseNotesSignature(parsed, input.publicKeyPemPath);
    if (!signed) return null;
  }
  return document;
}

function releaseNotesCacheDirectory(dataDirectory: string): string {
  return path.join(dataDirectory, "releases");
}

function releaseNotesCacheFilePath(dataDirectory: string, version: string): string {
  const safeName = version.replace(/[^0-9A-Za-z.-]/g, "_");
  return path.join(releaseNotesCacheDirectory(dataDirectory), `${safeName}.json`);
}

async function writeReleaseNotesCache(
  dataDirectory: string,
  version: string,
  raw: string,
): Promise<void> {
  const target = releaseNotesCacheFilePath(dataDirectory, version);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, raw, "utf8");
  try {
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export type TextFetcher = (url: string) => Promise<string>;

export const defaultReleaseNotesFetcher: TextFetcher = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), releaseNotesFetchTimeoutMs);
  try {
    const response = await globalThis.fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(
        `Release notes request failed with HTTP ${response.status} for ${url}.`,
      );
    }
    const text = await response.text();
    if (text.length > releaseNotesMaxBytes) {
      throw new Error("Release notes response exceeds the size limit.");
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
};

export async function loadReleaseNotesCache(
  options: ReleaseNotesResolverOptions,
  version: string,
  pinnedSha256: string | null,
): Promise<ReleaseNotesDocument | null> {
  try {
    const cached = await readFile(
      releaseNotesCacheFilePath(options.dataDirectory, version),
      "utf8",
    );
    return trustedReleaseNotesFromText(cached, {
      publicKeyPemPath: options.publicKeyPemPath,
      pinnedSha256,
      expectedVersion: version,
    });
  } catch {
    return null;
  }
}

export interface ReleaseNotesResolverOptions {
  dataDirectory: string;
  publicKeyPemPath: string;
  baseUrl: string;
  fetch?: TextFetcher;
}

export async function resolveReleaseNotes(
  options: ReleaseNotesResolverOptions,
  version: string,
  index: ReleaseNotesIndex | null,
): Promise<ReleaseNotesDocument | null> {
  const fetchText = options.fetch ?? defaultReleaseNotesFetcher;
  const reference =
    index?.releases.find((entry) => versionsEquivalent(entry.version, version)) ?? null;
  const pinnedSha256 = reference?.sha256 ?? null;

  const cached = await loadReleaseNotesCache(options, version, pinnedSha256);
  if (cached) return cached;

  const fallbackUrl = releaseNotesUrlForVersion(options.baseUrl, version);
  const fetchUrl =
    reference && isApprovedReleaseNotesFetchUrl(reference.releaseNotesUrl)
      ? reference.releaseNotesUrl
      : isApprovedReleaseNotesFetchUrl(fallbackUrl)
        ? fallbackUrl
        : null;
  if (!fetchUrl) return null;

  try {
    const raw = await fetchText(fetchUrl);
    const trusted = await trustedReleaseNotesFromText(raw, {
      publicKeyPemPath: options.publicKeyPemPath,
      pinnedSha256,
      expectedVersion: version,
    });
    if (!trusted) return null;
    await writeReleaseNotesCache(options.dataDirectory, version, raw);
    return trusted;
  } catch {
    return null;
  }
}

export async function fetchReleaseNotesIndex(
  options: ReleaseNotesResolverOptions,
): Promise<ReleaseNotesIndex | null> {
  const fetchText = options.fetch ?? defaultReleaseNotesFetcher;
  const cachePath = releaseNotesCacheFilePath(options.dataDirectory, "index");
  try {
    const cached = await readFile(cachePath, "utf8");
    if (cached.length <= releaseNotesMaxBytes) {
      const parsedCached: unknown = JSON.parse(cached);
      if (
        parseReleaseNotesIndex(parsedCached) &&
        (await verifyReleaseNotesSignature(parsedCached, options.publicKeyPemPath))
      ) {
        return parseReleaseNotesIndex(parsedCached);
      }
    }
  } catch {
    // fall through to fetch
  }

  const indexUrl = isApprovedReleaseNotesFetchUrl(
    releaseNotesUrlForVersion(options.baseUrl, "index"),
  )
    ? releaseNotesUrlForVersion(options.baseUrl, "index")
    : null;
  if (!indexUrl) return null;

  try {
    const raw = await fetchText(indexUrl);
    if (raw.length === 0 || raw.length > releaseNotesMaxBytes) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parseReleaseNotesIndex(parsed)) return null;
    if (!(await verifyReleaseNotesSignature(parsed, options.publicKeyPemPath))) {
      return null;
    }
    await writeReleaseNotesCache(options.dataDirectory, "index", raw);
    return parseReleaseNotesIndex(parsed);
  } catch {
    return null;
  }
}

export function releasesInRange(
  releases: readonly ReleaseNotesIndexEntry[],
  fromVersion: string,
  toVersion: string,
): ReleaseNotesIndexEntry[] {
  return releases
    .filter(
      (entry) =>
        compareLatexDoVersions(entry.version, fromVersion) > 0 &&
        compareLatexDoVersions(entry.version, toVersion) <= 0,
    )
    .sort((left, right) => compareLatexDoVersions(right.version, left.version));
}

export async function resolveReleaseNotesRange(
  options: ReleaseNotesResolverOptions,
  fromVersion: string,
  toVersion: string,
): Promise<{ documents: ReleaseNotesDocument[]; available: boolean }> {
  const index = await fetchReleaseNotesIndex(options);
  let versions: string[] = [];
  if (index && index.releases.length > 0) {
    versions = releasesInRange(index.releases, fromVersion, toVersion).map(
      (entry) => entry.version,
    );
  }
  if (!versions.some((version) => versionsEquivalent(version, toVersion))) {
    versions = [...versions, toVersion];
  }

  const documents: ReleaseNotesDocument[] = [];
  for (const version of versions) {
    const document = await resolveReleaseNotes(options, version, index);
    if (document) documents.push(document);
  }
  const target = documents.find((document) =>
    versionsEquivalent(document.version, toVersion),
  );
  return { documents, available: Boolean(target) };
}
