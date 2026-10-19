// @vitest-environment node
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectableBuildJobNames,
  collectableSnapshotFileNames,
  collectProjectGarbage,
  createGarbageCollector,
  mergeGarbageCollectionStats,
  parseHistoryIndexReferencedPaths,
  type CollectorFs,
} from "./garbageCollector.js";

const now = Date.parse("2026-07-15T12:00:00.000Z");
const day = 24 * 60 * 60 * 1000;
const root = path.join(path.sep, "project");
const build = path.join(root, ".latexdo", "build");
const snapshots = path.join(root, ".latexdo", "history", "snapshots");
const index = path.join(root, ".latexdo", "history", "recent.json");

type Node = { dir?: boolean; mtimeMs?: number; size?: number; content?: string };

/** An in-memory filesystem whose failures can be injected per path. */
function memoryFs(
  nodes: Record<string, Node>,
  failures: { readdir?: string[]; stat?: string[]; rm?: string[] } = {},
): CollectorFs & { removed: string[] } {
  const removed: string[] = [];
  return {
    removed,
    async readdir(directory) {
      if (failures.readdir?.includes(directory) || !nodes[directory]?.dir)
        throw new Error(`ENOENT ${directory}`);
      const prefix = directory + path.sep;
      return Object.keys(nodes)
        .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes(path.sep))
        .map((key) => key.slice(prefix.length));
    },
    async readFile(filePath) {
      const node = nodes[filePath];
      if (node?.content === undefined) throw new Error("ENOENT");
      return node.content;
    },
    async stat(entryPath) {
      const node = nodes[entryPath];
      if (!node || failures.stat?.includes(entryPath)) throw new Error("ENOENT");
      return {
        isDirectory: () => Boolean(node.dir),
        mtimeMs: node.mtimeMs ?? Number.NaN,
        size: node.size,
      };
    },
    async rm(entryPath) {
      if (failures.rm?.includes(entryPath)) throw new Error("EBUSY");
      removed.push(entryPath);
    },
  };
}

const job = (name: string) => path.join(build, name);
const snap = (name: string) => path.join(snapshots, name);

describe("collectProjectGarbage with an injected filesystem", () => {
  it("skips non-directories, vanished entries and failed removals", async () => {
    const nodes: Record<string, Node> = {
      [build]: { dir: true },
      [job("job-1")]: { dir: true, mtimeMs: now - 40 * day },
      [job("job-2")]: { dir: true, mtimeMs: now - 40 * day },
      [job("job-3")]: { dir: true, mtimeMs: now - 1000 },
      [job("job-4")]: { dir: true, mtimeMs: now - 1000 },
      [job("job-5")]: { dir: true, mtimeMs: now - 1000 },
      [job("job-6")]: { dir: true, mtimeMs: now - 1000 },
      [job("job-7")]: { mtimeMs: now - 40 * day },
      [job("job-8")]: { dir: true },
      [index]: { content: JSON.stringify([]) },
      [snapshots]: { dir: true },
      [snap("a.txt")]: { mtimeMs: now - 40 * day, size: 10 },
      [snap("b.txt")]: { mtimeMs: now - 40 * day },
      [snap("gone.txt")]: { mtimeMs: now - 40 * day },
    };
    const fs = memoryFs(nodes, {
      stat: [job("job-8"), snap("gone.txt")],
      rm: [job("job-2"), snap("b.txt")],
    });
    const stats = await collectProjectGarbage(root, {
      fs,
      now: () => now,
      buildPolicy: { keepRecent: 4 },
    });
    expect(stats.collectedBuildJobs).toEqual(["job-1"]);
    expect(stats.failedBuildJobs).toEqual(["job-2"]);
    expect(stats.collectedSnapshots).toEqual(["a.txt"]);
    expect(stats.failedSnapshots).toEqual(["b.txt"]);
    expect(stats.freedSnapshotBytes).toBe(10);
    expect(fs.removed).not.toContain(job("job-7"));
  });

  it("uses the clock for entries without a usable mtime and stops when snapshots are unreadable", async () => {
    const fs = memoryFs(
      {
        [build]: { dir: true },
        ...Object.fromEntries(
          Array.from({ length: 7 }, (_, i) => [job(`job-${i}`), { dir: true }]),
        ),
        [index]: { content: "{}" },
        [snapshots]: { dir: true },
      },
      { readdir: [snapshots] },
    );
    const stats = await collectProjectGarbage(root, { fs, now: () => now });
    // Every job looks brand new, so nothing is old enough to collect.
    expect(stats.collectedBuildJobs).toEqual([]);
    expect(stats.collectedSnapshots).toEqual([]);
    expect(stats.skippedHistoryIndex).toBe(false);
  });

  it("measures build sizes defensively while enforcing a budget", async () => {
    const big = job("job-a");
    const deep = Array.from({ length: 9 }, (_, i) => `d${i}`);
    const nodes: Record<string, Node> = {
      [build]: { dir: true },
      [big]: { dir: true, mtimeMs: now - 1000 },
      [job("job-b")]: { dir: true, mtimeMs: now - 2000 },
      [job("job-c")]: { dir: true, mtimeMs: now - 3000 },
      [job("job-d")]: { dir: true, mtimeMs: now - 4000 },
      [job("job-e")]: { dir: true, mtimeMs: now - 5000 },
      [job("job-f")]: { dir: true, mtimeMs: now - 6000 },
    };
    // 70 files so the walk yields at least once.
    for (let i = 0; i < 70; i += 1) nodes[path.join(job("job-f"), `f${i}`)] = { size: 100 };
    nodes[path.join(job("job-b"), "small")] = { size: 50 };
    nodes[path.join(job("job-f"), "negative")] = { size: -5 };
    nodes[path.join(job("job-f"), "unknown")] = {};
    nodes[path.join(job("job-f"), "vanished")] = { size: 1 };
    let cursor = job("job-e");
    for (const name of deep) {
      cursor = path.join(cursor, name);
      nodes[cursor] = { dir: true };
    }
    nodes[path.join(cursor, "too-deep.bin")] = { size: 1_000_000 };
    nodes[path.join(job("job-d"), "unreadable")] = { dir: true };
    const fs = memoryFs(nodes, {
      stat: [path.join(job("job-f"), "vanished")],
      readdir: [path.join(job("job-d"), "unreadable")],
    });
    const stats = await collectProjectGarbage(root, {
      fs,
      now: () => now,
      buildPolicy: { keepRecent: 1, minAgeMs: day, maxTotalBytes: 1 },
    });
    expect(stats.collectedBuildJobs).toEqual(["job-f"]);
    expect(stats.freedBuildBytes).toBe(7000);
  });
});

describe("pure selection defaults", () => {
  it("falls back to the current time and keeps identical duplicates stable", () => {
    const old = Date.now() - 40 * day;
    const entries = Array.from({ length: 7 }, () => ({ name: "job-1", mtimeMs: old }));
    const collected = collectableBuildJobNames(entries);
    expect(collected.length).toBeGreaterThan(0);
    expect(new Set(collected)).toEqual(new Set(["job-1"]));
    expect(
      collectableSnapshotFileNames(
        [{ name: "a.txt", mtimeMs: old, sizeBytes: 1 }],
        new Set(["", "b.txt"]),
      ),
    ).toEqual(["a.txt"]);
  });

  it("stops walking build sizes after too many files", async () => {
    const nodes: Record<string, Node> = { [build]: { dir: true } };
    for (const name of ["job-1", "job-2"]) nodes[job(name)] = { dir: true, mtimeMs: now };
    for (let i = 0; i < 20_001; i += 1) nodes[path.join(job("job-1"), `f${i}`)] = { size: 1 };
    nodes[path.join(job("job-1"), "zz")] = { dir: true };
    nodes[path.join(job("job-1"), "zz", "skipped")] = { size: 1_000 };
    const fs = memoryFs(nodes);
    const stats = await collectProjectGarbage(root, {
      fs,
      now: () => now,
      buildPolicy: { keepRecent: 0, maxTotalBytes: 20_000 },
    });
    expect(stats.collectedBuildJobs).toEqual(["job-1"]);
    expect(stats.freedBuildBytes).toBe(20_001);
  }, 30_000);
});

describe("history index parsing", () => {
  it("ignores null entries and non-snapshot objects", () => {
    expect(
      [...parseHistoryIndexReferencedPaths(
        JSON.stringify({ snapshots: [null, 3, { contentPath: " " }, { contentPath: "a.txt" }] }),
      )],
    ).toEqual(["a.txt"]);
    expect(parseHistoryIndexReferencedPaths("null").size).toBe(0);
  });
});

describe("mergeGarbageCollectionStats", () => {
  it("prefixes entries with the project folder when merging several roots", () => {
    const base = {
      collectedBuildJobs: ["job-1"],
      failedBuildJobs: [],
      collectedSnapshots: ["s.txt"],
      failedSnapshots: ["f.txt"],
      skippedHistoryIndex: false,
      freedBuildBytes: 5,
      freedSnapshotBytes: 2,
    };
    const merged = mergeGarbageCollectionStats([
      { ...base, projectRoot: "/a/one" },
      { ...base, projectRoot: "/b/two", skippedHistoryIndex: true },
    ]);
    expect(merged.projectRoot).toBe("/a/one");
    expect(merged.collectedBuildJobs).toEqual(["one/job-1", "two/job-1"]);
    expect(merged.failedSnapshots).toEqual(["one/f.txt", "two/f.txt"]);
    expect(merged.freedBuildBytes).toBe(10);
    expect(merged.skippedHistoryIndex).toBe(true);
    expect(mergeGarbageCollectionStats([]).projectRoot).toBe("");
  });
});

describe("background scheduling", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function fakeTimers() {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
  }

  function emptyFs() {
    return memoryFs({});
  }

  it("debounces triggers, defers during compiles, retries and gives up", async () => {
    fakeTimers();
    const logs: string[] = [];
    let compiling = true;
    const collector = createGarbageCollector({
      getProjectRoot: () => root,
      hasActiveCompiles: () => compiling,
      debounceMs: 10,
      retryDelayMs: 20,
      sweepIntervalMs: 1_000_000,
      maxRetries: 1,
      fs: emptyFs(),
      logger: (message) => logs.push(message),
    });
    collector.schedule("p");
    collector.schedule("p");
    await vi.advanceTimersByTimeAsync(10);
    expect(logs).toEqual(["[gc] deferred p: compile in progress"]);
    await vi.advanceTimersByTimeAsync(20);
    expect(logs.at(-1)).toBe("[gc] gave up on p after 1 retries");
    compiling = false;
    collector.schedule("p");
    await vi.advanceTimersByTimeAsync(10);
    await vi.waitFor(() =>
      expect(logs.at(-1)).toBe("[gc] p: removed 0 build job(s), 0 orphan snapshot(s)"),
    );
    collector.dispose();
    collector.schedule("p");
    await vi.advanceTimersByTimeAsync(100);
    expect(logs).toHaveLength(3);
  });

  it("drops retries after dispose and logs failures", async () => {
    fakeTimers();
    const logs: string[] = [];
    let compiling = true;
    const collector = createGarbageCollector({
      getProjectRoot: () => {
        if (!compiling) throw new Error("closed");
        return root;
      },
      hasActiveCompiles: () => compiling,
      debounceMs: 1,
      retryDelayMs: 5,
      logger: (message) => logs.push(message),
    });
    collector.schedule("q");
    await vi.advanceTimersByTimeAsync(1);
    collector.dispose();
    await vi.advanceTimersByTimeAsync(10);
    expect(logs).toEqual(["[gc] deferred q: compile in progress"]);

    const second = createGarbageCollector({
      getProjectRoot: () => {
        throw new Error("closed");
      },
      hasActiveCompiles: () => false,
      debounceMs: 1,
      logger: (message) => logs.push(message),
    });
    second.schedule("r");
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(logs.at(-1)).toBe("[gc] failed r: Error: closed"));
    second.dispose();
    compiling = false;
  });

  it("sweeps known projects periodically, skips in-flight ones and stops after dispose", async () => {
    fakeTimers();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fs = emptyFs();
    const readdir = fs.readdir;
    let calls = 0;
    fs.readdir = async (directory) => {
      calls += 1;
      await gate;
      return readdir(directory);
    };
    const collector = createGarbageCollector({
      getProjectRoot: () => root,
      hasActiveCompiles: () => false,
      debounceMs: 1,
      sweepIntervalMs: 50,
      fs,
    });
    collector.schedule("s");
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(1);
    // The sweep re-schedules while the first run is still in flight.
    await vi.advanceTimersByTimeAsync(51);
    expect(calls).toBe(1);
    release();
    await vi.advanceTimersByTimeAsync(50);
    await vi.waitFor(() => expect(calls).toBeGreaterThan(1));
    collector.dispose();
    collector.dispose();
    const before = calls;
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toBe(before);
  });

  it("stops draining queued projects once disposed mid-run", async () => {
    fakeTimers();
    const seen: string[] = [];
    const collector = createGarbageCollector({
      getProjectRoot: (id) => {
        seen.push(id);
        collector.dispose();
        return root;
      },
      hasActiveCompiles: () => false,
      debounceMs: 1,
      fs: emptyFs(),
    });
    collector.schedule("a");
    collector.schedule("b");
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(seen).toEqual(["a"]));
  });

  it("cancels a pending debounce on dispose", async () => {
    fakeTimers();
    const hasActiveCompiles = vi.fn(() => false);
    const collector = createGarbageCollector({
      getProjectRoot: () => root,
      hasActiveCompiles,
      debounceMs: 5,
      fs: emptyFs(),
    });
    collector.schedule("x");
    collector.dispose();
    await vi.advanceTimersByTimeAsync(100);
    expect(hasActiveCompiles).not.toHaveBeenCalled();
  });

  it("uses default timings and a silent logger", async () => {
    fakeTimers();
    const hasActiveCompiles = vi.fn(() => false);
    const collector = createGarbageCollector({
      getProjectRoot: () => root,
      getProjectRoots: () => [],
      hasActiveCompiles,
      fs: emptyFs(),
    });
    collector.schedule("d");
    await vi.advanceTimersByTimeAsync(29_999);
    expect(hasActiveCompiles).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(hasActiveCompiles).toHaveBeenCalledOnce();
    collector.dispose();
  });
});
