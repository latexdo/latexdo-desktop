import { describe, expect, it } from "vitest";
import { pickBestCandidate, rankCandidates } from "./candidateRanker";
import { PatternPredictor, manualEvidence } from "./patternPredictor";
import type {
  DocumentEditSession,
  DocumentSnapshot,
  NextEditCandidate,
  NormalizedEdit,
} from "./nextEditTypes";

function snapshot(
  text: string,
  revision = 1,
  documentKey = "project:main.tex",
): DocumentSnapshot {
  return {
    documentKey,
    revision,
    text,
    language: "latex",
  };
}

function sessionFor(
  documentKey: string,
  revision: number,
  edits: NormalizedEdit[] = [],
): DocumentEditSession {
  return {
    documentKey,
    revision,
    recentEdits: edits,
    acceptedPredictionIds: new Set(),
    dismissedPatternIds: new Map(),
  };
}

function manualEdit(args: {
  before: string;
  start: number;
  oldText: string;
  newText: string;
  timestamp?: number;
  documentKey?: string;
  revisionBefore?: number;
  revisionAfter?: number;
}): NormalizedEdit {
  return {
    id: `edit-${args.timestamp ?? 1}-${args.start}`,
    documentKey: args.documentKey ?? "project:main.tex",
    revisionBefore: args.revisionBefore ?? 1,
    revisionAfter: args.revisionAfter ?? 2,
    origin: "user",
    startOffsetBefore: args.start,
    endOffsetBefore: args.start + args.oldText.length,
    oldText: args.oldText,
    newText: args.newText,
    beforeContext: args.before.slice(Math.max(0, args.start - 160), args.start),
    afterContext: args.before.slice(
      args.start + args.oldText.length,
      args.start + args.oldText.length + 160,
    ),
    cursorOffsetAfter: args.start + args.newText.length,
    timestamp: args.timestamp ?? 100,
  };
}

function best(
  predictor: PatternPredictor,
  doc: DocumentSnapshot,
  edits: NormalizedEdit[],
): NextEditCandidate | null {
  return pickBestCandidate({
    patternCandidates: predictor.predictRawCandidates(
      doc,
      sessionFor(doc.documentKey, doc.revision, edits),
    ),
    session: sessionFor(doc.documentKey, doc.revision, edits),
    cursorOffset: edits[edits.length - 1]?.cursorOffsetAfter ?? 0,
    revision: doc.revision,
    now: edits[edits.length - 1]?.timestamp ?? 100,
  });
}

describe("PatternPredictor", () => {
  it("requires two manual examples before suggesting short replacements", () => {
    const predictor = new PatternPredictor({ now: () => 300 });
    const before = "foo one\nfoo two\nfoo three";
    const first = manualEdit({
      before,
      start: 0,
      oldText: "foo",
      newText: "bar",
    });

    predictor.observeEdit(first);

    expect(
      predictor.predictRawCandidates(
        snapshot("bar one\nfoo two\nfoo three", 2),
        sessionFor(first.documentKey, 2, [first]),
      ),
    ).toEqual([]);
  });

  it("suggests a command replacement after one typed suffix insertion", () => {
    const predictor = new PatternPredictor({ now: () => 300 });
    const before = [
      "\\section{\\comp: A Lazy Completion Architecture}",
      "",
      "This section presents \\comp as an architecture.",
    ].join("\n");
    const firstCommandEnd = before.indexOf("\\comp") + "\\comp".length;
    const after = `${before.slice(0, firstCommandEnd)}l${before.slice(firstCommandEnd)}`;
    const first = manualEdit({
      before,
      start: firstCommandEnd,
      oldText: "",
      newText: "l",
      timestamp: 100,
    });

    predictor.observeEdit(first);
    const candidate = best(predictor, snapshot(after, 2), [first]);

    expect(candidate).toMatchObject({
      expectedText: "\\comp",
      replacementText: "\\compl",
      source: "pattern",
    });
    expect(candidate?.startOffset).toBe(after.lastIndexOf("\\comp"));
  });

  it("suggests a specific whole-token replacement after one manual edit", () => {
    const predictor = new PatternPredictor({ now: () => 300 });
    const before = "old_name one\nold_name two";
    const after = before.replace("old_name one", "new_name one");
    const first = manualEdit({
      before,
      start: 0,
      oldText: "old_name",
      newText: "new_name",
      timestamp: 100,
    });

    predictor.observeEdit(first);
    const candidate = best(predictor, snapshot(after, 2), [first]);

    expect(candidate).toMatchObject({
      expectedText: "old_name",
      replacementText: "new_name",
      source: "pattern",
    });
    expect(candidate?.startOffset).toBe("new_name one\n".length);
  });

  it("suggests a third identical replacement after two manual replacements", () => {
    const predictor = new PatternPredictor({ now: () => 300 });
    const firstBefore = "old_name one\nold_name two\nold_name three";
    const afterFirst = "new_name one\nold_name two\nold_name three";
    const secondStart = afterFirst.indexOf("old_name");
    const first = manualEdit({
      before: firstBefore,
      start: 0,
      oldText: "old_name",
      newText: "new_name",
      timestamp: 100,
    });
    const second = manualEdit({
      before: afterFirst,
      start: secondStart,
      oldText: "old_name",
      newText: "new_name",
      timestamp: 200,
      revisionBefore: 2,
      revisionAfter: 3,
    });

    predictor.observeEdit(first);
    predictor.observeEdit(second);
    const candidate = best(
      predictor,
      snapshot("new_name one\nnew_name two\nold_name three", 3),
      [first, second],
    );

    expect(candidate).toMatchObject({
      expectedText: "old_name",
      replacementText: "new_name",
      source: "pattern",
    });
    expect(candidate?.startOffset).toBe("new_name one\nnew_name two\n".length);
  });

  it("suggests repeated deletions", () => {
    const predictor = new PatternPredictor({ now: () => 300 });
    const firstBefore = "alpha TODO\nbeta TODO\ngamma TODO";
    const afterFirst = "alpha \nbeta TODO\ngamma TODO";
    const secondStart = afterFirst.indexOf("TODO");
    const first = manualEdit({
      before: firstBefore,
      start: firstBefore.indexOf("TODO"),
      oldText: "TODO",
      newText: "",
      timestamp: 100,
    });
    const second = manualEdit({
      before: afterFirst,
      start: secondStart,
      oldText: "TODO",
      newText: "",
      timestamp: 200,
    });

    predictor.observeEdit(first);
    predictor.observeEdit(second);
    const candidate = best(predictor, snapshot("alpha \nbeta \ngamma TODO", 3), [
      first,
      second,
    ]);

    expect(candidate?.expectedText).toBe("TODO");
    expect(candidate?.replacementText).toBe("");
  });

  it("suggests repeated insertions using token anchors", () => {
    const predictor = new PatternPredictor({ now: () => 300 });
    const firstBefore = "alpha\nbeta\ngamma";
    const afterFirst = "alpha;\nbeta\ngamma";
    const first = manualEdit({
      before: firstBefore,
      start: "alpha".length,
      oldText: "",
      newText: ";",
      timestamp: 100,
    });
    const second = manualEdit({
      before: afterFirst,
      start: afterFirst.indexOf("beta") + "beta".length,
      oldText: "",
      newText: ";",
      timestamp: 200,
    });

    predictor.observeEdit(first);
    predictor.observeEdit(second);
    const candidate = best(predictor, snapshot("alpha;\nbeta;\ngamma", 3), [
      first,
      second,
    ]);

    expect(candidate?.expectedText).toBe("");
    expect(candidate?.replacementText).toBe(";");
    expect(candidate?.startOffset).toBe("alpha;\nbeta;\ngamma".length);
  });

  it("ranks the same LaTeX environment above unrelated occurrences", () => {
    const predictor = new PatternPredictor({ now: () => 300 });
    const before = [
      "\\begin{figure}",
      "foo first",
      "foo second",
      "foo third",
      "\\end{figure}",
      "\\begin{table}",
      "foo table",
      "\\end{table}",
    ].join("\n");
    const afterFirst = before.replace("foo first", "bar first");
    const first = manualEdit({
      before,
      start: before.indexOf("foo first"),
      oldText: "foo",
      newText: "bar",
      timestamp: 100,
    });
    const second = manualEdit({
      before: afterFirst,
      start: afterFirst.indexOf("foo second"),
      oldText: "foo",
      newText: "bar",
      timestamp: 200,
    });
    predictor.observeEdit(first);
    predictor.observeEdit(second);
    const doc = snapshot(afterFirst.replace("foo second", "bar second"), 3);
    const ranked = rankCandidates({
      patternCandidates: predictor.predictRawCandidates(
        doc,
        sessionFor(doc.documentKey, doc.revision, [first, second]),
      ),
      session: sessionFor(doc.documentKey, doc.revision, [first, second]),
      cursorOffset: second.cursorOffsetAfter,
      revision: doc.revision,
      now: 200,
    });

    expect(ranked[0]?.startOffset).toBe(doc.text.indexOf("foo third"));
    expect(ranked[0]?.confidence).toBeGreaterThan(ranked[1]?.confidence ?? 0);
  });

  it("prefers the forward edit frontier", () => {
    const predictor = new PatternPredictor({ now: () => 300 });
    const before = "foo before\nfoo first\nfoo second\nfoo after";
    const afterFirst = before.replace("foo first", "bar first");
    const first = manualEdit({
      before,
      start: before.indexOf("foo first"),
      oldText: "foo",
      newText: "bar",
      timestamp: 100,
    });
    const second = manualEdit({
      before: afterFirst,
      start: afterFirst.indexOf("foo second"),
      oldText: "foo",
      newText: "bar",
      timestamp: 200,
    });
    predictor.observeEdit(first);
    predictor.observeEdit(second);
    const doc = snapshot(afterFirst.replace("foo second", "bar second"), 3);
    const ranked = rankCandidates({
      patternCandidates: predictor.predictRawCandidates(
        doc,
        sessionFor(doc.documentKey, doc.revision, [first, second]),
      ),
      session: sessionFor(doc.documentKey, doc.revision, [first, second]),
      cursorOffset: second.cursorOffsetAfter,
      revision: doc.revision,
      now: 200,
    });

    expect(ranked[0]?.startOffset).toBe(doc.text.indexOf("foo after"));
  });

  it("prefers a backward edit sequence when the examples move upward", () => {
    const predictor = new PatternPredictor({ now: () => 300 });
    const before = "foo before\nfoo first\nfoo second\nfoo after";
    const afterFirst = before.replace("foo second", "bar second");
    const first = manualEdit({
      before,
      start: before.indexOf("foo second"),
      oldText: "foo",
      newText: "bar",
      timestamp: 100,
    });
    const second = manualEdit({
      before: afterFirst,
      start: afterFirst.indexOf("foo first"),
      oldText: "foo",
      newText: "bar",
      timestamp: 200,
    });
    predictor.observeEdit(first);
    predictor.observeEdit(second);
    const doc = snapshot(afterFirst.replace("foo first", "bar first"), 3);
    const ranked = rankCandidates({
      patternCandidates: predictor.predictRawCandidates(
        doc,
        sessionFor(doc.documentKey, doc.revision, [first, second]),
      ),
      session: sessionFor(doc.documentKey, doc.revision, [first, second]),
      cursorOffset: second.cursorOffsetAfter,
      revision: doc.revision,
      now: 200,
    });

    expect(ranked[0]?.startOffset).toBe(doc.text.indexOf("foo before"));
  });

  it("expires stale patterns by TTL", () => {
    const predictor = new PatternPredictor({
      now: () => 10_000,
      editTtlMs: 100,
    });
    const before = "foo one\nfoo two\nfoo three";
    const first = manualEdit({
      before,
      start: 0,
      oldText: "foo",
      newText: "bar",
      timestamp: 100,
    });
    const second = manualEdit({
      before: before.replace("foo one", "bar one"),
      start: "bar one\n".length,
      oldText: "foo",
      newText: "bar",
      timestamp: 200,
    });

    predictor.observeEdit(first);
    predictor.observeEdit(second);

    expect(
      predictor.predictRawCandidates(
        snapshot("bar one\nbar two\nfoo three", 3),
        sessionFor(first.documentKey, 3, [first, second]),
      ),
    ).toEqual([]);
  });

  it("isolates patterns by document key", () => {
    const predictor = new PatternPredictor({ now: () => 300 });
    const first = manualEdit({
      before: "foo one\nfoo two",
      start: 0,
      oldText: "foo",
      newText: "bar",
      documentKey: "project:a.tex",
    });
    const second = manualEdit({
      before: "bar one\nfoo two",
      start: "bar one\n".length,
      oldText: "foo",
      newText: "bar",
      documentKey: "project:a.tex",
    });

    predictor.observeEdit(first);
    predictor.observeEdit(second);

    expect(
      predictor.predictRawCandidates(
        snapshot("foo only", 3, "project:b.tex"),
        sessionFor("project:b.tex", 3),
      ),
    ).toEqual([]);
  });

  it("caps raw candidates per pattern", () => {
    const predictor = new PatternPredictor({
      now: () => 300,
      maxRawCandidatesPerPattern: 3,
    });
    const first = manualEdit({
      before: "x x x x x",
      start: 0,
      oldText: "x",
      newText: "y",
    });
    const second = manualEdit({
      before: "y x x x x",
      start: 2,
      oldText: "x",
      newText: "y",
    });
    predictor.observeEdit(first);
    predictor.observeEdit(second);

    expect(
      predictor.predictRawCandidates(
        snapshot("y y x x x x x", 3),
        sessionFor(first.documentKey, 3, [first, second]),
      ),
    ).toHaveLength(3);
  });

  it("does not count accepted predictions as manual evidence", () => {
    const predictor = new PatternPredictor({ now: () => 300 });
    const edit = manualEdit({
      before: "foo one\nfoo two\nfoo three",
      start: 0,
      oldText: "foo",
      newText: "bar",
    });
    const pattern = predictor.observeEdit(edit);
    predictor.recordAccepted({
      documentKey: edit.documentKey,
      patternId: pattern?.id,
    });

    expect(pattern ? manualEvidence(pattern) : 0).toBe(1);
    expect(
      predictor.predictRawCandidates(
        snapshot("bar one\nfoo two\nfoo three", 2),
        sessionFor(edit.documentKey, 2, [edit]),
      ),
    ).toEqual([]);
  });

  it("does not learn huge paste edits", () => {
    const predictor = new PatternPredictor({ now: () => 300 });
    const pattern = predictor.observeEdit({
      ...manualEdit({
        before: "small",
        start: 0,
        oldText: "small",
        newText: "large".repeat(200),
      }),
    });

    expect(pattern).toBeNull();
  });
});
