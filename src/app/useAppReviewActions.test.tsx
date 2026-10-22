/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as monaco from "monaco-editor";
import { useAppReviewActions } from "./useAppReviewActions";
import type { AppCtx13 } from "./appContext";
import { defaultAiConfig } from "../features/ai/aiConfig";
import { rebuttalLetterFileName } from "../rebuttalGenerator";
import { hookContext } from "./__tests__/hookHarness";
import { editorHarness } from "./__tests__/editorHarness";
const api = { readFile: vi.fn(), writeFile: vi.fn(), fileExists: vi.fn() };
function setup(overrides = {}) {
  const e = editorHarness();
  const entry = { ...e.document, type: "file" };
  const { ctx, state } = hookContext(
    {
      aiConfig: defaultAiConfig,
      aiIsDesktop: false,
      nextEditConfig: { semanticEnabled: false },
      activePathRef: { current: e.document.path },
      documentsRef: { current: [e.document] },
      documents: [e.document],
      editorRef: { current: e.editor },
      projectIdRef: { current: "p" },
      rootFileRef: { current: "main.tex" },
      projectPathRef: { current: "/p" },
      projectEntriesRef: { current: [entry] },
      allProjectEntries: [entry],
      reviewChats: [],
      rebuttalItems: [],
      mode: "reviewer",
      pendingSourceRef: { current: null },
      ...overrides,
    },
    [
      "setCitationSearchAnchor",
      "setDocuments",
      "setEditorCursorLine",
      "setFileBlameEnabled",
      "setRebuttalItems",
      "setReviewChats",
      "setStatusMessage",
    ],
    [
      "compile",
      "compileEntry",
      "openDocument",
      "refreshProject",
      "revealPendingSource",
      "saveReviewData",
    ],
  );
  return {
    ...renderHook(() => useAppReviewActions(ctx as AppCtx13)),
    ctx,
    state,
    ...e,
    entry,
  };
}
function chat(extra = {}) {
  return {
    id: "thread",
    filePath: "main.tex",
    selection: {
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 6,
      text: "First",
    },
    comments: [
      { id: "comment", author: "Reviewer", text: "Clarify & explain", timestamp: 1 },
    ],
    ...extra,
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  for (const mock of Object.values(api)) mock.mockReset().mockResolvedValue(undefined);
  api.fileExists.mockResolvedValue(false);
  api.readFile.mockResolvedValue("First line");
  window.latexdo = api as unknown as typeof window.latexdo;
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  for (const model of monaco.editor.getModels()) model.dispose();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("review conversations", () => {
  it("creates a thread from selection and appends comments using the active role", () => {
    const h = setup();
    h.result.current.handleAddReviewChat();
    expect(h.state.reviewChats[0]).toMatchObject({
      filePath: "main.tex",
      selection: { text: "Fir" },
      comments: [],
    });
    const id = h.state.reviewChats[0].id;
    h.result.current.handleAddReviewComment(id, "Check");
    expect(h.state.reviewChats[0].comments[0]).toMatchObject({
      text: "Check",
      author: "Reviewer",
    });
    h.ctx.mode = "author";
    h.rerender();
    h.result.current.handleAddReviewComment(id, "Fixed");
    expect(h.state.reviewChats[0].comments[1].author).toBe("Author");
  });
  it("rejects empty selections and absent editors", () => {
    const h = setup();
    h.editor.setPosition({ lineNumber: 1, column: 1 });
    h.result.current.handleAddReviewChat();
    expect(h.state.statusMessage).toContain("Select text");
    h.result.current.handleAddRebuttalToSource();
    expect(h.state.statusMessage).toContain("Select the text");
    h.ctx.editorRef.current = null;
    h.result.current.handleAddReviewChat();
    expect(h.state.statusMessage).toContain("Open a document");
  });
  it("inserts and deletes source markup without losing selected text", async () => {
    const thread = chat();
    const h = setup({ reviewChats: [thread] });
    await h.result.current.handleInsertReviewChatIntoTex(thread as any);
    expect(h.state.documents[0].content).toContain(
      "\\latexdoreviewercomment{\\textbf{Reviewer:} Clarify \\& explain}",
    );
    expect(h.state.reviewChats[0].insertedInTex).toBe(true);
    h.ctx.reviewChats = h.state.reviewChats;
    h.rerender();
    await h.result.current.handleDeleteReviewChat("thread");
    expect(h.state.reviewChats).toEqual([]);
    expect(h.state.documents[0].content).toBe(h.document.content);
  });
  it("writes markup for unopened documents and recompiles", async () => {
    const thread = chat();
    const h = setup({ documentsRef: { current: [] }, reviewChats: [thread] });
    await h.result.current.handleInsertReviewChatIntoTex(thread as any);
    expect(api.writeFile).toHaveBeenCalledWith(
      "p",
      "main.tex",
      expect.stringContaining("\\latexdoreviewercomment"),
    );
    expect(h.ctx.compile).toHaveBeenCalledOnce();
  });
  it("guards already-inserted, empty, missing and unreadable review targets", async () => {
    const h = setup();
    for (const [thread, message] of [
      [chat({ insertedInTex: true }), "already"],
      [chat({ comments: [] }), "at least one"],
      [chat({ selection: { ...chat().selection, text: "Missing" } }), "Could not find"],
    ] as const) {
      await h.result.current.handleInsertReviewChatIntoTex(thread as any);
      expect(h.state.statusMessage).toContain(message);
    }
    h.ctx.documentsRef.current = [];
    api.readFile.mockRejectedValue(new Error("denied"));
    await h.result.current.handleInsertReviewChatIntoTex(chat() as any);
    expect(h.state.statusMessage).toContain("Could not read");
    expect(api.writeFile).not.toHaveBeenCalled();
  });
  it("requires confirmation to delete a thread whose markup is missing", async () => {
    const h = setup({ reviewChats: [chat({ insertedInTex: true })] });
    vi.mocked(window.confirm).mockReturnValueOnce(true).mockReturnValueOnce(false);
    await h.result.current.handleDeleteReviewChat("thread");
    expect(h.state.reviewChats).toHaveLength(1);
    await h.result.current.handleDeleteReviewChat("thread");
    expect(h.state.reviewChats).toEqual([]);
    expect(h.state.statusMessage).toContain("Remove its comment");
  });
  it("jumps to moved selections and updates the stored anchor", async () => {
    const thread = chat();
    const h = setup({ reviewChats: [thread] });
    h.ctx.documentsRef.current = [
      { ...h.document, content: "Inserted line\n" + h.document.content },
    ];
    await h.result.current.handleJumpToReviewSelection(thread as any);
    expect(h.ctx.pendingSourceRef.current.line).toBe(2);
    expect(h.state.reviewChats[0].selection.startLine).toBe(2);
    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(h.ctx.revealPendingSource).toHaveBeenCalled();
    await h.result.current.handleJumpToReviewSelection({
      ...thread,
      filePath: "gone.tex",
    } as any);
    expect(h.state.statusMessage).toContain("no longer");
  });
  it("inserts a rebuttal block and inherits the last reviewer", () => {
    const h = setup({ rebuttalItems: [{ reviewer: "Reviewer 3" }] });
    h.result.current.handleAddRebuttalToSource();
    expect(h.model.getValue()).toContain("\\rebuttal");
    expect(h.state.rebuttalItems[1]).toMatchObject({
      reviewer: "Reviewer 3",
      originalText: "Fir",
      insertedInTex: true,
    });
  });
});
describe("response-letter creation", () => {
  it("writes, opens and compiles a response letter", async () => {
    const h = setup();
    const letter = {
      ...h.entry,
      path: "/p/" + rebuttalLetterFileName,
      relativePath: rebuttalLetterFileName,
      name: rebuttalLetterFileName,
    };
    h.ctx.projectEntriesRef.current.push(letter);
    await act(async () => h.result.current.handleGenerateRebuttalLetter());
    expect(api.writeFile).toHaveBeenCalledWith(
      "p",
      rebuttalLetterFileName,
      expect.stringContaining("\\documentclass"),
    );
    expect(h.ctx.openDocument).toHaveBeenCalledWith(letter);
    expect(h.ctx.compileEntry).toHaveBeenCalledWith(letter);
    await h.result.current.openRebuttalLetter();
    expect(h.ctx.openDocument).toHaveBeenCalledTimes(2);
  });
  it("preserves an edited response letter by creating a separate file", async () => {
    const h = setup();
    api.fileExists.mockResolvedValue(true);
    api.readFile.mockResolvedValue("Manually edited letter");
    vi.mocked(window.confirm).mockReturnValue(false);
    await act(async () => h.result.current.handleGenerateRebuttalLetter());
    expect(api.writeFile.mock.calls[0][1]).not.toBe(rebuttalLetterFileName);
    expect(h.result.current.rebuttalLetterPath).toBe(api.writeFile.mock.calls[0][1]);
    await h.result.current.openRebuttalLetter();
    expect(h.state.statusMessage).toContain("no longer");
  });
  it("reports failed writes and missing projects", async () => {
    const h = setup();
    api.writeFile.mockRejectedValue(new Error("disk full"));
    await act(async () => h.result.current.handleGenerateRebuttalLetter());
    expect(h.state.statusMessage).toContain("disk full");
    h.ctx.projectIdRef.current = "";
    await h.result.current.handleGenerateRebuttalLetter();
    expect(h.state.statusMessage).toContain("Open a project");
  });
});
