import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as monaco from "monaco-editor";
import type { CitationSearchAnchor } from "../components/CitationSearchPopup";
import type { AppCtx06 } from "./appContext";
import { setMonaco } from "./appShared";
import { useAppCitationSearch } from "./useAppCitationSearch";

function setup(line = "\\cite{old}", column = 10) {
  const state = {
    line,
    position: { lineNumber: 1, column },
    anchor: null as CitationSearchAnchor | null,
    focus: 0,
  };
  const model = {
    getLanguageId: vi.fn(() => "latex"),
    getLineContent: vi.fn(() => state.line),
    getLineCount: () => 1,
    getLineMaxColumn: () => state.line.length + 1,
  };
  const editor = {
    getModel: vi.fn((): typeof model | null => model),
    getPosition: vi.fn((): typeof state.position | null => state.position),
    getDomNode: vi.fn(() => ({
      getBoundingClientRect: () => ({ top: 100, bottom: 300, left: 20.4 }),
    })),
    getScrolledVisiblePosition: vi.fn(() => ({ top: 10.4, left: 40.3, height: 18.2 })),
    trigger: vi.fn(),
    setPosition: vi.fn((position: typeof state.position) => {
      state.position = position;
    }),
    pushUndoStop: vi.fn(),
    executeEdits: vi.fn(
      (_source: string, edits: { range: monaco.IRange; text: string }[]) => {
        for (const { range, text } of edits) {
          state.line =
            state.line.slice(0, range.startColumn - 1) +
            text +
            state.line.slice(range.endColumn - 1);
          state.position = { lineNumber: 1, column: range.startColumn + text.length };
        }
      },
    ),
    focus: vi.fn(),
  };
  const ctx = {
    editorRef: { current: editor as typeof editor | null },
    citationSuggestTimerRef: { current: null as number | null },
    setCitationSearchAnchor: vi.fn(
      (
        next:
          | CitationSearchAnchor
          | null
          | ((current: CitationSearchAnchor | null) => CitationSearchAnchor | null),
      ) => {
        state.anchor = typeof next === "function" ? next(state.anchor) : next;
      },
    ),
    setCitationSearchFocusRequest: vi.fn(
      (next: number | ((value: number) => number)) => {
        state.focus = typeof next === "function" ? next(state.focus) : next;
      },
    ),
  };
  return {
    ...renderHook(() => useAppCitationSearch(ctx as unknown as AppCtx06)),
    ctx,
    editor,
    model,
    state,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  setMonaco(monaco);
});
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("citation search editor integration", () => {
  it("anchors to the visible citation key and preserves an unchanged anchor", () => {
    const h = setup();
    h.result.current.syncCitationSearchAnchor();
    expect(h.state.anchor).toEqual({ left: 61, top: 110, bottom: 129 });
    expect(h.editor.getScrolledVisiblePosition).toHaveBeenCalledWith({
      lineNumber: 1,
      column: 7,
    });
    const anchor = h.state.anchor;
    h.result.current.syncCitationSearchAnchor();
    expect(h.state.anchor).toBe(anchor);
    h.state.line = "plain text";
    h.result.current.syncCitationSearchAnchor();
    expect(h.state.anchor).toBeNull();
  });

  it.each([-1, 190])("hides an anchor outside the viewport (top %s)", (top) => {
    const h = setup();
    h.editor.getScrolledVisiblePosition.mockReturnValue({ top, left: 0, height: 18 });
    h.result.current.syncCitationSearchAnchor();
    expect(h.state.anchor).toBeNull();
  });

  it.each(["editor", "model", "position", "language"])(
    "ignores unavailable %s",
    (missing) => {
      const h = setup();
      if (missing === "editor") h.ctx.editorRef.current = null;
      if (missing === "model") h.editor.getModel.mockReturnValue(null);
      if (missing === "position") h.editor.getPosition.mockReturnValue(null);
      if (missing === "language") h.model.getLanguageId.mockReturnValue("plaintext");
      h.result.current.syncCitationSearchAnchor();
      h.result.current.openCitationSearch();
      h.result.current.triggerCitationCompletionIfNeeded();
      if (missing !== "language") {
        h.result.current.insertCitationFromSearch({
          key: "new",
          type: "article",
          sourceFile: "refs.bib",
        });
        h.result.current.finishCitationInsert();
      }
      expect(h.editor.executeEdits).not.toHaveBeenCalled();
      expect(h.state.anchor).toBeNull();
      expect(h.state.focus).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("replaces the citation key, closes suggestions, cancels reopening and steps over the brace", () => {
    const h = setup();
    h.result.current.triggerCitationCompletionIfNeeded();
    h.result.current.insertCitationFromSearch({
      key: "smith2026",
      type: "article",
      sourceFile: "refs.bib",
    });
    expect(h.state.line).toBe("\\cite{smith2026}");
    expect(h.state.position.column).toBe(h.state.line.length + 1);
    expect(h.editor.pushUndoStop).toHaveBeenCalledTimes(2);
    expect(h.editor.focus).toHaveBeenCalledOnce();
    expect(h.editor.trigger).toHaveBeenCalledExactlyOnceWith(
      "latexdo-citation",
      "hideSuggestWidget",
      {},
    );
    expect(h.ctx.citationSuggestTimerRef.current).toBeNull();
    vi.advanceTimersByTime(100);
    expect(h.editor.trigger).toHaveBeenCalledTimes(1);
    expect(h.state.anchor).toBeNull();
  });

  it("does not skip a comma when finishing a citation in a multi-key argument", () => {
    const h = setup("\\cite{first,second}", 12);
    h.result.current.finishCitationInsert();
    expect(h.editor.setPosition).not.toHaveBeenCalled();
    expect(h.editor.trigger).toHaveBeenCalledWith(
      "latexdo-citation",
      "hideSuggestWidget",
      {},
    );
  });

  it("focuses without inserting when the caret has left the citation", () => {
    const h = setup("Text", 5);
    h.result.current.insertCitationFromSearch({
      key: "smith",
      type: "book",
      sourceFile: "refs.bib",
    });
    expect(h.editor.focus).toHaveBeenCalledOnce();
    expect(h.editor.executeEdits).not.toHaveBeenCalled();
  });

  it("starts a citation at the caret and focuses search without adding a second citation", () => {
    const h = setup("Text ", 6);
    h.result.current.openCitationSearch();
    expect(h.state.line).toBe("Text \\cite{}");
    expect(h.state.position.column).toBe(12);
    expect(h.state.focus).toBe(1);
    expect(h.state.anchor).not.toBeNull();
    h.result.current.openCitationSearch();
    expect(h.editor.executeEdits).toHaveBeenCalledOnce();
    expect(h.state.focus).toBe(2);
    h.result.current.clearCitationSearchFocusRequest();
    expect(h.state.focus).toBe(0);
  });

  it("debounces completion until 80 ms after the latest keystroke", () => {
    const h = setup();
    h.result.current.triggerCitationCompletionIfNeeded();
    vi.advanceTimersByTime(50);
    h.result.current.triggerCitationCompletionIfNeeded();
    vi.advanceTimersByTime(79);
    expect(h.editor.trigger).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(h.editor.trigger).toHaveBeenCalledExactlyOnceWith(
      "latexdo-citation",
      "editor.action.triggerSuggest",
      {},
    );
    expect(h.ctx.citationSuggestTimerRef.current).toBeNull();
  });

  it.each(["editor", "model", "position", "context"])(
    "discards a pending suggestion after changing %s",
    (changed) => {
      const h = setup();
      h.result.current.triggerCitationCompletionIfNeeded();
      if (changed === "editor") h.ctx.editorRef.current = null;
      if (changed === "model") h.editor.getModel.mockReturnValue({ ...h.model });
      if (changed === "position") h.editor.getPosition.mockReturnValue(null);
      if (changed === "context") h.state.line = "Plain text";
      vi.advanceTimersByTime(80);
      expect(h.editor.trigger).not.toHaveBeenCalled();
      expect(h.ctx.citationSuggestTimerRef.current).toBeNull();
    },
  );

  it("does not schedule suggestions outside a citation", () => {
    const h = setup("\\ref{label}", 8);
    h.result.current.triggerCitationCompletionIfNeeded();
    expect(vi.getTimerCount()).toBe(0);
  });
});
