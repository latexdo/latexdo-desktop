import { app } from "electron";
import { ipcMain } from "./trustedIpc.js";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pty from "node-pty";

type TerminalSessionMetadata = {
  id: number;
  ownerWebContentsId: number;
  projectId: string;
  cwd: string;
};

type PtySession = TerminalSessionMetadata & {
  kind: "pty";
  process: pty.IPty;
};

type PipeSession = TerminalSessionMetadata & {
  kind: "pipe";
  process: ChildProcessWithoutNullStreams;
};

type TerminalSession = PtySession | PipeSession;

type TerminalProjectRegistry = {
  getProjectRoot: (projectId: string) => string;
};

const terminals = new Map<number, TerminalSession>();
let nextTerminalId = 1;
const minTerminalCols = 10;
const maxTerminalCols = 300;
const minTerminalRows = 5;
const maxTerminalRows = 100;
const maxTerminalWriteLength = 32 * 1024;

async function canExecute(filePath: string | undefined): Promise<boolean> {
  if (!filePath) return false;

  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function pickShell(): Promise<string> {
  if (os.platform() === "win32") {
    return "powershell.exe";
  }

  const candidates = [process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"];

  for (const candidate of candidates) {
    if (await canExecute(candidate)) {
      return candidate!;
    }
  }

  return "sh";
}

async function pickFallbackShell(): Promise<string> {
  if (os.platform() === "win32") {
    return "powershell.exe";
  }

  const candidates = ["/bin/bash", "/bin/sh"];
  for (const candidate of candidates) {
    if (await canExecute(candidate)) {
      return candidate;
    }
  }

  return await pickShell();
}

function buildTerminalEnv(shell: string, cwd: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  env.TERM = "xterm-256color";
  env.COLORTERM = env.COLORTERM || "truecolor";
  env.TERM_PROGRAM = "LatexDo";
  env.CLICOLOR = env.CLICOLOR || "1";
  env.FORCE_COLOR = env.FORCE_COLOR || "1";
  env.HOME = env.HOME || app.getPath("home");
  env.PWD = cwd;
  env.HISTFILE = env.HISTFILE || `${app.getPath("temp")}/latexdo-shell-history`;
  env.ZDOTDIR = env.ZDOTDIR || env.HOME;
  env.BASH_SILENCE_DEPRECATION_WARNING = env.BASH_SILENCE_DEPRECATION_WARNING || "1";
  env.LSCOLORS = env.LSCOLORS || "ExGxBxDxCxEgEdxbxgxcxd";
  env.LS_COLORS =
    env.LS_COLORS ||
    "di=1;34:ln=36:so=35:pi=33:ex=1;32:bd=34;46:cd=34;43:su=30;41:sg=30;46:tw=30;42:ow=30;43";

  if (!env.PS1) {
    const shellName = shell.split("/").pop() ?? "";
    env.PS1 =
      shellName === "zsh"
        ? "%F{75}LatexDo%f %F{108}%~%f %# "
        : "\u001b[38;5;75mLatexDo\u001b[0m \u001b[38;5;108m\\w\u001b[0m \\$ ";
  }

  if (os.platform() !== "win32") {
    env.SHELL = shell;
    env.PATH =
      env.PATH || "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  }

  return env;
}

function shellArgs(shell: string, mode: "pty" | "pipe"): string[] {
  if (os.platform() === "win32") {
    return [];
  }

  const shellName = shell.split("/").pop() ?? shell;
  if (mode === "pty") {
    return ["-l"];
  }

  if (shellName === "bash") {
    return ["--noprofile", "--norc", "-i"];
  }

  if (shellName === "sh") {
    return [];
  }

  return [];
}

function sendTerminalExit(sender: Electron.WebContents, id: number, exitCode: number) {
  const session = terminals.get(id);
  if (!session || session.ownerWebContentsId !== sender.id) return;

  terminals.delete(id);
  if (!sender.isDestroyed()) {
    sender.send("terminal:exit", { id, exitCode });
  }
}

function sendTerminalData(sender: Electron.WebContents, id: number, data: string) {
  const session = terminals.get(id);
  if (!session || session.ownerWebContentsId !== sender.id) return;

  if (!sender.isDestroyed()) {
    sender.send("terminal:data", { id, data });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseProjectId(options: unknown): string {
  if (!isRecord(options) || typeof options.projectId !== "string") {
    throw new Error("Open a project before starting a terminal.");
  }

  const projectId = options.projectId.trim();
  if (!projectId) {
    throw new Error("Open a project before starting a terminal.");
  }

  return projectId;
}

async function resolveTerminalCwd(
  projects: TerminalProjectRegistry,
  projectId: string,
): Promise<string> {
  const projectRoot = path.resolve(projects.getProjectRoot(projectId));
  const details = await stat(projectRoot);
  if (!details.isDirectory()) {
    throw new Error("The selected project root is not a directory.");
  }

  const cwd = projectRoot;
  if (!isInside(projectRoot, cwd)) {
    throw new Error("Terminal working directory must be inside the project.");
  }

  return cwd;
}

function isValidTerminalId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parseTerminalSize(
  cols: unknown,
  rows: unknown,
): { cols: number; rows: number } | null {
  if (
    typeof cols !== "number" ||
    typeof rows !== "number" ||
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    cols < minTerminalCols ||
    cols > maxTerminalCols ||
    rows < minTerminalRows ||
    rows > maxTerminalRows
  ) {
    return null;
  }

  return { cols, rows };
}

function getOwnedTerminal(
  event: Electron.IpcMainEvent,
  payload: unknown,
): TerminalSession | null {
  if (!isRecord(payload) || !isValidTerminalId(payload.id)) {
    return null;
  }

  const session = terminals.get(payload.id);
  if (!session || session.ownerWebContentsId !== event.sender.id) {
    return null;
  }

  return session;
}

function registerTerminalSession(
  sender: Electron.WebContents,
  session: TerminalSession,
) {
  terminals.set(session.id, session);
  sender.once("destroyed", () => {
    const activeSession = terminals.get(session.id);
    if (activeSession && activeSession.ownerWebContentsId === sender.id) {
      disposeTerminalSession(activeSession);
    }
  });
}

function disposeTerminalSession(session: TerminalSession) {
  terminals.delete(session.id);
  try {
    session.process.kill();
  } catch {
    // The process may already be gone.
  }
}

export function registerTerminalIpc(projects: TerminalProjectRegistry) {
  ipcMain.handle(
    "terminal:create",
    async (event, options?: unknown, ...extraArgs: unknown[]) => {
      if (extraArgs.length) {
        throw new Error("Invalid IPC input for terminal:create.");
      }

      const projectId = parseProjectId(options);
      const cwd = await resolveTerminalCwd(projects, projectId);
      const id = nextTerminalId++;
      const ownerWebContentsId = event.sender.id;
      const shell = await pickShell();
      const env = buildTerminalEnv(shell, cwd);
      const sessionMetadata = {
        id,
        ownerWebContentsId,
        projectId,
        cwd,
      };
      let mode: "pty" | "pipe";

      try {
        const terminalProcess = pty.spawn(shell, shellArgs(shell, "pty"), {
          name: "xterm-256color",
          cols: 80,
          rows: 24,
          cwd,
          env,
        });

        registerTerminalSession(event.sender, {
          ...sessionMetadata,
          kind: "pty",
          process: terminalProcess,
        });
        mode = "pty";

        terminalProcess.onData((data) => {
          sendTerminalData(event.sender, id, data);
        });

        terminalProcess.onExit((res) => {
          const exitCode = (res && (res as any).exitCode) ?? 0;
          sendTerminalExit(event.sender, id, exitCode);
        });
      } catch (error) {
        const fallbackShell = await pickFallbackShell();
        const fallbackEnv = buildTerminalEnv(fallbackShell, cwd);
        const child = spawn(fallbackShell, shellArgs(fallbackShell, "pipe"), {
          cwd,
          env: fallbackEnv,
          stdio: "pipe",
        });

        registerTerminalSession(event.sender, {
          ...sessionMetadata,
          kind: "pipe",
          process: child,
        });
        mode = "pipe";

        child.stdout.on("data", (data: Buffer) => {
          sendTerminalData(event.sender, id, data.toString("utf8"));
        });

        child.stderr.on("data", (data: Buffer) => {
          sendTerminalData(event.sender, id, data.toString("utf8"));
        });

        child.on("exit", (exitCode) => {
          sendTerminalExit(event.sender, id, exitCode ?? 0);
        });

        child.on("error", (childError) => {
          sendTerminalData(
            event.sender,
            id,
            `[terminal failed to start] ${childError.message}\r\n`,
          );
          sendTerminalExit(event.sender, id, 1);
        });
      }

      return { id, mode };
    },
  );

  ipcMain.on("terminal:write", (event, payload: unknown, ...extraArgs: unknown[]) => {
    if (extraArgs.length) return;
    const session = getOwnedTerminal(event, payload);
    if (!session) return;
    if (!isRecord(payload) || typeof payload.data !== "string") return;
    if (payload.data.length > maxTerminalWriteLength) return;
    if (!payload.data) return;

    if (session.kind === "pty") {
      session.process.write(payload.data);
      return;
    }

    session.process.stdin.write(payload.data);
  });

  ipcMain.on("terminal:resize", (event, payload: unknown, ...extraArgs: unknown[]) => {
    if (extraArgs.length) return;
    const session = getOwnedTerminal(event, payload);
    if (!session || session.kind !== "pty") return;
    if (!isRecord(payload)) return;
    const size = parseTerminalSize(payload.cols, payload.rows);
    if (!size) return;

    session.process.resize(size.cols, size.rows);
  });

  ipcMain.on("terminal:dispose", (event, payload: unknown, ...extraArgs: unknown[]) => {
    if (extraArgs.length) return;
    const session = getOwnedTerminal(event, payload);
    if (!session) return;

    disposeTerminalSession(session);
  });
}
