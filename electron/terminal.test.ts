// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
type TerminalCreateHandler = (
  event: { sender: unknown },
  options?: unknown,
  ...extra: unknown[]
) => Promise<{ id: number; mode: "pty" | "pipe" }>;
type TerminalEventHandler = (
  event: { sender: unknown },
  payload: unknown,
  ...extra: unknown[]
) => void;
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, TerminalCreateHandler>(),
  events: new Map<string, TerminalEventHandler>(),
  pty: vi.fn(),
  spawn: vi.fn(),
}));
vi.mock("./trustedIpc.js", () => ({
  ipcMain: {
    handle: (name: string, fn: TerminalCreateHandler) => mocks.handlers.set(name, fn),
    on: (name: string, fn: TerminalEventHandler) => mocks.events.set(name, fn),
  },
}));
vi.mock("electron", () => ({ app: { getPath: () => os.tmpdir() } }));
vi.mock("node-pty", () => ({ default: { spawn: mocks.pty } }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
import { registerTerminalIpc } from "./terminal.js";
let root: string;
let sender: EventEmitter & {
  id: number;
  send: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn>;
};
let terminal: {
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
  onExit: ReturnType<typeof vi.fn>;
};
beforeEach(async () => {
  vi.clearAllMocks();
  root = await mkdtemp(path.join(os.tmpdir(), "latexdo-terminal-"));
  sender = Object.assign(new EventEmitter(), {
    id: 1,
    send: vi.fn(),
    isDestroyed: vi.fn(() => false),
  });
  terminal = {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
  };
  mocks.pty.mockReturnValue(terminal);
  registerTerminalIpc({
    getProjectRoot: (id) => {
      if (id !== "project") throw new Error("Unknown project");
      return root;
    },
  });
});
afterEach(async () => {
  sender.emit("destroyed");
  await rm(root, { recursive: true, force: true });
});
const create = (
  sender: unknown,
  options: unknown = { projectId: "project" },
  ...extra: unknown[]
) => mocks.handlers.get("terminal:create")!({ sender }, options, ...extra);
const send = (name: string, sender: unknown, payload: unknown, ...extra: unknown[]) =>
  mocks.events.get(name)!({ sender }, payload, ...extra);
describe("terminal ownership and lifecycle", () => {
  it("starts a shell in the trusted project with terminal environment", async () => {
    const result = await create(sender);
    expect(result.mode).toBe("pty");
    expect(result.id).toBeGreaterThan(0);
    expect(mocks.pty).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        cwd: root,
        cols: 80,
        rows: 24,
        env: expect.objectContaining({
          TERM: "xterm-256color",
          TERM_PROGRAM: "LatexDo",
          PWD: root,
        }),
      }),
    );
    send("terminal:write", sender, { id: result.id, data: "ls\n" });
    expect(terminal.write).toHaveBeenCalledWith("ls\n");
    send("terminal:resize", sender, { id: result.id, cols: 120, rows: 40 });
    expect(terminal.resize).toHaveBeenCalledWith(120, 40);
    terminal.onData.mock.calls[0][0]("output");
    expect(sender.send).toHaveBeenCalledWith("terminal:data", {
      id: result.id,
      data: "output",
    });
    terminal.onExit.mock.calls[0][0]({ exitCode: 3 });
    expect(sender.send).toHaveBeenCalledWith("terminal:exit", {
      id: result.id,
      exitCode: 3,
    });
    send("terminal:write", sender, { id: result.id, data: "late" });
    expect(terminal.write).toHaveBeenCalledTimes(1);
  });
  it("blocks cross-renderer writes, resizes and termination", async () => {
    const { id } = await create(sender);
    const attacker = { id: 2 };
    send("terminal:write", attacker, { id, data: "rm -rf /" });
    send("terminal:resize", attacker, { id, cols: 100, rows: 30 });
    send("terminal:dispose", attacker, { id });
    expect(terminal.write).not.toHaveBeenCalled();
    expect(terminal.resize).not.toHaveBeenCalled();
    expect(terminal.kill).not.toHaveBeenCalled();
    send("terminal:dispose", sender, { id });
    expect(terminal.kill).toHaveBeenCalledOnce();
  });
  it.each([
    null,
    {},
    [],
    { projectId: "" },
    { projectId: 42 },
    { projectId: "unknown" },
  ])("rejects an invalid project request %j", async (options) => {
    await expect(create(sender, options)).rejects.toThrow();
    expect(mocks.pty).not.toHaveBeenCalled();
  });
  it("rejects extra create arguments and non-directory project roots", async () => {
    await expect(create(sender, { projectId: "project" }, "extra")).rejects.toThrow(
      "Invalid IPC input",
    );
    const file = path.join(root, "file");
    await writeFile(file, "text");
    registerTerminalIpc({ getProjectRoot: () => file });
    await expect(create(sender)).rejects.toThrow("not a directory");
  });
  it("ignores malformed terminal messages and bounds input sizes", async () => {
    const { id } = await create(sender);
    for (const payload of [
      null,
      {},
      { id: 0, data: "bad" },
      { id: 1.5, data: "bad" },
      { id, data: 42 },
      { id, data: "" },
      { id, data: "a".repeat(32769) },
    ])
      send("terminal:write", sender, payload);
    send("terminal:write", sender, { id, data: "bad" }, "extra");
    for (const [cols, rows] of [
      [9, 24],
      [301, 24],
      [80, 4],
      [80, 101],
      [1.5, 24],
      [80, NaN],
    ])
      send("terminal:resize", sender, { id, cols, rows });
    send("terminal:resize", sender, { id, cols: 80, rows: 24 }, "extra");
    send("terminal:dispose", sender, { id }, "extra");
    expect(terminal.write).not.toHaveBeenCalled();
    expect(terminal.resize).not.toHaveBeenCalled();
    expect(terminal.kill).not.toHaveBeenCalled();
    sender.isDestroyed.mockReturnValue(true);
    terminal.onData.mock.calls[0][0]("late");
    expect(sender.send).not.toHaveBeenCalled();
    sender.emit("destroyed");
    expect(terminal.kill).toHaveBeenCalledOnce();
  });
  it("falls back to pipes when PTY startup fails and forwards both output streams", async () => {
    mocks.pty.mockImplementation(() => {
      throw new Error("PTY unavailable");
    });
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: { write: vi.fn() },
      kill: vi.fn(),
    });
    mocks.spawn.mockReturnValue(child);
    const { id, mode } = await create(sender);
    expect(mode).toBe("pipe");
    child.stdout.emit("data", Buffer.from("out"));
    child.stderr.emit("data", Buffer.from("err"));
    expect(sender.send).toHaveBeenCalledWith("terminal:data", { id, data: "err" });
    send("terminal:write", sender, { id, data: "pwd\n" });
    expect(child.stdin.write).toHaveBeenCalledWith("pwd\n");
    send("terminal:resize", sender, { id, cols: 80, rows: 24 });
    expect(terminal.resize).not.toHaveBeenCalled();
    child.emit("exit", null);
    expect(sender.send).toHaveBeenCalledWith("terminal:exit", { id, exitCode: 0 });
  });
  it("reports fallback process errors and tolerates already-terminated shells", async () => {
    mocks.pty.mockImplementation(() => {
      throw new Error("no PTY");
    });
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: { write: vi.fn() },
      kill: vi.fn(() => {
        throw new Error("already dead");
      }),
    });
    mocks.spawn.mockReturnValue(child);
    const { id } = await create(sender);
    child.emit("error", new Error("spawn failed"));
    expect(sender.send).toHaveBeenCalledWith("terminal:exit", { id, exitCode: 1 });
    const second = await create(sender);
    expect(() => send("terminal:dispose", sender, { id: second.id })).not.toThrow();
  });
});
