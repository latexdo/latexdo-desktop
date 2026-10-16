export interface NormalizedLatexDoVersion {
  core: string[];
  prerelease: string[];
}

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeLatexDoVersion(version: string): NormalizedLatexDoVersion {
  const normalized = version.trim().replace(/^v/i, "");
  const hyphenIndex = normalized.indexOf("-");
  const corePart = hyphenIndex === -1 ? normalized : normalized.slice(0, hyphenIndex);
  const prereleasePart = hyphenIndex === -1 ? "" : normalized.slice(hyphenIndex + 1);
  return {
    core: corePart.split(".").filter(Boolean),
    prerelease: prereleasePart.split(/[.-]/).filter(Boolean),
  };
}

function compareVersionPart(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const bothNumeric = Number.isFinite(leftNumber) && Number.isFinite(rightNumber);

  if (bothNumeric) {
    return leftNumber === rightNumber ? 0 : leftNumber > rightNumber ? 1 : -1;
  }

  return left === right ? 0 : left > right ? 1 : -1;
}

export function compareLatexDoVersions(left: string, right: string): number {
  const leftVersion = normalizeLatexDoVersion(left);
  const rightVersion = normalizeLatexDoVersion(right);
  const coreLength = Math.max(leftVersion.core.length, rightVersion.core.length);

  for (let index = 0; index < coreLength; index += 1) {
    const comparison = compareVersionPart(
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
    const comparison = compareVersionPart(leftPart, rightPart);
    if (comparison !== 0) {
      return comparison;
    }
  }

  return 0;
}

export interface ReleaseIdentity {
  version: string;
  commit?: string | null;
  /** When the release was published (latest) or the app was built (installed). */
  timestamp?: string | null;
}

/**
 * Whether `latest` should replace `installed`. A higher version always wins.
 * Every commit on main is published under the same version, so for equal
 * versions a different commit published after this app was built is newer.
 */
export function isNewerRelease(
  latest: ReleaseIdentity,
  installed: ReleaseIdentity,
): boolean {
  const comparison = compareLatexDoVersions(latest.version, installed.version);
  if (comparison !== 0) return comparison > 0;
  if (!latest.commit || !installed.commit || latest.commit === installed.commit) {
    return false;
  }
  const publishedAt = Date.parse(latest.timestamp ?? "");
  const builtAt = Date.parse(installed.timestamp ?? "");
  return (
    Number.isFinite(publishedAt) && Number.isFinite(builtAt) && publishedAt > builtAt
  );
}

export function versionsEquivalent(left: string, right: string): boolean {
  return compareLatexDoVersions(left, right) === 0;
}

export function isBuildReleaseSlugForVersion(
  release: string,
  version: string,
): boolean {
  return new RegExp(
    `^v${escapeRegExpLiteral(version)}-build\\.\\d+\\.\\d+\\.[a-f0-9]{12}$`,
  ).test(release);
}

export function isReleaseSlugForVersion(release: string, version: string): boolean {
  return release === `v${version}` || isBuildReleaseSlugForVersion(release, version);
}
