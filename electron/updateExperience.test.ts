import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  changesBetweenBuilds,
  emptyUpdateExperienceState,
  loadUpdateExperienceState,
  markVersionPresented,
  recordConfirmedUpdate,
  recordLaunchedVersion,
  saveUpdateExperienceState,
  shouldShowWhatsNew,
  updateExperienceStateSchemaVersion,
  type UpdateExperienceState,
} from "./updateExperience.js";

let dataDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "latexdo-update-experience-"));
  dataDirectories.push(directory);
  return directory;
}

beforeEach(() => {
  dataDirectories = [];
});

afterEach(async () => {
  await Promise.all(
    dataDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("update experience state", () => {
  it("starts empty", async () => {
    const directory = await temporaryDirectory();
    const state = await loadUpdateExperienceState(directory);
    expect(state).toEqual({ schemaVersion: updateExperienceStateSchemaVersion });
  });

  it("returns an empty state for malformed files", async () => {
    const directory = await temporaryDirectory();
    await saveUpdateExperienceState(directory, {
      schemaVersion: updateExperienceStateSchemaVersion,
      // @ts-expect-error intentionally invalid shape
      lastConfirmedUpdate: { fromVersion: 42 },
    });
    const state = await loadUpdateExperienceState(directory);
    expect(state).toEqual({ schemaVersion: updateExperienceStateSchemaVersion });
  });

  it("records a confirmed update and persists it", async () => {
    const directory = await temporaryDirectory();
    const snapshot = {
      fromVersion: "0.2.0",
      toVersion: "0.3.0",
      confirmedAt: "2026-03-01T12:00:00.000Z",
    };
    await recordConfirmedUpdate(directory, snapshot);

    const persisted = await readFile(path.join(directory, "update-state.json"), "utf8");
    expect(JSON.parse(persisted)).toEqual({
      schemaVersion: updateExperienceStateSchemaVersion,
      lastConfirmedUpdate: snapshot,
    });

    const state = await loadUpdateExperienceState(directory);
    expect(state.lastConfirmedUpdate).toEqual(snapshot);
  });

  it("replaces the last confirmed update on repeat records", async () => {
    const directory = await temporaryDirectory();
    await recordConfirmedUpdate(directory, {
      fromVersion: "0.2.0",
      toVersion: "0.3.0",
      confirmedAt: "2026-03-01T12:00:00.000Z",
    });
    await recordConfirmedUpdate(directory, {
      fromVersion: "0.3.0",
      toVersion: "0.4.0",
      confirmedAt: "2026-04-01T12:00:00.000Z",
    });
    const state = await loadUpdateExperienceState(directory);
    expect(state.lastConfirmedUpdate?.toVersion).toBe("0.4.0");
  });

  it("marks a version presented and deduplicates equivalent versions", async () => {
    const directory = await temporaryDirectory();
    await markVersionPresented(directory, "0.3.0");
    await markVersionPresented(directory, "v0.3.0");

    const state = await loadUpdateExperienceState(directory);
    expect(state.presentedVersions).toEqual(["0.3.0"]);
    expect(state.lastPresentedVersion).toBe("v0.3.0");
  });
});

describe("shouldShowWhatsNew", () => {
  it("stays hidden without a confirmed update", () => {
    expect(shouldShowWhatsNew("0.3.0", emptyUpdateExperienceState())).toBe(false);
  });

  it("shows after a confirmed upgrade to the running version", () => {
    const state: UpdateExperienceState = {
      schemaVersion: updateExperienceStateSchemaVersion,
      lastConfirmedUpdate: {
        fromVersion: "0.2.0",
        toVersion: "0.3.0",
        confirmedAt: "2026-03-01T12:00:00.000Z",
      },
    };
    expect(shouldShowWhatsNew("0.3.0", state)).toBe(true);
    expect(shouldShowWhatsNew("v0.3.0", state)).toBe(true);
  });

  it("stays hidden when the confirmed target differs from the running version", () => {
    const state: UpdateExperienceState = {
      schemaVersion: updateExperienceStateSchemaVersion,
      lastConfirmedUpdate: {
        fromVersion: "0.2.0",
        toVersion: "0.3.0",
        confirmedAt: "2026-03-01T12:00:00.000Z",
      },
    };
    expect(shouldShowWhatsNew("0.4.0", state)).toBe(false);
  });

  it("stays hidden once a version has been presented", () => {
    const state: UpdateExperienceState = {
      schemaVersion: updateExperienceStateSchemaVersion,
      lastConfirmedUpdate: {
        fromVersion: "0.2.0",
        toVersion: "0.3.0",
        confirmedAt: "2026-03-01T12:00:00.000Z",
      },
      presentedVersions: ["0.3.0"],
    };
    expect(shouldShowWhatsNew("0.3.0", state)).toBe(false);
  });

  it("stays hidden when lastPresentedVersion matches the running version", () => {
    const state: UpdateExperienceState = {
      schemaVersion: updateExperienceStateSchemaVersion,
      lastConfirmedUpdate: {
        fromVersion: "0.2.0",
        toVersion: "0.3.0",
        confirmedAt: "2026-03-01T12:00:00.000Z",
      },
      lastPresentedVersion: "0.3.0",
    };
    expect(shouldShowWhatsNew("0.3.0", state)).toBe(false);
  });
});

describe("recordLaunchedVersion", () => {
  const now = new Date("2026-10-15T12:00:00.000Z");

  it("records nothing on the first launch ever", async () => {
    const directory = await temporaryDirectory();
    const state = await recordLaunchedVersion(directory, "0.3.1", now);
    expect(state.lastRunVersion).toBe("0.3.1");
    expect(state.lastConfirmedUpdate).toBeUndefined();
    expect(shouldShowWhatsNew("0.3.1", state)).toBe(false);
  });

  it("shows release notes after an update installed outside LatexDo", async () => {
    const directory = await temporaryDirectory();
    await recordLaunchedVersion(directory, "0.3.0", now);
    const state = await recordLaunchedVersion(directory, "0.3.1", now);
    expect(state.lastConfirmedUpdate).toEqual({
      fromVersion: "0.3.0",
      toVersion: "0.3.1",
      fromCommit: null,
      toCommit: null,
      confirmedAt: now.toISOString(),
    });
    expect(shouldShowWhatsNew("0.3.1", state)).toBe(true);
  });

  it("keeps an in-app confirmed update and ignores downgrades", async () => {
    const directory = await temporaryDirectory();
    await recordLaunchedVersion(directory, "0.3.0", now);
    const confirmed = {
      fromVersion: "0.2.9",
      toVersion: "0.3.1",
      confirmedAt: "2026-10-14T09:00:00.000Z",
    };
    await recordConfirmedUpdate(directory, confirmed);
    expect(
      (await recordLaunchedVersion(directory, "0.3.1", now)).lastConfirmedUpdate,
    ).toMatchObject(confirmed);
    const downgraded = await recordLaunchedVersion(directory, "0.3.0", now);
    expect(downgraded.lastConfirmedUpdate).toMatchObject(confirmed);
    expect(shouldShowWhatsNew("0.3.0", downgraded)).toBe(false);
  });
});

describe("build updates within one version", () => {
  const now = new Date("2026-10-15T12:00:00.000Z");
  const older = "a".repeat(40);
  const newer = "b".repeat(40);

  it("shows What's New after a newer build of the same version", async () => {
    const directory = await temporaryDirectory();
    await recordLaunchedVersion(directory, "0.3.1", now, { commit: older });
    await markVersionPresented(directory, "0.3.1", older);
    const state = await recordLaunchedVersion(directory, "0.3.1", now, {
      commit: newer,
      history: [newer, older],
    });
    expect(state.lastConfirmedUpdate).toMatchObject({
      fromCommit: older,
      toCommit: newer,
    });
    expect(shouldShowWhatsNew("0.3.1", state, newer)).toBe(true);

    const presented = await markVersionPresented(directory, "0.3.1", newer);
    expect(shouldShowWhatsNew("0.3.1", presented, newer)).toBe(false);
  });

  it("adds the builds to an update the in-app updater confirmed", async () => {
    const directory = await temporaryDirectory();
    await recordLaunchedVersion(directory, "0.3.1", now, { commit: older });
    await markVersionPresented(directory, "0.3.1", older);
    await recordConfirmedUpdate(directory, {
      fromVersion: "0.3.1",
      toVersion: "0.3.1",
      confirmedAt: now.toISOString(),
    });
    const state = await recordLaunchedVersion(directory, "0.3.1", now, {
      commit: newer,
      history: [newer, older],
    });
    expect(state.lastConfirmedUpdate).toMatchObject({
      fromCommit: older,
      toCommit: newer,
    });
    expect(shouldShowWhatsNew("0.3.1", state, newer)).toBe(true);
  });

  it("tags the first in-app update from a build that did not record its commit", async () => {
    const directory = await temporaryDirectory();
    // An earlier LatexDo recorded the version only and already showed 0.3.1.
    await recordLaunchedVersion(directory, "0.3.1", now);
    await markVersionPresented(directory, "0.3.1");
    await recordConfirmedUpdate(directory, {
      fromVersion: "0.3.1",
      toVersion: "0.3.1",
      confirmedAt: now.toISOString(),
    });
    const state = await recordLaunchedVersion(directory, "0.3.1", now, {
      commit: newer,
      history: [newer],
      updaterConfirmed: true,
    });
    expect(state.lastConfirmedUpdate?.toCommit).toBe(newer);
    expect(shouldShowWhatsNew("0.3.1", state, newer)).toBe(true);
  });

  it("ignores an older or unrelated build of the same version", async () => {
    const directory = await temporaryDirectory();
    await recordLaunchedVersion(directory, "0.3.1", now, { commit: newer });
    const state = await recordLaunchedVersion(directory, "0.3.1", now, {
      commit: older,
      history: [older],
    });
    expect(state.lastConfirmedUpdate).toBeUndefined();
    expect(state.lastRunCommit).toBe(older);
  });
});

describe("changesBetweenBuilds", () => {
  const sha = (n: number) => String(n).repeat(40).slice(0, 40);
  const changes = [
    {
      commit: sha(5),
      subject: "feat(editor): complete the sentence being written (#267)",
    },
    { commit: sha(4), subject: "docs: record outcomes" },
    { commit: sha(3), subject: "fix(citations): let the author keep typing" },
    { commit: sha(2), subject: "perf: faster project tree" },
    { commit: sha(1), subject: "fix: older fix already installed" },
  ];

  it("lists user-facing changes since the previous build", () => {
    expect(changesBetweenBuilds(changes, sha(1))).toEqual([
      { kind: "new", text: "Complete the sentence being written" },
      { kind: "fixed", text: "Let the author keep typing" },
      { kind: "improved", text: "Faster project tree" },
    ]);
  });

  it("lists nothing when the previous build is unknown", () => {
    expect(changesBetweenBuilds(changes, null)).toEqual([]);
    expect(changesBetweenBuilds(changes, "f".repeat(40))).toEqual([]);
  });
});

describe("update experience state validation and edge cases", () => {
  async function loadRaw(value: unknown) {
    const directory = await temporaryDirectory();
    await saveUpdateExperienceState(directory, value as UpdateExperienceState);
    return loadUpdateExperienceState(directory);
  }

  it.each([
    ["an array", []],
    ["null", null],
    ["another schema", { schemaVersion: 2 }],
    ["a bad snapshot", { schemaVersion: 1, lastConfirmedUpdate: [] }],
    ["a bad presented version", { schemaVersion: 1, lastPresentedVersion: 3 }],
    ["a bad run version", { schemaVersion: 1, lastRunVersion: 3 }],
    ["a bad run commit", { schemaVersion: 1, lastRunCommit: 3 }],
    ["bad presented builds", { schemaVersion: 1, presentedBuilds: [1] }],
    ["non-array presented versions", { schemaVersion: 1, presentedVersions: "x" }],
    ["bad presented versions", { schemaVersion: 1, presentedVersions: [1] }],
  ])("rejects %s", async (_label, value) => {
    expect(await loadRaw(value)).toEqual(emptyUpdateExperienceState());
  });

  it("accepts a fully populated state", async () => {
    const state: UpdateExperienceState = {
      schemaVersion: 1,
      lastConfirmedUpdate: {
        fromVersion: "1.0.0",
        toVersion: "1.1.0",
        confirmedAt: "2026-01-01T00:00:00.000Z",
      },
      lastPresentedVersion: "1.0.0",
      lastRunVersion: "1.1.0",
      lastRunCommit: "abc",
      presentedBuilds: ["1.0.0+abc"],
      presentedVersions: ["1.0.0"],
    };
    expect(await loadRaw(state)).toEqual(state);
  });

  it("removes the temporary file and rethrows when the rename fails", async () => {
    const directory = await temporaryDirectory();
    const { mkdir, writeFile, readdir } = await import("node:fs/promises");
    // A non-empty directory where the file belongs makes rename fail.
    await mkdir(path.join(directory, "update-state.json", "occupied"), { recursive: true });
    await writeFile(path.join(directory, "update-state.json", "occupied", "x"), "x");
    await expect(
      saveUpdateExperienceState(directory, emptyUpdateExperienceState()),
    ).rejects.toThrow();
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("returns the stored state untouched when the same build relaunches", async () => {
    const directory = await temporaryDirectory();
    await recordLaunchedVersion(directory, "1.0.0", new Date(), { commit: "a" });
    const before = await readFile(path.join(directory, "update-state.json"), "utf8");
    const state = await recordLaunchedVersion(directory, "1.0.0", new Date(), {
      commit: "a",
    });
    expect(state.lastRunCommit).toBe("a");
    expect(await readFile(path.join(directory, "update-state.json"), "utf8")).toBe(before);
  });

  it("does not treat a same-version build without history as an update", async () => {
    const directory = await temporaryDirectory();
    await recordLaunchedVersion(directory, "1.0.0", new Date(), { commit: "a" });
    const state = await recordLaunchedVersion(directory, "1.0.0", new Date(), {
      commit: "b",
    });
    expect(state.lastConfirmedUpdate).toBeUndefined();
    expect(state.lastRunCommit).toBe("b");
  });

  it("ignores an updater record for another build of the version", async () => {
    const directory = await temporaryDirectory();
    await recordLaunchedVersion(directory, "1.0.0", new Date(), { commit: "a" });
    await recordConfirmedUpdate(directory, {
      fromVersion: "1.0.0",
      toVersion: "1.1.0",
      toCommit: "other",
      confirmedAt: "2026-01-01T00:00:00.000Z",
    });
    const now = new Date("2026-02-02T00:00:00.000Z");
    const state = await recordLaunchedVersion(directory, "1.1.0", now, { commit: "c" });
    expect(state.lastConfirmedUpdate).toEqual({
      fromVersion: "1.0.0",
      toVersion: "1.1.0",
      fromCommit: "a",
      toCommit: "c",
      confirmedAt: now.toISOString(),
    });
  });

  it("does not show What's New for a different build of the confirmed version", () => {
    expect(
      shouldShowWhatsNew(
        "1.1.0",
        {
          schemaVersion: 1,
          lastConfirmedUpdate: {
            fromVersion: "1.0.0",
            toVersion: "1.1.0",
            toCommit: "x",
            confirmedAt: "2026-01-01T00:00:00.000Z",
          },
        },
        "y",
      ),
    ).toBe(false);
  });

  it("skips unknown kinds and empty subjects and honours the limit", () => {
    const changes = [
      { commit: "5", subject: "Merge branch main" },
      { commit: "4", subject: "chore: tidy" },
      { commit: "3", subject: "fix: (#12)" },
      { commit: "2", subject: "feat: one" },
      { commit: "1", subject: "perf: two" },
      { commit: "0", subject: "feat: base" },
    ];
    expect(changesBetweenBuilds(changes as never, "0", 1)).toEqual([
      { kind: "new", text: "One" },
    ]);
  });
});
