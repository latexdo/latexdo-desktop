import { access, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectProjectGarbage,
  collectableBuildJobNames,
  collectableSnapshotFileNames,
  createGarbageCollector,
  enforceBuildSizeBudget,
  parseHistoryIndexReferencedPaths,
  type GarbageCollectorOptions,
} from "./garbageCollector.js";

const now = Date.parse("2026-07-15T12:00:00.000Z");
const minute = 60 * 1000;
const hour = 60 * minute;
const day = 24 * hour;

async function withTempProject(
  callback: (projectRoot: string) => Promise<void>,
): Promise<void> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "latexdo-gc-"));
  try {
    await callback(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

async function touch(directoryPath: string, ageMs: number): Promise<void> {
  const date = new Date(now - ageMs);
  await utimes(directoryPath, date, date);
}

describe("collectableBuildJobNames", () => {
  it("always keeps the newest jobs regardless of age", () => {
    const entries = Array.from({ length: 6 }, (_, index) => ({
      name: `job-${index}`,
      mtimeMs: now - index * hour,
    }));
    const collected = collectableBuildJobNames(entries, { now });
    expect(collected).toContain("job-5");
    expect(collected).not.toContain("job-0");
    expect(collected).toHaveLength(1);
  });

  it("keeps young jobs beyond the retention window until they age out", () => {
    const entries = [
      { name: "job-a1", mtimeMs: now - 5 * minute },
      { name: "job-b2", mtimeMs: now - 10 * minute },
      { name: "job-c3", mtimeMs: now - 20 * minute },
      { name: "job-d4", mtimeMs: now - 25 * minute },
      { name: "job-e5", mtimeMs: now - 29 * minute },
      { name: "job-f6", mtimeMs: now - 60 * hour },
    ];
    const collected = collectableBuildJobNames(entries, { now });
    expect(collected).toEqual(["job-f6"]);
  });

  it("ignores entries that are not build job directories", () => {
    const entries = [
      { name: "job-abc", mtimeMs: now - 30 * day },
      { name: "asy-def", mtimeMs: now - 30 * day },
      { name: "job-a5", mtimeMs: now - 30 * day },
      { name: "job-b6", mtimeMs: now - 30 * day },
      { name: "job-c7", mtimeMs: now - 30 * day },
      { name: "job-d8", mtimeMs: now - 30 * day },
      { name: "manual-makefile", mtimeMs: now - 100 * day },
      { name: "cache.aux", mtimeMs: now - 100 * day },
    ];
    const collected = collectableBuildJobNames(entries, { now });
    expect(collected).toEqual(["job-d8"]);
    expect(collected).not.toContain("manual-makefile");
    expect(collected).not.toContain("cache.aux");
  });

  it("is deterministic when mtimes tie", () => {
    const entries = Array.from({ length: 6 }, (_, index) => ({
      name: `job-${index}`,
      mtimeMs: now - 30 * day,
    }));
    expect(collectableBuildJobNames(entries, { now })).toEqual(["job-5"]);
  });
});

describe("parseHistoryIndexReferencedPaths", () => {
  it("parses a bare snapshot array", () => {
    const content = JSON.stringify([
      { contentPath: ".latexdo/history/snapshots/a.txt" },
      { contentPath: ".latexdo/history/snapshots/b.txt" },
    ]);
    expect(parseHistoryIndexReferencedPaths(content)).toEqual(
      new Set([".latexdo/history/snapshots/a.txt", ".latexdo/history/snapshots/b.txt"]),
    );
  });

  it("parses the schema-versioned index object", () => {
    const content = JSON.stringify({
      schemaVersion: 2,
      snapshots: [{ contentPath: "./.latexdo/history/snapshots/c.txt" }],
    });
    expect(parseHistoryIndexReferencedPaths(content)).toEqual(
      new Set([".latexdo/history/snapshots/c.txt"]),
    );
  });

  it("normalizes backslashes, leading slashes, and ignores malformed entries", () => {
    const content = JSON.stringify({
      snapshots: [
        { contentPath: "\\.latexdo\\history\\snapshots\\d.txt" },
        { contentPath: 42 },
        {},
      ],
    });
    expect(parseHistoryIndexReferencedPaths(content)).toEqual(
      new Set([".latexdo/history/snapshots/d.txt"]),
    );
  });

  it("returns an empty set for invalid JSON", () => {
    expect(parseHistoryIndexReferencedPaths("{nope")).toEqual(new Set());
  });
});

describe("collectableSnapshotFileNames", () => {
  const referenced = new Set([
    ".latexdo/history/snapshots/referenced-full.txt",
    ".latexdo/history/snapshots/referenced-bare.txt",
  ]);

  it("never collects a file the history index still references", () => {
    const entries = [
      { name: "referenced-full.txt", mtimeMs: now - 90 * day },
      { name: "referenced-bare.txt", mtimeMs: now - 90 * day },
      { name: "orphan.txt", mtimeMs: now - 90 * day },
    ];
    const collected = collectableSnapshotFileNames(entries, referenced, {
      graceMs: 7 * day,
      now,
    });
    expect(collected).toEqual(["orphan.txt"]);
  });

  it("keeps unreferenced files within the grace period", () => {
    const entries = [
      { name: "orphan-young.txt", mtimeMs: now - 2 * hour },
      { name: "orphan-old.txt", mtimeMs: now - 30 * day },
    ];
    const collected = collectableSnapshotFileNames(entries, new Set(), {
      graceMs: 7 * day,
      now,
    });
    expect(collected).toEqual(["orphan-old.txt"]);
  });

  it("ignores files that are not app-managed snapshot names", () => {
    const entries = [
      { name: "archive.backup.txt", mtimeMs: now - 90 * day },
      { name: "orphan 1.txt", mtimeMs: now - 90 * day },
      { name: "orphan.txt", mtimeMs: now - 90 * day },
    ];
    const collected = collectableSnapshotFileNames(entries, new Set(), {
      graceMs: 7 * day,
      now,
    });
    expect(collected).toEqual(["orphan.txt"]);
  });
});

describe("collectProjectGarbage", () => {
  it("removes stale build jobs and orphan snapshots while protecting live data", async () => {
    await withTempProject(async (projectRoot) => {
      const buildDirectory = path.join(projectRoot, ".latexdo", "build");
      const snapshotsDirectory = path.join(
        projectRoot,
        ".latexdo",
        "history",
        "snapshots",
      );
      await mkdir(buildDirectory, { recursive: true });
      await mkdir(snapshotsDirectory, { recursive: true });

      const keptRecent = ["job-11aa", "job-11bb"];
      const collected = ["job-11cc", "job-11dd", "job-11ee"];
      const asyCollected = ["asy-11ff"];
      const keptYoung = ["job-00aa", "job-00bb"];
      const notManaged = "user-thing";

      for (const name of [...keptRecent, ...collected, ...asyCollected, ...keptYoung]) {
        await mkdir(path.join(buildDirectory, name));
      }
      await mkdir(path.join(buildDirectory, notManaged));
      await touch(path.join(buildDirectory, keptRecent[0]), 3 * hour);
      await touch(path.join(buildDirectory, keptRecent[1]), 4 * hour);
      await touch(path.join(buildDirectory, collected[0]), 40 * day);
      await touch(path.join(buildDirectory, collected[1]), 41 * day);
      await touch(path.join(buildDirectory, collected[2]), 42 * day);
      await touch(path.join(buildDirectory, asyCollected[0]), 43 * day);
      await touch(path.join(buildDirectory, keptYoung[0]), 5 * minute);
      await touch(path.join(buildDirectory, keptYoung[1]), 10 * minute);
      await touch(path.join(buildDirectory, notManaged), 90 * day);

      const referencedOld = "referenced-old.txt";
      await writeFile(path.join(snapshotsDirectory, referencedOld), "old ref");
      await touch(path.join(snapshotsDirectory, referencedOld), 90 * day);
      const referencedYoung = "referenced-young.txt";
      await writeFile(path.join(snapshotsDirectory, referencedYoung), "young ref");
      await touch(path.join(snapshotsDirectory, referencedYoung), 1 * hour);
      const orphanOld = "orphan-old.txt";
      await writeFile(path.join(snapshotsDirectory, orphanOld), "orphan");
      await touch(path.join(snapshotsDirectory, orphanOld), 90 * day);
      const orphanYoung = "orphan-young.txt";
      await writeFile(path.join(snapshotsDirectory, orphanYoung), "orphan");
      await touch(path.join(snapshotsDirectory, orphanYoung), 2 * hour);

      await mkdir(path.join(projectRoot, ".latexdo", "history"), { recursive: true });
      await writeFile(
        path.join(projectRoot, ".latexdo", "history", "recent.json"),
        JSON.stringify({
          schemaVersion: 2,
          snapshots: [
            { contentPath: `.latexdo/history/snapshots/${referencedOld}` },
            { contentPath: `.latexdo/history/snapshots/${referencedYoung}` },
          ],
        }),
      );

      const stats = await collectProjectGarbage(projectRoot, {
        now: () => now,
        buildPolicy: { keepRecent: 5, minAgeMs: 30 * minute },
        orphanHistoryGraceMs: 7 * day,
      });

      // The five newest matched jobs are retained regardless of age (the two
      // fresh jobs, the two recent jobs, and the least-stale of the four old
      // ones), so exactly the three remaining stale jobs and the stale asy job
      // are removed.
      const expectedBuildCollects = [...collected.slice(1), asyCollected[0]];
      expect(stats.collectedBuildJobs).toEqual(
        expect.arrayContaining(expectedBuildCollects),
      );
      expect(stats.collectedBuildJobs).toHaveLength(3);
      expect(stats.collectedSnapshots).toEqual([orphanOld]);
      expect(stats.freedSnapshotBytes).toBe(6);

      for (const name of [...keptRecent, ...keptYoung, collected[0], notManaged]) {
        await expect(access(path.join(buildDirectory, name))).resolves.not.toThrow();
      }
      for (const name of expectedBuildCollects) {
        await expect(access(path.join(buildDirectory, name))).rejects.toThrow();
      }

      for (const name of [referencedOld, referencedYoung, orphanYoung]) {
        await expect(
          access(path.join(snapshotsDirectory, name)),
        ).resolves.not.toThrow();
      }
      await expect(access(path.join(snapshotsDirectory, orphanOld))).rejects.toThrow();
    });
  });

  it("skips snapshot collection entirely when the history index is missing", async () => {
    await withTempProject(async (projectRoot) => {
      const snapshotsDirectory = path.join(
        projectRoot,
        ".latexdo",
        "history",
        "snapshots",
      );
      await mkdir(snapshotsDirectory, { recursive: true });
      await writeFile(path.join(snapshotsDirectory, "orphan.txt"), "orphan");
      await touch(path.join(snapshotsDirectory, "orphan.txt"), 90 * day);

      const stats = await collectProjectGarbage(projectRoot, {
        now: () => now,
        orphanHistoryGraceMs: 7 * day,
      });

      expect(stats.skippedHistoryIndex).toBe(true);
      await expect(
        access(path.join(snapshotsDirectory, "orphan.txt")),
      ).resolves.not.toThrow();
    });
  });

  it("skips snapshot collection when the history index is malformed", async () => {
    await withTempProject(async (projectRoot) => {
      const snapshotsDirectory = path.join(
        projectRoot,
        ".latexdo",
        "history",
        "snapshots",
      );
      await mkdir(snapshotsDirectory, { recursive: true });
      await writeFile(path.join(snapshotsDirectory, "orphan.txt"), "orphan");
      await touch(path.join(snapshotsDirectory, "orphan.txt"), 90 * day);
      await writeFile(
        path.join(projectRoot, ".latexdo", "history", "recent.json"),
        "{not-json",
      );

      const stats = await collectProjectGarbage(projectRoot, {
        now: () => now,
        orphanHistoryGraceMs: 7 * day,
      });

      expect(stats.skippedHistoryIndex).toBe(true);
      expect(stats.collectedSnapshots).toEqual([]);
      await expect(
        access(path.join(snapshotsDirectory, "orphan.txt")),
      ).resolves.not.toThrow();
    });
  });

  it("does not remove directories that look like snapshot file names", async () => {
    await withTempProject(async (projectRoot) => {
      const snapshotsDirectory = path.join(
        projectRoot,
        ".latexdo",
        "history",
        "snapshots",
      );
      const directorySnapshot = path.join(snapshotsDirectory, "folder.txt");
      await mkdir(directorySnapshot, { recursive: true });
      await writeFile(path.join(directorySnapshot, "nested.txt"), "keep me");
      await touch(directorySnapshot, 90 * day);
      await writeFile(
        path.join(projectRoot, ".latexdo", "history", "recent.json"),
        JSON.stringify({ schemaVersion: 2, snapshots: [] }),
      );

      const stats = await collectProjectGarbage(projectRoot, {
        now: () => now,
        orphanHistoryGraceMs: 7 * day,
      });

      expect(stats.collectedSnapshots).toEqual([]);
      await expect(access(directorySnapshot)).resolves.not.toThrow();
      await expect(
        access(path.join(directorySnapshot, "nested.txt")),
      ).resolves.not.toThrow();
    });
  });

  it("tolerates a project with no .latexdo directory at all", async () => {
    await withTempProject(async (projectRoot) => {
      const stats = await collectProjectGarbage(projectRoot, { now: () => now });
      expect(stats.collectedBuildJobs).toEqual([]);
      expect(stats.collectedSnapshots).toEqual([]);
    });
  });
});

describe("enforceBuildSizeBudget", () => {
  function entry(name: string, ageMs: number, sizeBytes?: number) {
    return { name, mtimeMs: now - ageMs, sizeBytes };
  }

  it("returns nothing when the retained set fits the budget", () => {
    const entries = [
      entry("job-11aa", 5 * minute, 10_000),
      entry("job-11bb", 10 * minute, 10_000),
      entry("job-11cc", 15 * minute, 10_000),
    ];
    const evicted = enforceBuildSizeBudget(
      entries,
      entries.map(({ name }) => name),
      { maxTotalBytes: 100_000 },
    );
    expect(evicted).toEqual([]);
  });

  it("evicts the oldest retained jobs beyond the floor until the budget fits", () => {
    const entries = Array.from({ length: 7 }, (_, index) =>
      entry(`job-11b${index}`, 5 * minute + index * minute, 60_000),
    );
    const allNames = entries.map(({ name }) => name);
    const evicted = enforceBuildSizeBudget(entries, allNames, {
      keepRecent: 5,
      maxTotalBytes: 200_000,
    });
    expect(evicted).toEqual(["job-11b6", "job-11b5"]);
  });

  it("never evicts below the keepRecent floor", () => {
    const entries = Array.from({ length: 7 }, (_, index) =>
      entry(`job-11c${index}`, 5 * minute + index * minute, 1_000_000),
    );
    const evicted = enforceBuildSizeBudget(
      entries,
      entries.map(({ name }) => name),
      { keepRecent: 5, maxTotalBytes: 1 },
    );
    expect(evicted).toEqual(["job-11c6", "job-11c5"]);
  });

  it("ignores entries whose size is unknown", () => {
    const entries = Array.from({ length: 7 }, (_, index) =>
      entry(`job-11d${index}`, 5 * minute + index * minute),
    );
    const evicted = enforceBuildSizeBudget(
      entries,
      entries.map(({ name }) => name),
      { keepRecent: 5, maxTotalBytes: 1 },
    );
    expect(evicted).toEqual([]);
  });
});

describe("collectProjectGarbage with a size budget", () => {
  const buildDirectory = (projectRoot: string) =>
    path.join(projectRoot, ".latexdo", "build");

  async function writeYoungJob(
    projectRoot: string,
    name: string,
    bytes: number,
  ): Promise<void> {
    const directory = path.join(buildDirectory(projectRoot), name);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "main.pdf"), "x".repeat(bytes));
    await touch(directory, 10 * minute);
  }

  it("walks nested files, evicts beyond-floor retained jobs, and reports freed bytes", async () => {
    await withTempProject(async (projectRoot) => {
      await mkdir(buildDirectory(projectRoot), { recursive: true });
      await writeYoungJob(projectRoot, "job-110", 60_000);
      await writeYoungJob(projectRoot, "job-111", 60_000);
      await writeYoungJob(projectRoot, "job-112", 60_000);
      await writeYoungJob(projectRoot, "job-113", 60_000);
      await writeYoungJob(projectRoot, "job-114", 60_000);
      await writeYoungJob(projectRoot, "job-115", 30_000);
      await mkdir(path.join(buildDirectory(projectRoot), "job-115", "aux"));
      await writeFile(
        path.join(buildDirectory(projectRoot), "job-115", "aux", "out.aux"),
        "x".repeat(10_000),
      );
      await touch(path.join(buildDirectory(projectRoot), "job-115"), 10 * minute);
      await writeYoungJob(projectRoot, "job-116", 40_000);

      const stats = await collectProjectGarbage(projectRoot, {
        now: () => now,
        buildPolicy: { keepRecent: 5, minAgeMs: 30 * minute, maxTotalBytes: 200_000 },
      });

      expect(stats.collectedBuildJobs).toEqual(["job-115", "job-116"]);
      expect(stats.freedBuildBytes).toBe(80_000);
      await expect(
        access(path.join(buildDirectory(projectRoot), "job-110")),
      ).resolves.not.toThrow();
      await expect(
        access(path.join(buildDirectory(projectRoot), "job-115")),
      ).rejects.toThrow();
    });
  });

  it("does not walk for sizes when the budget is not requested", async () => {
    await withTempProject(async (projectRoot) => {
      await mkdir(buildDirectory(projectRoot), { recursive: true });
      await writeYoungJob(projectRoot, "job-110", 60_000);
      await writeYoungJob(projectRoot, "job-116", 40_000);

      const stats = await collectProjectGarbage(projectRoot, {
        now: () => now,
        buildPolicy: { keepRecent: 5, minAgeMs: 30 * minute },
      });

      expect(stats.collectedBuildJobs).toEqual([]);
      expect(stats.freedBuildBytes).toBe(0);
    });
  });

  it("reports freed bytes for stale jobs when a budget asks for size accounting", async () => {
    await withTempProject(async (projectRoot) => {
      await mkdir(buildDirectory(projectRoot), { recursive: true });
      for (let index = 0; index < 6; index += 1) {
        const name = `job-12${index}`;
        const directory = path.join(buildDirectory(projectRoot), name);
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, "main.pdf"), "x".repeat(12_345));
        await touch(directory, (40 + index) * day);
      }

      const stats = await collectProjectGarbage(projectRoot, {
        now: () => now,
        buildPolicy: {
          keepRecent: 5,
          minAgeMs: 30 * minute,
          maxTotalBytes: 1_000_000,
        },
      });

      expect(stats.collectedBuildJobs).toEqual(["job-125"]);
      expect(stats.freedBuildBytes).toBe(12_345);
    });
  });
});

describe("createGarbageCollector collectNow", () => {
  function createCollector(overrides: Partial<GarbageCollectorOptions> = {}) {
    return createGarbageCollector({
      getProjectRoot: () => {
        throw new Error("no project");
      },
      hasActiveCompiles: () => false,
      ...overrides,
    });
  }

  it("returns compile-in-progress stats while a compile is active", async () => {
    const collector = createCollector({ hasActiveCompiles: () => true });
    const stats = await collector.collectNow("proj-1");
    expect(stats?.skippedReason).toBe("compile-in-progress");
    expect(stats?.collectedBuildJobs).toEqual([]);
    collector.dispose();
  });

  it("returns project-not-open stats when the project cannot be resolved", async () => {
    const collector = createCollector({
      getProjectRoot: () => {
        throw new Error("not open");
      },
    });
    const stats = await collector.collectNow("proj-1");
    expect(stats?.skippedReason).toBe("project-not-open");
    collector.dispose();
  });

  it("returns null when a collection is already in flight", async () => {
    let unblock!: () => void;
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const hangingFs = {
      readdir: async () => {
        await gate;
        return [];
      },
      readFile: () => Promise.resolve(""),
      stat: () => Promise.resolve({ isDirectory: () => false, mtimeMs: 0 }),
      rm: () => Promise.resolve(),
    };
    const collector = createCollector({
      getProjectRoot: () => path.join(os.tmpdir(), "something"),
      fs: hangingFs,
    });
    const first = collector.collectNow("proj-1");
    const second = await collector.collectNow("proj-1");
    expect(second).toBeNull();
    unblock();
    await first;
    collector.dispose();
  });

  it("returns null after dispose", async () => {
    const collector = createCollector();
    collector.dispose();
    await expect(collector.collectNow("proj-1")).resolves.toBeNull();
  });

  it("applies a manual size budget end to end", async () => {
    await withTempProject(async (projectRoot) => {
      const buildDir = path.join(projectRoot, ".latexdo", "build");
      await mkdir(buildDir, { recursive: true });
      for (const name of [
        "job-110",
        "job-111",
        "job-112",
        "job-113",
        "job-114",
        "job-115",
        "job-116",
      ]) {
        await mkdir(path.join(buildDir, name));
        await writeFile(path.join(buildDir, name, "main.pdf"), "x".repeat(60_000));
        await touch(path.join(buildDir, name), 10 * minute);
      }

      const collector = createCollector({
        getProjectRoot: () => projectRoot,
        now: () => now,
      });
      const stats = await collector.collectNow("proj-1", {
        buildPolicy: { keepRecent: 5, minAgeMs: 30 * minute, maxTotalBytes: 200_000 },
      });

      expect(stats?.collectedBuildJobs).toEqual(["job-115", "job-116"]);
      expect(stats?.freedBuildBytes).toBe(120_000);
      collector.dispose();
    });
  });

  it("collects every root returned for a multi-folder project", async () => {
    await withTempProject(async (firstRoot) => {
      await withTempProject(async (secondRoot) => {
        for (const [projectRoot, jobName] of [
          [firstRoot, "job-a1"],
          [secondRoot, "job-b2"],
        ] as const) {
          const buildDir = path.join(projectRoot, ".latexdo", "build", jobName);
          await mkdir(buildDir, { recursive: true });
          await writeFile(path.join(buildDir, "main.pdf"), "x");
          await touch(buildDir, 40 * day);
        }

        const collector = createCollector({
          getProjectRoot: () => firstRoot,
          getProjectRoots: () => [firstRoot, secondRoot],
          now: () => now,
        });
        const stats = await collector.collectNow("space-1", {
          buildPolicy: {
            keepRecent: 0,
            minAgeMs: 30 * minute,
            maxTotalBytes: 1_000_000,
          },
        });

        expect(stats?.projectRoots).toEqual([firstRoot, secondRoot]);
        expect(stats?.collectedBuildJobs).toEqual([
          `${path.basename(firstRoot)}/job-a1`,
          `${path.basename(secondRoot)}/job-b2`,
        ]);
        expect(stats?.freedBuildBytes).toBe(2);
        await expect(
          access(path.join(firstRoot, ".latexdo", "build", "job-a1")),
        ).rejects.toThrow();
        await expect(
          access(path.join(secondRoot, ".latexdo", "build", "job-b2")),
        ).rejects.toThrow();
        collector.dispose();
      });
    });
  });
});
