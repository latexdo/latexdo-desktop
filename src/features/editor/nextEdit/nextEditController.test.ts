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

describe("NextEditController lifecycle and guards", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const initial = "foo one\nfoo two\nfoo three";
  const afterFirst = initial.replace("foo one", "bar one");
  const afterSecond = afterFirst.replace("foo two", "bar two");
  const firstEdit = edit({
    before: initial,
    start: 0,
    oldText: "foo",
    newText: "bar",
    revisionBefore: 1,
    revisionAfter: 2,
  });
  const secondEdit = edit({
    before: afterFirst,
    start: afterFirst.indexOf("foo two"),
    oldText: "foo",
    newText: "bar",
    revisionBefore: 2,
    revisionAfter: 3,
  });

  function withSuggestion(controller: NextEditController) {
    controller.onDocumentChanged(snapshot(afterFirst, 2));
    controller.observeEdit(firstEdit);
    controller.onDocumentChanged(snapshot(afterSecond, 3));
    controller.observeEdit(secondEdit);
    const suggestion = controller.getSuggestion();
    expect(suggestion).not.toBeNull();
    return suggestion!;
  }

  it("notifies subscribers immediately and on changes until they unsubscribe", () => {
    const controller = new NextEditController({ now: () => 300 });
    const seen: Array<NextEditCandidate | null> = [];
    const unsubscribe = controller.subscribeSuggestionChanged((c) => seen.push(c));
    expect(seen).toEqual([null]);
    const suggestion = withSuggestion(controller);
    expect(seen.at(-1)).toBe(suggestion);
    expect(controller.getDebugState()).toBe("showing");
    unsubscribe();
    controller.dismissSuggestion("explicit");
    expect(seen.at(-1)).toBe(suggestion);
    expect(controller.getDebugState()).toBe("idle");
  });

  it("does nothing once disposed", () => {
    const controller = new NextEditController({ now: () => 300 });
    withSuggestion(controller);
    controller.dispose();
    expect(controller.getSuggestion()).toBeNull();
    controller.dispose();
    controller.observeEdit(secondEdit);
    controller.onCursorMoved(3);
    controller.onDocumentChanged(snapshot(afterSecond, 9));
    controller.onSelectionChanged(0, 5);
    expect(controller.acceptSuggestion()).toBeNull();
    expect(controller.getSuggestion()).toBeNull();
  });

  it("clears the suggestion for edits in another document or with no snapshot", () => {
    const controller = new NextEditController({ now: () => 300 });
    controller.observeEdit(firstEdit);
    expect(controller.getSuggestion()).toBeNull();
    withSuggestion(controller);
    controller.observeEdit({ ...secondEdit, documentKey: "project:other.tex" });
    expect(controller.getSuggestion()).toBeNull();
  });

  it("dismisses suggestions when a selection overlaps them", () => {
    const controller = new NextEditController({ now: () => 300 });
    controller.onSelectionChanged(0, 4);
    const suggestion = withSuggestion(controller);
    controller.onSelectionChanged(suggestion.startOffset, suggestion.startOffset);
    controller.onSelectionChanged(0, 2);
    expect(controller.getSuggestion()).toBe(suggestion);
    controller.onSelectionChanged(suggestion.endOffset, suggestion.startOffset + 1);
    expect(controller.getSuggestion()).toBeNull();
  });

  it("keeps or drops a suggestion after undo depending on whether it still fits", () => {
    const controller = new NextEditController({ now: () => 300 });
    withSuggestion(controller);
    controller.observeEdit({ ...secondEdit, origin: "undo", revisionAfter: 3 });
    expect(controller.getSuggestion()).not.toBeNull();
    expect(controller.getDebugState()).toBe("showing");

    const other = new NextEditController({ now: () => 300 });
    other.observeEdit({ ...secondEdit, origin: "undo" });
    other.onDocumentChanged(snapshot("x", 1));
    other.observeEdit({ ...secondEdit, origin: "undo", revisionAfter: 2 });
    expect(other.getDebugState()).toBe("idle");
  });

  it("drops stale suggestions when the cursor moves", () => {
    const controller = new NextEditController({ now: () => 300 });
    const suggestion = withSuggestion(controller);
    // Same revision, different text: only reachable through a buggy caller,
    // but the controller still refuses to show a suggestion that no longer fits.
    (controller as unknown as { snapshot: DocumentSnapshot }).snapshot = snapshot(
      "changed",
      3,
    );
    controller.onCursorMoved(-5);
    expect(controller.getSuggestion()).toBeNull();
    expect(suggestion).toBeTruthy();
  });

  it("refuses to accept a suggestion that went stale", () => {
    const controller = new NextEditController({ now: () => 300 });
    withSuggestion(controller);
    (controller as unknown as { snapshot: DocumentSnapshot }).snapshot = snapshot(
      "changed",
      3,
    );
    expect(controller.acceptSuggestion()).toBeNull();
    expect(controller.getSuggestion()).toBeNull();
  });

  it("debounces pattern searches while typing", () => {
    vi.useFakeTimers();
    const controller = new NextEditController({ now: () => 300, patternDebounceMs: 50 });
    controller.onDocumentChanged(snapshot(afterFirst, 2));
    controller.observeEdit(firstEdit);
    controller.onDocumentChanged(snapshot(afterSecond, 3));
    controller.observeEdit(secondEdit);
    expect(controller.getSuggestion()).toBeNull();
    controller.onCursorMoved(0);
    expect(controller.getSuggestion()).toBeNull();
    vi.advanceTimersByTime(50);
    const suggestion = controller.getSuggestion();
    expect(suggestion).not.toBeNull();

    // A keystroke that invalidates the suggestion hides it right away.
    const typed = afterSecond.replace("foo three", "fob three");
    controller.onDocumentChanged(snapshot(typed, 4));
    (controller as unknown as { suggestion: NextEditCandidate }).suggestion = {
      ...suggestion!,
      basedOnRevision: 3,
    };
    controller.observeEdit(
      edit({
        before: afterSecond,
        start: afterSecond.indexOf("foo three") + 2,
        oldText: "o",
        newText: "b",
        revisionBefore: 3,
        revisionAfter: 4,
      }),
    );
    expect(controller.getSuggestion()).toBeNull();

    controller.observeEdit(
      edit({
        before: typed,
        start: 0,
        oldText: "b",
        newText: "b",
        revisionBefore: 4,
        revisionAfter: 4,
      }),
    );
    controller.dispose();
    vi.advanceTimersByTime(100);
    expect(controller.getSuggestion()).toBeNull();
  });

  it("skips a pending pattern search when disposed before it runs", () => {
    vi.useFakeTimers();
    const controller = new NextEditController({ now: () => 300, patternDebounceMs: 50 });
    controller.onDocumentChanged(snapshot(afterFirst, 2));
    controller.observeEdit(firstEdit);
    const timer = (controller as unknown as { patternTimer: unknown }).patternTimer;
    expect(timer).not.toBeNull();
    (controller as unknown as { disposed: boolean }).disposed = true;
    vi.advanceTimersByTime(50);
    expect(controller.getSuggestion()).toBeNull();
  });
});

describe("NextEditController semantic predictions", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function semanticSetup(predictor: SemanticNextEditPredictor) {
    vi.useFakeTimers();
    const controller = new NextEditController({
      now: () => 100,
      semanticPredictor: predictor,
      semanticEnabled: true,
      semanticDebounceMs: 1,
    });
    controller.onDocumentChanged(snapshot("y only", 2));
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
    return controller;
  }

  it("treats a failing model as having no suggestion", async () => {
    const predictor = { predict: vi.fn().mockRejectedValue(new Error("offline")) };
    const controller = semanticSetup(predictor);
    expect(controller.getDebugState()).toBe("predicting");
    await vi.advanceTimersByTimeAsync(2);
    expect(predictor.predict).toHaveBeenCalledTimes(1);
    expect(controller.getSuggestion()).toBeNull();
    expect(controller.getDebugState()).toBe("idle");
  });

  it.each([
    ["another document", { documentKey: "project:other.tex" }],
    ["an older revision", { basedOnRevision: 1 }],
    ["a negative range", { startOffset: -1 }],
    ["a reversed range", { startOffset: 4, endOffset: 2 }],
    ["a range past the end", { startOffset: 2, endOffset: 99 }],
  ])("rejects a semantic candidate for %s", async (_label, patch) => {
    const predictor = new DeferredSemanticPredictor();
    const controller = semanticSetup(predictor);
    await vi.advanceTimersByTimeAsync(2);
    const request = predictor.calls[0];
    request.resolve({ ...semanticCandidate(request.input, "only"), ...patch });
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getSuggestion()).toBeNull();
  });

  it("records an explicit dismissal of a semantic suggestion", async () => {
    const predictor = new DeferredSemanticPredictor();
    const controller = semanticSetup(predictor);
    await vi.advanceTimersByTimeAsync(2);
    const request = predictor.calls[0];
    request.resolve({ ...semanticCandidate(request.input, "only"), confidence: 0.95 });
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getSuggestion()?.source).toBe("semantic");

    controller.dismissSuggestion("explicit");
    expect(controller.getSuggestion()).toBeNull();
  });

  it("does not ask the model once disposed", async () => {
    const predictor = new DeferredSemanticPredictor();
    const controller = semanticSetup(predictor);
    (controller as unknown as { disposed: boolean }).disposed = true;
    await vi.advanceTimersByTimeAsync(2);
    expect(predictor.calls).toHaveLength(0);
  });

  it("ignores a model reply that arrives after disposal", async () => {
    const predictor = new DeferredSemanticPredictor();
    const controller = semanticSetup(predictor);
    await vi.advanceTimersByTimeAsync(2);
    const request = predictor.calls[0];
    controller.dispose();
    request.resolve(semanticCandidate(request.input, "only"));
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getSuggestion()).toBeNull();
  });
});

describe("NextEditController defensive paths", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  type Internals = {
    snapshot: DocumentSnapshot | null;
    suggestion: NextEditCandidate | null;
  };

  function candidate(overrides: Partial<NextEditCandidate> = {}): NextEditCandidate {
    return {
      id: "c1",
      documentKey: "project:main.tex",
      source: "pattern",
      startOffset: 2,
      endOffset: 2,
      expectedText: "",
      replacementText: "!",
      confidence: 0.5,
      reason: "test",
      basedOnRevision: 1,
      ...overrides,
    };
  }

  it("clears suggestions when the cursor moves before any document is known", () => {
    const controller = new NextEditController();
    controller.onCursorMoved(3);
    expect(controller.getSuggestion()).toBeNull();
    (controller as unknown as Internals).suggestion = candidate();
    controller.onCursorMoved(1);
    expect(controller.getSuggestion()).toBeNull();
  });

  it("treats a selection touching an insertion point as overlapping", () => {
    const controller = new NextEditController();
    controller.onDocumentChanged(snapshot("abcd", 1));
    (controller as unknown as Internals).suggestion = candidate();
    controller.onSelectionChanged(3, 4);
    expect(controller.getSuggestion()).not.toBeNull();
    controller.onSelectionChanged(0, 2);
    expect(controller.getSuggestion()).toBeNull();
  });

  it("dismisses a stale suggestion on undo", () => {
    const controller = new NextEditController();
    controller.onDocumentChanged(snapshot("abcd", 1));
    (controller as unknown as Internals).suggestion = candidate({ basedOnRevision: 0 });
    controller.observeEdit(
      edit({
        before: "abcd",
        start: 0,
        oldText: "a",
        newText: "a",
        revisionBefore: 1,
        revisionAfter: 1,
        origin: "undo",
      }),
    );
    expect(controller.getSuggestion()).toBeNull();
    expect(controller.getDebugState()).toBe("idle");
  });

  it("does not ask the model while a strong suggestion is showing", async () => {
    vi.useFakeTimers();
    const predictor = new DeferredSemanticPredictor();
    const controller = new NextEditController({
      now: () => 100,
      semanticPredictor: predictor,
      semanticEnabled: true,
      semanticDebounceMs: 1,
      patternDebounceMs: 50,
    });
    controller.onDocumentChanged(snapshot("abcd", 1));
    (controller as unknown as Internals).suggestion = candidate({ confidence: 0.95 });
    controller.observeEdit(
      edit({
        before: "abcd",
        start: 0,
        oldText: "a",
        newText: "a",
        revisionBefore: 1,
        revisionAfter: 1,
      }),
    );
    await vi.advanceTimersByTimeAsync(5);
    expect(predictor.calls).toHaveLength(0);

    (controller as unknown as Internals).suggestion = candidate({ confidence: 0.1 });
    controller.observeEdit(
      edit({
        before: "abcd",
        start: 0,
        oldText: "a",
        newText: "a",
        revisionBefore: 1,
        revisionAfter: 1,
      }),
    );
    await vi.advanceTimersByTimeAsync(2);
    expect(predictor.calls).toHaveLength(1);
    predictor.calls[0].resolve(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getDebugState()).toBe("showing");
  });
});
