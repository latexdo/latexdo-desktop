import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { UpdateAttemptResolution } from "./types.js";
import { versionsEquivalent } from "./versions.js";

export const pendingUpdateSchemaVersion = 1;
export const maxPendingUpdateAttempts = 3;

export type PendingUpdateState =
  | "installing"
  | "restart-required"
  | "confirmed"
  | "failed";

export interface PendingUpdateRecord {
  schemaVersion: 1;
  fromVersion: string;
  expectedVersion: string;
  /** Commit of the build being installed; builds can share a version. */
  expectedCommit?: string | null;
  installerSha256: string | null;
  startedAt: string;
  state: PendingUpdateState;
  attempts: number;
  lastFailure?: string | null;
  lastAttemptAt?: string | null;
  completedAt?: string | null;
  installedPath?: string;
  failurePath?: string;
}

export interface BeginPendingUpdateInput {
  fromVersion: string;
  expectedVersion: string;
  expectedCommit?: string | null;
  installerSha256: string;
  installedPath?: string;
}

function sameTarget(
  record: PendingUpdateRecord,
  expectedVersion: string,
  expectedCommit: string | null | undefined,
): boolean {
  return (
    record.expectedVersion === expectedVersion &&
    (record.expectedCommit ?? null) === (expectedCommit ?? null)
  );
}

function pendingUpdateFilePath(dataDirectory: string): string {
  return path.join(dataDirectory, "pending-update.json");
}

async function writeJsonAtomically(target: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function isValidRecord(value: unknown): value is PendingUpdateRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<PendingUpdateRecord>;
  return (
    record.schemaVersion === pendingUpdateSchemaVersion &&
    typeof record.fromVersion === "string" &&
    typeof record.expectedVersion === "string" &&
    typeof record.startedAt === "string" &&
    typeof record.attempts === "number" &&
    (record.state === "installing" ||
      record.state === "restart-required" ||
      record.state === "confirmed" ||
      record.state === "failed")
  );
}

export async function loadPendingUpdate(
  dataDirectory: string,
): Promise<PendingUpdateRecord | null> {
  try {
    const content = await readFile(pendingUpdateFilePath(dataDirectory), "utf8");
    const parsed: unknown = JSON.parse(content);
    return isValidRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function beginPendingUpdate(
  dataDirectory: string,
  input: BeginPendingUpdateInput,
): Promise<PendingUpdateRecord> {
  const previous = await loadPendingUpdate(dataDirectory);
  const sameVersionAttempt =
    previous && sameTarget(previous, input.expectedVersion, input.expectedCommit);
  const record: PendingUpdateRecord = {
    schemaVersion: pendingUpdateSchemaVersion,
    fromVersion: input.fromVersion,
    expectedVersion: input.expectedVersion,
    expectedCommit: input.expectedCommit ?? null,
    installerSha256: input.installerSha256,
    installedPath: input.installedPath,
    failurePath: path.join(dataDirectory, `update-failure-${randomUUID()}.txt`),
    startedAt: new Date().toISOString(),
    state: "installing",
    attempts: sameVersionAttempt ? (previous?.attempts ?? 0) : 0,
    lastFailure: null,
    lastAttemptAt: new Date().toISOString(),
  };
  await writeJsonAtomically(pendingUpdateFilePath(dataDirectory), record);
  return record;
}

export async function markPendingUpdateConfirmed(
  dataDirectory: string,
  record: PendingUpdateRecord,
): Promise<PendingUpdateRecord> {
  const confirmed: PendingUpdateRecord = {
    ...record,
    state: "confirmed",
    completedAt: new Date().toISOString(),
    lastFailure: null,
    lastAttemptAt: new Date().toISOString(),
  };
  await writeJsonAtomically(pendingUpdateFilePath(dataDirectory), confirmed);
  return confirmed;
}

export async function markPendingUpdateFailed(
  dataDirectory: string,
  record: PendingUpdateRecord,
  reason: string,
): Promise<PendingUpdateRecord> {
  const failed: PendingUpdateRecord = {
    ...record,
    state: "failed",
    attempts: (record.attempts ?? 0) + 1,
    lastFailure: reason,
    lastAttemptAt: new Date().toISOString(),
  };
  await writeJsonAtomically(pendingUpdateFilePath(dataDirectory), failed);
  return failed;
}

export function resolutionFromRecord(
  record: PendingUpdateRecord | null,
  currentVersion: string,
): UpdateAttemptResolution {
  if (!record) {
    return { status: "none", currentVersion, expectedVersion: null };
  }

  return {
    status:
      record.state === "confirmed"
        ? "confirmed"
        : record.state === "failed"
          ? "failed"
          : "installing",
    currentVersion,
    expectedVersion: record.expectedVersion,
    fromVersion: record.fromVersion,
    attemptedAt: record.startedAt,
    completedAt: record.completedAt ?? null,
    attempts: record.attempts,
    installerSha256: record.installerSha256,
    error: record.lastFailure ?? null,
  };
}

export async function describePendingUpdate(
  dataDirectory: string,
  currentVersion: string,
): Promise<UpdateAttemptResolution> {
  const record = await loadPendingUpdate(dataDirectory);
  return resolutionFromRecord(record, currentVersion);
}

export async function resolvePendingUpdate(
  dataDirectory: string,
  currentVersion: string,
  installedPath?: string,
  currentCommit?: string | null,
): Promise<UpdateAttemptResolution> {
  const record = await loadPendingUpdate(dataDirectory);
  if (!record) {
    return resolutionFromRecord(null, currentVersion);
  }

  if (record.state === "failed") {
    return resolutionFromRecord(record, currentVersion);
  }

  const helperFailure = record.failurePath
    ? await readFile(record.failurePath, "utf8").catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return "";
          throw error;
        },
      )
    : "";
  const wrongPath = Boolean(
    record.installedPath && record.installedPath !== installedPath,
  );
  // The version alone cannot prove the app was replaced: builds share it.
  const wrongBuild = Boolean(
    record.expectedCommit && currentCommit && record.expectedCommit !== currentCommit,
  );
  if (
    !helperFailure &&
    !wrongPath &&
    !wrongBuild &&
    versionsEquivalent(currentVersion, record.expectedVersion)
  ) {
    if (record.state === "confirmed")
      return resolutionFromRecord(record, currentVersion);
    const confirmed = await markPendingUpdateConfirmed(dataDirectory, record);
    return resolutionFromRecord(confirmed, currentVersion);
  }

  const failed = await markPendingUpdateFailed(
    dataDirectory,
    record,
    helperFailure.trim() ||
      (wrongPath
        ? "installed-application-path-mismatch"
        : wrongBuild
          ? "installed-build-mismatch"
          : "installed-version-mismatch"),
  );
  return resolutionFromRecord(failed, currentVersion);
}

export function pendingUpdateAttemptLimitReached(
  record: PendingUpdateRecord | null,
  expectedVersion: string,
  expectedCommit?: string | null,
): boolean {
  return Boolean(
    record &&
    sameTarget(record, expectedVersion, expectedCommit) &&
    record.state === "failed" &&
    (record.attempts ?? 0) >= maxPendingUpdateAttempts,
  );
}
