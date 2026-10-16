// Repeat-edit suggestions must stay cheap while typing in long documents:
// one search per pause, near the cursor, reused until something changes.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextEditController } from "./nextEditController";
import { NEXT_EDIT_SCAN_RADIUS, PatternPredictor } from "./patternPredictor";
import type { DocumentSnapshot, NormalizedEdit } from "./nextEditTypes";

const key = "project:main.tex";

function snapshot(text: string, revision: number): DocumentSnapshot {
  return { documentKey: key, revision, text, language: "latex" };
}

function replace(before: string, start: number, revisionAfter: number): NormalizedEdit {
  return {
    id: `edit-${revisionAfter}`,
    documentKey: key,
    revisionBefore: revisionAfter - 1,
    revisionAfter,
    origin: "user",
    startOffsetBefore: start,
    endOffsetBefore: start + 3,
    oldText: "foo",
    newText: "bar",
    beforeContext: before.slice(Math.max(0, start - 160), start),
    afterContext: before.slice(start + 3, start + 163),
    cursorOffsetAfter: start + 3,
    timestamp: revisionAfter * 100,
  };
}

/** Two "foo" → "bar" edits teach the pattern; the text still has more "foo". */
function learnedDocument(filler: string) {
  const initial = `foo one\nfoo two\nfoo near\n${filler}foo far\n`;
  const first = initial.replace("foo one", "bar one");
  const second = first.replace("foo two", "bar two");
  return {
    initial,
    first,
    second,
    edits: [
      replace(initial, initial.indexOf("foo one"), 2),
      replace(first, first.indexOf("foo two"), 3),
    ],
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("PatternPredictor search window", () => {
  it("searches near the cursor and skips matches far away", () => {
    const filler = "x".repeat(NEXT_EDIT_SCAN_RADIUS * 3) + "\n";
    const doc = learnedDocument(filler);
    const predictor = new PatternPredictor({ now: () => 300 });
    for (const edit of doc.edits) predictor.observeEdit(edit);

    const near = doc.second.indexOf("foo near");
    const far = doc.second.indexOf("foo far");
    const whole = predictor.predictRawCandidates(snapshot(doc.second, 3));
    expect(whole.map((c) => c.startOffset)).toEqual(
      expect.arrayContaining([near, far]),
    );

    const windowed = predictor.predictRawCandidates(
      snapshot(doc.second, 3),
      undefined,
      0,
    );
    expect(windowed.map((c) => c.startOffset)).toContain(near);
    expect(windowed.map((c) => c.startOffset)).not.toContain(far);
  });

  it("reuses its result until the text or the patterns change", () => {
    const doc = learnedDocument("");
    const predictor = new PatternPredictor({ now: () => 300 });
    for (const edit of doc.edits) predictor.observeEdit(edit);

    const first = predictor.predictRawCandidates(snapshot(doc.second, 3), undefined, 5);
    expect(predictor.predictRawCandidates(snapshot(doc.second, 3), undefined, 9)).toBe(
      first,
    );
    expect(
      predictor.predictRawCandidates(snapshot(doc.second, 4), undefined, 9),
    ).not.toBe(first);
  });
});

describe("NextEditController typing pause", () => {
  it("searches once after a pause instead of on every keystroke", () => {
    vi.useFakeTimers();
    const doc = learnedDocument("");
    const controller = new NextEditController({
      now: () => 300,
      patternDebounceMs: 90,
    });
    const predict = vi.spyOn(PatternPredictor.prototype, "predictRawCandidates");

    controller.onDocumentChanged(snapshot(doc.first, 2));
    controller.observeEdit(doc.edits[0]);
    controller.onCursorMoved(10);
    controller.onDocumentChanged(snapshot(doc.second, 3));
    controller.observeEdit(doc.edits[1]);
    controller.onCursorMoved(20);
    expect(predict).not.toHaveBeenCalled();
    expect(controller.getSuggestion()).toBeNull();

    vi.advanceTimersByTime(90);
    expect(predict).toHaveBeenCalledTimes(1);
    expect(controller.getSuggestion()).toMatchObject({
      expectedText: "foo",
      replacementText: "bar",
    });
    predict.mockRestore();
    controller.dispose();
  });
});
