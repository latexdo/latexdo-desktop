import { describe, expect, it } from "vitest";
import * as ui from "./gitUi";
import type { GitChangeEntry } from "../../types";
function entry(path: string, status: GitChangeEntry["worktreeStatus"]): GitChangeEntry {
  return {
    path,
    indexStatus: status,
    worktreeStatus: status,
    staged: true,
    unstaged: true,
    untracked: false,
    conflicted: false,
  };
}
describe("Git change summaries", () => {
  it.each([
    ["deleted", "D", "Deleted", "deleted"],
    ["renamed", "R", "Renamed", "renamed"],
    ["copied", "C", "Copied", "renamed"],
    ["untracked", "U", "Untracked", "untracked"],
    ["conflicted", "!", "Conflict", "conflict"],
    ["type-changed", "T", "Type changed", "type-changed"],
  ] as const)(
    "labels %s in both index and working tree",
    (status, code, label, style) => {
      for (const area of ["staged", "changes"] as const)
        expect(ui.gitStatusCode(entry("file.tex", status), area)).toBe(code);
      expect(ui.gitStatusLabel(code)).toBe(label);
      expect(ui.gitStatusClass(code)).toBe(style);
    },
  );
  it("groups and sorts numeric paths without changing the original list", () => {
    const entries = [
      entry("part10/a.tex", "added"),
      entry("part2/10.tex", "modified"),
      entry("part2/2.tex", "deleted"),
      entry("main.tex", "modified"),
      entry("part2/3.tex", "modified"),
    ];
    const groups = ui.groupGitChanges(entries, "changes");
    expect(groups.map((g) => g.directory)).toEqual([".", "part2", "part10"]);
    expect(groups[1].entries.map((e) => e.path)).toEqual([
      "part2/2.tex",
      "part2/3.tex",
      "part2/10.tex",
    ]);
    expect(groups[1].statusCounts).toEqual([
      { code: "M", label: "Modified", className: "modified", count: 2 },
      { code: "D", label: "Deleted", className: "deleted", count: 1 },
    ]);
    expect(entries[0].path).toBe("part10/a.tex");
  });
  it.each([
    ["added", "A"],
    ["deleted", "D"],
    ["renamed", "R"],
    ["copied", "C"],
  ] as const)("marks a committed %s file", (status, code) =>
    expect(ui.gitDiffStatusCode(status)).toBe(code),
  );
  it("preserves invalid dates and explains canceled discards", () => {
    expect(ui.formatGitDate("unknown")).toBe("unknown");
    const date = "2026-10-20T12:00:00Z";
    expect(ui.formatGitDate(date)).toBe(
      new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
      }).format(Date.parse(date)),
    );
    expect(ui.gitDiscardStatusMessage({ discarded: false }, "Discarded")).toBe(
      "Discard canceled.",
    );
  });
});
