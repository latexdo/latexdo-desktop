import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BuildChange } from "./buildInfo.js";
import type { BuildChangeNote } from "./types.js";
import { compareLatexDoVersions, versionsEquivalent } from "./versions.js";

export const updateExperienceStateSchemaVersion = 1;

export interface ConfirmedUpdateSnapshot {
  fromVersion: string;
  toVersion: string;
  confirmedAt: string;
  /** Builds share a version number, so the commits tell builds apart. */
  fromCommit?: string | null;
  toCommit?: string | null;
}

export interface UpdateExperienceState {
  schemaVersion: 1;
  lastConfirmedUpdate?: ConfirmedUpdateSnapshot;
  lastPresentedVersion?: string;
  presentedVersions?: string[];
  /** Version of the previous launch; detects updates installed outside LatexDo. */
  lastRunVersion?: string;
  /** Commit of the previous launch's build. */
  lastRunCommit?: string;
  /** Builds ("version+commit") whose What's New was already shown. */
  presentedBuilds?: string[];
}

/** Identity of one published build. */
export function buildKey(version: string, commit?: string | null): string {
  return commit ? `${version}+${commit}` : version;
}

function stringList(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function updateExperienceStateFilePath(dataDirectory: string): string {
  return path.join(dataDirectory, "update-state.json");
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

function isValidState(value: unknown): value is UpdateExperienceState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<UpdateExperienceState>;
  if (record.schemaVersion !== updateExperienceStateSchemaVersion) return false;
  if (record.lastConfirmedUpdate !== undefined) {
    const snapshot = record.lastConfirmedUpdate;
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      Array.isArray(snapshot) ||
      typeof snapshot.fromVersion !== "string" ||
      typeof snapshot.toVersion !== "string" ||
      !Number.isFinite(Date.parse(snapshot.confirmedAt))
    ) {
      return false;
    }
  }
  if (record.lastPresentedVersion !== undefined) {
    if (typeof record.lastPresentedVersion !== "string") return false;
  }
  if (record.lastRunVersion !== undefined) {
    if (typeof record.lastRunVersion !== "string") return false;
  }
  if (record.lastRunCommit !== undefined && typeof record.lastRunCommit !== "string") {
    return false;
  }
  if (record.presentedBuilds !== undefined && !stringList(record.presentedBuilds)) {
    return false;
  }
  if (record.presentedVersions !== undefined) {
    if (
      !Array.isArray(record.presentedVersions) ||
      record.presentedVersions.some((version) => typeof version !== "string")
    ) {
      return false;
    }
  }
  return true;
}

export function emptyUpdateExperienceState(): UpdateExperienceState {
  return { schemaVersion: updateExperienceStateSchemaVersion };
}

export async function loadUpdateExperienceState(
  dataDirectory: string,
): Promise<UpdateExperienceState> {
  try {
    const content = await readFile(
      updateExperienceStateFilePath(dataDirectory),
      "utf8",
    );
    const parsed: unknown = JSON.parse(content);
    return isValidState(parsed) ? parsed : emptyUpdateExperienceState();
  } catch {
    return emptyUpdateExperienceState();
  }
}

export async function saveUpdateExperienceState(
  dataDirectory: string,
  state: UpdateExperienceState,
): Promise<void> {
  await writeJsonAtomically(updateExperienceStateFilePath(dataDirectory), state);
}

export async function recordConfirmedUpdate(
  dataDirectory: string,
  snapshot: ConfirmedUpdateSnapshot,
): Promise<UpdateExperienceState> {
  const state = await loadUpdateExperienceState(dataDirectory);
  const next: UpdateExperienceState = {
    ...state,
    lastConfirmedUpdate: snapshot,
  };
  await saveUpdateExperienceState(dataDirectory, next);
  return next;
}

/**
 * Called on every launch with the running build. Launching a newer build than
 * last time records the update so What's New opens once after the relaunch,
 * whether the update came from the in-app updater or a downloaded installer.
 * Builds share a version number, so a same-version launch counts as an update
 * when the previous build's commit is in this build's history. The first
 * launch ever, a relaunch of the same build and a downgrade record nothing.
 */
export async function recordLaunchedVersion(
  dataDirectory: string,
  runningVersion: string,
  now: Date = new Date(),
  build: {
    commit?: string | null;
    history?: readonly string[];
    /** The in-app updater confirmed on this launch that the update installed. */
    updaterConfirmed?: boolean;
  } = {},
): Promise<UpdateExperienceState> {
  const state = await loadUpdateExperienceState(dataDirectory);
  const previousVersion = state.lastRunVersion;
  const previousCommit = state.lastRunCommit;
  const commit = build.commit ?? undefined;
  const next: UpdateExperienceState = {
    ...state,
    lastRunVersion: runningVersion,
    lastRunCommit: commit,
  };
  if (previousVersion) {
    const comparison = compareLatexDoVersions(runningVersion, previousVersion);
    const newerBuild =
      comparison === 0 &&
      Boolean(commit && previousCommit && commit !== previousCommit) &&
      (build.history ?? []).includes(previousCommit!);
    const confirmed = state.lastConfirmedUpdate;
    const confirmedByUpdater =
      confirmed &&
      versionsEquivalent(confirmed.toVersion, runningVersion) &&
      (!confirmed.toCommit || confirmed.toCommit === commit);
    const untaggedUpdaterRecord =
      build.updaterConfirmed && confirmedByUpdater && !confirmed.toCommit;
    if (confirmedByUpdater && (comparison > 0 || newerBuild || untaggedUpdaterRecord)) {
      // The in-app updater already recorded this update; add the builds.
      next.lastConfirmedUpdate = {
        ...confirmed,
        fromCommit: confirmed.fromCommit ?? previousCommit ?? null,
        toCommit: commit ?? null,
      };
    } else if (comparison > 0 || newerBuild) {
      next.lastConfirmedUpdate = {
        fromVersion: previousVersion,
        toVersion: runningVersion,
        fromCommit: previousCommit ?? null,
        toCommit: commit ?? null,
        confirmedAt: now.toISOString(),
      };
    }
  }
  if (
    previousVersion === runningVersion &&
    previousCommit === commit &&
    next.lastConfirmedUpdate === state.lastConfirmedUpdate
  ) {
    return state;
  }
  await saveUpdateExperienceState(dataDirectory, next);
  return next;
}

export async function markVersionPresented(
  dataDirectory: string,
  version: string,
  commit?: string | null,
): Promise<UpdateExperienceState> {
  const state = await loadUpdateExperienceState(dataDirectory);
  const presentedVersions = state.presentedVersions ?? [];
  if (!presentedVersions.some((entry) => versionsEquivalent(entry, version))) {
    presentedVersions.push(version);
  }
  const presentedBuilds = [...(state.presentedBuilds ?? [])];
  const key = buildKey(version, commit);
  if (commit && !presentedBuilds.includes(key)) presentedBuilds.push(key);
  const next: UpdateExperienceState = {
    ...state,
    lastPresentedVersion: version,
    presentedVersions,
    ...(presentedBuilds.length ? { presentedBuilds: presentedBuilds.slice(-50) } : {}),
  };
  await saveUpdateExperienceState(dataDirectory, next);
  return next;
}

export function shouldShowWhatsNew(
  runningVersion: string,
  state: UpdateExperienceState,
  runningCommit?: string | null,
): boolean {
  const confirmed = state.lastConfirmedUpdate;
  if (!confirmed) return false;
  if (!versionsEquivalent(confirmed.toVersion, runningVersion)) return false;
  if (confirmed.toCommit && runningCommit) {
    // Shown once per build: a later build of the same version shows again.
    if (confirmed.toCommit !== runningCommit) return false;
    return !(state.presentedBuilds ?? []).includes(
      buildKey(runningVersion, runningCommit),
    );
  }
  if (
    state.presentedVersions?.some((version) =>
      versionsEquivalent(version, runningVersion),
    )
  ) {
    return false;
  }
  if (
    state.lastPresentedVersion &&
    versionsEquivalent(state.lastPresentedVersion, runningVersion)
  ) {
    return false;
  }
  return true;
}

const changeKinds: Record<string, BuildChangeNote["kind"]> = {
  feat: "new",
  fix: "fixed",
  perf: "improved",
};

/**
 * User-facing notes for the commits a build update brought: features, fixes
 * and performance work, without the conventional-commit prefix or issue
 * numbers. Empty when the previous build is not in this build's history.
 */
export function changesBetweenBuilds(
  changes: readonly BuildChange[],
  fromCommit: string | null | undefined,
  limit = 30,
): BuildChangeNote[] {
  if (!fromCommit) return [];
  const end = changes.findIndex((change) => change.commit === fromCommit);
  if (end <= 0) return [];
  const notes: BuildChangeNote[] = [];
  for (const change of changes.slice(0, end)) {
    const match = /^(\w+)(?:\([^)]*\))?!?:\s*(.+)$/.exec(change.subject);
    const kind = match ? changeKinds[match[1].toLowerCase()] : undefined;
    if (!match || !kind) continue;
    const text = match[2].replace(/\s*\((?:#\d+(?:,\s*)?)+\)\s*$/, "").trim();
    if (!text) continue;
    notes.push({ kind, text: text[0].toUpperCase() + text.slice(1) });
    if (notes.length >= limit) break;
  }
  return notes;
}
