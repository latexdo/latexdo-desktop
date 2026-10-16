import { vi } from "vitest";

// A deterministic implementation of the Monaco boundary. App callbacks and
// providers remain real; text edits are applied so tests can assert their result.
export function createEditorHarness(
  initialText: string,
  filePath: string,
  onChange: (text: string) => void,
) {
  let text = initialText;
  let version = 1;
  let position = { lineNumber: 1, column: 1 };
  class Range {
    constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number,
    ) {}
    isEmpty() {
      return (
        this.startLineNumber === this.endLineNumber &&
        this.startColumn === this.endColumn
      );
    }
    getStartPosition() {
      return { lineNumber: this.startLineNumber, column: this.startColumn };
    }
    getEndPosition() {
      return { lineNumber: this.endLineNumber, column: this.endColumn };
    }
    containsPosition(p: { lineNumber: number; column: number }) {
      const offset = model.getOffsetAt(p);
      return (
        offset >= model.getOffsetAt(this.getStartPosition()) &&
        offset <= model.getOffsetAt(this.getEndPosition())
      );
    }
  }
  class Selection extends Range {
    selectionStartLineNumber: number;
    selectionStartColumn: number;
    positionLineNumber: number;
    positionColumn: number;
    constructor(a: number, b: number, c: number, d: number) {
      super(a, b, c, d);
      this.selectionStartLineNumber = a;
      this.selectionStartColumn = b;
      this.positionLineNumber = c;
      this.positionColumn = d;
    }
  }
  let selection = new Selection(1, 1, 1, 1);
  const listeners = new Map<string, (...args: any[]) => void>();
  const actions = new Map<string, any>();
  const providers = new Map<string, any[]>();
  const decorations = new Map<string, Range>();
  const disposable = () => ({ dispose: vi.fn() });
  const model = {
    uri: { fsPath: filePath, toString: () => `file://${filePath}` },
    getValue: () => text,
    getVersionId: () => version,
    isDisposed: () => false,
    getLanguageId: () => "latex",
    getLineCount: () => text.split("\n").length,
    getLineContent: (n: number) => text.split("\n")[n - 1] ?? "",
    getLineMaxColumn: (n: number) => (text.split("\n")[n - 1] ?? "").length + 1,
    getOffsetAt: (p: { lineNumber: number; column: number }) =>
      text
        .split("\n")
        .slice(0, p.lineNumber - 1)
        .reduce((n, line) => n + line.length + 1, 0) +
      p.column -
      1,
    getPositionAt: (offset: number) => {
      const before = text.slice(0, offset).split("\n");
      return {
        lineNumber: before.length,
        column: before[before.length - 1].length + 1,
      };
    },
    getValueInRange: (range: Range) =>
      text.slice(
        model.getOffsetAt({
          lineNumber: range.startLineNumber,
          column: range.startColumn,
        }),
        model.getOffsetAt({ lineNumber: range.endLineNumber, column: range.endColumn }),
      ),
    getFullModelRange: () =>
      new Range(
        1,
        1,
        model.getLineCount(),
        model.getLineMaxColumn(model.getLineCount()),
      ),
    getWordUntilPosition: (p: { lineNumber: number; column: number }) => {
      const word = (model
        .getLineContent(p.lineNumber)
        .slice(0, p.column - 1)
        .match(/[A-Za-z0-9_-]+$/) ?? [""])[0];
      return { word, startColumn: p.column - word.length, endColumn: p.column };
    },
    getDecorationRange: (id: string) => decorations.get(id) ?? null,
    validatePosition: (p: unknown) => p,
    validateRange: (r: unknown) => r,
  };
  const editor: any = {
    getModel: () => model,
    getPosition: () => position,
    getSelection: () => selection,
    getSelections: () => [selection],
    focus: vi.fn(),
    trigger: vi.fn(),
    pushUndoStop: vi.fn(),
    getAction: (id: string) => actions.get(id),
    getScrollLeft: () => 0,
    getScrollTop: () => 0,
    getVisibleRanges: () => [model.getFullModelRange()],
    getLayoutInfo: () => ({ height: 800, width: 1000 }),
    saveViewState: () => null,
    restoreViewState: vi.fn(),
    updateOptions: vi.fn(),
    layout: vi.fn(),
    getDomNode: () => document.body,
    setPosition: vi.fn((p: typeof position) => {
      position = p;
      selection = new Selection(p.lineNumber, p.column, p.lineNumber, p.column);
    }),
    setSelection: vi.fn((r: Range) => {
      selection = new Selection(
        r.startLineNumber,
        r.startColumn,
        r.endLineNumber,
        r.endColumn,
      );
      position = selection.getEndPosition();
    }),
    addAction: vi.fn((action: any) => {
      actions.set(action.id, action);
      return disposable();
    }),
    addCommand: vi.fn(),
    deltaDecorations: vi.fn((old: string[], next: any[]) => {
      old.forEach((id) => decorations.delete(id));
      return next.map((item, i) => {
        const id = `decoration-${decorations.size}-${i}`;
        decorations.set(id, item.range);
        return id;
      });
    }),
    executeEdits: vi.fn((_source: string, edits: { range: Range; text: string }[]) => {
      for (const edit of [...edits].sort(
        (a, b) =>
          model.getOffsetAt(b.range.getStartPosition()) -
          model.getOffsetAt(a.range.getStartPosition()),
      )) {
        const start = model.getOffsetAt(edit.range.getStartPosition());
        const end = model.getOffsetAt(edit.range.getEndPosition());
        text = text.slice(0, start) + edit.text + text.slice(end);
      }
      version++;
      onChange(text);
      return true;
    }),
  };
  for (const name of [
    "revealLineInCenter",
    "revealLineInCenterIfOutsideViewport",
    "revealPositionInCenterIfOutsideViewport",
    "revealRangeInCenter",
    "revealRangeInCenterIfOutsideViewport",
    "revealPosition",
    "setScrollTop",
    "setScrollLeft",
    "setSelections",
  ])
    editor[name] = vi.fn();
  for (const name of [
    "onDidChangeCursorPosition",
    "onDidChangeCursorSelection",
    "onDidChangeModelContent",
    "onDidChangeModel",
    "onMouseDown",
    "onDidScrollChange",
  ])
    editor[name] = vi.fn((fn: (...args: any[]) => void) => {
      listeners.set(name, fn);
      return disposable();
    });
  const languages: any = {
    getLanguages: () => [],
    register: vi.fn(),
    setMonarchTokensProvider: vi.fn(),
    setLanguageConfiguration: vi.fn(),
    FoldingRangeKind: { Comment: "comment", Region: "region" },
    CompletionItemKind: { Snippet: 1, Reference: 2, Operator: 3 },
    CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
  };
  for (const kind of [
    "FoldingRange",
    "Link",
    "CompletionItem",
    "Hover",
    "InlineCompletions",
  ]) {
    languages[`register${kind}Provider`] = vi.fn(
      (language: string, provider: unknown) => {
        const key = `${language}:${kind}`;
        providers.set(key, [...(providers.get(key) ?? []), provider]);
        return disposable();
      },
    );
  }
  const instance: any = {
    Range,
    Selection,
    languages,
    KeyMod: { CtrlCmd: 2048, Shift: 1024, Alt: 512 },
    KeyCode: {
      KeyR: 48,
      KeyA: 31,
      KeyF: 36,
      Enter: 3,
      F2: 60,
      RightArrow: 17,
      LeftArrow: 15,
    },
    Uri: { parse: (value: string) => ({ fsPath: value, toString: () => value }) },
    MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
    editor: {
      defineTheme: vi.fn(),
      setTheme: vi.fn(),
      setModelMarkers: vi.fn(),
      getModel: () => model,
      ScrollType: { Smooth: 1 },
      GlyphMarginLane: { Center: 2 },
      OverviewRulerLane: { Center: 2 },
      TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 },
      InjectedTextCursorStops: { None: 0 },
      // Global commands (run by completion items) are recorded like actions.
      registerCommand: vi.fn((id: string, handler: () => void) => {
        actions.set(id, { id, run: handler });
        return disposable();
      }),
    },
  };
  return {
    editor,
    model,
    instance,
    actions,
    providers,
    listeners,
    Range,
    Selection,
    setText: (value: string) => {
      text = value;
      version++;
    },
    select: (start: number, end = start) => {
      const a = model.getPositionAt(start),
        b = model.getPositionAt(end);
      selection = new Selection(a.lineNumber, a.column, b.lineNumber, b.column);
      position = b;
    },
    run: (id: string) => {
      const action = actions.get(id);
      if (!action) throw new Error(`Missing editor action ${id}`);
      return action.run(editor);
    },
  };
}
