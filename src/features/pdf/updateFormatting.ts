import type { UpdateAttemptResolution, UpdateDownloadProgress } from "../../types";

// Every commit on main publishes a build, so look for one hourly.
export const updateCheckIntervalMs = 60 * 60 * 1000;
/** Minimum gap before returning to the window triggers another check. */
export const updateRecheckOnFocusMs = 15 * 60 * 1000;

export function formatUpdateDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatUpdateLocation(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return null;
  }
}

export function formatUpdateBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = Number.isInteger(value) || value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export function formatUpdateProgress(progress: UpdateDownloadProgress): string {
  const fallback = progress.message ?? "Preparing update";
  if (progress.status !== "downloading") {
    return fallback;
  }

  const parts: string[] = [];
  if (progress.percent !== null) {
    parts.push(`${Math.round(progress.percent)}%`);
  }
  if (progress.totalBytes !== null) {
    parts.push(
      `${formatUpdateBytes(progress.transferredBytes)} of ${formatUpdateBytes(
        progress.totalBytes,
      )}`,
    );
  } else if (progress.transferredBytes > 0) {
    parts.push(formatUpdateBytes(progress.transferredBytes));
  }

  return parts.length ? `${fallback} (${parts.join(", ")})` : fallback;
}

export function formatUpdateAttempt(status: UpdateAttemptResolution): string | null {
  switch (status.status) {
    case "confirmed":
      return `LatexDo was updated to ${
        status.expectedVersion ?? "the latest build"
      } from ${status.fromVersion ?? "the previous build"} and verified after restart.`;
    case "failed":
      return [
        `Update failed: the update to ${status.expectedVersion ?? "the latest build"} could not be verified.`,
        `LatexDo is still running ${status.currentVersion}.`,
        status.attempts ? `Attempt ${status.attempts} of 3.` : null,
        status.error ? `Reason: ${status.error}` : null,
      ]
        .filter(Boolean)
        .join(" ");
    case "installing":
      return `The update to ${
        status.expectedVersion ?? "the latest build"
      } is being installed and will be verified after restart.`;
    case "none":
    default:
      return null;
  }
}

/** Identifies an available update. Builds share a version, so the commit is part of it. */
export function updateIdentity(update: {
  latestVersion: string | null;
  latestCommit?: string | null;
}): string | null {
  if (!update.latestVersion) return null;
  return update.latestCommit
    ? `${update.latestVersion}+${update.latestCommit}`
    : update.latestVersion;
}

/** "0.3.0 (2f55cb3)" when the build's commit is known, otherwise the version. */
export function formatBuildLabel(version: string, commit?: string | null): string {
  return commit ? `${version} (${commit.slice(0, 7)})` : version;
}
