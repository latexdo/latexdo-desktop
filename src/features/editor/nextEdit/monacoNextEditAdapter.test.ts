import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import { EditorMutationOrigin } from "../../../collaboration/editProvenance";
import { installMonacoNextEdit } from "./monacoNextEditAdapter";
import { defaultNextEditConfig } from "./nextEditTypes";

class FakeRange {
  constructor(
    readonly startLineNumber: number,
    readonly startColumn: number,
    readonly endLineNumber: number,
    readonly endColumn: number,
  ) {}
}

class FakeModel {
  uri = { fsPath: "/project/main.tex" };
  version = 1;

  constructor(public text: string) {}

  getValue() {
    return this.text;
  }

  getValueLength() {
    return this.text.length;
  }

  getVersionId() {
    return this.version;
  }

  getPositionAt(offset: number) {
    const safeOffset = Math.max(0, Math.min(this.text.length, offset));
    const prefix = this.text.slice(0, safeOffset);
    const lines = prefix.split("\n");
    return {
      lineNumber: lines.length,
      column: (lines[lines.length - 1]?.length ?? 0) + 1,
    };
  }

  getOffsetAt(position: Monaco.IPosition) {
    const lines = this.text.split("\n");
    let offset = 0;
    for (let line = 1; line < position.lineNumber; line += 1) {
      offset += (lines[line - 1]?.length ?? 0) + 1;
    }
    return offset + position.column - 1;
  }

  getValueInRange(range: FakeRange) {
    return this.text.slice(
      this.getOffsetAt(rangeStart(range)),
      this.getOffsetAt(rangeEnd(range)),
    );
  }
}

interface FakeAction {
  id: string;
  label: string;
  keybindings?: number[];
  precondition?: string;
  run: () => void;
}

class FakeEditor {
  contentListeners: Array<(event: Monaco.editor.IModelContentChangedEvent) => void> =
    [];
  cursorListeners: Array<(event: { position: Monaco.IPosition }) => void> = [];
  selectionListeners: Array<(event: { selection: FakeSelection }) => void> = [];
  modelListeners: Array<() => void> = [];
  actions: FakeAction[] = [];
  decorations: Monaco.editor.IModelDeltaDecoration[] = [];
  contextValue = false;
  undoStops = 0;
  executeSources: string[] = [];
  position: Monaco.IPosition;

  constructor(readonly model: FakeModel) {
    this.position = model.getPositionAt(0);
  }

  getModel() {
    return this.model;
  }

  getPosition() {
    return this.position;
  }

  setPosition(position: Monaco.IPosition) {
    this.position = position;
  }

  revealPositionInCenterIfOutsideViewport = vi.fn();

  createDecorationsCollection() {
    return {
      set: (decorations: Monaco.editor.IModelDeltaDecoration[]) => {
        this.decorations = decorations;
        return decorations.map((_, index) => `decoration-${index}`);
      },
      clear: () => {
        this.decorations = [];
      },
    };
  }

  createContextKey(_key: string, defaultValue: boolean) {
    this.contextValue = defaultValue;
    return {
      set: (value: boolean) => {
        this.contextValue = value;
      },
      reset: () => {
        this.contextValue = defaultValue;
      },
    };
  }

  onDidChangeModelContent(
    listener: (event: Monaco.editor.IModelContentChangedEvent) => void,
  ) {
    this.contentListeners.push(listener);
    return disposable(() => {
      this.contentListeners = this.contentListeners.filter((item) => item !== listener);
    });
  }

  onDidChangeCursorPosition(listener: (event: { position: Monaco.IPosition }) => void) {
    this.cursorListeners.push(listener);
    return disposable(() => {
      this.cursorListeners = this.cursorListeners.filter((item) => item !== listener);
    });
  }

  onDidChangeCursorSelection(listener: (event: { selection: FakeSelection }) => void) {
    this.selectionListeners.push(listener);
    return disposable(() => {
      this.selectionListeners = this.selectionListeners.filter(
        (item) => item !== listener,
      );
    });
  }

  onDidChangeModel(listener: () => void) {
    this.modelListeners.push(listener);
    return disposable(() => {
      this.modelListeners = this.modelListeners.filter((item) => item !== listener);
    });
  }

  addAction(action: FakeAction) {
    this.actions.push(action);
    return disposable(() => {
      this.actions = this.actions.filter((item) => item !== action);
    });
  }

  pushUndoStop() {
    this.undoStops += 1;
  }

  executeEdits(source: string, edits: Array<{ range: FakeRange; text: string }>) {
    this.executeSources.push(source);
    for (const edit of edits) {
      this.replaceRange(
        this.model.getOffsetAt(rangeStart(edit.range)),
        this.model.getOffsetAt(rangeEnd(edit.range)),
        edit.text,
      );
    }
  }

  replaceRange(
    startOffset: number,
    endOffset: number,
    text: string,
    flags: Partial<Monaco.editor.IModelContentChangedEvent> = {},
  ) {
    const before = this.model.text;
    const range = rangeFromOffsets(this.model, startOffset, endOffset);
    this.model.text = `${before.slice(0, startOffset)}${text}${before.slice(endOffset)}`;
    this.model.version += 1;
    this.position = this.model.getPositionAt(startOffset + text.length);
    const event = {
      changes: [
        {
          range,
          rangeOffset: startOffset,
          rangeLength: endOffset - startOffset,
          text,
        },
      ],
      eol: "\n",
      versionId: this.model.version,
      isUndoing: false,
      isRedoing: false,
      isFlush: false,
      isEolChange: false,
      ...flags,
    } as Monaco.editor.IModelContentChangedEvent;
    for (const listener of this.contentListeners) {
      listener(event);
    }
  }
}

class FakeSelection {
  constructor(
    private readonly start: Monaco.IPosition,
    private readonly end: Monaco.IPosition,
  ) {}

  getStartPosition() {
    return this.start;
  }

  getEndPosition() {
    return this.end;
  }
}

const fakeMonaco = {
  KeyCode: {
    Tab: 2,
    Escape: 9,
  },
  editor: {
    TrackedRangeStickiness: {
      NeverGrowsWhenTypingAtEdges: 1,
    },
    InjectedTextCursorStops: {
      None: 3,
    },
  },
  Range: FakeRange,
} as unknown as typeof Monaco;

function setup(text = "foo one\nfoo two\nfoo three") {
  const model = new FakeModel(text);
  const editor = new FakeEditor(model);
  const origin = new EditorMutationOrigin();
  const adapter = installMonacoNextEdit({
    editor: editor as unknown as Monaco.editor.IStandaloneCodeEditor,
    monaco: fakeMonaco,
    documentKey: "project:main.tex",
    language: "latex",
    config: defaultNextEditConfig,
    mutationOrigin: origin,
    now: () => 300,
  });
  return { model, editor, adapter, origin };
}

function makeSuggestionVisible(editor: FakeEditor) {
  editor.replaceRange(0, 3, "bar");
  const secondStart = editor.model.text.indexOf("foo two");
  editor.replaceRange(secondStart, secondStart + 3, "bar");
}

describe("monacoNextEditAdapter", () => {
  it("toggles the context key and renders a decoration when a suggestion appears", async () => {
    const { editor } = setup();

    makeSuggestionVisible(editor);
    await Promise.resolve();

    expect(editor.contextValue).toBe(true);
    expect(editor.decorations[0]?.options.after?.content).toContain("bar");
    // The Tab hint is its own decoration at the end of the edited line; the
    // cursor is on another line, so Tab first goes there.
    const hint = editor.decorations[1];
    expect(hint?.options.after?.content).toBe("Tab to go here");
    expect(editor.decorations[2]?.options.linesDecorationsClassName).toBe(
      "latexdo-next-edit-gutter",
    );
    expect(editor.decorations[3]?.options.linesDecorationsClassName).toBe(
      "latexdo-next-edit-jump-down",
    );
    expect(hint?.options.after?.inlineClassName).toBe("latexdo-next-edit-tab-hint");
    const hintOffset = editor.model.getOffsetAt(rangeStart(hint!.range as FakeRange));
    const editEnd = editor.model.getOffsetAt(
      rangeEnd(editor.decorations[0]!.range as FakeRange),
    );
    const lineBreak = editor.model.text.indexOf("\n", editEnd);
    expect(hintOffset).toBe(lineBreak < 0 ? editor.model.text.length : lineBreak);
  });

  it("registers Tab and Escape actions with Monaco preconditions", () => {
    const { editor } = setup();
    const tab = editor.actions.find(
      (action) => action.id === "latexdo.nextEdit.accept",
    );
    const escape = editor.actions.find(
      (action) => action.id === "latexdo.nextEdit.dismiss",
    );

    expect(tab?.precondition).toContain("latexdoNextEditVisible");
    expect(tab?.precondition).toContain("!suggestWidgetVisible");
    expect(tab?.precondition).toContain("!renameInputVisible");
    expect(tab?.precondition).toContain("!inSnippetMode");
    expect(tab?.precondition).toContain("!inlineSuggestionVisible");
    expect(escape?.precondition).toContain("latexdoNextEditVisible");
  });

  it("goes to a suggestion on another line first, then accepts it as one undoable edit", async () => {
    const { editor } = setup();
    makeSuggestionVisible(editor);
    await Promise.resolve();
    const tab = editor.actions.find(
      (action) => action.id === "latexdo.nextEdit.accept",
    );

    tab?.run();
    expect(editor.model.text).toBe("bar one\nbar two\nfoo three");
    expect(editor.getPosition()?.lineNumber).toBe(3);
    await Promise.resolve();
    expect(editor.decorations[1]?.options.after?.content).toBe("Tab to accept");

    tab?.run();

    expect(editor.model.text).toBe("bar one\nbar two\nbar three");
    expect(editor.executeSources).toContain("latexdo.nextEdit.accept");
    expect(editor.undoStops).toBe(2);
    await Promise.resolve();
    expect(editor.contextValue).toBe(false);
  });

  it("expands a typed LaTeX command suffix into a whole-command replacement", async () => {
    const { editor } = setup(
      [
        "\\section{\\comp: A Lazy Completion Architecture}",
        "",
        "This section presents \\comp as an architecture.",
      ].join("\n"),
    );
    const firstCommandEnd = editor.model.text.indexOf("\\comp") + "\\comp".length;

    editor.replaceRange(firstCommandEnd, firstCommandEnd, "l");
    await Promise.resolve();

    expect(editor.contextValue).toBe(true);
    expect(editor.decorations[0]?.options.className).toBe("latexdo-next-edit-remove");
    expect(editor.decorations[0]?.options.after?.content).toBe("\\compl");
    expect(editor.decorations[0]?.options.after?.inlineClassName).toBe(
      "latexdo-next-edit-add",
    );
    expect(
      editor.model.getValueInRange(editor.decorations[0]?.range as FakeRange),
    ).toBe("\\comp");

    const tab = editor.actions.find(
      (action) => action.id === "latexdo.nextEdit.accept",
    );
    tab?.run(); // goes to the suggestion
    tab?.run(); // accepts it

    expect(editor.model.text).toContain("This section presents \\compl as");
    expect(editor.model.text).not.toContain("\\compll");
  });

  it("dismisses the visible suggestion with Escape", () => {
    const { editor } = setup();
    makeSuggestionVisible(editor);
    const escape = editor.actions.find(
      (action) => action.id === "latexdo.nextEdit.dismiss",
    );

    escape?.run();

    expect(editor.contextValue).toBe(false);
    expect(editor.decorations).toEqual([]);
  });

  it("does not apply a stale expected-text mismatch", () => {
    const { editor, adapter } = setup();
    makeSuggestionVisible(editor);
    editor.model.text = editor.model.text.replace("foo three", "baz three");

    const accepted = adapter.acceptVisibleSuggestion();

    expect(accepted).toBe(false);
    expect(editor.model.text).toBe("bar one\nbar two\nbaz three");
    expect(editor.executeSources).toEqual([]);
  });

  it("does not learn remote-origin changes", () => {
    const { editor, origin } = setup();
    origin.run("remote", () => {
      editor.replaceRange(0, 3, "bar");
    });
    const secondStart = editor.model.text.indexOf("foo two");
    origin.run("remote", () => {
      editor.replaceRange(secondStart, secondStart + 3, "bar");
    });

    expect(editor.contextValue).toBe(false);
    expect(editor.decorations).toEqual([]);
  });

  it("clears decorations and resets the context key on dispose", () => {
    const { editor, adapter } = setup();
    makeSuggestionVisible(editor);

    adapter.dispose();

    expect(editor.contextValue).toBe(false);
    expect(editor.decorations).toEqual([]);
  });
});

function disposable(dispose: () => void): Monaco.IDisposable {
  return { dispose };
}

function rangeFromOffsets(model: FakeModel, start: number, end: number): FakeRange {
  const startPosition = model.getPositionAt(start);
  const endPosition = model.getPositionAt(end);
  return new FakeRange(
    startPosition.lineNumber,
    startPosition.column,
    endPosition.lineNumber,
    endPosition.column,
  );
}

function rangeStart(range: FakeRange): Monaco.IPosition {
  return {
    lineNumber: range.startLineNumber,
    column: range.startColumn,
  };
}

function rangeEnd(range: FakeRange): Monaco.IPosition {
  return {
    lineNumber: range.endLineNumber,
    column: range.endColumn,
  };
}
