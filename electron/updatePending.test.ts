import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  beginPendingUpdate,
  describePendingUpdate,
  loadPendingUpdate,
  markPendingUpdateConfirmed,
  markPendingUpdateFailed,
  maxPendingUpdateAttempts,
  pendingUpdateAttemptLimitReached,
  resolutionFromRecord,
  resolvePendingUpdate,
  type PendingUpdateRecord,
} from "./updatePending.js";

let dataDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "latexdo-update-pending-"));
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

describe("beginPendingUpdate", () => {
  it("cleans up a failed atomic replacement without damaging the existing target", async () => {
    const directory = await temporaryDirectory();
    const target = path.join(directory, "pending-update.json");
    await mkdir(target);
    await writeFile(path.join(target, "preserved"), "original data");
    await expect(
      beginPendingUpdate(directory, {
        fromVersion: "0.2.0",
        expectedVersion: "0.3.0",
        installerSha256: "abc123",
      }),
    ).rejects.toThrow();
    expect(await readdir(directory)).toEqual(["pending-update.json"]);
    expect(await readFile(path.join(target, "preserved"), "utf8")).toBe(
      "original data",
    );
  });
  it("writes an installing record", async () => {
    const directory = await temporaryDirectory();
    const record = await beginPendingUpdate(directory, {
      fromVersion: "0.2.0",
      expectedVersion: "0.3.0",
      installerSha256: "abc123",
    });

    expect(record.state).toBe("installing");
    expect(record.fromVersion).toBe("0.2.0");
    expect(record.expectedVersion).toBe("0.3.0");
    expect(record.installerSha256).toBe("abc123");
    expect(record.attempts).toBe(0);

    const loaded = await loadPendingUpdate(directory);
    expect(loaded?.state).toBe("installing");
    expect(loaded?.expectedVersion).toBe("0.3.0");
  });

  it("carries attempt count over for the same expected version", async () => {
    const directory = await temporaryDirectory();
    let record = await beginPendingUpdate(directory, {
      fromVersion: "0.2.0",
      expectedVersion: "0.3.0",
      installerSha256: "abc123",
    });
    record = await markPendingUpdateFailed(
      directory,
      record,
      "installed-version-mismatch",
    );

    const restarted = await beginPendingUpdate(directory, {
      fromVersion: "0.2.0",
      expectedVersion: "0.3.0",
      installerSha256: "abc123",
    });
    expect(restarted.attempts).toBe(1);

    const differentVersion = await beginPendingUpdate(directory, {
      fromVersion: "0.2.0",
      expectedVersion: "0.4.0",
      installerSha256: "def456",
    });
    expect(differentVersion.attempts).toBe(0);
  });
});

describe("loadPendingUpdate", () => {
  it("returns null when no record exists", async () => {
    const directory = await temporaryDirectory();
    expect(await loadPendingUpdate(directory)).toBeNull();
  });

  it("returns null for invalid content", async () => {
    const directory = await temporaryDirectory();
    await beginPendingUpdate(directory, {
      fromVersion: "0.2.0",
      expectedVersion: "0.3.0",
      installerSha256: "abc123",
    });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(directory, "pending-update.json"), "{ not json", "utf8");
    expect(await loadPendingUpdate(directory)).toBeNull();
  });
});

describe("resolvePendingUpdate", () => {
  it("preserves the pending state when the helper failure report cannot be read", async () => {
    const directory = await temporaryDirectory();
    const record = await beginPendingUpdate(directory, {
      fromVersion: "0.2.0",
      expectedVersion: "0.3.0",
      installerSha256: "abc123",
    });
    // A path beneath a regular file reliably fails with ENOTDIR on all platforms.
    const blocker = path.join(directory, "not-a-directory");
    await writeFile(blocker, "preserved");
    record.failurePath = path.join(blocker, "failure.txt");
    await writeFile(
      path.join(directory, "pending-update.json"),
      JSON.stringify(record),
    );
    await expect(resolvePendingUpdate(directory, "0.3.0")).rejects.toThrow();
    expect(await loadPendingUpdate(directory)).toEqual(record);
  });

  it("does not increment attempts or overwrite evidence when reopening a failed update", async () => {
    const directory = await temporaryDirectory();
    const record = await beginPendingUpdate(directory, {
      fromVersion: "0.2.0",
      expectedVersion: "0.3.0",
      installerSha256: "abc123",
    });
    const failed = await markPendingUpdateFailed(
      directory,
      record,
      "signature invalid",
    );
    for (let i = 0; i < 2; i++) {
      expect(await resolvePendingUpdate(directory, "0.3.0")).toMatchObject({
        status: "failed",
        attempts: 1,
        error: "signature invalid",
      });
    }
    expect(await loadPendingUpdate(directory)).toEqual(failed);
  });

  it("keeps a confirmed update stable across subsequent launches", async () => {
    const directory = await temporaryDirectory();
    await beginPendingUpdate(directory, {
      fromVersion: "0.2.0",
      expectedVersion: "0.3.0",
      installerSha256: "abc123",
    });
    await resolvePendingUpdate(directory, "0.3.0");
    const confirmed = await loadPendingUpdate(directory);
    expect(await resolvePendingUpdate(directory, "0.3.0")).toMatchObject({
      status: "confirmed",
    });
    expect(await loadPendingUpdate(directory)).toEqual(confirmed);
  });
  it("rejects a different installed path even when its version matches", async () => {
    const directory = await temporaryDirectory();
    await beginPendingUpdate(directory, {
      fromVersion: "1.4.0",
      expectedVersion: "1.5.0",
      installerSha256: "abc",
      installedPath: "/Applications/LatexDo.app",
    });
    const result = await resolvePendingUpdate(
      directory,
      "1.5.0",
      "/Downloads/LatexDo.app",
    );
    expect(result.status).toBe("failed");
    expect(result.error).toBe("installed-application-path-mismatch");
  });

  it("surfaces helper failures even if the running version matches", async () => {
    const directory = await temporaryDirectory();
    const record = await beginPendingUpdate(directory, {
      fromVersion: "1.4.0",
      expectedVersion: "1.5.0",
      installerSha256: "abc",
    });
    await writeFile(
      record.failurePath!,
      "Update failed: could not verify installed files",
    );
    const result = await resolvePendingUpdate(directory, "1.5.0");
    expect(result.status).toBe("failed");
    expect(result.error).toContain("could not verify installed files");
  });

  it("confirms when the running version matches the expected version", async () => {
    const directory = await temporaryDirectory();
    await beginPendingUpdate(directory, {
      fromVersion: "0.2.0",
      expectedVersion: "0.3.0",
      installerSha256: "abc123",
    });

    const resolution = await resolvePendingUpdate(directory, "v0.3.0");
    expect(resolution.status).toBe("confirmed");
    expect(resolution.currentVersion).toBe("v0.3.0");
    expect(resolution.expectedVersion).toBe("0.3.0");
    expect(resolution.fromVersion).toBe("0.2.0");

    const reloaded = await loadPendingUpdate(directory);
    expect(reloaded?.state).toBe("confirmed");
  });

  it("fails when the running version does not match the expected version", async () => {
    const directory = await temporaryDirectory();
    await beginPendingUpdate(directory, {
      fromVersion: "0.2.0",
      expectedVersion: "0.3.0",
      installerSha256: "abc123",
    });

    const resolution = await resolvePendingUpdate(directory, "0.2.0");
    expect(resolution.status).toBe("failed");
    expect(resolution.error).toBe("installed-version-mismatch");
    expect(resolution.attempts).toBe(1);
    expect(resolution.currentVersion).toBe("0.2.0");

    const reloaded = await loadPendingUpdate(directory);
    expect(reloaded?.state).toBe("failed");
  });

  it("invalidates a previous confirmation when an old build is reopened", async () => {
    const directory = await temporaryDirectory();
    let record = await beginPendingUpdate(directory, {
      fromVersion: "0.2.0",
      expectedVersion: "0.3.0",
      installerSha256: "abc123",
    });
    record = await markPendingUpdateConfirmed(directory, record);

    const resolution = await resolvePendingUpdate(directory, "0.0.1");
    expect(resolution.status).toBe("failed");
    expect((await loadPendingUpdate(directory))?.state).toBe("failed");
  });

  it("returns a none resolution when no record exists", async () => {
    const directory = await temporaryDirectory();
    const resolution = await resolvePendingUpdate(directory, "0.3.0");
    expect(resolution.status).toBe("none");
    expect(resolution.expectedVersion).toBeNull();
  });
});

describe("pendingUpdateAttemptLimitReached", () => {
  it("is true after the configured threshold for the same expected version", async () => {
    const directory = await temporaryDirectory();
    let record = await beginPendingUpdate(directory, {
      fromVersion: "0.2.0",
      expectedVersion: "0.3.0",
      installerSha256: "abc123",
    });
    for (let attempt = 0; attempt < maxPendingUpdateAttempts; attempt += 1) {
      record = await markPendingUpdateFailed(
        directory,
        record,
        "installed-version-mismatch",
      );
    }

    expect(pendingUpdateAttemptLimitReached(record, "0.3.0")).toBe(true);
    expect(pendingUpdateAttemptLimitReached(record, "0.4.0")).toBe(false);
  });

  it("is false for installing records and missing records", async () => {
    const directory = await temporaryDirectory();
    const record = await beginPendingUpdate(directory, {
      fromVersion: "0.2.0",
      expectedVersion: "0.3.0",
      installerSha256: "abc123",
    });
    expect(pendingUpdateAttemptLimitReached(record, "0.3.0")).toBe(false);
    expect(pendingUpdateAttemptLimitReached(null, "0.3.0")).toBe(false);
  });
});

describe("resolutionFromRecord", () => {
  it("maps record states onto update attempt resolutions", () => {
    const record: PendingUpdateRecord = {
      schemaVersion: 1,
      fromVersion: "0.2.0",
      expectedVersion: "0.3.0",
      installerSha256: "abc123",
      startedAt: "2026-01-01T00:00:00.000Z",
      state: "installing",
      attempts: 0,
    };
    const resolution = resolutionFromRecord(record, "0.2.0");
    expect(resolution.status).toBe("installing");
    expect(resolution.attemptedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("describePendingUpdate", () => {
  it("describes a failed record without mutating it", async () => {
    const directory = await temporaryDirectory();
    let record = await beginPendingUpdate(directory, {
      fromVersion: "0.2.0",
      expectedVersion: "0.3.0",
      installerSha256: "abc123",
    });
    record = await markPendingUpdateFailed(
      directory,
      record,
      "installed-version-mismatch",
    );

    const resolution = await describePendingUpdate(directory, "0.3.0");
    expect(resolution.status).toBe("failed");
    expect(record.attempts).toBe(1);
    expect((await loadPendingUpdate(directory))?.state).toBe("failed");
  });
});

describe("same-version builds", () => {
  const oldCommit = "a".repeat(40);
  const newCommit = "b".repeat(40);
  const begin = (directory: string) =>
    beginPendingUpdate(directory, {
      fromVersion: "0.3.0",
      expectedVersion: "0.3.0",
      expectedCommit: newCommit,
      installerSha256: "c".repeat(64),
    });

  it("confirms only when the relaunched app is the expected build", async () => {
    const directory = await temporaryDirectory();
    await begin(directory);
    const resolution = await resolvePendingUpdate(
      directory,
      "0.3.0",
      undefined,
      newCommit,
    );
    expect(resolution.status).toBe("confirmed");
  });

  it("fails when the old build is still running after the update", async () => {
    const directory = await temporaryDirectory();
    await begin(directory);
    const resolution = await resolvePendingUpdate(
      directory,
      "0.3.0",
      undefined,
      oldCommit,
    );
    expect(resolution).toMatchObject({
      status: "failed",
      error: "installed-build-mismatch",
    });
  });

  it("does not let failures of one build block the next build", async () => {
    const directory = await temporaryDirectory();
    let record = await begin(directory);
    for (let attempt = 0; attempt < maxPendingUpdateAttempts; attempt += 1) {
      record = await markPendingUpdateFailed(directory, record, "failed");
    }
    expect(pendingUpdateAttemptLimitReached(record, "0.3.0", newCommit)).toBe(true);
    expect(pendingUpdateAttemptLimitReached(record, "0.3.0", "d".repeat(40))).toBe(
      false,
    );
  });
});
