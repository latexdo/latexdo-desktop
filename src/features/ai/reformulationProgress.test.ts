import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import {
  reformulatingContextKey,
  showReformulationProgress,
} from "./reformulationProgress";

function fakeEditor() {
  let widget: Monaco.editor.IContentWidget | null = null;
  const clear = vi.fn();
  const contextKeys = new Map<string, unknown>();
  const editor = {
    addContentWidget: vi.fn((w: Monaco.editor.IContentWidget) => {
      widget = w;
      document.body.append(w.getDomNode());
    }),
    removeContentWidget: vi.fn((w: Monaco.editor.IContentWidget) => {
      w.getDomNode().remove();
      widget = null;
    }),
    layoutContentWidget: vi.fn(),
    createDecorationsCollection: vi.fn(() => ({ clear })),
    createContextKey: vi.fn((key: string, initial: unknown) => {
      contextKeys.set(key, initial);
      return { set: (value: unknown) => contextKeys.set(key, value) };
    }),
  };
  return { editor, clear, contextKeys, widget: () => widget };
}

const monaco = {
  editor: {
    ContentWidgetPositionPreference: { ABOVE: 1, BELOW: 2 },
    TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 },
  },
} as unknown as typeof Monaco;

const range = { startLineNumber: 4, startColumn: 1, endLineNumber: 4, endColumn: 30 };

describe("showReformulationProgress", () => {
  it("shows a popup above the selection and tints the selected text", () => {
    const { editor, widget } = fakeEditor();
    showReformulationProgress(
      editor as unknown as Monaco.editor.IStandaloneCodeEditor,
      monaco,
      range,
      () => {},
    );

    const node = widget()!.getDomNode();
    expect(node.textContent).toContain("Reformulating with AI…");
    expect(widget()!.getPosition()?.position).toEqual({ lineNumber: 4, column: 1 });
    expect(editor.createDecorationsCollection).toHaveBeenCalledWith([
      expect.objectContaining({
        range,
        options: expect.objectContaining({ className: "latexdo-reformulating-range" }),
      }),
    ]);
  });

  it("streams the rewrite into the popup", () => {
    const { editor, widget } = fakeEditor();
    const progress = showReformulationProgress(
      editor as unknown as Monaco.editor.IStandaloneCodeEditor,
      monaco,
      range,
      () => {},
    );
    const preview = widget()!
      .getDomNode()
      .querySelector<HTMLElement>(".latexdo-reformulate-progress-preview")!;
    expect(preview.hidden).toBe(true);

    progress.append("Our approach ");
    progress.append("outperforms\nprior methods.");

    expect(preview.hidden).toBe(false);
    expect(preview.textContent).toBe("Our approach outperforms prior methods.");
    expect(editor.layoutContentWidget).toHaveBeenCalled();
  });

  it("lets Escape cancel only while the popup is shown", () => {
    const { editor, contextKeys } = fakeEditor();
    const progress = showReformulationProgress(
      editor as unknown as Monaco.editor.IStandaloneCodeEditor,
      monaco,
      range,
      () => {},
    );
    expect(contextKeys.get(reformulatingContextKey)).toBe(true);
    progress.dispose();
    expect(contextKeys.get(reformulatingContextKey)).toBe(false);
  });

  it("cancels from the button and cleans up once", () => {
    const { editor, clear, widget } = fakeEditor();
    const onCancel = vi.fn();
    const progress = showReformulationProgress(
      editor as unknown as Monaco.editor.IStandaloneCodeEditor,
      monaco,
      range,
      onCancel,
    );

    const node = widget()!.getDomNode();
    node
      .querySelector<HTMLButtonElement>(".latexdo-reformulate-progress-cancel")!
      .click();
    expect(onCancel).toHaveBeenCalledTimes(1);

    progress.dispose();
    progress.dispose();
    progress.append("ignored");
    expect(editor.removeContentWidget).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(node.isConnected).toBe(false);
  });

  it("keeps the widget id stable, the selection on mousedown and shows the tail of long rewrites", () => {
    const { editor, widget } = fakeEditor();
    const progress = showReformulationProgress(
      editor as unknown as Monaco.editor.IStandaloneCodeEditor,
      monaco,
      range,
      () => {},
    );
    expect(widget()!.getId()).toBe("latexdo.reformulate.progress");
    const node = widget()!.getDomNode();
    const cancel = node.querySelector<HTMLButtonElement>(
      ".latexdo-reformulate-progress-cancel",
    )!;
    const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    cancel.dispatchEvent(mouseDown);
    expect(mouseDown.defaultPrevented).toBe(true);

    const preview = node.querySelector<HTMLElement>(
      ".latexdo-reformulate-progress-preview",
    )!;
    progress.append("");
    progress.append("   \n ");
    expect(preview.hidden).toBe(true);
    expect(editor.layoutContentWidget).not.toHaveBeenCalled();

    progress.append("a".repeat(300) + "END");
    expect(preview.textContent).toBe(`…${"a".repeat(217)}END`);
    expect(preview.textContent!.length).toBe(221);
  });
});
