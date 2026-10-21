import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DragEvent, FormEvent } from "react";
import { useAppProjectCreation } from "./useAppProjectCreation";
import type { AppCtx09 } from "./appContext";
import type { OpenDocument, ProjectEntry } from "../types";
import { welcomeTemplates } from "../features/settings/settings";
const entry = (name = "main.tex"): ProjectEntry => ({
  name,
  path: `/p/${name}`,
  relativePath: name,
  type: "file",
});
const project = { id: "p", rootPath: "/p", name: "Paper", entries: [entry()] };
const api = {
  createProject: vi.fn(),
  createResearchSpace: vi.fn(),
  writeFile: vi.fn(),
  createFile: vi.fn(),
  createFolder: vi.fn(),
  getDroppedFilePaths: vi.fn(),
  importExternalFiles: vi.fn(),
  chooseImportExternalFiles: vi.fn(),
  importDocx: vi.fn(),
  importMarkdown: vi.fn(),
  importPdf: vi.fn(),
  updateCollaborationPermission: vi.fn(),
  removeCollaborator: vi.fn(),
  updateCollaborationPresence: vi.fn(),
  onHostSharingChanged: vi.fn(),
};
function setup(overrides: Record<string, unknown> = {}) {
  const documentsRef = { current: [] as OpenDocument[] };
  const ctx = {
    projectEntriesRef: { current: [entry()] },
    activeDocumentIsLatex: true,
    activePath: "/p/main.tex",
    activePathRef: { current: "/p/main.tex" },
    closedTabPathsRef: { current: [] as string[] },
    collaborationAvailable: false,
    collaborationState: { enabled: false, users: [], revision: 1 },
    createDialog: "file",
    createPath: "new.tex",
    defaultCreateRelativePath: vi.fn(() => "chapter.tex"),
    documentsRef,
    editorPathBeforeWelcomeRef: { current: "" },
    editorRef: {
      current: {
        getTargetAtClientPoint: () => null,
        getPosition: () => ({ lineNumber: 1, column: 1 }),
      },
    },
    hideProjectEntries: false,
    hideProjectEntriesRef: { current: false },
    hostingAvailable: false,
    insertLatexBlockAtEditorPosition: vi.fn(() => true),
    loadCollaborationPermissions: vi.fn().mockResolvedValue(undefined),
    loadProject: vi.fn().mockResolvedValue(undefined),
    openDocument: vi.fn().mockResolvedValue(undefined),
    paperReviewImporting: false,
    pdfReviewInputRef: { current: { click: vi.fn() } },
    projectId: "p",
    projectIdRef: { current: "p" },
    refreshCollaborationState: vi.fn().mockResolvedValue(undefined),
    refreshProject: vi.fn().mockResolvedValue([entry("new.tex"), entry()]),
    reopenClosedTabArmedRef: { current: false },
    requireLegalAcceptance: vi.fn(() => false),
    rootFileRef: { current: "main.tex" },
    setActivePath: vi.fn(),
    setCollaborationState: vi.fn(),
    setCreateDialog: vi.fn(),
    setCreateError: vi.fn(),
    setCreatePath: vi.fn(),
    setCreating: vi.fn(),
    setCurrentUserRole: vi.fn(),
    setDocuments: vi.fn(
      (next: OpenDocument[] | ((docs: OpenDocument[]) => OpenDocument[])) => {
        documentsRef.current =
          typeof next === "function" ? next(documentsRef.current) : next;
      },
    ),
    setDocxImporting: vi.fn(),
    setIsProjectAdmin: vi.fn(),
    setMarkdownImporting: vi.fn(),
    setMode: vi.fn(),
    setPaperReviewImporting: vi.fn(),
    setPdfImporting: vi.fn(),
    setPreviewVisible: vi.fn(),
    setRootFile: vi.fn(),
    setStatusMessage: vi.fn(),
    setTemplateCreating: vi.fn(),
    setWelcomeOpen: vi.fn(),
    standalonePdfReviewActiveRef: { current: false },
    templateCreating: null,
    ...overrides,
  };
  return {
    ...renderHook(() => useAppProjectCreation(ctx as unknown as AppCtx09)),
    ctx,
  };
}
const imported = () => ({
  project,
  relativePath: "main.tex",
  sourcePath: "/external/input.docx",
  converter: "pandoc",
  mediaFiles: [],
  warnings: [],
  stats: {
    pages: 1,
    paragraphs: 1,
    headings: 1,
    figures: 0,
    tables: 0,
    equations: 0,
    references: 0,
  },
});
beforeEach(() => {
  vi.useFakeTimers();
  for (const mock of Object.values(api)) mock.mockReset().mockResolvedValue(undefined);
  api.createProject.mockResolvedValue(project);
  api.createResearchSpace.mockResolvedValue(project);
  api.createFile.mockResolvedValue("new.tex");
  api.getDroppedFilePaths.mockReturnValue(["/external/a.png"]);
  api.importExternalFiles.mockResolvedValue([entry("figures/a.png")]);
  api.chooseImportExternalFiles.mockResolvedValue([entry("a.png")]);
  for (const kind of ["importDocx", "importMarkdown", "importPdf"] as const)
    api[kind].mockResolvedValue(imported());
  api.updateCollaborationPresence.mockResolvedValue({
    enabled: true,
    users: [],
    currentUserRole: "editor",
    isAdmin: false,
  });
  api.onHostSharingChanged.mockReturnValue(vi.fn());
  window.latexdo = api as unknown as typeof window.latexdo;
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("project creation and file dialogs", () => {
  it("creates and loads projects and Research Spaces, respecting legal acceptance", async () => {
    const h = setup();
    await h.result.current.createProject();
    expect(h.ctx.loadProject).toHaveBeenCalledWith(project, true, false);
    await h.result.current.createResearchSpace();
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith("Research Space ready");
    h.ctx.requireLegalAcceptance.mockReturnValue(true);
    api.createResearchSpace.mockClear();
    await h.result.current.createResearchSpace();
    expect(api.createResearchSpace).not.toHaveBeenCalled();
  });
  it.each([new Error("denied"), "bad"])("reports creation failures", async (error) => {
    const h = setup();
    api.createProject.mockRejectedValue(error);
    api.createResearchSpace.mockRejectedValue(error);
    await h.result.current.createProject();
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      error instanceof Error ? "denied" : "Could not create project",
    );
    await h.result.current.createResearchSpace();
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      error instanceof Error ? "denied" : "Could not create Research Space",
    );
  });
  it("handles cancelled dialogs and writes template source and bibliography", async () => {
    const h = setup();
    api.createProject.mockResolvedValueOnce(null);
    await h.result.current.createProject();
    expect(h.ctx.loadProject).not.toHaveBeenCalled();
    api.createResearchSpace.mockResolvedValueOnce(null);
    await h.result.current.createResearchSpace();
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      expect.stringContaining("Welcome"),
    );
    const template = { ...welcomeTemplates[0], bibTex: "@book{a}" };
    await h.result.current.createProjectFromTemplate(template);
    expect(api.writeFile).toHaveBeenCalledWith("p", "references.bib", "@book{a}");
    expect(h.ctx.setTemplateCreating).toHaveBeenLastCalledWith(null);
    for (const t of welcomeTemplates)
      expect(h.result.current.renderTemplateIcon(t)).toBeTruthy();
  });
  it("opens file/folder dialogs and submits both kinds", async () => {
    const h = setup();
    h.result.current.openCreateDialog("file");
    expect(h.ctx.setCreatePath).toHaveBeenCalledWith("chapter.tex");
    h.result.current.openCreateDialogInDirectory("folder", {
      ...entry("sections"),
      type: "directory",
    });
    expect(h.ctx.setCreatePath).toHaveBeenLastCalledWith("sections/chapters");
    const event = { preventDefault: vi.fn() } as unknown as FormEvent;
    await h.result.current.submitCreate(event);
    expect(h.ctx.openDocument).toHaveBeenCalledWith(entry("new.tex"));
    expect(h.ctx.setCreateDialog).toHaveBeenLastCalledWith(null);
    h.ctx.createDialog = "folder";
    h.rerender();
    await h.result.current.submitCreate(event);
    expect(api.createFolder).toHaveBeenCalledWith("p", "new.tex");
    h.ctx.createPath = " ";
    h.rerender();
    await h.result.current.submitCreate(event);
    expect(h.ctx.setCreateError).toHaveBeenLastCalledWith("Enter a name or path.");
  });
  it("reports creation failures and missing created files", async () => {
    const h = setup();
    h.ctx.refreshProject.mockResolvedValue([]);
    await h.result.current.submitCreate({
      preventDefault: vi.fn(),
    } as unknown as FormEvent);
    expect(h.ctx.setCreateError).toHaveBeenLastCalledWith(
      "The file was created but could not be opened.",
    );
    api.createFile.mockRejectedValue(
      new Error("Error invoking remote method 'file:create': denied"),
    );
    await h.result.current.submitCreate({
      preventDefault: vi.fn(),
    } as unknown as FormEvent);
    expect(h.ctx.setCreateError).toHaveBeenLastCalledWith("denied");
    expect(h.ctx.setCreating).toHaveBeenLastCalledWith(false);
  });
});
describe("document import", () => {
  it.each(["importDocx", "importMarkdown", "importPdf"] as const)(
    "loads %s output and resets its busy indicator",
    async (kind) => {
      const h = setup();
      await h.result.current[kind]();
      expect(h.ctx.openDocument).toHaveBeenCalledWith(entry(), "p");
      expect(h.ctx.setRootFile).toHaveBeenCalledWith("main.tex");
      expect(h.ctx.setWelcomeOpen).toHaveBeenCalledWith(false);
      api[kind].mockResolvedValueOnce(null);
      h.ctx.openDocument.mockClear();
      await h.result.current[kind]();
      expect(h.ctx.openDocument).not.toHaveBeenCalled();
      api[kind].mockRejectedValueOnce(new Error("No handler registered"));
      await h.result.current[kind]();
      expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
        expect.stringContaining("Restart the LatexDo app"),
      );
      api[kind].mockRejectedValueOnce(
        new Error("Error invoking remote method 'import': denied"),
      );
      await h.result.current[kind]();
      expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith("denied");
      api[kind].mockRejectedValueOnce("bad");
      await h.result.current[kind]();
      expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
        expect.stringContaining("Could not import"),
      );
    },
  );
  it("loads an imported project and rejects results without a TeX document", async () => {
    const h = setup();
    h.ctx.projectIdRef.current = "";
    api.importDocx.mockResolvedValue({
      ...imported(),
      mediaFiles: ["x.png"],
      warnings: ["Check formatting"],
      converter: "builtin",
    });
    await h.result.current.importDocx();
    expect(h.ctx.loadProject).toHaveBeenCalledWith(project, false, false);
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      expect.stringContaining("1 media file"),
    );
    api.importDocx.mockResolvedValue({ ...imported(), project: undefined });
    await h.result.current.importDocx();
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      "Import did not return a project.",
    );
    api.importDocx.mockResolvedValue({ ...imported(), relativePath: "missing.tex" });
    await h.result.current.importDocx();
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      "Imported file missing.tex was not found.",
    );
    h.ctx.refreshProject.mockResolvedValue([entry("main.pdf")]);
    api.importDocx.mockResolvedValue({ ...imported(), relativePath: "main.pdf" });
    await h.result.current.importDocx();
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      "Imported file main.pdf is not a TeX file.",
    );
  });
  it("imports external files and reports cancellation, unavailable paths and errors", async () => {
    const h = setup();
    await h.result.current.importExternalFiles([], null);
    expect(api.importExternalFiles).toHaveBeenCalledWith("p", "", ["/external/a.png"]);
    await h.result.current.chooseImportFiles(entry("figures"));
    expect(api.chooseImportExternalFiles).toHaveBeenCalledWith("p", "figures");
    api.chooseImportExternalFiles.mockResolvedValue([]);
    h.ctx.refreshProject.mockClear();
    await h.result.current.chooseImportFiles(null);
    expect(h.ctx.refreshProject).not.toHaveBeenCalled();
    api.getDroppedFilePaths.mockReturnValue([]);
    await h.result.current.importExternalFiles([], null);
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      expect.stringContaining("desktop app"),
    );
    api.chooseImportExternalFiles.mockRejectedValue("bad");
    await h.result.current.chooseImportFiles(null);
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith("Could not import files.");
    h.ctx.projectIdRef.current = "";
    await h.result.current.chooseImportFiles(null);
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      "Open a project before importing files.",
    );
  });
  it("opens local PDFs for review and handles unreadable input", async () => {
    const h = setup();
    const file = {
      name: "paper.pdf",
      arrayBuffer: async () => new Uint8Array([1, 2]).buffer,
    } as File;
    await h.result.current.openPdfFileForReview(file);
    expect(h.ctx.documentsRef.current[0]).toMatchObject({
      kind: "asset",
      assetMimeType: "application/pdf",
      assetSizeBytes: 2,
    });
    expect(h.ctx.setPreviewVisible).toHaveBeenCalledWith(false);
    expect(h.ctx.setMode).toHaveBeenCalledWith("author");
    await h.result.current.openPdfFileForReview({
      ...file,
      arrayBuffer: async () => {
        throw new Error("denied");
      },
    } as File);
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith("denied");
    expect(h.ctx.setPaperReviewImporting).toHaveBeenLastCalledWith(false);
    h.result.current.reviewPaper();
    expect(h.ctx.pdfReviewInputRef.current.click).toHaveBeenCalled();
  });
});
const drop = (paths: string[], files: File[] = []) =>
  ({
    dataTransfer: { files, getData: () => paths[0] ?? "" },
    clientX: 1,
    clientY: 1,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  }) as unknown as DragEvent<HTMLDivElement>;
describe("file references and tabs", () => {
  it("inserts project-file references or opens unsupported files", async () => {
    const h = setup();
    await h.result.current.handleEditorFileDrop(drop(["/p/main.tex"]));
    expect(h.ctx.insertLatexBlockAtEditorPosition).toHaveBeenCalledWith(
      expect.stringContaining("\\input"),
      expect.anything(),
    );
    h.ctx.projectEntriesRef.current = [entry("notes.txt")];
    await h.result.current.handleEditorFileDrop(drop(["/p/notes.txt"]));
    expect(h.ctx.openDocument).toHaveBeenCalledWith(entry("notes.txt"));
    h.result.current.insertImageReference(entry("plot.png"));
    expect(h.ctx.insertLatexBlockAtEditorPosition).toHaveBeenCalledWith(
      expect.stringContaining("plot.png"),
    );
    h.result.current.insertImageReference(entry());
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      expect.stringContaining("Choose an image"),
    );
  });
  it("imports dropped images before inserting their figure code", async () => {
    const h = setup();
    api.createFolder.mockRejectedValue(new Error("exists"));
    await h.result.current.handleEditorFileDrop(drop([], [new File([], "a.png")]));
    expect(api.importExternalFiles).toHaveBeenCalledWith("p", "figures", [
      "/external/a.png",
    ]);
    expect(h.ctx.insertLatexBlockAtEditorPosition).toHaveBeenCalledWith(
      expect.stringContaining("figures/a.png"),
      expect.anything(),
    );
    api.getDroppedFilePaths.mockReturnValue(["/external/a.txt"]);
    api.importExternalFiles.mockResolvedValue([entry()]);
    await h.result.current.handleEditorFileDrop(drop([], [new File([], "a.txt")]));
    expect(h.ctx.openDocument).toHaveBeenCalledWith(entry());
  });
  it("confirms closing dirty tabs, remembers closed tabs and opens Welcome", () => {
    const h = setup();
    const documents = [
      { ...entry(), kind: "text", content: "new", savedContent: "old" },
      { ...entry("other.tex"), kind: "text", content: "", savedContent: "" },
    ] as OpenDocument[];
    h.ctx.documentsRef.current = documents;
    vi.mocked(window.confirm).mockReturnValue(false);
    h.result.current.closeDocument("/p/main.tex");
    expect(h.ctx.documentsRef.current).toHaveLength(2);
    vi.mocked(window.confirm).mockReturnValue(true);
    h.result.current.closeDocument("/p/main.tex");
    expect(h.ctx.activePathRef.current).toBe("/p/other.tex");
    expect(h.ctx.closedTabPathsRef.current).toEqual(["/p/main.tex"]);
    h.result.current.showWelcomePage();
    expect(h.ctx.editorPathBeforeWelcomeRef.current).toBe("/p/other.tex");
    expect(h.ctx.activePathRef.current).toBe("");
    h.result.current.closeDocument("/p/other.tex");
    expect(h.ctx.documentsRef.current).toEqual([]);
  });
});
describe("collaboration maintenance", () => {
  it("updates permissions, removes collaborators and refreshes invitations", async () => {
    const h = setup({ collaborationAvailable: true });
    await h.result.current.handleUpdatePermission({ clientId: "c", role: "viewer" });
    expect(api.updateCollaborationPermission).toHaveBeenCalledWith("p", {
      clientId: "c",
      role: "viewer",
    });
    await h.result.current.handleRemoveCollaborator("c");
    expect(h.ctx.refreshCollaborationState).toHaveBeenCalledWith("p");
    api.removeCollaborator.mockRejectedValue("bad");
    await h.result.current.handleRemoveCollaborator("c");
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      "Failed to remove collaborator",
    );
    api.updateCollaborationPermission.mockRejectedValue(new Error("denied"));
    await h.result.current.handleUpdatePermission({ clientId: "c", role: "editor" });
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith("denied");
  });
  it("sends presence, reconciles revisions and stops after unmount", async () => {
    const h = setup({
      collaborationAvailable: true,
      collaborationState: { enabled: true, users: [], revision: 1 },
    });
    await act(async () => {});
    expect(api.updateCollaborationPresence).toHaveBeenCalledWith("p", null);
    expect(h.ctx.setCurrentUserRole).toHaveBeenCalledWith("editor");
    expect(h.ctx.setIsProjectAdmin).toHaveBeenCalledWith(false);
    h.ctx.collaborationState = { enabled: true, users: [], revision: 2 };
    h.rerender();
    await act(async () => {});
    expect(h.ctx.refreshProject).toHaveBeenCalledWith("p");
    await act(() => vi.advanceTimersByTimeAsync(8000));
    expect(api.updateCollaborationPresence.mock.calls.length).toBeGreaterThan(1);
    h.unmount();
    api.updateCollaborationPresence.mockClear();
    await act(() => vi.advanceTimersByTimeAsync(8000));
    expect(api.updateCollaborationPresence).not.toHaveBeenCalled();
  });
});

describe("project workflow recovery", () => {
  it("copies relative paths and reports clipboard denial", async () => {
    const clipboard = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboard },
    });
    const h = setup();
    await h.result.current.copyRelativePath(entry("chapters/a.tex"));
    expect(clipboard).toHaveBeenCalledWith("chapters/a.tex");
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith("Copied chapters/a.tex");
    clipboard.mockRejectedValue(new Error("denied"));
    await h.result.current.copyRelativePath(entry());
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      "Could not copy the relative path.",
    );
  });
  it.each(["importDocx", "importMarkdown", "importPdf"] as const)(
    "explains missing native %s handlers",
    async (kind) => {
      const h = setup();
      window.latexdo = { ...api } as unknown as typeof window.latexdo;
      Reflect.deleteProperty(window.latexdo, kind);
      await h.result.current[kind]();
      expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
        expect.stringContaining("not loaded"),
      );
    },
  );
  it("reconciles shared trees on focus and visibility without concurrent requests", async () => {
    let finish!: () => void;
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const h = setup({
      collaborationAvailable: true,
      collaborationState: { enabled: true, users: [], revision: 1 },
      refreshProject: refresh,
    });
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(refresh).toHaveBeenCalledTimes(2);
    await act(async () => finish());
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(refresh).toHaveBeenCalledTimes(2);
    h.unmount();
  });
  it("updates host status and refreshes sharing after startup", async () => {
    const h = setup({ hostingAvailable: true });
    h.ctx.refreshCollaborationState.mockClear();
    const callback = api.onHostSharingChanged.mock.calls[0][0];
    const status = { phase: "starting" };
    act(() => callback(status));
    const update = h.ctx.setCollaborationState.mock.calls[0][0];
    expect(update({ hosted: true })).toEqual({ hosted: true, host: status });
    expect(update({ hosted: false })).toEqual({ hosted: false });
    expect(h.ctx.refreshCollaborationState).not.toHaveBeenCalled();
    act(() => callback({ phase: "ready" }));
    expect(h.ctx.refreshCollaborationState).toHaveBeenCalledOnce();
  });
  it("requires a LaTeX document for image insertion and a project for file creation", () => {
    const h = setup({
      activeDocumentIsLatex: false,
      projectId: "",
      projectIdRef: { current: "" },
    });
    h.result.current.insertImageReference(entry("a.png"));
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      "Open a LaTeX file before inserting image code.",
    );
    h.result.current.openCreateDialog("file");
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      "Create or open a project before adding files.",
    );
  });
});
