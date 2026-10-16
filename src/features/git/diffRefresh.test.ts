import { describe, expect, it } from "vitest";
import type { GitDiffSession } from "../../types";
import { reconcileDiffRefresh } from "./diffRefresh";

const current: GitDiffSession = {
  id: "open-session",
  relativePath: "main.tex",
  originalRef: { kind: "index" },
  modifiedRef: { kind: "working-tree" },
  originalContent: "old",
  modifiedContent: "new",
  originalLabel: "Index",
  modifiedLabel: "Working Tree",
  status: "modified",
  language: "latex",
};

describe("background diff refresh (#245)", () => {
  it("ignores fresh IPC identifiers when nothing changed", () => {
    expect(
      reconcileDiffRefresh(current, structuredClone({ ...current, id: "new-id" })),
    ).toBe(current);
  });
  it("updates changed content without remounting the editor", () => {
    const next = reconcileDiffRefresh(current, {
      ...current,
      id: "new-id",
      modifiedContent: "edited",
    });
    expect(next.id).toBe(current.id);
    expect(next.modifiedContent).toBe("edited");
    expect(current.modifiedContent).toBe("new");
  });
  it("updates revision metadata and binary fallback state", () => {
    const next = reconcileDiffRefresh(current, {
      ...current,
      id: "new-id",
      binary: true,
      originalRef: { kind: "commit", hash: "abc" },
    });
    expect(next.binary).toBe(true);
    expect(next.originalRef).toEqual({ kind: "commit", hash: "abc" });
  });
});
