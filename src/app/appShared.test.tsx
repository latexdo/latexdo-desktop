import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import * as shared from "./appShared";
import { latexDoAiTiers } from "../features/ai/product/latexDoAiTiers";
import { defaultAiConfig } from "../features/ai/aiConfig";

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  shared.installCustomLatexDoAiModels([]);
});
describe("persisted chat tabs", () => {
  it.each([
    null,
    undefined,
    1,
    "chat",
    {},
    { id: "wrong", title: "title" },
    { id: "ai-chat-a", title: 3 },
  ])("rejects malformed tab %j", (raw) => {
    expect(shared.normalizePersistedAiChat(raw)).toBeNull();
  });
  it("bounds names and falls back to a nonempty title", () => {
    expect(
      shared.normalizePersistedAiChat({
        id: "ai-chat-" + "a".repeat(200),
        title: "x".repeat(100),
      }),
    ).toMatchObject({
      id: expect.stringMatching(/^.{120}$/),
      title: expect.stringMatching(/^.{80}$/),
    });
    expect(shared.normalizePersistedAiChat({ id: "ai-chat-a", title: "" })?.title).toBe(
      "Chat",
    );
  });
  it.each(["bad", "null", "{}", '{"chats":[]}'])("recovers from stored %s", (raw) => {
    localStorage.setItem(shared.aiChatTabsStorageKey, raw);
    expect(shared.loadPersistedAiChatTabs()).toEqual(shared.defaultAiChatTabs());
  });
  it("keeps valid tabs despite corrupt neighbors and derives the next chat number", () => {
    localStorage.setItem(
      shared.aiChatTabsStorageKey,
      JSON.stringify({
        chats: [
          null,
          { id: "ai-chat-a", title: "Chat 10" },
          { id: "ai-chat-b", title: "Custom" },
        ],
        activeId: "ai-chat-b",
      }),
    );
    expect(shared.loadPersistedAiChatTabs()).toEqual({
      chats: [
        { id: "ai-chat-a", title: "Chat 10" },
        { id: "ai-chat-b", title: "Custom" },
      ],
      activeId: "ai-chat-b",
      nextNumber: 11,
    });
    localStorage.setItem(
      shared.aiChatTabsStorageKey,
      JSON.stringify({
        chats: Array.from({ length: 25 }, (_, i) => ({
          id: `ai-chat-${i}`,
          title: "Custom",
        })),
        activeId: "gone",
        nextNumber: 100,
      }),
    );
    const saved = shared.loadPersistedAiChatTabs();
    expect(saved.chats).toHaveLength(20);
    expect(saved.activeId).toBe("ai-chat-0");
    expect(saved.nextNumber).toBe(100);
    shared.savePersistedAiChatTabs(saved);
    expect(shared.loadPersistedAiChatTabs()).toEqual(saved);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(() => shared.savePersistedAiChatTabs(saved)).not.toThrow();
    expect(shared.aiChatStateStorageKey("ai-chat-1")).toBe(
      "latexdo.ai.chatState.ai-chat-1.v1",
    );
  });
});
describe("imported AI model records", () => {
  it.each([null, undefined, {}, { fileName: "x.bin" }])(
    "rejects invalid model %j",
    (raw) => expect(shared.normalizeCustomLatexDoAiModelRecord(raw)).toBeNull(),
  );
  it("normalizes filenames, labels, sizes and manifests", () => {
    expect(
      shared.normalizeCustomLatexDoAiModelRecord({
        fileName: "folder\\My_Model.GGUF",
        manifest: { fileSizeBytes: 1024 },
      }),
    ).toMatchObject({
      id: "imported-gguf:My_Model.GGUF",
      fileName: "My_Model.GGUF",
      name: "My Model",
      sizeBytes: 1024,
    });
    expect(
      shared.normalizeCustomLatexDoAiModelRecord({
        fileName: "x.gguf",
        name: " Custom ",
        id: "imported-gguf:custom",
        sizeBytes: 20,
      }),
    ).toMatchObject({ name: "Custom", id: "imported-gguf:custom", sizeBytes: 20 });
    expect(
      shared.normalizeCustomLatexDoAiModelRecord({
        fileName: "x.gguf",
        sizeBytes: Infinity,
        manifest: { fileSizeBytes: NaN },
      })?.sizeBytes,
    ).toBeNull();
    expect(shared.labelForGgufFile(".gguf")).toBe(".gguf");
  });
  it("loads unique models while skipping malformed records", () => {
    localStorage.setItem(
      shared.customLatexDoAiModelsStorageKey,
      JSON.stringify([
        null,
        { fileName: "x.gguf" },
        { fileName: "x.gguf", name: "Last" },
      ]),
    );
    const models = shared.loadCustomLatexDoAiModels();
    expect(models).toHaveLength(1);
    expect(models[0].name).toBe("Last");
    shared.saveCustomLatexDoAiModels(models);
    expect(shared.loadCustomLatexDoAiModels()).toEqual(models);
    for (const raw of ["bad", "{}", "null"]) {
      localStorage.setItem(shared.customLatexDoAiModelsStorageKey, raw);
      expect(shared.loadCustomLatexDoAiModels()).toEqual([]);
    }
  });
  it("remembers the local provider and restores an imported model selection", () => {
    const id = shared.importedLatexDoAiModelId("x.gguf");
    expect(
      shared.loadLocalAiProviderMode({
        ...defaultAiConfig,
        provider: "local",
        modelId: id,
      }),
    ).toBe("local-model");
    expect(shared.loadLocalAiProviderMode(defaultAiConfig)).toBe("latexdo-ai");
    shared.saveLocalAiProviderMode("local-model");
    expect(shared.loadLocalAiProviderMode(defaultAiConfig)).toBe("local-model");
    shared.saveCustomLatexDoAiModels([
      shared.normalizeCustomLatexDoAiModelRecord({ fileName: "x.gguf" })!,
    ]);
    localStorage.setItem("latexdo.ai.config.v1", JSON.stringify({ modelId: id }));
    expect(shared.loadAiConfigForApp()).toMatchObject({
      modelId: id,
      modelDownloaded: true,
      selection: { mode: "custom", custom: { kind: "gguf", modelId: id } },
    });
    expect(shared.localRuntimeSelectionForTier(latexDoAiTiers[0])).toMatchObject({
      provider: "local",
      modelId: latexDoAiTiers[0].runtime.modelId,
      modelDownloaded: false,
    });
  });
});
describe("display formatting and IPC guards", () => {
  it.each([
    [undefined, "unknown size"],
    [NaN, "unknown size"],
    [-1, "unknown size"],
    [0, "0 B"],
    [1024, "1.0 KB"],
    [1024 ** 2, "1.0 MB"],
    [1024 ** 3, "1.0 GB"],
    [1024 ** 4, "1.0 TB"],
  ] as const)("formats file size %s", (bytes, label) =>
    expect(shared.formatFileSize(bytes)).toBe(label),
  );
  it.each([
    [undefined, ""],
    [0, ""],
    [-1, ""],
    [20, "20 B"],
    [1024, "1.0 KB"],
    [1024 ** 2, "1.0 MB"],
  ] as const)("formats asset size %s", (bytes, label) =>
    expect(shared.formatAssetSize(bytes)).toBe(label),
  );
  it.each([
    "",
    "/root.tex",
    "C:\\main.tex",
    "file:main.tex",
    "a\0b",
    "a/../b",
    ".git/config",
    "node_modules/x",
    "a/",
  ])("rejects unsafe relative path %j", (path) =>
    expect(shared.isSafeIpcRelativePath(path)).toBe(false),
  );
  it("accepts relative paths only with allowed extensions", () => {
    expect(shared.isSafeIpcRelativePath("chapters\\Main.TEX", [".tex"])).toBe(true);
    expect(shared.isSafeIpcRelativePath("chapter.md", [".tex"])).toBe(false);
    expect(shared.isSafeIpcRelativePath("chapter.md")).toBe(true);
    expect(shared.isSafeIpcProjectId("project_123")).toBe(true);
    expect(shared.isSafeIpcProjectId(" ")).toBe(false);
    expect(shared.isSafeIpcProjectId("p\nq")).toBe(false);
    expect(shared.bookmarkLinesEqual([1, 2], [1, 2])).toBe(true);
    expect(shared.bookmarkLinesEqual([1], [2])).toBe(false);
    expect(shared.bookmarkLinesEqual([], [1])).toBe(false);
    expect(shared.assetPreviewTypeLabel("application/pdf")).toBe("PDF");
    expect(shared.assetPreviewTypeLabel()).toBe("Image");
    expect(shared.isPreviewAssetMimeType(null)).toBe(false);
    expect(shared.isPreviewAssetMimeType("text/plain")).toBe(false);
    expect(shared.isPreviewAssetMimeType("image/png")).toBe(true);
  });
  it("deduplicates closed tabs and bounds their history", () => {
    const paths = { current: Array.from({ length: 25 }, (_, i) => `file${i}`) };
    const armed = { current: false };
    shared.rememberClosedTab(paths, armed, "file10");
    expect(paths.current).toHaveLength(20);
    expect(paths.current.at(-1)).toBe("file10");
    expect(paths.current.filter((p) => p === "file10")).toHaveLength(1);
    expect(armed.current).toBe(true);
  });
});
function model(text: string) {
  const lines = text.split("\n");
  return {
    getValue: () => text,
    getLineCount: () => lines.length,
    getLineMaxColumn: (line: number) => lines[line - 1].length + 1,
    getLineContent: (line: number) => lines[line - 1],
    getWordAtPosition: () => null,
  } as unknown as Monaco.editor.ITextModel;
}
describe("safe editor coordinates", () => {
  it("clamps invalid positions and keeps ranges ordered", () => {
    const m = model("hello\nworld");
    expect(shared.clampModelLine(m, NaN)).toBe(1);
    expect(shared.clampModelLine(m, 9)).toBe(2);
    expect(shared.clampModelColumn(m, 1, Infinity)).toBe(1);
    expect(shared.clampModelColumn(m, 2, 90)).toBe(6);
    expect(shared.modelRange(m, 2, 3, 1, 1)).toEqual({
      startLineNumber: 2,
      startColumn: 3,
      endLineNumber: 2,
      endColumn: 4,
    });
    expect(shared.modelRange(m, 1, 2, 2, 5).endColumn).toBe(5);
    const position = { lineNumber: 1, column: 3 } as Monaco.Position;
    expect(
      shared.completionReplacementRangeAtPosition(m, position, {
        rangeStartColumn: 2,
        rangeEndColumn: 5,
      }),
    ).toEqual({
      insert: shared.modelRange(m, 1, 2, 1, 5),
      replace: shared.modelRange(m, 1, 2, 1, 5),
    });
    expect(shared.offsetFromLineColumn("ab\ncd", 2, 90)).toBe(5);
    expect(shared.offsetFromLineColumn("a", 0, 1)).toBeNull();
    expect(shared.offsetFromLineColumn("a", 3, 1)).toBeNull();
  });
  it("selects clicked words, explicit spans, line text or whitespace safely", () => {
    const m = model("  hello world\n   ");
    expect(
      shared.sourceSelectionRange(m, {
        path: "main.tex",
        line: 1,
        column: 3,
        word: "world",
      }).startColumn,
    ).toBe(9);
    expect(
      shared.sourceSelectionRange(m, {
        path: "main.tex",
        line: 1,
        column: 3,
        endColumn: 6,
      }).endColumn,
    ).toBe(6);
    expect(
      shared.sourceSelectionRange(m, { path: "main.tex", line: 1, column: 1 })
        .startColumn,
    ).toBe(3);
    expect(
      shared.sourceSelectionRange(m, { path: "main.tex", line: 2, column: 1 })
        .endColumn,
    ).toBe(2);
    m.getWordAtPosition = () => ({ word: "hello", startColumn: 3, endColumn: 8 });
    expect(
      shared.sourceSelectionRange(m, { path: "main.tex", line: 1, column: 4 })
        .endColumn,
    ).toBe(8);
    expect(shared.getNearbyCitationContext(null)).toBe("");
  });
});
