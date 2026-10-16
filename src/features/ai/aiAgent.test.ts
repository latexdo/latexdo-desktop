import { describe, it, expect, vi } from "vitest";
import {
  looksLikeProjectAccessRefusal,
  parseJsonToolCall,
  runAgent,
  type AgentEvent,
} from "./aiAgent";
import { executeTool, type AgentContext } from "./aiTools";
import type { ChatMessage, GenerationStep, ToolSchema } from "./aiTypes";

function stubContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    projectName: () => "Test",
    activeFilePath: () => "main.tex",
    listFiles: async () => ["main.tex"],
    readFile: async () => "\\documentclass{article}",
    writeFile: async () => {},
    documentText: () => "hello",
    selection: () => ({ text: "world", hasSelection: true }),
    applyEdit: async () => {},
    compile: async () => ({ ok: true, log: "", diagnostics: [] }),
    runChecks: async () => "ok",
    insertCitation: async () =>
      JSON.stringify({ recommendation: { key: "x", citation: "\\citep{x}" } }),
    recommendCitations: async () =>
      JSON.stringify({ recommendations: [{ key: "x", score: 0.5 }] }),
    requestApproval: async () => true,
    ...overrides,
  };
}

describe("parseJsonToolCall", () => {
  it("extracts a tool call from a JSON protocol reply", () => {
    const call = parseJsonToolCall('{"tool":"read_file","args":{"path":"a.tex"}}');
    expect(call?.name).toBe("read_file");
    expect(call?.args).toEqual({ path: "a.tex" });
  });

  it("returns null for plain prose", () => {
    expect(parseJsonToolCall("Here is your rewritten paragraph.")).toBeNull();
  });

  it("parses JSON wrapped in markdown fences", () => {
    const call = parseJsonToolCall('Sure!\n```json\n{"tool":"compile","args":{}}\n```');
    expect(call?.name).toBe("compile");
  });

  it("parses simple function-style tool text from local models", () => {
    const call = parseJsonToolCall("list_files()");
    expect(call?.name).toBe("list_files");
    expect(call?.args).toEqual({});
  });

  it("parses the OpenAI-style name/arguments shape", () => {
    const call = parseJsonToolCall(
      '{"name":"read_file","arguments":{"path":"main.tex"}}',
    );
    expect(call?.name).toBe("read_file");
    expect(call?.args).toEqual({ path: "main.tex" });
  });
});

describe("looksLikeProjectAccessRefusal", () => {
  it("detects project/file access refusals", () => {
    expect(
      looksLikeProjectAccessRefusal(
        "I'm sorry, but I don't have access to your publications. Please share the content/conclusion.tex file.",
      ),
    ).toBe(true);
  });

  it("detects current conversation/topic access refusals", () => {
    expect(
      looksLikeProjectAccessRefusal(
        "I don't have access to your current conversation or current topic.",
      ),
    ).toBe(true);
  });

  it("does not flag ordinary questions that need clarification", () => {
    expect(looksLikeProjectAccessRefusal("Which venue should I target?")).toBe(false);
  });

  it("detects paste-the-text deflections without an explicit refusal", () => {
    expect(
      looksLikeProjectAccessRefusal(
        "To help you understand the authors' first paragraph of the related work, I'll need to read and analyze the relevant section of the document. Please provide the text of the first paragraph, and I'll do my best to explain it.",
      ),
    ).toBe(true);
    expect(
      looksLikeProjectAccessRefusal(
        "Yes, I have access to the project files. Please provide the text of the first paragraph of the related work.",
      ),
    ).toBe(true);
  });

  it("does not flag answers that merely mention documents or sections", () => {
    expect(
      looksLikeProjectAccessRefusal(
        "The related-work section compares three code-completion benchmarks and argues the paper's approach generalizes better.",
      ),
    ).toBe(false);
  });
});

describe("runAgent", () => {
  it("executes a tool then finishes on plain text", async () => {
    const steps: GenerationStep[] = [
      {
        type: "tool_calls",
        content: "",
        toolCalls: [{ id: "c1", name: "read_file", args: { path: "main.tex" } }],
      },
      { type: "text", content: "Done reading the file." },
    ];
    let i = 0;
    const generate = vi.fn(
      async (
        _m: ChatMessage[],
        _t: ToolSchema[],
        _onToken: (s: string) => void,
      ): Promise<GenerationStep> => steps[i++],
    );

    const readFile = vi.fn(async () => "\\documentclass{article}");
    const events: AgentEvent[] = [];
    await runAgent({
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "read main.tex" },
      ],
      ctx: stubContext({ readFile }),
      generate,
      autoApprove: true,
      maxSteps: 6,
      onEvent: (e) => events.push(e),
    });

    expect(readFile).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledTimes(2);
    const done = events.find((e) => e.type === "done");
    expect(done).toEqual({ type: "done", reason: "completed" });
    const finalMsg = events.find((e) => e.type === "assistant-message");
    expect(finalMsg).toMatchObject({ text: "Done reading the file." });
  });

  it("returns the updated model-facing transcript", async () => {
    const history = await runAgent({
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "read main.tex" },
      ],
      ctx: stubContext(),
      generate: async (_messages, _tools) => ({
        type: "tool_calls",
        content: "",
        toolCalls: [{ id: "c1", name: "read_file", args: { path: "main.tex" } }],
      }),
      autoApprove: true,
      maxSteps: 1,
      onEvent: () => {},
    });

    expect(history).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "read main.tex" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", name: "read_file", args: { path: "main.tex" } }],
      },
      {
        role: "tool",
        content: "\\documentclass{article}",
        toolCallId: "c1",
        name: "read_file",
      },
    ]);
  });

  it("recovers a JSON tool call emitted as plain text", async () => {
    const steps: GenerationStep[] = [
      { type: "text", content: '{"tool":"compile","args":{}}' },
      { type: "text", content: "It compiles." },
    ];
    let i = 0;
    const compile = vi.fn(async () => ({ ok: true, log: "", diagnostics: [] }));
    await runAgent({
      messages: [{ role: "user", content: "does it build?" }],
      ctx: stubContext({ compile }),
      generate: async () => steps[i++],
      autoApprove: true,
      maxSteps: 6,
      onEvent: () => {},
    });
    expect(compile).toHaveBeenCalledOnce();
  });

  it("answers plainly instead of executing a tool that is unavailable", async () => {
    const listFiles = vi.fn(async () => ["main.tex"]);
    const events: AgentEvent[] = [];

    await runAgent({
      messages: [{ role: "user", content: "which project is open?" }],
      ctx: stubContext({
        hasProject: () => false,
        projectName: () => "",
        activeFilePath: () => null,
        listFiles,
        selection: () => ({ text: "", hasSelection: false }),
      }),
      tools: [],
      toolCapabilities: {
        hasProject: false,
        hasActiveDocument: false,
        hasSelection: false,
        access: {
          chatHistory: true,
          currentEditor: true,
          projectFiles: true,
          bibliography: true,
          researcherProfile: true,
        },
      },
      generate: async (messages) =>
        messages.some((m) => m.role === "tool")
          ? { type: "text", content: "No project is open yet." }
          : { type: "text", content: "list_files()" },
      autoApprove: false,
      maxSteps: 6,
      onEvent: (e) => events.push(e),
    });

    expect(listFiles).not.toHaveBeenCalled();
    // The model learns why from the tool result, then answers in prose.
    expect(events.find((e) => e.type === "tool-result")).toMatchObject({
      ok: false,
      content: expect.stringContaining("No LatexDo project is open"),
    });
    expect(events.find((e) => e.type === "assistant-message")).toMatchObject({
      text: "No project is open yet.",
    });
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  it("passes only the configured tool list to the provider", async () => {
    const generate = vi.fn(async () => ({
      type: "text" as const,
      content: "No tools for that action.",
    }));

    await runAgent({
      messages: [{ role: "user", content: "create a file" }],
      ctx: stubContext(),
      tools: [],
      generate,
      autoApprove: false,
      maxSteps: 6,
      onEvent: () => {},
    });

    expect(generate).toHaveBeenCalledWith(
      expect.any(Array),
      [],
      expect.any(Function),
      expect.any(Function),
    );
  });

  it("retries once when the model wrongly claims it cannot access project files", async () => {
    const steps: GenerationStep[] = [
      {
        type: "text",
        content:
          "I'm sorry, but I don't have access to your personal information or publications. Please share the LaTeX file.",
      },
      {
        type: "tool_calls",
        content: "",
        toolCalls: [{ id: "c1", name: "read_file", args: { path: "main.tex" } }],
      },
      { type: "text", content: "The project contains one publication entry." },
    ];
    let i = 0;
    const readFile = vi.fn(async () => "\\bibliography{references}");
    const events: AgentEvent[] = [];

    await runAgent({
      messages: [{ role: "user", content: "what publications do I have?" }],
      ctx: stubContext({ readFile }),
      generate: async () => steps[i++],
      autoApprove: true,
      maxSteps: 6,
      onEvent: (e) => events.push(e),
    });

    expect(readFile).toHaveBeenCalledWith("main.tex");
    expect(events.find((e) => e.type === "assistant-message")).toMatchObject({
      text: "The project contains one publication entry.",
    });
  });

  it("stops at the step budget", async () => {
    const events: AgentEvent[] = [];
    await runAgent({
      messages: [{ role: "user", content: "loop" }],
      ctx: stubContext(),
      // Always asks for a tool, never finishes.
      generate: async () => ({
        type: "tool_calls",
        content: "",
        toolCalls: [{ id: "c", name: "list_files", args: {} }],
      }),
      autoApprove: true,
      maxSteps: 3,
      onEvent: (e) => events.push(e),
    });
    expect(events.filter((e) => e.type === "step")).toHaveLength(3);
    expect(events.at(-1)).toEqual({ type: "done", reason: "max-steps" });
  });
});

describe("step-by-step approval", () => {
  const proposalCtx = (
    approve: boolean,
    applyEdit: () => Promise<void>,
  ): AgentContext => ({
    projectName: () => "Test",
    activeFilePath: () => "main.tex",
    listFiles: async () => [],
    readFile: async () => "old",
    writeFile: async () => {},
    documentText: () => "doc",
    selection: () => ({ text: "old", hasSelection: true }),
    applyEdit,
    compile: async () => ({ ok: true, log: "", diagnostics: [] }),
    runChecks: async () => "",
    insertCitation: async () => "",
    recommendCitations: async () => "",
    requestApproval: async () => approve,
  });

  it("applies the edit when approved (ask mode)", async () => {
    const applyEdit = vi.fn(async () => {});
    const result = await executeTool(
      "edit_selection",
      { new_text: "new" },
      proposalCtx(true, applyEdit),
      { autoApprove: false },
    );
    expect(applyEdit).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
  });

  it("does NOT apply the edit when declined (ask mode)", async () => {
    const applyEdit = vi.fn(async () => {});
    const result = await executeTool(
      "edit_selection",
      { new_text: "new" },
      proposalCtx(false, applyEdit),
      { autoApprove: false },
    );
    expect(applyEdit).not.toHaveBeenCalled();
    expect(result.content).toMatch(/declined/i);
  });

  it("still requires approval even if an old config asks for autonomous mode", async () => {
    const requestApproval = vi.fn(async () => true);
    const applyEdit = vi.fn(async () => {});
    await executeTool(
      "edit_selection",
      { new_text: "new" },
      { ...proposalCtx(true, applyEdit), requestApproval },
      { autoApprove: true },
    );
    expect(requestApproval).toHaveBeenCalledOnce();
    expect(applyEdit).toHaveBeenCalledOnce();
  });
});
