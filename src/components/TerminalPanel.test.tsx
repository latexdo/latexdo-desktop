import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalPanel } from "./TerminalPanel";

const xtermMocks = vi.hoisted(() => {
  const terminalInstances: any[] = [];
  const fitAddonInstances: any[] = [];

  class MockTerminal {
    dataHandler: ((data: string) => void) | null = null;
    selectionHandler: (() => void) | null = null;
    selection = "";
    loadAddon = vi.fn();
    open = vi.fn();
    focus = vi.fn();
    clear = vi.fn();
    write = vi.fn();
    writeln = vi.fn();
    paste = vi.fn();
    dispose = vi.fn();
    attachCustomKeyEventHandler = vi.fn();
    getSelection = vi.fn(() => this.selection);

    constructor() {
      terminalInstances.push(this);
    }

    onData(callback: (data: string) => void) {
      this.dataHandler = callback;
      return { dispose: vi.fn() };
    }

    onSelectionChange(callback: () => void) {
      this.selectionHandler = callback;
      return { dispose: vi.fn() };
    }

    emitData(data: string) {
      this.dataHandler?.(data);
    }

    emitSelection(selection: string) {
      this.selection = selection;
      this.selectionHandler?.();
    }
  }

  class MockFitAddon {
    fit = vi.fn();
    proposeDimensions = vi.fn(() => ({ cols: 80, rows: 24 }));

    constructor() {
      fitAddonInstances.push(this);
    }
  }

  return { terminalInstances, fitAddonInstances, MockTerminal, MockFitAddon };
});

vi.mock("@xterm/xterm", () => ({
  Terminal: xtermMocks.MockTerminal,
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: xtermMocks.MockFitAddon,
}));

describe("TerminalPanel", () => {
  let terminalDataCallback: ((payload: { id: number; data: string }) => void) | null;
  let terminalExitCallback:
    | ((payload: { id: number; exitCode: number }) => void)
    | null;
  let nextTerminalId: number;

  beforeEach(() => {
    terminalDataCallback = null;
    terminalExitCallback = null;
    nextTerminalId = 7;
    xtermMocks.terminalInstances.length = 0;
    xtermMocks.fitAddonInstances.length = 0;

    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
    });
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      value: class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: vi.fn().mockResolvedValue("pasted command"),
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    window.terminalApi = {
      create: vi.fn().mockImplementation(async () => ({
        id: nextTerminalId++,
        mode: "pty",
      })),
      write: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
      onData: vi.fn((callback) => {
        terminalDataCallback = callback;
        return vi.fn();
      }),
      onExit: vi.fn((callback) => {
        terminalExitCallback = callback;
        return vi.fn();
      }),
    };
  });

  it("reports when a typed command has finished printing (#226)", async () => {
    const onCommandSettled = vi.fn();
    render(
      <TerminalPanel
        projectId="project-1"
        workspacePath="/Users/omar/paper"
        active
        onCommandSettled={onCommandSettled}
      />,
    );
    await waitFor(() => expect(window.terminalApi.create).toHaveBeenCalled());
    const terminal = xtermMocks.terminalInstances[0];

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      act(() => {
        terminal.emitData("git pull\r");
      });
      act(() => {
        vi.advanceTimersByTime(500);
        terminalDataCallback?.({ id: 7, data: "Updating 1a2b..3c4d" });
        vi.advanceTimersByTime(500);
      });
      // Still printing: not done yet.
      expect(onCommandSettled).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(onCommandSettled).toHaveBeenCalledTimes(1);

      // Output without a new command (a prompt, a clock) does not refresh.
      act(() => {
        terminalDataCallback?.({ id: 7, data: "$ " });
        vi.advanceTimersByTime(2000);
      });
      expect(onCommandSettled).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not create a shell without an open project", async () => {
    render(<TerminalPanel active />);

    expect(await screen.findByTitle(/Open a project first/)).toBeVisible();
    expect(window.terminalApi.create).not.toHaveBeenCalled();
    expect(xtermMocks.terminalInstances[0].writeln).toHaveBeenCalledWith(
      "[open a project to start a terminal]",
    );
  });

  it("creates, writes to, copies from, and disposes the owned terminal session", async () => {
    const { unmount } = render(
      <TerminalPanel projectId="project-1" workspacePath="/Users/omar/paper" active />,
    );

    await waitFor(() => {
      expect(window.terminalApi.create).toHaveBeenCalledWith({
        projectId: "project-1",
      });
    });
    expect(screen.getByRole("tab", { name: /zsh/i })).toBeVisible();
    expect(screen.getByTitle(/\/Users\/omar\/paper · PTY shell ready/)).toBeVisible();

    const terminal = xtermMocks.terminalInstances[0];
    act(() => {
      terminal.emitData("ls\n");
    });
    expect(window.terminalApi.write).toHaveBeenCalledWith(7, "ls\n");

    act(() => {
      terminalDataCallback?.({ id: 7, data: "output" });
    });
    expect(terminal.write).toHaveBeenCalledWith("output");

    act(() => {
      terminal.emitSelection("selected output");
    });
    fireEvent.click(screen.getByRole("button", { name: /copy selection/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("selected output");

    act(() => {
      terminalExitCallback?.({ id: 7, exitCode: 0 });
    });
    expect(screen.getByTitle(/Exited with code 0/)).toBeVisible();

    unmount();
    expect(window.terminalApi.dispose).toHaveBeenCalledWith(7);
  });

  it("handles LatexDo commands locally without sending them to the PTY", async () => {
    const commandService = {
      execute: vi.fn().mockResolvedValue({
        ok: true,
        message: "✓ Theme changed to Graphite Pro.",
      }),
      complete: vi.fn(() => []),
      help: vi.fn(),
    };

    render(
      <TerminalPanel
        projectId="project-1"
        workspacePath="/Users/omar/paper"
        active
        commandService={commandService}
      />,
    );

    await waitFor(() => expect(window.terminalApi.create).toHaveBeenCalledTimes(1));

    const terminal = xtermMocks.terminalInstances[0];
    act(() => {
      terminal.emitData("latexdo theme graphite\r");
    });

    await waitFor(() => {
      expect(commandService.execute).toHaveBeenCalledWith("latexdo theme graphite");
    });
    expect(window.terminalApi.write).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(terminal.write).toHaveBeenCalledWith(
        "✓ Theme changed to Graphite Pro.\r\n",
      );
    });
  });

  it("continues to send ordinary commands to the PTY", async () => {
    const commandService = {
      execute: vi.fn(),
      complete: vi.fn(() => []),
      help: vi.fn(),
    };

    render(
      <TerminalPanel
        projectId="project-1"
        workspacePath="/Users/omar/paper"
        active
        commandService={commandService}
      />,
    );

    await waitFor(() => expect(window.terminalApi.create).toHaveBeenCalledTimes(1));

    const terminal = xtermMocks.terminalInstances[0];
    act(() => {
      terminal.emitData("ls\n");
    });

    expect(commandService.execute).not.toHaveBeenCalled();
    expect(window.terminalApi.write).toHaveBeenCalledWith(7, "ls\n");
  });

  it("creates additional terminal tabs and restarts the active session", async () => {
    render(
      <TerminalPanel projectId="project-1" workspacePath="/Users/omar/paper" active />,
    );

    await waitFor(() => expect(window.terminalApi.create).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /new terminal/i }));
    await waitFor(() => expect(window.terminalApi.create).toHaveBeenCalledTimes(2));

    expect(screen.getByRole("tab", { name: /zsh 2/i })).toBeVisible();
    expect(screen.getAllByRole("tab")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /restart shell/i }));
    await waitFor(() => expect(window.terminalApi.create).toHaveBeenCalledTimes(3));
    expect(window.terminalApi.dispose).toHaveBeenCalledWith(8);
  });
});
