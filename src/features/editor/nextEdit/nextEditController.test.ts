import { afterEach, describe, expect, it, vi } from "vitest";
import { NextEditController } from "./nextEditController";
import type {
  DocumentSnapshot,
  NextEditCandidate,
  NormalizedEdit,
  SemanticNextEditInput,
  SemanticNextEditPredictor,
} from "./nextEditTypes";

function snapshot(
  text: string,
  revision: number,
  documentKey = "project:main.tex",
): DocumentSnapshot {
  return {
    documentKey,
    revision,
    text,
    language: "latex",
  };
}

function edit(args: {
  before: string;
  start: number;
  oldText: string;
  newText: string;
  revisionBefore: number;
  revisionAfter: number;
  origin?: NormalizedEdit["origin"];
  timestamp?: number;
  documentKey?: string;
}): NormalizedEdit {
  return {
    id: `edit-${args.revisionAfter}-${args.start}`,
    documentKey: args.documentKey ?? "project:main.tex",
    revisionBefore: args.revisionBefore,
    revisionAfter: args.revisionAfter,
    origin: args.origin ?? "user",
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
    timestamp: args.timestamp ?? args.revisionAfter * 100,
  };
}

class DeferredSemanticPredictor implements SemanticNextEditPredictor {
  calls: Array<{
    input: SemanticNextEditInput;
    signal: AbortSignal;
    resolve: (candidate: NextEditCandidate | null) => void;
  }> = [];

  predict(input: SemanticNextEditInput, signal: AbortSignal) {
    return new Promise<NextEditCandidate | null>((resolve) => {
      this.calls.push({ input, signal, resolve });
    });
  }
}

function semanticCandidate(
  input: SemanticNextEditInput,
  expected: string,
): NextEditCandidate {
  const start = input.snapshot.text.indexOf(expected);
  return {
    id: `semantic-${input.basedOnRevision}`,
    documentKey: input.snapshot.documentKey,
    source: "semantic",
    startOffset: start,
    endOffset: start + expected.length,
    expectedText: expected,
    replacementText: expected.toUpperCase(),
    confidence: 0.8,
    reason: "test",
    basedOnRevision: input.basedOnRevision,
    modelRequestId: input.requestId,
  };
}

describe("NextEditController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("transitions from observing to showing, accepts, and chains after next-edit application", () => {
    const shown: Array<NextEditCandidate | null> = [];
    const controller = new NextEditController({
      now: () => 300,
      onSuggestionChanged: (candidate) => shown.push(candidate),
    });
    const initial = "foo one\nfoo two\nfoo three\nfoo four";
    const afterFirst = initial.replace("foo one", "bar one");
    const afterSecond = afterFirst.replace("foo two", "bar two");

    const first = edit({
      before: initial,
      start: initial.indexOf("foo one"),
      oldText: "foo",
      newText: "bar",
      revisionBefore: 1,
      revisionAfter: 2,
      timestamp: 100,
    });
    const second = edit({
      before: afterFirst,
      start: afterFirst.indexOf("foo two"),
      oldText: "foo",
      newText: "bar",
      revisionBefore: 2,
      revisionAfter: 3,
      timestamp: 200,
    });

    controller.onDocumentChanged(snapshot(afterFirst, 2));
    controller.observeEdit(first);
    controller.onDocumentChanged(snapshot(afterSecond, 3));
    controller.observeEdit(second);

    const accepted = controller.acceptSuggestion();
    expect(accepted).toMatchObject({
      expectedText: "foo",
      replacementText: "bar",
    });

    const afterAccepted = afterSecond.replace("foo three", "bar three");
    controller.onDocumentChanged(snapshot(afterAccepted, 4));
    controller.observeEdit(
      edit({
        before: afterSecond,
        start: accepted?.startOffset ?? 0,
        oldText: "foo",
        newText: "bar",
        revisionBefore: 3,
        revisionAfter: 4,
        origin: "next-edit",
      }),
    );

    expect(controller.getSuggestion()?.startOffset).toBe(
      afterAccepted.indexOf("foo four"),
    );
    expect(shown.some((candidate) => candidate?.source === "pattern")).toBe(true);
  });

  it("recomputes pattern suggestions when the cursor moves near a candidate", () => {
    const controller = new NextEditController({ now: () => 300 });
    const filler = "filler ".repeat(360);
    const initial = [
      "\\section{\\comp: title}",
      filler,
      "This section presents \\comp as an architecture.",
    ].join("\n");
    const firstCommandEnd = initial.indexOf("\\comp") + "\\comp".length;
    const afterFirst = `${initial.slice(0, firstCommandEnd)}l${initial.slice(firstCommandEnd)}`;
    const first = edit({
      before: initial,
      start: firstCommandEnd,
      oldText: "",
      newText: "l",
      revisionBefore: 1,
      revisionAfter: 2,
      timestamp: 100,
    });

    controller.onDocumentChanged(snapshot(afterFirst, 2));
    controller.observeEdit(first);
    expect(controller.getSuggestion()).toBeNull();

    const target = afterFirst.lastIndexOf("\\comp");
    controller.onCursorMoved(target);

    expect(controller.getSuggestion()).toMatchObject({
      startOffset: target,
      expectedText: "\\comp",
      replacementText: "\\compl",
    });
  });

  it("dismisses an active suggestion explicitly", () => {
    const controller = new NextEditController({ now: () => 300 });
    const initial = "foo one\nfoo two\nfoo three";
    const afterFirst = initial.replace("foo one", "bar one");
    const afterSecond = afterFirst.replace("foo two", "bar two");

    const first = edit({
      before: initial,
      start: 0,
      oldText: "foo",
      newText: "bar",
      revisionBefore: 1,
      revisionAfter: 2,
    });
    const second = edit({
      before: afterFirst,
      start: afterFirst.indexOf("foo two"),
      oldText: "foo",
      newText: "bar",
      revisionBefore: 2,
      revisionAfter: 3,
    });

    controller.onDocumentChanged(snapshot(afterFirst, 2));
    controller.observeEdit(first);
    controller.onDocumentChanged(snapshot(afterSecond, 3));
    controller.observeEdit(second);
    expect(controller.getSuggestion()).not.toBeNull();

    controller.dismissSuggestion("explicit");

    expect(controller.getSuggestion()).toBeNull();
  });

  it("clears stale suggestions before acceptance", () => {
    const controller = new NextEditController({ now: () => 300 });
    const initial = "foo one\nfoo two\nfoo three";
    const afterFirst = initial.replace("foo one", "bar one");
    const afterSecond = afterFirst.replace("foo two", "bar two");
    const first = edit({
      before: initial,
      start: 0,
      oldText: "foo",
      newText: "bar",
      revisionBefore: 1,
      revisionAfter: 2,
    });
    const second = edit({
      before: afterFirst,
      start: afterFirst.indexOf("foo two"),
      oldText: "foo",
      newText: "bar",
      revisionBefore: 2,
      revisionAfter: 3,
    });
    controller.onDocumentChanged(snapshot(afterFirst, 2));
    controller.observeEdit(first);
    controller.onDocumentChanged(snapshot(afterSecond, 3));
    controller.observeEdit(second);
    expect(controller.getSuggestion()).not.toBeNull();

    controller.onDocumentChanged(
      snapshot(afterSecond.replace("foo three", "baz three"), 4),
    );

    expect(controller.getSuggestion()).toBeNull();
    expect(controller.acceptSuggestion()).toBeNull();
  });

  it("ignores late semantic responses after a newer edit wins", async () => {
    vi.useFakeTimers();
    const semantic = new DeferredSemanticPredictor();
    const controller = new NextEditController({
      now: () => 100,
      semanticPredictor: semantic,
      semanticEnabled: true,
      semanticDebounceMs: 1,
    });

    const afterA = "target one\nplain two";
    controller.onDocumentChanged(snapshot(afterA, 2));
    controller.observeEdit(
      edit({
        before: "plain one\nplain two",
        start: 0,
        oldText: "plain",
        newText: "target",
        revisionBefore: 1,
        revisionAfter: 2,
      }),
    );
    vi.advanceTimersByTime(2);
    expect(semantic.calls).toHaveLength(1);
    const requestA = semantic.calls[0];

    const afterB = "target one\ntarget two";
    controller.onDocumentChanged(snapshot(afterB, 3));
    controller.observeEdit(
      edit({
        before: afterA,
        start: afterA.indexOf("plain two"),
        oldText: "plain",
        newText: "target",
        revisionBefore: 2,
        revisionAfter: 3,
      }),
    );
    vi.advanceTimersByTime(2);
    expect(semantic.calls).toHaveLength(2);
    const requestB = semantic.calls[1];

    requestB?.resolve(semanticCandidate(requestB.input, "target"));
    await Promise.resolve();
    requestA?.resolve(semanticCandidate(requestA.input, "target"));
    await Promise.resolve();

    expect(requestA?.signal.aborted).toBe(true);
    expect(controller.getSuggestion()?.basedOnRevision).toBe(3);
  });

  it("preserves a valid semantic suggestion when cursor movement recomputes patterns", async () => {
    vi.useFakeTimers();
    const semantic = new DeferredSemanticPredictor();
    const controller = new NextEditController({
      now: () => 100,
      semanticPredictor: semantic,
      semanticEnabled: true,
      semanticDebounceMs: 1,
    });
    const afterFirst = "y only";

    controller.onDocumentChanged(snapshot(afterFirst, 2));
    controller.observeEdit(
      edit({
        before: "x only",
        start: 0,
        oldText: "x",
        newText: "y",
        revisionBefore: 1,
        revisionAfter: 2,
      }),
    );
    vi.advanceTimersByTime(2);
    const request = semantic.calls[0];
    request?.resolve(semanticCandidate(request.input, "only"));
    await Promise.resolve();

    expect(controller.getSuggestion()).toMatchObject({
      source: "semantic",
      expectedText: "only",
    });

    controller.onCursorMoved(0);

    expect(controller.getSuggestion()).toMatchObject({
      source: "semantic",
      expectedText: "only",
    });
  });

  it("ignores semantic responses after a file switch", async () => {
    vi.useFakeTimers();
    const semantic = new DeferredSemanticPredictor();
    const controller = new NextEditController({
      semanticPredictor: semantic,
      semanticEnabled: true,
      semanticDebounceMs: 1,
    });

    controller.onDocumentChanged(snapshot("target", 2, "project:a.tex"));
    controller.observeEdit(
      edit({
        before: "plain",
        start: 0,
        oldText: "plain",
        newText: "target",
        revisionBefore: 1,
        revisionAfter: 2,
        documentKey: "project:a.tex",
      }),
    );
    vi.advanceTimersByTime(2);
    const request = semantic.calls[0];

    controller.onDocumentChanged(snapshot("target", 1, "project:b.tex"));
    request?.resolve(semanticCandidate(request.input, "target"));
    await Promise.resolve();

    expect(request?.signal.aborted).toBe(true);
    expect(controller.getSuggestion()).toBeNull();
  });
});
