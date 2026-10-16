import { describe, expect, it, vi } from "vitest";
import { asksForChange, runAgent, type AgentEvent } from "./aiAgent";
import { agentToolSchemas, executeTool, type AgentContext } from "./aiTools";
import type { ChatMessage, GenerationStep } from "./aiTypes";
import { claudeModelTraits } from "./claudeModels";
import { trimHistory } from "./useAiAgent";
import { buildSystemPrompt, buildTurnContext } from "./aiSystemPrompt";

function ctx(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    hasProject: () => true,
    projectName: () => "Paper",
    activeFilePath: () => "main.tex",
    listFiles: async () => ["main.tex"],
    readFile: async () => "\\begin{document}\nHello\n\\end{document}\n",
    writeFile: async () => {},
    documentText: () => "",
    selection: () => ({ text: "", hasSelection: false }),
    applyEdit: async () => {},
    compile: async () => ({ ok: true, log: "", diagnostics: [] }),
    runChecks: async () => "ok",
    insertCitation: async () => "none",
    recommendCitations: async () => "none",
    requestApproval: async () => true,
    ...overrides,
  };
}

function scripted(steps: GenerationStep[]) {
  const seen: ChatMessage[][] = [];
  const generate = vi.fn(async (messages: ChatMessage[]) => {
    seen.push(messages.map((message) => ({ ...message })));
    return steps.shift() ?? { type: "text" as const, content: "Done." };
  });
  return { generate, seen };
}

async function run(
  steps: GenerationStep[],
  context: AgentContext,
  user = "help",
  extra: Partial<Parameters<typeof runAgent>[0]> = {},
) {
  const { generate, seen } = scripted(steps);
  const events: AgentEvent[] = [];
  const messages = await runAgent({
    messages: [{ role: "user", content: user }],
    ctx: context,
    tools: agentToolSchemas,
    generate,
    autoApprove: true,
    maxSteps: 8,
    onEvent: (event) => events.push(event),
    ...extra,
  });
  return { messages, events, seen, generate };
}

describe("agent loop", () => {
  it("runs independent reads at the same time", async () => {
    let active = 0;
    let peak = 0;
    const readFile = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return "x";
    });
    await run(
      [
        {
          type: "tool_calls",
          content: "",
          toolCalls: [
            { id: "a", name: "read_file", args: { path: "a.tex" } },
            { id: "b", name: "read_file", args: { path: "b.tex" } },
          ],
        },
      ],
      ctx({ readFile }),
    );
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(peak).toBe(2);
  });

  it("does not run a tool call whose arguments were cut off", async () => {
    const writeFile = vi.fn(async () => {});
    const { seen } = await run(
      [
        {
          type: "tool_calls",
          content: "",
          truncated: true,
          toolCalls: [
            {
              id: "w",
              name: "write_file",
              args: { path: "main.tex", content: "\\begin" },
            },
          ],
        },
      ],
      ctx({ writeFile }),
    );
    expect(writeFile).not.toHaveBeenCalled();
    const result = seen[1].find((message) => message.role === "tool");
    expect(result?.content).toContain("output limit");
  });

  it("stops a repeated call that already failed", async () => {
    const call = {
      type: "tool_calls" as const,
      content: "",
      toolCalls: [{ id: "r", name: "read_file", args: { path: "missing.tex" } }],
    };
    const readFile = vi.fn(async () => {
      throw new Error("No such file");
    });
    const { seen } = await run(
      [call, { ...call, toolCalls: [{ ...call.toolCalls[0], id: "r2" }] }],
      ctx({ readFile }),
    );
    expect(readFile).toHaveBeenCalledTimes(1);
    const second = seen[2].filter((message) => message.role === "tool").at(-1);
    expect(second?.content).toContain("already made this exact read_file call");
  });

  it("keeps the provider's record of each assistant step", async () => {
    const { messages } = await run(
      [
        {
          type: "tool_calls",
          content: "",
          toolCalls: [{ id: "c", name: "compile", args: {} }],
          providerContent: [{ type: "thinking", signature: "s" }],
        },
        {
          type: "text",
          content: "Builds.",
          providerContent: [{ type: "text", text: "Builds." }],
        },
      ],
      ctx(),
    );
    const assistants = messages.filter((message) => message.role === "assistant");
    expect(assistants.map((message) => message.providerContent)).toEqual([
      [{ type: "thinking", signature: "s" }],
      [{ type: "text", text: "Builds." }],
    ]);
  });

  it("reminds a model once to apply a change it only described", async () => {
    const writeFile = vi.fn(async () => {});
    const { seen, events } = await run(
      [
        { type: "text", content: "Add \\end{itemize} before \\end{document}." },
        {
          type: "tool_calls",
          content: "",
          toolCalls: [
            {
              id: "e",
              name: "replace_in_file",
              args: { path: "main.tex", old_text: "Hello", new_text: "Hi" },
            },
          ],
        },
        { type: "text", content: "Fixed." },
      ],
      ctx({ writeFile }),
      "Fix the build",
      { nudgeUnappliedChanges: true },
    );
    expect(seen[1].at(-1)?.content).toContain("You have not changed any file yet");
    expect(writeFile).toHaveBeenCalled();
    expect(events.filter((event) => event.type === "assistant-message")).toHaveLength(
      1,
    );
  });

  it("does not remind when the user asked a question or the option is off", async () => {
    const question = await run(
      [{ type: "text", content: "It means X." }],
      ctx(),
      "What does this error mean?",
      { nudgeUnappliedChanges: true },
    );
    expect(question.generate).toHaveBeenCalledTimes(1);
    const off = await run([{ type: "text", content: "Do X." }], ctx(), "Fix it");
    expect(off.generate).toHaveBeenCalledTimes(1);
  });

  it("reads change requests from the user's words, not the editor context", () => {
    expect(asksForChange("Please rewrite the abstract")).toBe(true);
    expect(asksForChange("What is this paper about?")).toBe(false);
    expect(
      asksForChange(
        "<editor_context>\nfix replace add\n</editor_context>\n\nSummarize it",
      ),
    ).toBe(false);
  });
});

describe("replace_in_file", () => {
  const file = "\\section{A}\nSame line\n\\section{B}\nSame line\n";

  it("replaces one exact passage after approval", async () => {
    const writeFile = vi.fn(async () => {});
    const requestApproval = vi.fn(async () => true);
    const result = await executeTool(
      "replace_in_file",
      { path: "main.tex", old_text: "\\section{B}", new_text: "\\section{Beta}" },
      ctx({ readFile: async () => file, writeFile, requestApproval }),
      { autoApprove: false },
    );
    expect(result).toMatchObject({
      ok: true,
      content: expect.stringContaining("line 3"),
    });
    expect(writeFile).toHaveBeenCalledWith("main.tex", file.replace("{B}", "{Beta}"));
    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "replace-file", oldText: file }),
    );
  });

  it("explains a missing or ambiguous passage instead of guessing", async () => {
    const context = ctx({ readFile: async () => file });
    await expect(
      executeTool(
        "replace_in_file",
        { path: "main.tex", old_text: "Nope", new_text: "x" },
        context,
        { autoApprove: true },
      ),
    ).resolves.toMatchObject({
      ok: false,
      content: expect.stringContaining("not found"),
    });
    await expect(
      executeTool(
        "replace_in_file",
        { path: "main.tex", old_text: "Same line", new_text: "x" },
        context,
        { autoApprove: true },
      ),
    ).resolves.toMatchObject({
      ok: false,
      content: expect.stringContaining("appears 2 times"),
    });
  });

  it("leaves the file alone when the user declines", async () => {
    const writeFile = vi.fn(async () => {});
    const result = await executeTool(
      "replace_in_file",
      { path: "main.tex", old_text: "\\section{A}", new_text: "\\section{Alpha}" },
      ctx({
        readFile: async () => file,
        writeFile,
        requestApproval: async () => false,
      }),
      { autoApprove: false },
    );
    expect(result.content).toContain("declined");
    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe("trimHistory", () => {
  it("keeps the system prompt and starts the tail on a user message", () => {
    const history: ChatMessage[] = [
      { role: "system", content: "S" },
      { role: "user", content: "u1" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "1", name: "compile", args: {} }],
      },
      { role: "tool", content: "ok", toolCallId: "1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
    ];
    expect(trimHistory(history, 4).map((message) => message.content)).toEqual([
      "S",
      "u2",
      "a2",
    ]);
    expect(trimHistory(history, 100)).toEqual(history);
  });
});

describe("per-turn context", () => {
  it("keeps the system prompt free of the open file and file list", () => {
    const base = {
      perTurnContext: true,
      userName: "",
      projectName: "Paper",
      hasSelection: false,
      providerSupportsNativeTools: true,
      projectFiles: ["main.tex"],
    };
    const first = buildSystemPrompt({ ...base, activeFilePath: "a.tex" });
    const second = buildSystemPrompt({
      ...base,
      activeFilePath: "b.tex",
      hasSelection: true,
      projectFiles: ["main.tex", "new.tex"],
    });
    expect(first).toBe(second);
    expect(first).not.toContain("a.tex");
  });

  it("sends the file list only when it changed", () => {
    const turn = {
      activeFilePath: "main.tex",
      hasSelection: true,
      projectFiles: ["main.tex"],
    };
    expect(buildTurnContext(turn)).toContain("Project files");
    expect(buildTurnContext(turn, ["main.tex"])).not.toContain("Project files");
    expect(buildTurnContext(turn, ["main.tex"])).toContain('Open file: "main.tex"');
  });
});

describe("claudeModelTraits", () => {
  it.each([
    [
      "claude-opus-5-5",
      { sampling: false, adaptiveThinking: true, thinkingBinding: true },
    ],
    [
      "claude-sonnet-5-5",
      { sampling: false, adaptiveThinking: true, thinkingBinding: true },
    ],
    [
      "claude-haiku-5-5",
      { sampling: false, adaptiveThinking: true, thinkingBinding: true },
    ],
    [
      "claude-fable-5-1",
      { sampling: false, adaptiveThinking: true, thinkingBinding: true },
    ],
    [
      "claude-sonnet-5",
      { sampling: false, adaptiveThinking: true, thinkingBinding: false },
    ],
    [
      "claude-opus-4-8",
      { sampling: false, adaptiveThinking: true, thinkingBinding: false },
    ],
    [
      "claude-sonnet-4-6",
      { sampling: true, adaptiveThinking: true, thinkingBinding: false },
    ],
    [
      "claude-haiku-4-5",
      { sampling: true, adaptiveThinking: false, thinkingBinding: false },
    ],
    ["claude-haiku-4-5-20251001", { sampling: true, adaptiveThinking: false }],
    ["my-proxy-model", { sampling: true, adaptiveThinking: false }],
  ])("%s", (model, expected) => {
    expect(claudeModelTraits(model)).toMatchObject(expected);
  });
});
