import { act, renderHook, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAiAgent, supportsNativeTools } from "./useAiAgent";
import { defaultAiConfig, type AiConfig } from "./aiConfig";
import type { AgentContext } from "./aiTools";
import { generateStep, abortGeneration } from "./aiClient";
vi.mock("./aiClient", () => ({
  generateStep: vi.fn(),
  abortGeneration: vi.fn(async () => {}),
}));
function setup(
  configChanges: Partial<AiConfig> = {},
  key = "chat",
  contextChanges: Partial<AgentContext> = {},
) {
  const ctx: AgentContext = {
    hasProject: () => true,
    projectName: () => "Paper",
    activeFilePath: () => "main.tex",
    listFiles: vi.fn(async () => ["main.tex"]),
    readFile: vi.fn(async () => "original passage"),
    writeFile: vi.fn(async () => {}),
    documentText: () => "original document",
    selection: () => ({ text: "selected", hasSelection: true }),
    applyEdit: vi.fn(async () => {}),
    compile: vi.fn(async () => ({ ok: true, log: "", diagnostics: [] })),
    runChecks: vi.fn(async () => "all checked"),
    insertCitation: vi.fn(async () => "smith"),
    recommendCitations: vi.fn(async () => "smith recommendation"),
    requestApproval: vi.fn(async () => true),
    ...contextChanges,
  };
  const config = { ...defaultAiConfig, provider: "ollama" as const, ...configChanges };
  return { ...renderHook(() => useAiAgent(config, ctx, key)), ctx, config };
}
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(generateStep).mockResolvedValue({ type: "text", content: "Answer" });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("AI conversation lifecycle", () => {
  it.each(["local", "cloud"] as const)(
    "supports graph actions with the %s protocol and no text-editor target",
    async (provider) => {
      const filter = vi.fn(async () =>
        JSON.stringify({ applied: true, keys: ["smith"] }),
      );
      vi.mocked(generateStep)
        .mockResolvedValueOnce(
          provider === "local"
            ? {
                type: "text",
                content: '{"tool":"filter_knowledge_graph","args":{"mode":"related"}}',
              }
            : {
                type: "tool_calls",
                content: "",
                toolCalls: [
                  {
                    id: "graph",
                    name: "filter_knowledge_graph",
                    args: { mode: "related" },
                  },
                ],
              },
        )
        .mockResolvedValueOnce({ type: "text", content: "Filtered." });
      const { result } = setup({ provider }, "graph-chat", {
        activeFilePath: () => null,
        selection: () => ({ text: "", hasSelection: false }),
        workspaceTab: () => ({
          id: "graph",
          label: "Knowledge Graph",
          kind: "knowledge-graph",
        }),
        filterKnowledgeGraph: filter,
      });
      await act(async () => result.current.send("Show related entries"));
      expect(filter).toHaveBeenCalledWith(expect.objectContaining({ mode: "related" }));
      expect(vi.mocked(generateStep).mock.calls[0][0].messages[0].content).toContain(
        'AI target tab: "Knowledge Graph"',
      );
      const tools = vi
        .mocked(generateStep)
        .mock.calls[0][0].tools.map((tool) => tool.name);
      expect(tools).not.toContain("get_active_document");
      expect(result.current.pendingApproval).toBeNull();
    },
  );

  it.each(["currentEditor", "bibliography"] as const)(
    "does not expose graph actions when %s access is off",
    async (permission) => {
      const filter = vi.fn(async () => "filtered");
      vi.mocked(generateStep).mockResolvedValueOnce({
        type: "tool_calls",
        content: "",
        toolCalls: [
          { id: "graph", name: "filter_knowledge_graph", args: { mode: "all" } },
        ],
      });
      const { result } = setup(
        { access: { ...defaultAiConfig.access, [permission]: false } },
        "private-graph",
        {
          workspaceTab: () => ({
            id: "graph",
            label: "Knowledge Graph",
            kind: "knowledge-graph",
          }),
          filterKnowledgeGraph: filter,
        },
      );
      await act(async () => result.current.send("Show everything"));
      expect(filter).not.toHaveBeenCalled();
      expect(
        vi.mocked(generateStep).mock.calls[0][0].tools.map((tool) => tool.name),
      ).not.toContain("filter_knowledge_graph");
    },
  );

  it.each(["local", "ollama", "cloud"] as const)(
    "uses the %s runtime and persists a completed conversation",
    async (provider) => {
      const { result, unmount } = setup({ provider });
      await act(async () =>
        result.current.send(" Explain @main.tex ", {
          displayText: "Explain this paper",
        }),
      );
      const request = vi.mocked(generateStep).mock.calls[0][0];
      expect(request.provider).toBe(provider);
      expect(request.messages[1].content).toContain("original passage");
      expect(request.options.maxTokens).toBe(provider === "cloud" ? 32_000 : 4096);
      expect(request.options.effort).toBe("high");
      // Every runtime now calls tools natively, so no document is inlined.
      expect(supportsNativeTools({ ...defaultAiConfig, provider })).toBe(true);
      expect(request.messages[0].content).not.toContain("original document");
      expect(request.messages[1].content).toContain("<editor_context>");
      expect(result.current.messages.map((m) => m.text)).toEqual([
        "Explain this paper",
        "Answer",
      ]);
      expect(result.current.isRunning).toBe(false);
      expect(result.current.messages[1].pending).toBe(false);
      await waitFor(() =>
        expect(JSON.parse(localStorage.getItem("chat")!).messages[1].text).toBe(
          "Answer",
        ),
      );
      unmount();
      const reloaded = setup();
      expect(reloaded.result.current.messages[1].text).toBe("Answer");
      await act(async () => reloaded.result.current.send("Follow up"));
      expect(
        vi
          .mocked(generateStep)
          .mock.calls[1][0].messages.some((m) => m.content === "Answer"),
      ).toBe(true);
    },
  );
  it.each([true, false])(
    "requires interactive approval and honors approved=%s",
    async (approved) => {
      vi.mocked(generateStep)
        .mockResolvedValueOnce({
          type: "tool_calls",
          content: "",
          toolCalls: [
            { id: "edit", name: "edit_selection", args: { new_text: "replacement" } },
          ],
        })
        .mockResolvedValueOnce({ type: "text", content: "Done" });
      const { result, ctx } = setup();
      let sending: Promise<void>;
      act(() => {
        sending = result.current.send("Rewrite");
      });
      await waitFor(() =>
        expect(result.current.pendingApproval?.newText).toBe("replacement"),
      );
      expect(result.current.status).toContain("approval");
      expect(ctx.applyEdit).not.toHaveBeenCalled();
      await act(async () => {
        result.current.resolveApproval(approved);
        await sending;
      });
      expect(ctx.applyEdit).toHaveBeenCalledTimes(approved ? 1 : 0);
      expect(result.current.pendingApproval).toBeNull();
      expect(result.current.messages[1].activity[0].name).toBe("edit_selection");
    },
  );
  it("runs read, write, citation and check tools through project access boundaries", async () => {
    const calls = [
      { id: "read", name: "read_file", args: { path: "main.tex" } },
      { id: "doc", name: "get_active_document", args: {} },
      { id: "sel", name: "get_selection", args: {} },
      { id: "cite", name: "insert_citation", args: { query: "smith" } },
      { id: "rec", name: "recommend_citations", args: { passage: "claim" } },
      { id: "write", name: "write_file", args: { path: "new.tex", content: "new" } },
    ];
    vi.mocked(generateStep)
      .mockResolvedValueOnce({ type: "tool_calls", content: "", toolCalls: calls })
      .mockResolvedValueOnce({ type: "text", content: "Done" });
    const { result, ctx } = setup();
    let sending: Promise<void>;
    act(() => {
      sending = result.current.send("Update references");
    });
    await waitFor(() => expect(result.current.pendingApproval?.path).toBe("new.tex"));
    await act(async () => {
      result.current.resolveApproval(true);
      await sending;
    });
    expect(ctx.writeFile).toHaveBeenCalledWith("new.tex", "new");
    expect(ctx.insertCitation).toHaveBeenCalledWith("smith");
    expect(ctx.recommendCitations).toHaveBeenCalledWith("claim");
    expect(result.current.messages[1].activity).toHaveLength(6);
  });
  it("denies unavailable tools without reading private project context", async () => {
    const access = {
      chatHistory: false,
      currentEditor: false,
      projectFiles: false,
      bibliography: false,
      researcherProfile: false,
    };
    vi.mocked(generateStep)
      .mockResolvedValueOnce({
        type: "tool_calls",
        content: "",
        toolCalls: [{ id: "read", name: "read_file", args: { path: "main.tex" } }],
      })
      .mockResolvedValueOnce({
        type: "text",
        content: "Project files access is disabled in AI settings.",
      });
    const { result, ctx } = setup({ access });
    await act(async () => result.current.send("Read @main.tex"));
    expect(ctx.listFiles).not.toHaveBeenCalled();
    expect(ctx.readFile).not.toHaveBeenCalled();
    // The refusal reaches the model as the tool's result, and it answers.
    const toolResult = vi
      .mocked(generateStep)
      .mock.calls[1][0].messages.find((m) => m.role === "tool");
    expect(toolResult?.content).toContain("disabled");
    expect(result.current.messages[1].text).toContain("disabled");
    expect(vi.mocked(generateStep).mock.calls[0][0].tools).toEqual([]);
    await act(async () => result.current.send("Again"));
    const userTurns = vi
      .mocked(generateStep)
      .mock.calls[2][0].messages.filter((m) => m.role === "user");
    expect(userTurns).toHaveLength(1);
    expect(userTurns[0].content.endsWith("Again")).toBe(true);
  });
  it("aborts an approval without applying changes and clears chat", async () => {
    vi.mocked(generateStep).mockResolvedValue({
      type: "tool_calls",
      content: "",
      toolCalls: [{ id: "insert", name: "insert_at_cursor", args: { text: "new" } }],
    });
    const { result, ctx } = setup();
    let sending: Promise<void>;
    act(() => {
      sending = result.current.send("Insert");
    });
    await waitFor(() => expect(result.current.pendingApproval).not.toBeNull());
    await act(async () => {
      result.current.abort();
      await sending;
    });
    expect(ctx.applyEdit).not.toHaveBeenCalled();
    expect(abortGeneration).toHaveBeenCalled();
    act(() => result.current.reset());
    expect(result.current.messages).toEqual([]);
    expect(localStorage.getItem("chat")).toBeNull();
  });
  it("streams output and reports provider failures without a stuck pending state", async () => {
    vi.mocked(generateStep).mockImplementationOnce(async (_request, onToken) => {
      onToken("partial");
      return { type: "error", content: "service failed" };
    });
    const { result } = setup();
    await act(async () => result.current.send("Hello"));
    expect(result.current.messages[1].text).toContain("partial");
    expect(result.current.messages[1].text).toContain("service failed");
    expect(result.current.messages[1].pending).toBe(false);
    expect(result.current.isRunning).toBe(false);
    await act(async () => result.current.send("   "));
    expect(generateStep).toHaveBeenCalledTimes(1);
  });
  it("sanitizes, trims and caps stored history", () => {
    localStorage.setItem(
      "chat",
      JSON.stringify({
        version: 1,
        messages: [
          {},
          ...Array.from({ length: 90 }, (_, i) => ({
            id: String(i),
            role: "assistant",
            text: "x".repeat(13000),
            pending: true,
            activity: [{}, { name: "read_file", ok: true, summary: "y".repeat(500) }],
          })),
        ],
        history: [
          {},
          { role: "tool", content: "result", toolCallId: "c", name: "read_file" },
        ],
      }),
    );
    const { result } = setup();
    expect(result.current.messages).toHaveLength(80);
    expect(result.current.messages[0].id).toBe("10");
    expect(result.current.messages[0].text).toContain("[trimmed]");
    expect(result.current.messages[0].pending).toBe(false);
    expect(result.current.messages[0].activity).toEqual([
      { name: "read_file", ok: true, summary: "y".repeat(400) },
    ]);
  });
  it("keeps chat functional when storage is corrupt or full", async () => {
    localStorage.setItem("chat", "invalid JSON");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const { result } = setup();
    await act(async () => result.current.send("Hello"));
    expect(result.current.messages[1].text).toBe("Answer");
  });
  it("resolves standalone reformulation proposals", async () => {
    const { result } = setup();
    let approval: Promise<boolean>;
    act(() => {
      approval = result.current.proposeEdit({
        path: "main.tex",
        kind: "replace-selection",
        newText: "new",
        source: "reformulate",
      });
    });
    act(() => result.current.resolveApproval(true));
    expect(await approval!).toBe(true);
  });
});
