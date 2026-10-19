import { describe, expect, it } from "vitest";
import { EditHistoryStore, originCanTeach } from "./editHistory";
import { EDIT_TTL_MS, type NormalizedEdit } from "./nextEditTypes";

function edit(
  id: string,
  timestamp: number,
  overrides: Partial<NormalizedEdit> = {},
): NormalizedEdit {
  return {
    id,
    documentKey: "doc",
    revisionBefore: 0,
    revisionAfter: 1,
    origin: "user",
    startOffsetBefore: 0,
    endOffsetBefore: 0,
    oldText: "",
    newText: "x",
    beforeContext: "",
    afterContext: "",
    cursorOffsetAfter: 1,
    timestamp,
    ...overrides,
  };
}

describe("EditHistoryStore", () => {
  it("creates an empty session on first access and reuses it", () => {
    const store = new EditHistoryStore(() => 1000);
    const session = store.get("doc");
    expect(session).toMatchObject({ documentKey: "doc", revision: 0, recentEdits: [] });
    expect(store.get("doc")).toBe(session);
  });

  it("uses Date.now by default", () => {
    const store = new EditHistoryStore();
    store.recordEdit(edit("a", Date.now()));
    expect(store.get("doc").recentEdits).toHaveLength(1);
  });

  it("only ever moves the revision forward", () => {
    const store = new EditHistoryStore(() => 0);
    expect(store.updateRevision("doc", 5).revision).toBe(5);
    expect(store.updateRevision("doc", 3).revision).toBe(5);
    store.recordEdit(edit("a", 0, { revisionAfter: 2 }));
    expect(store.get("doc").revision).toBe(5);
    store.recordEdit(edit("b", 0, { revisionAfter: 9 }));
    expect(store.get("doc").revision).toBe(9);
  });

  it("keeps only the most recent edits within the limit", () => {
    const store = new EditHistoryStore(() => 100, 2);
    for (const id of ["a", "b", "c"]) store.recordEdit(edit(id, 100));
    expect(store.get("doc").recentEdits.map((e) => e.id)).toEqual(["b", "c"]);
  });

  it("drops edits and dismissals older than the TTL", () => {
    let now = 0;
    const store = new EditHistoryStore(() => now);
    store.recordEdit(edit("old", 0));
    store.recordDismissed("doc", "pattern-old");
    store.recordDismissed("doc", "pattern-new", EDIT_TTL_MS + 5);
    now = EDIT_TTL_MS + 1;
    store.recordEdit(edit("new", now));
    const session = store.get("doc");
    expect(session.recentEdits.map((e) => e.id)).toEqual(["new"]);
    expect([...session.dismissedPatternIds.keys()]).toEqual(["pattern-new"]);
  });

  it("tracks accepted predictions and returns only manual edits", () => {
    const store = new EditHistoryStore(() => 10);
    store.recordAccepted("doc", "candidate-1");
    store.recordEdit(edit("typed", 10));
    store.recordEdit(edit("predicted", 10, { origin: "next-edit" }));
    expect(store.get("doc").acceptedPredictionIds.has("candidate-1")).toBe(true);
    expect(store.recentManualEdits("doc").map((e) => e.id)).toEqual(["typed"]);
  });

  it("forgets one document or all documents", () => {
    const store = new EditHistoryStore(() => 10);
    store.recordEdit(edit("a", 10));
    store.recordEdit(edit("b", 10, { documentKey: "other" }));
    store.disposeDocument("doc");
    expect(store.get("doc").recentEdits).toEqual([]);
    expect(store.get("other").recentEdits).toHaveLength(1);
    store.clear();
    expect(store.get("other").recentEdits).toEqual([]);
  });
});

describe("originCanTeach", () => {
  it("learns only from user edits", () => {
    expect(originCanTeach("user")).toBe(true);
    expect(originCanTeach("next-edit")).toBe(false);
  });
});
