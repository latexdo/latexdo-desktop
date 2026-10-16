import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAiConfig, type AiConfig } from "../features/ai/aiConfig";
import type { AgentContext, EditProposal } from "../features/ai/aiTools";
import type { UiMessage } from "../features/ai/useAiAgent";
import type { AiSidebarApi } from "./AiSidebar";

const agentMock = vi.hoisted(() => ({
  state: {
    messages: [] as UiMessage[],
    isRunning: false,
    status: "",
    send: vi.fn(),
    abort: vi.fn(),
    reset: vi.fn(),
    pendingApproval: null as EditProposal | null,
    resolveApproval: vi.fn(),
    proposeEdit: vi.fn(),
  },
}));

vi.mock("../features/ai/useAiAgent", () => ({
  useAiAgent: vi.fn(() => agentMock.state),
}));

import { AiSidebar } from "./AiSidebar";

const ctx: AgentContext = {
  projectName: () => "Paper",
  activeFilePath: () => "main.tex",
  listFiles: vi.fn().mockResolvedValue(["main.tex"]),
  readFile: vi.fn().mockResolvedValue("\\section{Intro}"),
  writeFile: vi.fn().mockResolvedValue(undefined),
  documentText: () => "\\section{Intro}",
  selection: () => ({ text: "Intro", hasSelection: true }),
  applyEdit: vi.fn().mockResolvedValue(undefined),
  compile: vi.fn().mockResolvedValue({ ok: true, log: "", diagnostics: [] }),
  runChecks: vi.fn().mockResolvedValue("ok"),
  insertCitation: vi.fn().mockResolvedValue(
    JSON.stringify({
      recommendation: { key: "smith2026", citation: "\\citep{smith2026}" },
    }),
  ),
  recommendCitations: vi
    .fn()
    .mockResolvedValue(
      JSON.stringify({ recommendations: [{ key: "smith2026", score: 0.5 }] }),
    ),
  requestApproval: vi.fn().mockResolvedValue(true),
};

type AiConfigOverrides = Omit<Partial<AiConfig>, "cloud" | "profile"> & {
  cloud?: Partial<AiConfig["cloud"]>;
  profile?: Partial<AiConfig["profile"]>;
};

function makeConfig(overrides: AiConfigOverrides = {}): AiConfig {
  return {
    ...defaultAiConfig,
    ...overrides,
    cloud: {
      ...defaultAiConfig.cloud,
      ...overrides.cloud,
    },
    profile: {
      ...defaultAiConfig.profile,
      ...overrides.profile,
    },
  };
}

function resetAgent(overrides: Partial<typeof agentMock.state> = {}) {
  agentMock.state.messages = [];
  agentMock.state.isRunning = false;
  agentMock.state.status = "";
  agentMock.state.send = vi.fn().mockResolvedValue(undefined);
  agentMock.state.abort = vi.fn();
  agentMock.state.reset = vi.fn();
  agentMock.state.pendingApproval = null;
  agentMock.state.resolveApproval = vi.fn();
  agentMock.state.proposeEdit = vi.fn().mockResolvedValue(true);
  Object.assign(agentMock.state, overrides);
}

function renderSidebar(config = makeConfig(), isDesktop = true) {
  const onOpenSettings = vi.fn();
  const onToggleExpanded = vi.fn();
  render(
    <AiSidebar
      config={config}
      ctx={ctx}
      isDesktop={isDesktop}
      expanded={false}
      onToggleExpanded={onToggleExpanded}
      onOpenSettings={onOpenSettings}
    />,
  );
  return { onOpenSettings, onToggleExpanded };
}

function renderSidebarWithApi(config = makeConfig()) {
  const apiRef: React.MutableRefObject<AiSidebarApi | null> = { current: null };
  render(
    <AiSidebar
      config={config}
      ctx={ctx}
      isDesktop={true}
      expanded={false}
      onToggleExpanded={vi.fn()}
      onOpenSettings={vi.fn()}
      apiRef={apiRef}
    />,
  );
  return apiRef;
}

function typeInAiInput(value: string) {
  const input = screen.getByPlaceholderText(/Ask the AI/i) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value } });
  input.setSelectionRange(value.length, value.length);
  fireEvent.select(input);
  return input;
}

describe("AiSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAgent();
    vi.mocked(ctx.listFiles).mockResolvedValue(["main.tex"]);
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    vi.stubGlobal("requestAnimationFrame", (cb: (time: number) => void) => {
      cb(0);
      return 1;
    });
  });

  it("shows the empty setup state for unconfigured providers", () => {
    const { onOpenSettings } = renderSidebar(
      makeConfig({ provider: "cloud", cloud: { credentialConfigured: false } }),
    );

    expect(screen.getByText("Cloud · claude-opus-5-5")).toBeVisible();
    expect(screen.getByText("AI isn't ready yet.")).toBeVisible();
    expect(screen.getByText("Add your API key in AI settings.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Open AI settings/i }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("explains desktop-only local setup in the browser", () => {
    renderSidebar(makeConfig({ provider: "local", modelDownloaded: true }), false);

    expect(screen.getByText("LatexDo AI Plus")).toBeVisible();
    expect(
      screen.getByText(
        "Local models need the desktop app. Switch to a cloud provider for the browser.",
      ),
    ).toBeVisible();
  });

  it("sends trimmed prompts and shows approval-required edit safety", () => {
    const config = makeConfig({
      provider: "ollama",
      ollamaModel: "qwen2.5-coder:3b",
    });
    const { onOpenSettings, onToggleExpanded } = renderSidebar(config);

    // Header label in a narrow panel, composer chip when expanded (CSS decides).
    expect(screen.getAllByText("Ollama · qwen2.5-coder:3b")).toHaveLength(2);
    expect(
      screen.getByRole("button", {
        name: "Model: Ollama · qwen2.5-coder:3b. Change model",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "What are we writing today?" }),
    ).toBeVisible();
    expect(screen.getByRole("img", { name: "Approval required" })).toBeVisible();
    expect(screen.queryByText("Ask me to…")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle("AI settings"));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle("Expand AI chat"));
    expect(onToggleExpanded).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle("New chat"));
    expect(agentMock.state.reset).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle("Clear chat")).toBeDisabled();

    expect(
      screen.queryByRole("button", { name: /Autonomous/i }),
    ).not.toBeInTheDocument();

    const input = screen.getByPlaceholderText(/Ask the AI/i);
    fireEvent.change(input, {
      target: { value: "  Fix the compile errors  " },
    });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(agentMock.state.send).toHaveBeenCalledWith("Fix the compile errors");
    expect(input).toHaveValue("");
  });

  it("clears the current AI chat from the trash button", () => {
    resetAgent({
      messages: [
        {
          id: "user-1",
          role: "user",
          text: "Can you fix this?",
          activity: [],
        },
        {
          id: "assistant-1",
          role: "assistant",
          text: "Yes.",
          activity: [],
        },
      ],
    });
    renderSidebar(
      makeConfig({
        provider: "ollama",
        ollamaModel: "qwen2.5-coder:3b",
      }),
    );

    const clearButton = screen.getByRole("button", { name: "Clear chat" });
    expect(clearButton).toBeEnabled();

    fireEvent.click(clearButton);

    expect(agentMock.state.reset).toHaveBeenCalledTimes(1);
  });

  it("offers quick command suggestions and accepts them from the keyboard", () => {
    renderSidebar(
      makeConfig({
        provider: "ollama",
        ollamaModel: "qwen2.5-coder:3b",
      }),
    );

    const input = typeInAiInput("\\f");

    expect(screen.getByRole("listbox")).toBeVisible();
    expect(screen.getByText("Quick commands")).toBeVisible();
    expect(screen.getByRole("option", { name: /\\fix/i })).toBeVisible();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(input).toHaveValue("\\fix ");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes quick command suggestions with Escape or blur", () => {
    renderSidebar(
      makeConfig({
        provider: "ollama",
        ollamaModel: "qwen2.5-coder:3b",
      }),
    );

    const input = typeInAiInput("\\c");
    expect(screen.getByRole("listbox")).toBeVisible();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    typeInAiInput("\\r");
    expect(screen.getByRole("listbox")).toBeVisible();

    fireEvent.blur(input);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("loads project file suggestions and accepts them with the mouse", async () => {
    vi.mocked(ctx.listFiles).mockResolvedValue([
      "main.tex",
      "sections/intro.tex",
      "refs/bibliography.bib",
    ]);
    renderSidebar(
      makeConfig({
        provider: "ollama",
        ollamaModel: "qwen2.5-coder:3b",
      }),
    );

    const input = typeInAiInput("@m");

    await waitFor(() => expect(ctx.listFiles).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    typeInAiInput("@ma");

    expect(screen.getByRole("listbox")).toBeVisible();
    expect(screen.getByText("Attach a project file")).toBeVisible();
    const mainOption = screen.getByRole("option", { name: /@main\.tex/i });

    fireEvent.mouseEnter(mainOption);
    expect(mainOption).toHaveAttribute("aria-selected", "true");

    fireEvent.mouseDown(mainOption);

    expect(input).toHaveValue("@main.tex ");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("keeps file suggestions closed when project files cannot be listed", async () => {
    vi.mocked(ctx.listFiles).mockRejectedValueOnce(new Error("No project"));
    renderSidebar(
      makeConfig({
        provider: "ollama",
        ollamaModel: "qwen2.5-coder:3b",
      }),
    );

    typeInAiInput("@m");

    await waitFor(() => expect(ctx.listFiles).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    typeInAiInput("@ma");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("renders activity, running status, abort, and edit approval controls", () => {
    resetAgent({
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          text: "I found a problem.",
          activity: [
            { name: "read_file", ok: true, summary: "Read main.tex" },
            { name: "compile", ok: false, summary: "Compile failed" },
          ],
        },
      ],
      isRunning: true,
      status: "Waiting for your approval...",
      pendingApproval: {
        path: "main.tex",
        kind: "replace-selection",
        oldText: "old text",
        newText: "new text",
      },
    });

    renderSidebar(makeConfig({ provider: "local", modelDownloaded: true }));

    expect(screen.getByText("I found a problem.")).toBeVisible();
    expect(screen.getByText("read_file")).toBeVisible();
    expect(screen.getByText("compile")).toBeVisible();
    expect(screen.getByText("Waiting for your approval...")).toBeVisible();
    expect(screen.getByText(/Replace selection/)).toBeVisible();
    expect(screen.getByText("old text")).toBeVisible();
    expect(screen.getByText("new text")).toBeVisible();

    fireEvent.click(screen.getByTitle("Stop"));
    expect(agentMock.state.abort).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Approve/i }));
    fireEvent.click(screen.getByRole("button", { name: /Decline/i }));
    expect(agentMock.state.resolveApproval).toHaveBeenNthCalledWith(1, true);
    expect(agentMock.state.resolveApproval).toHaveBeenNthCalledWith(2, false);
  });

  it("labels reformulate proposals distinctly from agent edits", () => {
    resetAgent({
      pendingApproval: {
        path: "main.tex",
        kind: "replace-selection",
        oldText: "Original prose.",
        newText: "Refined prose.",
        source: "reformulate",
      },
    });

    renderSidebar(makeConfig({ provider: "local", modelDownloaded: true }));

    expect(screen.getByText(/Reformulate selection/)).toBeVisible();
    expect(screen.getByText("Original prose.")).toBeVisible();
    expect(screen.getByText("Refined prose.")).toBeVisible();
  });

  it("attaches a selection context via apiRef and sends it with the next message", async () => {
    resetAgent();
    const apiRef = renderSidebarWithApi(
      makeConfig({
        provider: "ollama",
        ollamaModel: "qwen2.5-coder:3b",
      }),
    );

    apiRef.current?.appendSelectionContext({
      type: "editor-selection",
      filePath: "main.tex",
      text: "The method reduces complexity from $O(n^2)$ to $O(n \\log n)$.",
      startLine: 42,
      endLine: 44,
    });

    expect(await screen.findByText(/Selection: main\.tex · lines 42–44/)).toBeVisible();
    expect(await screen.findByText(/The method reduces complexity/)).toBeVisible();

    const input = screen.getByPlaceholderText(/Ask about the selection/);
    fireEvent.change(input, { target: { value: "Explain this claim." } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(agentMock.state.send).toHaveBeenCalledTimes(1);
    const sent = agentMock.state.send.mock.calls[0][0];
    expect(sent).toContain("Selection from main.tex (lines 42–44)");
    expect(sent).toContain("$O(n^2)$");
    expect(sent).toContain("Explain this claim.");
  });

  it("removes the selection context chip without sending anything", async () => {
    const apiRef = renderSidebarWithApi(
      makeConfig({
        provider: "ollama",
        ollamaModel: "qwen2.5-coder:3b",
      }),
    );

    apiRef.current?.appendSelectionContext({
      type: "editor-selection",
      filePath: "main.tex",
      text: "Some prose.",
      startLine: 1,
      endLine: 2,
    });
    expect(await screen.findByText(/Selection: main\.tex/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Remove selection context/i }));
    await waitFor(() =>
      expect(screen.queryByText(/Selection: main\.tex/)).not.toBeInTheDocument(),
    );
    expect(agentMock.state.send).not.toHaveBeenCalled();
  });

  it("enables Send when only the selection is attached", async () => {
    const apiRef = renderSidebarWithApi(
      makeConfig({
        provider: "ollama",
        ollamaModel: "qwen2.5-coder:3b",
      }),
    );

    const sendButton = screen.getByTitle("Send") as HTMLButtonElement;
    expect(sendButton).toBeDisabled();

    apiRef.current?.appendSelectionContext({
      type: "editor-selection",
      filePath: "main.tex",
      text: "Selected.",
      startLine: 1,
      endLine: 2,
    });
    await waitFor(() => expect(screen.getByTitle("Send")).toBeEnabled());

    fireEvent.click(screen.getByTitle("Send"));
    expect(agentMock.state.send).toHaveBeenCalledTimes(1);
    expect(agentMock.state.send.mock.calls[0][0]).toContain("Selected.");
  });

  it("exposes proposeEdit through apiRef for reformulation approval", () => {
    resetAgent({
      proposeEdit: vi.fn(),
    });
    const apiRef = renderSidebarWithApi(
      makeConfig({
        provider: "ollama",
        ollamaModel: "qwen2.5-coder:3b",
      }),
    );

    expect(apiRef.current?.proposeEdit).toBeDefined();
    expect(typeof apiRef.current?.proposeEdit).toBe("function");
  });
});
