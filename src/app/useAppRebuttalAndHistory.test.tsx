import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import * as monaco from "monaco-editor";
import { useAppRebuttalAndHistory } from "./useAppRebuttalAndHistory";
import { setMonaco } from "./appShared";
import type { AppCtx14 } from "./appContext";
import type { OpenDocument, RebuttalItem } from "../types";
import { rebuttalMacro } from "../features/review/rebuttalSource";
const item: RebuttalItem = {
  id: "r",
  originalText: "before",
  revisedText: "after",
  modificationMade: "after",
  reviewerComment: "why",
  authorComment: "because",
  insertedInTex: false,
  filePath: "main.tex",
};
const doc = (name = "main.tex", content = "text"): OpenDocument => ({
  name,
  path: `/p/${name}`,
  relativePath: name,
  kind: "text",
  content,
  savedContent: "old",
});
const api = { readFile: vi.fn(), writeFile: vi.fn() };
function setup(overrides: Record<string, unknown> = {}) {
  let selection: monaco.Selection | null = new monaco.Selection(1, 1, 1, 5);
  let text = "text";
  const model = {
    uri: monaco.Uri.file("/p/main.tex"),
    getValue: () => text,
    getValueInRange: () => text,
    getLineCount: () => 1,
    getLineLength: () => text.length,
    getOffsetAt: () => text.length,
    getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }),
  };
  const editor = {
    getModel: () => model,
    getSelection: () => selection,
    getPosition: vi.fn(() => ({ lineNumber: 1, column: 5 })),
    executeEdits: vi.fn(),
    focus: vi.fn(),
  };
  const documentsRef = { current: [doc()] };
  let items = [{ ...item }];
  let citations: { path: string; content: string }[] = [];
  let widths: Record<string, number> = {};
  const container = document.createElement("div");
  container.getBoundingClientRect = () => ({ left: 0, width: 1000 }) as DOMRect;
  const ctx = {
    activePathRef: { current: "/p/main.tex" },
    activeSidebar: "files",
    activeTextDocument: doc(),
    aiSidebarExpanded: false,
    allProjectEntries: [],
    dismissedUpdateVersion: null,
    documentsRef,
    editorPreviewRef: { current: container },
    editorRef: { current: editor },
    panelHeight: 200,
    previewShown: false,
    projectEntriesRef: { current: [{ ...doc("r.bib"), type: "file" }] },
    projectId: "p",
    projectIdRef: { current: "p" },
    rebuttalItems: items,
    rebuttalSourceQueueRef: { current: Promise.resolve() },
    refreshProject: vi.fn().mockResolvedValue([]),
    setActivePath: vi.fn(),
    setCitationProjectFiles: vi.fn(
      (fn: (files: typeof citations) => typeof citations) => {
        citations = fn(citations);
      },
    ),
    setDocuments: vi.fn((fn: (docs: OpenDocument[]) => OpenDocument[]) => {
      documentsRef.current = fn(documentsRef.current);
    }),
    setPanelHeight: vi.fn(),
    setRebuttalItems: vi.fn((fn: (previous: RebuttalItem[]) => RebuttalItem[]) => {
      items = fn(items);
    }),
    setSidebarWidths: vi.fn(
      (fn: (previous: Record<string, number>) => Record<string, number>) => {
        widths = fn(widths);
      },
    ),
    setSplitPercent: vi.fn(),
    setStatusMessage: vi.fn(),
    setWelcomeOpen: vi.fn(),
    showBlankWorkspace: false,
    showWelcome: false,
    sidebarWidths: {},
    splitPercent: 52,
    updateInfo: null,
    updateProgress: null,
    ...overrides,
  };
  return {
    ...renderHook(() => useAppRebuttalAndHistory(ctx as unknown as AppCtx14)),
    ctx,
    editor,
    setText: (value: string) => {
      text = value;
    },
    setSelection: (value: monaco.Selection | null) => {
      selection = value;
    },
    items: () => items,
    citations: () => citations,
    widths: () => widths,
  };
}
beforeEach(() => {
  setMonaco(monaco);
  api.readFile.mockReset().mockResolvedValue("disk");
  api.writeFile.mockReset().mockResolvedValue(undefined);
  window.latexdo = api as unknown as typeof window.latexdo;
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("rebuttal source editing", () => {
  it("adds empty items using the previous reviewer", () => {
    const h = setup();
    h.result.current.handleAddRebuttalItem();
    expect(h.items()).toHaveLength(2);
    expect(h.items()[1]).toMatchObject({ originalText: "", insertedInTex: false });
    h.items()[1].reviewer = "Reviewer 2";
    h.result.current.handleAddRebuttalItem();
    expect(h.items()[2].reviewer).toBe("Reviewer 2");
  });
  it("inserts the selected text and records the source file", () => {
    const h = setup();
    h.result.current.handleInsertRebuttalItemIntoTex("missing");
    expect(h.editor.executeEdits).not.toHaveBeenCalled();
    h.result.current.handleInsertRebuttalItemIntoTex("r");
    expect(h.editor.executeEdits).toHaveBeenCalledWith("rebuttal-mode", [
      expect.objectContaining({ text: "\\rebuttal{text}{why}{because}{after}" }),
    ]);
    expect(h.items()[0]).toMatchObject({
      insertedInTex: true,
      filePath: "main.tex",
      originalText: "text",
    });
  });
  it("requires an editor matching the document and a nonblank selection", () => {
    const h = setup();
    h.setSelection(null);
    h.result.current.handleInsertRebuttalItemIntoTex("r");
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      expect.stringContaining("Select the text"),
    );
    h.ctx.activePathRef.current = "missing";
    h.result.current.handleInsertRebuttalItemIntoTex("r");
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      expect.stringContaining("Open a TeX file"),
    );
  });
  it("updates and deletes inserted blocks in open documents, preserving other tabs", async () => {
    const inserted = { ...item, insertedInTex: true };
    const h = setup({ rebuttalItems: [inserted] });
    const other = doc("other.tex");
    h.ctx.documentsRef.current = [other, doc("main.tex", rebuttalMacro(inserted))];
    h.result.current.handleUpdateRebuttalItem("missing", {});
    h.result.current.handleUpdateRebuttalItem("r", { authorComment: "new answer" });
    await h.ctx.rebuttalSourceQueueRef.current;
    expect(h.ctx.documentsRef.current[1].content).toContain("{new answer}");
    expect(h.ctx.documentsRef.current[0]).toBe(other);
    h.ctx.rebuttalItems = h.items();
    h.rerender();
    h.result.current.handleDeleteRebuttalItem("r");
    await h.ctx.rebuttalSourceQueueRef.current;
    expect(h.ctx.documentsRef.current[1].content).toBe("after");
    expect(h.items()).toEqual([]);
  });
  it.each(["closed", "no-block", "unreadable"])(
    "handles %s source files",
    async (scenario) => {
      const inserted = { ...item, insertedInTex: true };
      const h = setup({ rebuttalItems: [inserted] });
      h.ctx.documentsRef.current = [];
      api.readFile.mockResolvedValue(
        scenario === "closed" ? rebuttalMacro(inserted) : "unrelated",
      );
      if (scenario === "unreadable")
        api.readFile.mockRejectedValue(new Error("denied"));
      h.result.current.handleUpdateRebuttalItem("r", { authorComment: "new" });
      await h.ctx.rebuttalSourceQueueRef.current;
      if (scenario === "closed")
        expect(api.writeFile).toHaveBeenCalledWith(
          "p",
          "main.tex",
          expect.stringContaining("{new}"),
        );
      else
        expect(h.ctx.setStatusMessage).toHaveBeenCalledWith(
          expect.stringContaining("no longer updates"),
        );
    },
  );
  it("searches open documents for legacy items without a source path", async () => {
    const inserted = { ...item, filePath: undefined, insertedInTex: true };
    const h = setup({ rebuttalItems: [inserted] });
    h.ctx.documentsRef.current = [
      doc("other.tex"),
      doc("main.tex", rebuttalMacro(inserted)),
    ];
    h.result.current.handleDeleteRebuttalItem("r");
    await h.ctx.rebuttalSourceQueueRef.current;
    expect(h.ctx.documentsRef.current[1].content).toBe("after");
    h.ctx.documentsRef.current = [];
    h.result.current.handleDeleteRebuttalItem("r");
    await h.ctx.rebuttalSourceQueueRef.current;
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      expect.stringContaining("not found"),
    );
  });
  it("respects cancellation and edits items not inserted into TeX", () => {
    const h = setup();
    h.result.current.handleUpdateRebuttalItem("r", { authorComment: "answer" });
    expect(h.items()[0].authorComment).toBe("answer");
    vi.mocked(window.confirm).mockReturnValue(false);
    h.result.current.handleDeleteRebuttalItem("r");
    expect(h.items()).toHaveLength(1);
    h.result.current.handleDeleteRebuttalItem("missing");
    vi.mocked(window.confirm).mockReturnValue(true);
    h.result.current.handleDeleteRebuttalItem("r");
    expect(h.items()).toEqual([]);
    expect(api.writeFile).not.toHaveBeenCalled();
  });
});
describe("editor insertions", () => {
  it.each(["$x$", "\\[x = y\\]"])("wraps the selection in %s", (snippet) => {
    const h = setup();
    h.result.current.handleInsertNotationCode(snippet);
    expect(h.editor.executeEdits).toHaveBeenCalledWith("notation-manager", [
      expect.objectContaining({
        text: snippet === "$x$" ? "$text$" : "\n\\[text\\]\n",
      }),
    ]);
    expect(h.editor.focus).toHaveBeenCalled();
    h.setSelection(null);
    h.result.current.handleInsertNotationCode(snippet);
    expect(h.editor.executeEdits).toHaveBeenLastCalledWith("notation-manager", [
      expect.objectContaining({ text: snippet === "$x$" ? "$x$" : "\n\\[x = y\\]\n" }),
    ]);
  });
  it("rejects insertions into a missing or non-TeX document", () => {
    const h = setup();
    h.ctx.documentsRef.current = [];
    h.result.current.handleInsertNotationCode("x");
    h.result.current.handleInsertCitationCode("key", "cite");
    expect(h.editor.executeEdits).not.toHaveBeenCalled();
    expect(h.ctx.setStatusMessage).toHaveBeenCalledWith(
      expect.stringContaining("before inserting a citation"),
    );
  });
  it("inserts citations at a selection or cursor and avoids duplicates", () => {
    const h = setup();
    h.result.current.handleInsertCitationCode("smith", "cite");
    expect(h.editor.executeEdits).toHaveBeenCalledWith("citation-manager", [
      expect.objectContaining({ text: expect.stringContaining("\\cite{smith}") }),
    ]);
    h.editor.executeEdits.mockClear();
    h.setText("\\cite{smith}");
    h.result.current.handleInsertCitationCode("smith", "cite");
    expect(h.editor.executeEdits).not.toHaveBeenCalled();
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      expect.stringContaining("Already cited in the selection"),
    );
    h.setSelection(null);
    h.result.current.handleInsertCitationCode("smith", "cite");
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      expect.stringContaining("Already cited near the cursor"),
    );
    h.setText("new claim");
    h.result.current.handleInsertCitationCode("jones", "cite");
    expect(h.editor.executeEdits).toHaveBeenCalled();
  });
});
describe("bibliography appends", () => {
  it("uses unsaved text and updates both open documents and citation index", async () => {
    const h = setup();
    const other = doc();
    h.ctx.documentsRef.current = [other, doc("r.bib", "editor  \n")];
    await h.result.current.handleAppendBibEntry("r.bib", "@book{a}");
    expect(api.writeFile).toHaveBeenCalledWith("p", "r.bib", "editor\n\n@book{a}\n");
    expect(h.ctx.documentsRef.current[0]).toBe(other);
    expect(h.ctx.documentsRef.current[1].savedContent).toContain("@book{a}");
    await h.result.current.handleAppendBibEntry("r.bib", "@book{b}");
    expect(h.citations()).toHaveLength(1);
    expect(h.citations()[0].content).toContain("@book{b}");
  });
  it("reads closed files and reports unavailable projects, missing files and errors", async () => {
    const h = setup();
    await h.result.current.handleAppendBibEntry("r.bib", "new");
    expect(api.readFile).toHaveBeenCalledWith("p", "r.bib");
    for (const error of [new Error("denied"), "bad"]) {
      api.writeFile.mockRejectedValueOnce(error);
      await h.result.current.handleAppendBibEntry("r.bib", "new");
      expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
        error instanceof Error ? "denied" : "Could not update BibTeX file",
      );
    }
    await h.result.current.handleAppendBibEntry("missing", "new");
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith("Could not find missing");
    h.ctx.projectIdRef.current = "";
    await h.result.current.handleAppendBibEntry("r.bib", "new");
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      "Open a project before editing BibTeX.",
    );
  });
});
const keyEvent = (key: string, currentTarget: HTMLDivElement, shiftKey = false) =>
  ({
    key,
    currentTarget,
    shiftKey,
    preventDefault: vi.fn(),
  }) as unknown as ReactKeyboardEvent<HTMLDivElement>;
describe("pane resizing", () => {
  it("nudges and resets split and sidebar widths", () => {
    const h = setup();
    const wrapper = document.createElement("div");
    const sidebar = document.createElement("div");
    const handle = document.createElement("div");
    wrapper.append(sidebar, handle);
    sidebar.getBoundingClientRect = () => ({ left: 10, width: 300 }) as DOMRect;
    for (const key of ["ArrowLeft", "ArrowRight", "Home", "Enter", "other"]) {
      h.result.current.nudgeSplit(keyEvent(key, handle));
      h.result.current.nudgeSidebar(keyEvent(key, handle, true));
    }
    expect(h.ctx.setSplitPercent).toHaveBeenCalledWith(50.4);
    expect(h.ctx.setSplitPercent).toHaveBeenCalledWith(53.6);
    expect(h.ctx.setSplitPercent).toHaveBeenCalledWith(52);
    expect(h.widths()).toEqual({});
    const orphan = document.createElement("div");
    h.result.current.nudgeSidebar(keyEvent("ArrowLeft", orphan));
    h.result.current.startSidebarResize({
      currentTarget: orphan,
    } as ReactPointerEvent<HTMLDivElement>);
  });
  it("clamps panel dragging and removes listeners after release", () => {
    const h = setup();
    const main = document.createElement("div");
    main.className = "main-area";
    Object.defineProperty(main, "clientHeight", { value: 600 });
    document.body.append(main);
    const handle = document.createElement("div");
    handle.setPointerCapture = vi.fn();
    h.result.current.startPanelResize({
      button: 0,
      currentTarget: handle,
      pointerId: 1,
      clientY: 300,
      preventDefault: vi.fn(),
    } as unknown as ReactPointerEvent<HTMLDivElement>);
    expect(handle.classList.contains("dragging")).toBe(true);
    expect(document.body.classList.contains("pane-resizing-row")).toBe(true);
    window.dispatchEvent(new MouseEvent("pointermove", { clientY: 0 }));
    expect(h.ctx.setPanelHeight).toHaveBeenLastCalledWith(500);
    window.dispatchEvent(new MouseEvent("pointermove", { clientY: 1000 }));
    expect(h.ctx.setPanelHeight).toHaveBeenLastCalledWith(80);
    window.dispatchEvent(new Event("pointerup"));
    expect(document.body.classList.contains("pane-resizing-row")).toBe(false);
    h.ctx.setPanelHeight.mockClear();
    window.dispatchEvent(new MouseEvent("pointermove", { clientY: 0 }));
    expect(h.ctx.setPanelHeight).not.toHaveBeenCalled();
    h.result.current.nudgePanel(keyEvent("ArrowUp", handle));
    expect(h.ctx.setPanelHeight).toHaveBeenLastCalledWith(216);
    h.result.current.nudgePanel(keyEvent("ArrowDown", handle, true));
    expect(h.ctx.setPanelHeight).toHaveBeenLastCalledWith(136);
    h.result.current.resetPanelHeight();
    expect(h.ctx.setPanelHeight).toHaveBeenLastCalledWith(200);
    main.remove();
  });
  it("uses the expanded AI sidebar width and reports build defaults", () => {
    const h = setup({
      activeSidebar: "ai",
      aiSidebarExpanded: true,
      sidebarWidths: { "ai-expanded": 400 },
    });
    expect(h.result.current.sidebarWidthStyle).toMatchObject({ width: 400 });
    expect(h.result.current.currentBuildVersion).toBe("Unknown");
    expect(h.result.current.updateBannerVisible).toBe(false);
  });
});
