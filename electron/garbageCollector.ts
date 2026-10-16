import { readFile, readdir, rm, stat as statFile } from "node:fs/promises";
import path from "node:path";

/**
 * Background garbage collector for the app-managed `.latexdo` workspace data.
 *
 * Current scope:
 *  - stale per-job LaTeX/Asymptote build directories under `.latexdo/build`
 *  - orphaned history snapshot content files under `.latexdo/history/snapshots`
 *
 * Safety rules (nothing that the user can still see is ever removed):
 *  - build jobs newer than `minBuildAgeMs` and the newest `keepRecentBuildJobs`
 *    jobs are always kept, which includes the PDF currently on the canvas
 *  - an optional byte budget (`maxTotalBytes`) trims the newest kept jobs when
 *    they exceed the threshold, never below the `keepRecent` floor
 *  - snapshot files are only collected when they are no longer referenced by
 *    the history index AND older than `orphanHistoryGraceMs`
 *  - projects with an active compile are skipped and retried later
 *  - automatic sweeps never walk directories for sizes (zero overhead); size
 *    accounting only runs when a caller explicitly requests a byte budget
 *  - all deletions run in bounded batches and yield to the event loop so the
 *    editor stays responsive while a sweep is in progress
 */

export interface BuildJobEntry {
  name: string;
  mtimeMs: number;
  sizeBytes?: number;
}

export interface BuildCollectionPolicy {
  keepRecent: number;
  minAgeMs: number;
  maxTotalBytes?: number;
}

export const defaultBuildCollectionPolicy: BuildCollectionPolicy = {
  keepRecent: 5,
  minAgeMs: 30 * 60 * 1000,
};

export const buildJobNamePattern = /^(?:job|asy)-[0-9a-fA-F-]+$/;

const safeSnapshotFileNamePattern = /^[a-z0-9_-]+\.txt$/i;

export const defaultOrphanHistoryGraceMs = 7 * 24 * 60 * 60 * 1000;

export const historyIndexRelativePath = ".latexdo/history/recent.json";
export const buildDirectoryRelativePath = ".latexdo/build";
export const historySnapshotsRelativePath = ".latexdo/history/snapshots";

export function isBuildJobEntry(entry: BuildJobEntry): boolean {
  return buildJobNamePattern.test(entry.name);
}

function tieBreak(a: BuildJobEntry, b: BuildJobEntry): number {
  if (b.mtimeMs !== a.mtimeMs) {
    return b.mtimeMs - a.mtimeMs;
  }
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * Pure selection of build job names to delete. Newest entries (by mtime) are
 * retained first, then anything younger than the minimum age is kept, and the
 * rest are eligible for collection.
 */
export function collectableBuildJobNames(
  entries: BuildJobEntry[],
  options: Partial<BuildCollectionPolicy> & { now?: number } = {},
): string[] {
  const { keepRecent, minAgeMs } = {
    ...defaultBuildCollectionPolicy,
    ...options,
  };
  const now = options.now ?? Date.now();

  const sorted = entries.filter(isBuildJobEntry).sort(tieBreak);
  const collectableNames = new Set<string>();
  let keptRecent = 0;
  for (const entry of sorted) {
    if (keptRecent < keepRecent) {
      keptRecent += 1;
      continue;
    }
    if (now - entry.mtimeMs < minAgeMs) {
      continue;
    }
    collectableNames.add(entry.name);
  }
  return sorted.map((entry) => entry.name).filter((name) => collectableNames.has(name));
}

/**
 * Pure budget pass: when the retained build jobs (the ones kept by the count /
 * age policy) together exceed `maxTotalBytes`, evicts the oldest retained jobs
 * — never dipping below the `keepRecent` floor — until the retained set fits
 * the budget. Returns the additional job names to collect. Only entries with a
 * known `sizeBytes` participate.
 */
export function enforceBuildSizeBudget(
  entries: ReadonlyArray<BuildJobEntry>,
  retainedNames: readonly string[],
  options: { keepRecent?: number; maxTotalBytes: number },
): string[] {
  const keepRecent = options.keepRecent ?? defaultBuildCollectionPolicy.keepRecent;
  const retainedByName = new Map(entries.map((entry) => [entry.name, entry] as const));

  const evictable = retainedNames
    .map((name) => retainedByName.get(name))
    .filter((entry): entry is BuildJobEntry => Boolean(entry?.sizeBytes))
    .sort(tieBreak)
    .slice(keepRecent);

  let totalBytes = 0;
  for (const name of retainedNames) {
    totalBytes += retainedByName.get(name)?.sizeBytes ?? 0;
  }

  const evicted: string[] = [];
  while (totalBytes > options.maxTotalBytes && evictable.length > 0) {
    const oldest = evictable.pop();
    if (!oldest) break;
    totalBytes -= oldest.sizeBytes ?? 0;
    evicted.push(oldest.name);
  }
  return evicted;
}

function normalizeContentPath(contentPath: string): string {
  return contentPath
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
}

/**
 * Parses the history index (either a bare snapshot array or
 * `{ snapshots: [...] }`) and returns the set of referenced content paths,
 * normalized to POSIX relative paths.
 */
export function parseHistoryIndexReferencedPaths(content: string): Set<string> {
  return parseHistoryIndexReferencedPathsStrict(content) ?? new Set();
}

function parseHistoryIndexReferencedPathsStrict(content: string): Set<string> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  const rawSnapshots = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { snapshots?: unknown })?.snapshots)
      ? (parsed as { snapshots: unknown[] }).snapshots
      : [];

  const referenced = new Set<string>();
  for (const raw of rawSnapshots) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const contentPath = (raw as { contentPath?: unknown }).contentPath;
    if (typeof contentPath === "string" && contentPath.trim()) {
      referenced.add(normalizeContentPath(contentPath));
    }
  }
  return referenced;
}

export interface SnapshotFileEntry {
  name: string;
  mtimeMs: number;
  sizeBytes?: number;
}

/**
 * Pure selection of snapshot files to delete. A file is only collectable when
 * it is not referenced by the history index (checked against both its full
 * relative path and its file name) and is older than the orphan grace period.
 */
export function collectableSnapshotFileNames(
  entries: SnapshotFileEntry[],
  referencedPaths: ReadonlySet<string>,
  options: { graceMs?: number; now?: number } = {},
): string[] {
  const graceMs = options.graceMs ?? defaultOrphanHistoryGraceMs;
  const now = options.now ?? Date.now();

  const referencedBasenames = new Set<string>();
  for (const referenced of referencedPaths) {
    const basename = path.posix.basename(referenced);
    if (basename) {
      referencedBasenames.add(basename);
    }
  }

  const collectable: string[] = [];
  for (const entry of entries) {
    if (!safeSnapshotFileNamePattern.test(entry.name)) {
      continue;
    }
    const relative = `${historySnapshotsRelativePath}/${entry.name}`;
    if (
      referencedPaths.has(relative) ||
      referencedPaths.has(entry.name) ||
      referencedBasenames.has(entry.name)
    ) {
      continue;
    }
    if (now - entry.mtimeMs < graceMs) {
      continue;
    }
    collectable.push(entry.name);
  }
  return collectable;
}

export interface CollectorFs {
  readdir(directory: string): Promise<string[]>;
  readFile(filePath: string): Promise<string>;
  stat(entryPath: string): Promise<{
    isDirectory(): boolean;
    mtimeMs: number;
    size?: number;
  }>;
  rm(entryPath: string): Promise<void>;
}

export interface GarbageCollectionStats {
  projectRoot: string;
  projectRoots?: string[];
  collectedBuildJobs: string[];
  failedBuildJobs: string[];
  collectedSnapshots: string[];
  failedSnapshots: string[];
  skippedHistoryIndex: boolean;
  freedBuildBytes: number;
  freedSnapshotBytes: number;
  skippedReason?: "compile-in-progress" | "project-not-open";
}

const realCollectorFs: CollectorFs = {
  readdir: (directory) => readdir(directory),
  readFile: (filePath) => readFile(filePath, "utf8"),
  stat: (entryPath) =>
    statFile(entryPath).then((stats) => ({
      isDirectory: () => stats.isDirectory(),
      mtimeMs: stats.mtimeMs,
      size: stats.size,
    })),
  rm: (entryPath) => rm(entryPath, { recursive: true, force: true }),
};

export const maxCollectableEntriesPerRun = 100;

const maxBuildSizeWalkDepth = 6;
const maxBuildSizeWalkEntries = 20_000;
const sizeWalkYieldEvery = 64;

function yieldsBetweenDeletions(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Collects stale build jobs and orphaned history snapshots for one open
 * project. Returns aggregate stats; never throws for the caller. Deletions are
 * confined to the app-managed `.latexdo` directories and each removal yields to
 * the event loop so a large sweep cannot stall the editor.
 */
export async function collectProjectGarbage(
  projectRoot: string,
  options: {
    buildPolicy?: Partial<BuildCollectionPolicy>;
    orphanHistoryGraceMs?: number;
    now?: () => number;
    fs?: CollectorFs;
  } = {},
): Promise<GarbageCollectionStats> {
  const fs = options.fs ?? realCollectorFs;
  const now = options.now ?? Date.now;
  const stats: GarbageCollectionStats = {
    projectRoot,
    collectedBuildJobs: [],
    failedBuildJobs: [],
    collectedSnapshots: [],
    failedSnapshots: [],
    skippedHistoryIndex: false,
    freedBuildBytes: 0,
    freedSnapshotBytes: 0,
  };

  await collectBuildJobs(projectRoot, fs, options.buildPolicy, now, stats);
  await collectOrphanSnapshots(
    projectRoot,
    fs,
    options.orphanHistoryGraceMs,
    now,
    stats,
  );

  return stats;
}

async function collectBuildJobs(
  projectRoot: string,
  fs: CollectorFs,
  buildPolicy: Partial<BuildCollectionPolicy> | undefined,
  now: () => number,
  stats: GarbageCollectionStats,
): Promise<void> {
  const buildDirectory = path.join(projectRoot, buildDirectoryRelativePath);
  let names: string[];
  try {
    names = await fs.readdir(buildDirectory);
  } catch {
    return;
  }

  const entries: BuildJobEntry[] = [];
  for (const name of names) {
    if (!buildJobNamePattern.test(name)) {
      continue;
    }
    const entryPath = path.join(buildDirectory, name);
    try {
      const info = await fs.stat(entryPath);
      if (!info.isDirectory()) {
        continue;
      }
      entries.push({ name, mtimeMs: nowInfo(info, now) });
    } catch {
      // A build directory may disappear between listing and statting; skip it.
    }
  }

  const policy = { ...defaultBuildCollectionPolicy, ...buildPolicy };
  const collectable = collectableBuildJobNames(entries, { ...policy, now: now() });
  const retainedNames = entries
    .filter(isBuildJobEntry)
    .map((entry) => entry.name)
    .filter((name) => !collectable.includes(name));

  if (typeof policy.maxTotalBytes === "number" && entries.length > 0) {
    await measureBuildSizes(fs, buildDirectory, entries);
    const budgetEvictions = enforceBuildSizeBudget(entries, retainedNames, {
      keepRecent: policy.keepRecent,
      maxTotalBytes: policy.maxTotalBytes,
    });
    collectable.push(...budgetEvictions);
  }

  const toCollect = [...new Set(collectable)].sort();
  for (const name of toCollect.slice(0, maxCollectableEntriesPerRun)) {
    await yieldsBetweenDeletions();
    try {
      await fs.rm(path.join(buildDirectory, name));
      stats.collectedBuildJobs.push(name);
      const knownBytes = entries.find((entry) => entry.name === name)?.sizeBytes;
      if (typeof knownBytes === "number") {
        stats.freedBuildBytes += knownBytes;
      }
    } catch {
      stats.failedBuildJobs.push(name);
    }
  }
}

async function measureBuildSizes(
  fs: CollectorFs,
  buildDirectory: string,
  entries: BuildJobEntry[],
): Promise<void> {
  for (const entry of entries) {
    const state = { bytes: 0, files: 0 };
    await directorySizeBytes(fs, path.join(buildDirectory, entry.name), state);
    entry.sizeBytes = state.bytes;
  }
}

async function directorySizeBytes(
  fs: CollectorFs,
  directory: string,
  state: { bytes: number; files: number },
  depth = 0,
): Promise<void> {
  if (depth > maxBuildSizeWalkDepth || state.files > maxBuildSizeWalkEntries) {
    return;
  }
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch {
    return;
  }
  for (const name of names) {
    const entryPath = path.join(directory, name);
    let info: { isDirectory(): boolean; size?: number };
    try {
      info = await fs.stat(entryPath);
    } catch {
      // A build artifact may disappear while being replaced; skip it.
      continue;
    }
    if (info.isDirectory()) {
      if (depth < maxBuildSizeWalkDepth) {
        await directorySizeBytes(fs, entryPath, state, depth + 1);
      }
    } else {
      state.files += 1;
      state.bytes += typeof info.size === "number" && info.size > 0 ? info.size : 0;
    }
    if (state.files % sizeWalkYieldEvery === 0) {
      await yieldsBetweenDeletions();
    }
  }
}

function nowInfo(
  info: { isDirectory(): boolean; mtimeMs: number },
  now: () => number,
): number {
  return Number.isFinite(info.mtimeMs) ? info.mtimeMs : now();
}

async function collectOrphanSnapshots(
  projectRoot: string,
  fs: CollectorFs,
  orphanHistoryGraceMs: number | undefined,
  now: () => number,
  stats: GarbageCollectionStats,
): Promise<void> {
  const indexPath = path.join(projectRoot, historyIndexRelativePath);
  let referenced: Set<string>;
  try {
    const parsed = parseHistoryIndexReferencedPathsStrict(await fs.readFile(indexPath));
    if (!parsed) {
      stats.skippedHistoryIndex = true;
      return;
    }
    referenced = parsed;
  } catch {
    stats.skippedHistoryIndex = true;
    return;
  }

  const snapshotsDirectory = path.join(projectRoot, historySnapshotsRelativePath);
  let names: string[];
  try {
    names = await fs.readdir(snapshotsDirectory);
  } catch {
    return;
  }

  const entries: SnapshotFileEntry[] = [];
  for (const name of names) {
    const entryPath = path.join(snapshotsDirectory, name);
    try {
      const info = await fs.stat(entryPath);
      if (info.isDirectory()) {
        continue;
      }
      entries.push({
        name,
        mtimeMs: nowInfo(info, now),
        sizeBytes: typeof info.size === "number" && info.size > 0 ? info.size : 0,
      });
    } catch {
      // A snapshot file may have been removed concurrently; skip it.
    }
  }

  const collectable = collectableSnapshotFileNames(entries, referenced, {
    graceMs: orphanHistoryGraceMs,
    now: now(),
  });

  for (const name of collectable.slice(0, maxCollectableEntriesPerRun)) {
    await yieldsBetweenDeletions();
    try {
      await fs.rm(path.join(snapshotsDirectory, name));
      stats.collectedSnapshots.push(name);
      const knownBytes = entries.find((entry) => entry.name === name)?.sizeBytes;
      if (typeof knownBytes === "number") {
        stats.freedSnapshotBytes += knownBytes;
      }
    } catch {
      stats.failedSnapshots.push(name);
    }
  }
}

export interface GarbageCollectorOptions {
  getProjectRoot: (projectId: string) => string;
  getProjectRoots?: (projectId: string) => string[];
  hasActiveCompiles: (projectId: string) => boolean;
  debounceMs?: number;
  retryDelayMs?: number;
  sweepIntervalMs?: number;
  maxRetries?: number;
  now?: () => number;
  fs?: CollectorFs;
  logger?: (message: string) => void;
}

export interface GarbageCollector {
  schedule(projectId: string): void;
  collectNow(
    projectId: string,
    options?: CollectNowOptions,
  ): Promise<GarbageCollectionStats | null>;
  dispose(): void;
}

export interface CollectNowOptions {
  buildPolicy?: Partial<BuildCollectionPolicy>;
}

/**
 * Background scheduler for garbage collection. Triggers are coalesced through a
 * debounce so rapid compiles only produce one sweep, project sweeps are skipped
 * while a compile is in flight (retried with backoff), and a low-priority
 * periodic sweep catches anything missed. Every timer is unref'd so the app can
 * quit immediately.
 */
export function createGarbageCollector(
  options: GarbageCollectorOptions,
): GarbageCollector {
  const debounceMs = options.debounceMs ?? 30 * 1000;
  const retryDelayMs = options.retryDelayMs ?? 60 * 1000;
  const sweepIntervalMs = options.sweepIntervalMs ?? 30 * 60 * 1000;
  const maxRetries = options.maxRetries ?? 5;
  const logger = options.logger ?? (() => {});

  const knownProjects = new Set<string>();
  const inflight = new Set<string>();
  const retries = new Map<string, number>();

  let debounceTimer: NodeJS.Timeout | null = null;
  let sweepTimer: NodeJS.Timeout | null = null;
  let disposed = false;

  function schedule(projectId: string): void {
    if (disposed) {
      return;
    }
    knownProjects.add(projectId);
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void drainScheduled();
    }, debounceMs);
    debounceTimer.unref?.();
  }

  async function drainScheduled(): Promise<void> {
    const scheduled = [...knownProjects];
    for (const projectId of scheduled) {
      if (disposed) {
        return;
      }
      await collectProject(projectId);
    }
  }

  async function collectProject(projectId: string): Promise<void> {
    if (inflight.has(projectId)) {
      return;
    }
    inflight.add(projectId);
    try {
      if (options.hasActiveCompiles(projectId)) {
        const attempts = retries.get(projectId) ?? 0;
        if (attempts < maxRetries) {
          retries.set(projectId, attempts + 1);
          setTimeout(() => {
            if (!disposed) {
              void collectProject(projectId);
            }
          }, retryDelayMs).unref?.();
          logger(`[gc] deferred ${projectId}: compile in progress`);
        } else {
          retries.delete(projectId);
          logger(`[gc] gave up on ${projectId} after ${attempts} retries`);
        }
        return;
      }

      const stats = await collectProjectRoots(projectId);
      retries.delete(projectId);
      logger(
        `[gc] ${projectId}: removed ${stats.collectedBuildJobs.length} build job(s), ` +
          `${stats.collectedSnapshots.length} orphan snapshot(s)`,
      );
    } catch (error) {
      logger(`[gc] failed ${projectId}: ${String(error)}`);
    } finally {
      inflight.delete(projectId);
    }
  }

  sweepTimer = setInterval(() => {
    if (disposed) {
      return;
    }
    for (const projectId of knownProjects) {
      schedule(projectId);
    }
  }, sweepIntervalMs);
  sweepTimer.unref?.();

  function dispose(): void {
    disposed = true;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (sweepTimer) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
    knownProjects.clear();
    retries.clear();
  }

  function emptyStats(
    reason: "compile-in-progress" | "project-not-open",
  ): GarbageCollectionStats {
    return {
      projectRoot: "",
      collectedBuildJobs: [],
      failedBuildJobs: [],
      collectedSnapshots: [],
      failedSnapshots: [],
      skippedHistoryIndex: false,
      freedBuildBytes: 0,
      freedSnapshotBytes: 0,
      skippedReason: reason,
    };
  }

  async function collectNow(
    projectId: string,
    collectOptions: CollectNowOptions = {},
  ): Promise<GarbageCollectionStats | null> {
    if (disposed) {
      return null;
    }
    if (inflight.has(projectId)) {
      return null;
    }
    inflight.add(projectId);
    try {
      if (options.hasActiveCompiles(projectId)) {
        logger(`[gc] manual ${projectId}: compile in progress`);
        return emptyStats("compile-in-progress");
      }
      const stats = await collectProjectRoots(projectId, collectOptions);
      retries.delete(projectId);
      logger(
        `[gc] manual ${projectId}: removed ${stats.collectedBuildJobs.length} build job(s), ` +
          `${stats.collectedSnapshots.length} orphan snapshot(s), ` +
          `freed ${stats.freedBuildBytes} bytes`,
      );
      return stats;
    } catch {
      logger(`[gc] manual ${projectId}: project is not open`);
      return emptyStats("project-not-open");
    } finally {
      inflight.delete(projectId);
    }
  }

  async function collectProjectRoots(
    projectId: string,
    collectOptions: CollectNowOptions = {},
  ): Promise<GarbageCollectionStats> {
    const roots = rootsForProject(projectId);
    const stats: GarbageCollectionStats[] = [];
    for (const projectRoot of roots) {
      stats.push(
        await collectProjectGarbage(projectRoot, {
          now: options.now,
          fs: options.fs,
          buildPolicy: collectOptions.buildPolicy,
        }),
      );
    }
    return mergeGarbageCollectionStats(stats);
  }

  function rootsForProject(projectId: string): string[] {
    const roots = options.getProjectRoots?.(projectId);
    if (roots?.length) {
      return [...new Set(roots)];
    }
    return [options.getProjectRoot(projectId)];
  }

  return { schedule, collectNow, dispose };
}

export function mergeGarbageCollectionStats(
  statsList: readonly GarbageCollectionStats[],
): GarbageCollectionStats {
  if (statsList.length === 1) {
    return statsList[0];
  }

  const projectRoots = statsList.map((stats) => stats.projectRoot);
  const prefix = (stats: GarbageCollectionStats, name: string) =>
    `${path.basename(stats.projectRoot)}/${name}`;
  const entries = (
    selector: (stats: GarbageCollectionStats) => readonly string[],
  ): string[] =>
    statsList.flatMap((stats) =>
      selector(stats).map((name) =>
        statsList.length > 1 ? prefix(stats, name) : name,
      ),
    );

  return {
    projectRoot: projectRoots[0] ?? "",
    projectRoots,
    collectedBuildJobs: entries((stats) => stats.collectedBuildJobs),
    failedBuildJobs: entries((stats) => stats.failedBuildJobs),
    collectedSnapshots: entries((stats) => stats.collectedSnapshots),
    failedSnapshots: entries((stats) => stats.failedSnapshots),
    skippedHistoryIndex: statsList.some((stats) => stats.skippedHistoryIndex),
    freedBuildBytes: statsList.reduce(
      (total, stats) => total + stats.freedBuildBytes,
      0,
    ),
    freedSnapshotBytes: statsList.reduce(
      (total, stats) => total + stats.freedSnapshotBytes,
      0,
    ),
  };
}
