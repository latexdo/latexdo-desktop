import type { UpdateCheckResult } from "./types";

export interface DownloadManifestFile {
  id: string;
  label: string;
  platform: string;
  arch: string;
  filename: string;
  url: string;
  sha256: string;
  size: number;
}

export interface DownloadManifest {
  schemaVersion: 1;
  product: "LatexDo";
  version: string | null;
  publishedAt: string | null;
  commit: string | null;
  repository: string;
  downloadsPage: string;
  files: DownloadManifestFile[];
}

const sha256Pattern = /^[a-f0-9]{64}$/;
const requiredDownloadIds = [
  "macos-arm64",
  "macos-x64",
  "windows-x64",
  "linux-x64",
] as const;

function splitVersionString(value: string): { core: string[]; prerelease: string[] } {
  const normalized = value.trim().replace(/^v/i, "");
  const hyphenIndex = normalized.indexOf("-");
  const corePart = hyphenIndex === -1 ? normalized : normalized.slice(0, hyphenIndex);
  const prereleasePart = hyphenIndex === -1 ? "" : normalized.slice(hyphenIndex + 1);
  return {
    core: corePart.split(".").filter(Boolean),
    prerelease: prereleasePart.split(/[.-]/).filter(Boolean),
  };
}

function compareVersionIdentifiers(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const bothNumeric = Number.isFinite(leftNumber) && Number.isFinite(rightNumber);

  if (bothNumeric) {
    return leftNumber === rightNumber ? 0 : leftNumber > rightNumber ? 1 : -1;
  }

  const comparison = left.localeCompare(right);
  return comparison === 0 ? 0 : comparison > 0 ? 1 : -1;
}

export function compareVersionStrings(left: string, right: string): number {
  const leftVersion = splitVersionString(left);
  const rightVersion = splitVersionString(right);
  const coreLength = Math.max(leftVersion.core.length, rightVersion.core.length);

  for (let index = 0; index < coreLength; index += 1) {
    const comparison = compareVersionIdentifiers(
      leftVersion.core[index] ?? "0",
      rightVersion.core[index] ?? "0",
    );
    if (comparison !== 0) {
      return comparison;
    }
  }

  // A release outranks any pre-release of the same version (semver rule).
  if (!leftVersion.prerelease.length || !rightVersion.prerelease.length) {
    return (
      Number(Boolean(rightVersion.prerelease.length)) -
      Number(Boolean(leftVersion.prerelease.length))
    );
  }

  const prereleaseLength = Math.max(
    leftVersion.prerelease.length,
    rightVersion.prerelease.length,
  );
  for (let index = 0; index < prereleaseLength; index += 1) {
    const leftPart = leftVersion.prerelease[index];
    const rightPart = rightVersion.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const comparison = compareVersionIdentifiers(leftPart, rightPart);
    if (comparison !== 0) {
      return comparison;
    }
  }

  return 0;
}

export function validateDownloadManifest(value: unknown): DownloadManifest | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const manifest = value as Partial<DownloadManifest>;
  if (
    manifest.schemaVersion !== 1 ||
    manifest.product !== "LatexDo" ||
    (manifest.version !== null && typeof manifest.version !== "string") ||
    typeof manifest.repository !== "string" ||
    typeof manifest.downloadsPage !== "string" ||
    !Array.isArray(manifest.files)
  ) {
    return null;
  }

  const files = manifest.files.filter(isValidManifestFile);
  const ids = new Set(files.map((file) => file.id));
  if (!requiredDownloadIds.every((id) => ids.has(id))) {
    return null;
  }

  return {
    schemaVersion: 1,
    product: "LatexDo",
    version: manifest.version ?? null,
    publishedAt: typeof manifest.publishedAt === "string" ? manifest.publishedAt : null,
    commit: typeof manifest.commit === "string" ? manifest.commit : null,
    repository: manifest.repository,
    downloadsPage: manifest.downloadsPage,
    files,
  };
}

export function updateCheckFromDownloadManifest(
  manifest: DownloadManifest | null,
  currentVersion: string,
  fallbackUrl: string,
): UpdateCheckResult {
  const latestVersion = manifest?.version?.replace(/^v/i, "") ?? null;
  if (!manifest || !latestVersion) {
    return {
      currentVersion,
      latestVersion: null,
      releaseUrl: fallbackUrl,
      updateAvailable: false,
      error: "No website download manifest version found.",
    };
  }

  return {
    currentVersion,
    latestVersion,
    releaseUrl: manifest.downloadsPage || fallbackUrl,
    updateAvailable: compareVersionStrings(latestVersion, currentVersion) > 0,
  };
}

function isValidManifestFile(value: unknown): value is DownloadManifestFile {
  if (!value || typeof value !== "object") {
    return false;
  }

  const file = value as Partial<DownloadManifestFile>;
  return (
    typeof file.id === "string" &&
    typeof file.label === "string" &&
    typeof file.platform === "string" &&
    typeof file.arch === "string" &&
    typeof file.filename === "string" &&
    typeof file.url === "string" &&
    typeof file.sha256 === "string" &&
    sha256Pattern.test(file.sha256) &&
    typeof file.size === "number" &&
    Number.isFinite(file.size) &&
    file.size > 0
  );
}
