import { describe, expect, it } from "vitest";
import type { UpdateAttemptResolution, UpdateDownloadProgress } from "../../types";
import {
  formatBuildLabel,
  formatUpdateAttempt,
  formatUpdateBytes,
  formatUpdateDate,
  formatUpdateLocation,
  formatUpdateProgress,
  updateIdentity,
} from "./updateFormatting";

const progress = (patch: Partial<UpdateDownloadProgress>): UpdateDownloadProgress =>
  ({
    status: "downloading",
    percent: null,
    transferredBytes: 0,
    totalBytes: null,
    ...patch,
  }) as UpdateDownloadProgress;

const attempt = (patch: Partial<UpdateAttemptResolution>): UpdateAttemptResolution => ({
  status: "none",
  currentVersion: "1.0.0",
  expectedVersion: null,
  ...patch,
});

describe("update formatting", () => {
  it("formats dates and rejects missing or invalid ones", () => {
    expect(formatUpdateDate(null)).toBeNull();
    expect(formatUpdateDate("not a date")).toBeNull();
    const expected = new Date("2026-10-19T12:00:00Z").toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    expect(formatUpdateDate("2026-10-19T12:00:00Z")).toBe(expected);
  });

  it("formats locations as host and path", () => {
    expect(formatUpdateLocation(undefined)).toBeNull();
    expect(formatUpdateLocation("::bad")).toBeNull();
    expect(formatUpdateLocation("https://latexdo.org/downloads/a.dmg?x=1")).toBe(
      "latexdo.org/downloads/a.dmg",
    );
  });

  it.each([
    [NaN, "0 B"],
    [-5, "0 B"],
    [0, "0 B"],
    [512, "512 B"],
    [1024, "1 KB"],
    [1536, "1.5 KB"],
    [15 * 1024 + 300, "15 KB"],
    [5 * 1024 ** 3, "5 GB"],
    [2048 * 1024 ** 3, "2048 GB"],
  ])("formats %d bytes as %s", (bytes, text) => {
    expect(formatUpdateBytes(bytes)).toBe(text);
  });

  it("describes download progress", () => {
    expect(formatUpdateProgress(progress({ status: "verifying" }))).toBe(
      "Preparing update",
    );
    expect(
      formatUpdateProgress(progress({ status: "checking", message: "Checking" })),
    ).toBe("Checking");
    expect(formatUpdateProgress(progress({}))).toBe("Preparing update");
    expect(
      formatUpdateProgress(
        progress({
          message: "Downloading",
          percent: 41.6,
          transferredBytes: 1024,
          totalBytes: 2048,
        }),
      ),
    ).toBe("Downloading (42%, 1 KB of 2 KB)");
    expect(formatUpdateProgress(progress({ transferredBytes: 512 }))).toBe(
      "Preparing update (512 B)",
    );
  });

  it("describes update attempts", () => {
    expect(formatUpdateAttempt(attempt({}))).toBeNull();
    expect(formatUpdateAttempt(attempt({ status: "confirmed" }))).toBe(
      "LatexDo was updated to the latest build from the previous build and verified after restart.",
    );
    expect(
      formatUpdateAttempt(
        attempt({
          status: "confirmed",
          expectedVersion: "1.1.0",
          fromVersion: "1.0.0",
        }),
      ),
    ).toBe("LatexDo was updated to 1.1.0 from 1.0.0 and verified after restart.");
    expect(formatUpdateAttempt(attempt({ status: "failed" }))).toBe(
      "Update failed: the update to the latest build could not be verified. LatexDo is still running 1.0.0.",
    );
    expect(
      formatUpdateAttempt(
        attempt({
          status: "failed",
          expectedVersion: "1.1.0",
          attempts: 2,
          error: "hash",
        }),
      ),
    ).toBe(
      "Update failed: the update to 1.1.0 could not be verified. LatexDo is still running 1.0.0. Attempt 2 of 3. Reason: hash",
    );
    expect(formatUpdateAttempt(attempt({ status: "installing" }))).toBe(
      "The update to the latest build is being installed and will be verified after restart.",
    );
    expect(
      formatUpdateAttempt(attempt({ status: "installing", expectedVersion: "2.0.0" })),
    ).toContain("update to 2.0.0");
  });

  it("identifies updates and labels builds", () => {
    expect(updateIdentity({ latestVersion: null })).toBeNull();
    expect(updateIdentity({ latestVersion: "1.0.0" })).toBe("1.0.0");
    expect(updateIdentity({ latestVersion: "1.0.0", latestCommit: "abc" })).toBe(
      "1.0.0+abc",
    );
    expect(formatBuildLabel("1.0.0")).toBe("1.0.0");
    expect(formatBuildLabel("1.0.0", "2f55cb3deadbeef")).toBe("1.0.0 (2f55cb3)");
  });
});
