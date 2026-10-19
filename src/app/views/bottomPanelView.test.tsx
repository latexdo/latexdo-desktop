import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AppCtx } from "../appContext";

vi.mock("../appShared", () => ({
  TerminalPanel: (props: {
    active: boolean;
    projectId: string;
    onCommandSettled: () => void;
  }) => (
    <button
      data-testid="terminal"
      data-active={String(props.active)}
      onClick={props.onCommandSettled}
    >
      terminal {props.projectId}
    </button>
  ),
  ToolchainSetupCard: (props: { issue: { id: string }; onInstalled: () => void }) => (
    <button data-testid="setup" onClick={props.onInstalled}>
      setup {props.issue.id}
    </button>
  ),
}));

vi.mock("../../components/ProblemsPanel", () => ({
  ProblemsPanel: (props: {
    diagnostics: unknown[];
    onOpen: (d: unknown) => void;
    onApplyFix: (d: unknown, f: unknown) => void;
  }) => (
    <div data-testid="problems">
      <button onClick={() => props.onOpen(props.diagnostics[0])}>open</button>
      <button onClick={() => props.onApplyFix(props.diagnostics[0], "fix")}>fix</button>
    </div>
  ),
}));

import { renderPanelContent, renderPanelTabs } from "./bottomPanelView";

function makeCtx(overrides: Partial<AppCtx> = {}): AppCtx {
  return {
    activePanel: "problems",
    diagnostics: [{ message: "x" }],
    openPanel: vi.fn(),
    setPanelVisible: vi.fn(),
    applyDiagnosticReplacement: vi.fn(),
    applyLatexDiagnosticFix: vi.fn(async () => {}),
    compile: vi.fn(async () => {}),
    openDiagnostic: vi.fn(async () => {}),
    openExternalLink: vi.fn(),
    rootFile: "main.tex",
    activeCompilerSetupIssue: null,
    refreshAfterTerminalCommand: vi.fn(async () => {}),
    compileResult: null,
    latexDoCommandService: {},
    projectId: "p1",
    projectPath: "/p",
    statusMessage: "Ready",
    terminalStarted: false,
    ...overrides,
  } as unknown as AppCtx;
}

describe("bottomPanelView", () => {
  it("renders tabs with the problem count and routes clicks", () => {
    const ctx = makeCtx();
    render(renderPanelTabs(ctx));
    const problems = screen.getByRole("button", { name: /PROBLEMS/ });
    expect(problems).toHaveClass("active");
    expect(problems).toHaveTextContent("1");
    fireEvent.click(problems);
    fireEvent.click(screen.getByRole("button", { name: /OUTPUT/ }));
    fireEvent.click(screen.getByRole("button", { name: /TERMINAL/ }));
    expect(ctx.openPanel).toHaveBeenNthCalledWith(1, "problems");
    expect(ctx.openPanel).toHaveBeenNthCalledWith(2, "output");
    expect(ctx.openPanel).toHaveBeenNthCalledWith(3, "terminal");
    fireEvent.click(screen.getByLabelText("Close bottom panel"));
    expect(ctx.setPanelVisible).toHaveBeenCalledWith(false);
  });

  it("omits the badge with no diagnostics and highlights other tabs", () => {
    render(renderPanelTabs(makeCtx({ diagnostics: [], activePanel: "terminal" })));
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.getByRole("button", { name: /TERMINAL/ })).toHaveClass("active");
    expect(screen.getByRole("button", { name: /PROBLEMS/ })).not.toHaveClass("active");
  });

  it("wires the problems panel callbacks and default output text", () => {
    const ctx = makeCtx();
    render(renderPanelContent(ctx));
    fireEvent.click(screen.getByText("open"));
    fireEvent.click(screen.getByText("fix"));
    expect(ctx.openDiagnostic).toHaveBeenCalledWith({ message: "x" });
    expect(ctx.applyLatexDiagnosticFix).toHaveBeenCalledWith({ message: "x" }, "fix");
    expect(screen.getByText("Compile the project to see build output.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Ready");
    expect(screen.queryByTestId("terminal")).toBeNull();
  });

  it("shows the toolchain setup card, build output and the terminal", async () => {
    const ctx = makeCtx({
      activePanel: "terminal",
      activeCompilerSetupIssue: { id: "tex" } as never,
      compileResult: { output: "LOG" } as never,
      terminalStarted: true,
    });
    render(renderPanelContent(ctx));
    expect(screen.getByLabelText("Problems")).toHaveClass("hidden");
    fireEvent.click(screen.getByTestId("setup"));
    expect(ctx.compile).toHaveBeenCalled();
    expect(screen.getByText("LOG")).toBeInTheDocument();
    const terminal = await screen.findByTestId("terminal");
    expect(terminal).toHaveAttribute("data-active", "true");
    fireEvent.click(terminal);
    expect(ctx.refreshAfterTerminalCommand).toHaveBeenCalled();
  });

  it("hides the terminal pane when another panel is active", () => {
    render(renderPanelContent(makeCtx({ activePanel: "output", terminalStarted: true })));
    expect(screen.getByTestId("terminal")).toHaveAttribute("data-active", "false");
    expect(screen.getByLabelText("Output")).not.toHaveClass("hidden");
  });

  it("marks the output tab active", () => {
    render(renderPanelTabs(makeCtx({ activePanel: "output" })));
    expect(screen.getByRole("button", { name: /OUTPUT/ })).toHaveClass("active");
  });
});
