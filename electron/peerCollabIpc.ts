import { app, BrowserWindow, dialog, net, safeStorage, utilityProcess } from "electron";
import { stat } from "node:fs/promises";
import path from "node:path";
import { PeerCollabService, type PeerSocket } from "./peerCollab.js";
import { ipcMain } from "./trustedIpc.js";
import type {
  HostSharingStatus,
  OpenProject,
  SaveSharedProjectResult,
} from "./types.js";

type PeerProjectRegistry = {
  getProjectRoot: (projectId: string) => string;
  registerProject: (rootPath: string) => OpenProject;
};

const maxSocketsPerWindow = 8;
const sockets = new Map<string, PeerSocket>();
let service: PeerCollabService | null = null;

function invalid(channel: string): never {
  throw new Error(`Invalid IPC input for ${channel}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseText(channel: string, value: unknown, maxLength: number): string {
  if (typeof value !== "string" || !value || value.length > maxLength) {
    invalid(channel);
  }
  return value;
}

function socketKey(senderId: number, socketId: number): string {
  return `${senderId}:${socketId}`;
}

function hostServerEnvironment(env: Record<string, string>): Record<string, string> {
  const inherited: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    // A LATEXDO_COLLAB_* variable in the user's shell must not reconfigure the
    // server that the app hosts on their behalf.
    if (value !== undefined && !name.startsWith("LATEXDO_COLLAB_")) {
      inherited[name] = value;
    }
  }
  return { ...inherited, ...env };
}

function broadcastStatus(status: HostSharingStatus): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("peer:host-changed", status);
  }
}

export function disposePeerCollab(): void {
  for (const socket of sockets.values()) socket.close(1001, "LatexDo is closing");
  sockets.clear();
  service?.dispose();
  service = null;
}

export function registerPeerCollabIpc(projects: PeerProjectRegistry): void {
  const peer = new PeerCollabService({
    dataDirectory: path.join(app.getPath("userData"), "collaboration-host"),
    serverEntryPath: path.join(app.getAppPath(), "collaborations", "server.mjs"),
    cloudOrigin: process.env.LATEXDO_COLLAB_URL?.trim() || "https://collab.latexdo.org",
    // Project encryption keys are kept in the OS keychain.
    keyProtection: {
      available: () => safeStorage.isEncryptionAvailable(),
      encrypt: (value) => safeStorage.encryptString(value),
      decrypt: (value) => safeStorage.decryptString(value),
    },
    spawnServer: (entryPath, env) => {
      const child = utilityProcess.fork(entryPath, [], {
        env: hostServerEnvironment(env),
        stdio: "pipe",
        serviceName: "LatexDo collaboration host",
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        console.error("[latexdo] collaboration-host", chunk.toString().trimEnd());
      });
      return {
        stdout: child.stdout,
        kill: () => child.kill(),
        once: (_event, listener) => child.once("exit", listener),
      };
    },
    fetchRemote: ((input: RequestInfo | URL, init?: RequestInit) =>
      net.fetch(input instanceof URL ? input.toString() : input, init)) as typeof fetch,
    onStatusChange: broadcastStatus,
  });
  service = peer;

  ipcMain.handle("peer:request", async (_event, ...args: unknown[]) => {
    const channel = "peer:request";
    const [request] = args;
    if (args.length !== 1 || !isRecord(request) || !isRecord(request.headers)) {
      invalid(channel);
    }
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === "string") headers[name] = value;
    }
    return peer.request({
      origin: parseText(channel, request.origin, 512),
      path: parseText(channel, request.path, 4096),
      method: parseText(channel, request.method, 8),
      headers,
      body: typeof request.body === "string" ? request.body : undefined,
      timeoutMs: typeof request.timeoutMs === "number" ? request.timeoutMs : 15_000,
    });
  });

  ipcMain.handle("peer:socket-open", async (event, ...args: unknown[]) => {
    const channel = "peer:socket-open";
    const [socketId, origin, pathAndQuery] = args;
    if (args.length !== 3 || !Number.isSafeInteger(socketId)) invalid(channel);
    const sender = event.sender;
    const key = socketKey(sender.id, socketId as number);
    const owned = [...sockets.keys()].filter((existing) =>
      existing.startsWith(`${sender.id}:`),
    );
    if (sockets.has(key) || owned.length >= maxSocketsPerWindow) invalid(channel);

    const emit = (payload: Record<string, unknown>) => {
      if (!sender.isDestroyed()) {
        sender.send("peer:socket-event", { id: socketId, ...payload });
      }
    };
    const socket = await peer.openSocket(
      parseText(channel, origin, 512),
      parseText(channel, pathAndQuery, 4096),
      {
        onOpen: () => emit({ type: "open" }),
        onMessage: (data) => emit({ type: "message", data }),
        onError: () => emit({ type: "error" }),
        onClose: (code, reason) => {
          sockets.delete(key);
          emit({ type: "close", code, reason });
        },
      },
    );
    if (sender.isDestroyed()) {
      socket.close(1001, "Window closed");
      return;
    }
    sockets.set(key, socket);
    sender.once("destroyed", () => {
      sockets.get(key)?.close(1001, "Window closed");
      sockets.delete(key);
    });
  });

  ipcMain.on("peer:socket-send", (event, socketId: unknown, data: unknown) => {
    if (!Number.isSafeInteger(socketId) || !(data instanceof Uint8Array)) return;
    sockets.get(socketKey(event.sender.id, socketId as number))?.send(data);
  });

  ipcMain.on(
    "peer:socket-close",
    (event, socketId: unknown, code: unknown, reason: unknown) => {
      if (!Number.isSafeInteger(socketId)) return;
      sockets
        .get(socketKey(event.sender.id, socketId as number))
        ?.close(
          typeof code === "number" ? code : undefined,
          typeof reason === "string" ? reason.slice(0, 120) : undefined,
        );
    },
  );

  ipcMain.handle("peer:host-status", (_event, ...args: unknown[]) => {
    if (args.length !== 0) invalid("peer:host-status");
    return peer.status();
  });

  ipcMain.handle("peer:host-start", (_event, ...args: unknown[]) => {
    const [mode] = args;
    if (args.length !== 1 || (mode !== "internet" && mode !== "local")) {
      invalid("peer:host-start");
    }
    return peer.startSharing(mode);
  });

  ipcMain.handle("peer:host-stop", (_event, ...args: unknown[]) => {
    if (args.length !== 0) invalid("peer:host-stop");
    return peer.stopSharing();
  });

  ipcMain.handle("peer:host-invite", (_event, ...args: unknown[]) => {
    const channel = "peer:host-invite";
    if (args.length !== 1) invalid(channel);
    return peer.invite(parseText(channel, args[0], 256));
  });

  ipcMain.handle("peer:resolve-invite", (_event, ...args: unknown[]) => {
    const channel = "peer:resolve-invite";
    if (args.length !== 1) invalid(channel);
    return peer.resolveInvite(parseText(channel, args[0], 8192));
  });

  ipcMain.handle("peer:host-register-project", async (_event, ...args: unknown[]) => {
    const channel = "peer:host-register-project";
    const [sharedProjectId, localProjectId, name] = args;
    if (args.length !== 3) invalid(channel);
    await peer.registerHostedProject(
      parseText(channel, sharedProjectId, 80),
      projects.getProjectRoot(parseText(channel, localProjectId, 256)),
      typeof name === "string" ? name.slice(0, 120) : "",
    );
  });

  ipcMain.handle("peer:cloud-invite", (_event, ...args: unknown[]) => {
    const channel = "peer:cloud-invite";
    if (args.length !== 1) invalid(channel);
    return peer.cloudInvite(parseText(channel, args[0], 256));
  });

  // True for the owner's own shared copy of a folder on this computer.
  ipcMain.handle("peer:has-folder", async (_event, ...args: unknown[]) => {
    const channel = "peer:has-folder";
    if (args.length !== 1) invalid(channel);
    return (await peer.hostedProject(parseText(channel, args[0], 80))) !== null;
  });

  ipcMain.handle(
    "peer:cloud-save-project",
    async (event, ...args: unknown[]): Promise<SaveSharedProjectResult> => {
      const channel = "peer:cloud-save-project";
      if (args.length !== 2) invalid(channel);
      const projectId = parseText(channel, args[0], 80);
      const rawFiles = args[1];
      if (!Array.isArray(rawFiles) || rawFiles.length > 5000) invalid(channel);
      const files = rawFiles.map((file: unknown) => {
        if (!isRecord(file) || typeof file.relativePath !== "string") invalid(channel);
        const record = file as Record<string, unknown>;
        const bytes =
          typeof record.base64 === "string"
            ? Buffer.from(record.base64, "base64")
            : typeof record.content === "string"
              ? Buffer.from(record.content, "utf8")
              : invalid(channel);
        return { relativePath: parseText(channel, record.relativePath, 512), bytes };
      });
      const hosted = await peer.hostedProject(projectId);
      if (!hosted) {
        throw new Error("This project was not shared from a folder on this computer.");
      }
      // Overwriting the user's own files is confirmed natively so page content
      // can never trigger it on its own.
      const window = BrowserWindow.fromWebContents(event.sender);
      const options = {
        type: "question" as const,
        buttons: ["Save to Folder", "Cancel"],
        defaultId: 0,
        cancelId: 1,
        message: "Save the shared changes to your folder?",
        detail: `Files in ${hosted.localRoot} are replaced by the shared versions. Nothing is deleted.`,
      };
      const { response } = window
        ? await dialog.showMessageBox(window, options)
        : await dialog.showMessageBox(options);
      if (response !== 0) return { saved: false };
      const result = await peer.saveFilesToHostedFolder(projectId, files);
      return {
        saved: true,
        folder: result.folder,
        written: result.written,
        project: projects.registerProject(result.folder),
      };
    },
  );

  // Reopens the folder a hosted project was shared from, without copying.
  ipcMain.handle("peer:host-open-folder", async (_event, ...args: unknown[]) => {
    const channel = "peer:host-open-folder";
    if (args.length !== 1) invalid(channel);
    const hosted = await peer.hostedProject(parseText(channel, args[0], 80));
    if (!hosted || !(await stat(hosted.localRoot).catch(() => null))?.isDirectory()) {
      return null;
    }
    return projects.registerProject(hosted.localRoot);
  });

  ipcMain.handle(
    "peer:host-save-project",
    async (event, ...args: unknown[]): Promise<SaveSharedProjectResult> => {
      const channel = "peer:host-save-project";
      if (args.length !== 1) invalid(channel);
      const projectId = parseText(channel, args[0], 80);
      const hosted = await peer.hostedProject(projectId);
      if (!hosted) {
        throw new Error("This project was not shared from a folder on this computer.");
      }
      // Overwriting the user's own files is confirmed natively so page content
      // can never trigger it on its own.
      const window = BrowserWindow.fromWebContents(event.sender);
      const options = {
        type: "question" as const,
        buttons: ["Save to Folder", "Cancel"],
        defaultId: 0,
        cancelId: 1,
        message: "Save the shared changes to your folder?",
        detail: `Files in ${hosted.localRoot} are replaced by the shared versions. Nothing is deleted.`,
      };
      const { response } = window
        ? await dialog.showMessageBox(window, options)
        : await dialog.showMessageBox(options);
      if (response !== 0) return { saved: false };
      const result = await peer.saveHostedProject(projectId);
      return {
        saved: true,
        folder: result.folder,
        written: result.written,
        project: projects.registerProject(result.folder),
      };
    },
  );
}
