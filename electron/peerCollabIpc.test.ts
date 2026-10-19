// @vitest-environment node
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  listeners: new Map<string, (...args: any[]) => any>(),
  serviceOptions: null as any,
  service: null as any,
  windows: [] as any[],
  fromWebContents: vi.fn(),
  showMessageBox: vi.fn(),
  fork: vi.fn(),
  netFetch: vi.fn(),
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`enc:${value}`)),
    decryptString: vi.fn((value: Buffer) => `dec:${value.toString()}`),
  },
}));

vi.mock("./trustedIpc.js", () => ({
  ipcMain: {
    handle: (name: string, fn: (...args: any[]) => any) => mocks.handlers.set(name, fn),
    on: (name: string, fn: (...args: any[]) => any) => mocks.listeners.set(name, fn),
  },
}));

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => `/user/${name}`,
    getAppPath: () => "/app",
  },
  BrowserWindow: {
    getAllWindows: () => mocks.windows,
    fromWebContents: mocks.fromWebContents,
  },
  dialog: { showMessageBox: mocks.showMessageBox },
  net: { fetch: mocks.netFetch },
  safeStorage: mocks.safeStorage,
  utilityProcess: { fork: mocks.fork },
}));

vi.mock("./peerCollab.js", () => ({
  PeerCollabService: class {
    request = vi.fn(async (request: unknown) => ({ ok: true, request }));
    openSocket = vi.fn();
    status = vi.fn(() => ({ state: "stopped" }));
    startSharing = vi.fn(async (mode: string) => ({ state: "running", mode }));
    stopSharing = vi.fn(async () => ({ state: "stopped" }));
    invite = vi.fn(async (id: string) => `invite:${id}`);
    resolveInvite = vi.fn(async (code: string) => ({ code }));
    registerHostedProject = vi.fn(async () => undefined);
    cloudInvite = vi.fn(async (id: string) => `cloud:${id}`);
    hostedProject = vi.fn(async (): Promise<any> => null);
    forgetHostedProject = vi.fn(async () => undefined);
    saveFilesToHostedFolder = vi.fn(async () => ({ folder: "/home/p", written: 2 }));
    saveHostedProject = vi.fn(async () => ({ folder: "/home/p", written: 3 }));
    dispose = vi.fn();
    constructor(options: unknown) {
      mocks.serviceOptions = options;
      mocks.service = this;
    }
  },
}));

import {
  disposePeerCollab,
  registerPeerCollabIpc,
  sharedProjectSourceFolder,
} from "./peerCollabIpc.js";

const projects = {
  getProjectRoot: vi.fn((id: string) => `/roots/${id}`),
  registerProject: vi.fn((root: string) => ({ id: "p1", rootPath: root }) as any),
};

let nextSenderId = 1;
function makeSender() {
  const sender = Object.assign(new EventEmitter(), {
    id: nextSenderId++,
    destroyed: false,
    isDestroyed: vi.fn(function (this: any) {
      return this.destroyed;
    }),
    send: vi.fn(),
  });
  return sender;
}

function invoke(channel: string, ...args: unknown[]) {
  return invokeFrom(makeSender(), channel, ...args);
}

function invokeFrom(sender: unknown, channel: string, ...args: unknown[]) {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`No handler ${channel}`);
  return handler({ sender }, ...args);
}

function makeSocket() {
  return { send: vi.fn(), close: vi.fn() };
}

describe("peerCollabIpc", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.listeners.clear();
    mocks.windows = [];
    mocks.fromWebContents.mockReset();
    mocks.showMessageBox.mockReset();
    mocks.fork.mockReset();
    mocks.netFetch.mockReset();
    projects.getProjectRoot.mockClear();
    projects.registerProject.mockClear();
    delete process.env.LATEXDO_COLLAB_URL;
    registerPeerCollabIpc(projects);
  });

  afterEach(() => {
    disposePeerCollab();
  });

  it("configures the service with app paths and the default cloud origin", () => {
    expect(mocks.serviceOptions.dataDirectory).toBe(
      path.join("/user/userData", "collaboration-host"),
    );
    expect(mocks.serviceOptions.serverEntryPath).toBe(
      path.join("/app", "collaborations", "server.mjs"),
    );
    expect(mocks.serviceOptions.cloudOrigin).toBe("https://collab.latexdo.org");
  });

  it("uses a trimmed LATEXDO_COLLAB_URL as the cloud origin", () => {
    process.env.LATEXDO_COLLAB_URL = "  https://example.test  ";
    registerPeerCollabIpc(projects);
    expect(mocks.serviceOptions.cloudOrigin).toBe("https://example.test");
    process.env.LATEXDO_COLLAB_URL = "   ";
    registerPeerCollabIpc(projects);
    expect(mocks.serviceOptions.cloudOrigin).toBe("https://collab.latexdo.org");
  });

  it("protects keys with safeStorage", () => {
    const keys = mocks.serviceOptions.keyProtection;
    expect(keys.available()).toBe(true);
    expect(keys.encrypt("secret").toString()).toBe("enc:secret");
    expect(keys.decrypt(Buffer.from("x"))).toBe("dec:x");
  });

  it("spawns the host server without inheriting LATEXDO_COLLAB_* variables", () => {
    process.env.LATEXDO_COLLAB_EVIL = "1";
    process.env.LATEXDO_TEST_KEEP = "kept";
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    });
    mocks.fork.mockReturnValue(child);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const handle = mocks.serviceOptions.spawnServer("/entry.mjs", { PORT: "9" });
      const [entry, argv, options] = mocks.fork.mock.calls[0];
      expect(entry).toBe("/entry.mjs");
      expect(argv).toEqual([]);
      expect(options.stdio).toBe("pipe");
      expect(options.env.PORT).toBe("9");
      expect(options.env.LATEXDO_TEST_KEEP).toBe("kept");
      expect(options.env).not.toHaveProperty("LATEXDO_COLLAB_EVIL");
      expect(handle.stdout).toBe(child.stdout);

      child.stderr.emit("data", Buffer.from("boom\n"));
      expect(errorSpy).toHaveBeenCalledWith("[latexdo] collaboration-host", "boom");

      handle.kill();
      expect(child.kill).toHaveBeenCalled();
      const exit = vi.fn();
      handle.once("exit", exit);
      child.emit("exit", 0);
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      delete process.env.LATEXDO_COLLAB_EVIL;
      delete process.env.LATEXDO_TEST_KEEP;
      errorSpy.mockRestore();
    }
  });

  it("spawns even when the child has no stderr", () => {
    mocks.fork.mockReturnValue(
      Object.assign(new EventEmitter(), { stdout: null, stderr: null, kill: vi.fn() }),
    );
    const handle = mocks.serviceOptions.spawnServer("/entry.mjs", {});
    expect(handle.stdout).toBeNull();
  });

  it("fetches remote resources through net.fetch, stringifying URLs", async () => {
    mocks.netFetch.mockResolvedValue("response");
    await mocks.serviceOptions.fetchRemote(new URL("https://a.test/x"), { method: "GET" });
    expect(mocks.netFetch).toHaveBeenCalledWith("https://a.test/x", { method: "GET" });
    await mocks.serviceOptions.fetchRemote("https://b.test/");
    expect(mocks.netFetch).toHaveBeenLastCalledWith("https://b.test/", undefined);
  });

  it("broadcasts status changes to live windows only", () => {
    const live = { isDestroyed: () => false, webContents: { send: vi.fn() } };
    const dead = { isDestroyed: () => true, webContents: { send: vi.fn() } };
    mocks.windows = [live, dead];
    mocks.serviceOptions.onStatusChange({ state: "running" });
    expect(live.webContents.send).toHaveBeenCalledWith("peer:host-changed", {
      state: "running",
    });
    expect(dead.webContents.send).not.toHaveBeenCalled();
  });

  describe("peer:request", () => {
    it("forwards a validated request with string headers and defaults", async () => {
      await invoke("peer:request", {
        origin: "https://o.test",
        path: "/x",
        method: "GET",
        headers: { a: "1", b: 2 },
      });
      expect(mocks.service.request).toHaveBeenCalledWith({
        origin: "https://o.test",
        path: "/x",
        method: "GET",
        headers: { a: "1" },
        body: undefined,
        timeoutMs: 15_000,
      });
    });

    it("passes body and timeout when given", async () => {
      await invoke("peer:request", {
        origin: "o",
        path: "/",
        method: "POST",
        headers: {},
        body: "data",
        timeoutMs: 5,
      });
      expect(mocks.service.request.mock.calls[0][0]).toMatchObject({
        body: "data",
        timeoutMs: 5,
      });
    });

    it.each([
      [[]],
      [[{ headers: {} }, 1]],
      [[null]],
      [[[]]],
      [[{ headers: null }]],
      [[{ headers: [] }]],
      [[{ headers: {}, origin: "", path: "/", method: "GET" }]],
      [[{ headers: {}, origin: "o", path: "/", method: "TOOLONGMETHOD" }]],
      [[{ headers: {}, origin: 1, path: "/", method: "GET" }]],
    ])("rejects invalid input %#", async (args) => {
      await expect(invoke("peer:request", ...args)).rejects.toThrow(
        "Invalid IPC input for peer:request.",
      );
    });
  });

  describe("sockets", () => {
    it("opens a socket, relays events and routes send/close", async () => {
      const sender = makeSender();
      const socket = makeSocket();
      let callbacks: any;
      mocks.service.openSocket.mockImplementation(
        async (_o: string, _p: string, cb: any) => {
          callbacks = cb;
          return socket;
        },
      );
      await invokeFrom(sender, "peer:socket-open", 7, "https://o.test", "/ws?x=1");
      expect(mocks.service.openSocket).toHaveBeenCalledWith(
        "https://o.test",
        "/ws?x=1",
        expect.any(Object),
      );

      callbacks.onOpen();
      callbacks.onMessage(new Uint8Array([1]));
      callbacks.onError();
      expect(sender.send).toHaveBeenNthCalledWith(1, "peer:socket-event", {
        id: 7,
        type: "open",
      });
      expect(sender.send).toHaveBeenNthCalledWith(2, "peer:socket-event", {
        id: 7,
        type: "message",
        data: new Uint8Array([1]),
      });
      expect(sender.send).toHaveBeenNthCalledWith(3, "peer:socket-event", {
        id: 7,
        type: "error",
      });

      const send = mocks.listeners.get("peer:socket-send")!;
      send({ sender }, 7, new Uint8Array([9]));
      expect(socket.send).toHaveBeenCalledWith(new Uint8Array([9]));
      send({ sender }, 7, "not bytes");
      send({ sender }, 1.5, new Uint8Array([9]));
      send({ sender }, 99, new Uint8Array([9]));
      expect(socket.send).toHaveBeenCalledTimes(1);

      const close = mocks.listeners.get("peer:socket-close")!;
      close({ sender }, 7, 4000, "x".repeat(200));
      expect(socket.close).toHaveBeenCalledWith(4000, "x".repeat(120));
      close({ sender }, 7, "bad", 5);
      expect(socket.close).toHaveBeenLastCalledWith(undefined, undefined);
      close({ sender }, "bad");
      expect(socket.close).toHaveBeenCalledTimes(2);

      // Closing frees the slot and notifies the renderer.
      callbacks.onClose(1000, "done");
      expect(sender.send).toHaveBeenLastCalledWith("peer:socket-event", {
        id: 7,
        type: "close",
        code: 1000,
        reason: "done",
      });
      send({ sender }, 7, new Uint8Array([1]));
      expect(socket.send).toHaveBeenCalledTimes(1);
    });

    it("does not emit to a destroyed sender", async () => {
      const sender = makeSender();
      let callbacks: any;
      mocks.service.openSocket.mockImplementation(async (_o: any, _p: any, cb: any) => {
        callbacks = cb;
        return makeSocket();
      });
      await invokeFrom(sender, "peer:socket-open", 1, "o", "/");
      sender.destroyed = true;
      callbacks.onOpen();
      expect(sender.send).not.toHaveBeenCalled();
    });

    it("closes the socket if the window was destroyed while opening", async () => {
      const sender = makeSender();
      const socket = makeSocket();
      mocks.service.openSocket.mockImplementation(async () => {
        sender.destroyed = true;
        return socket;
      });
      await invokeFrom(sender, "peer:socket-open", 1, "o", "/");
      expect(socket.close).toHaveBeenCalledWith(1001, "Window closed");
      // It was never registered, so the same id can be reused.
      sender.destroyed = false;
      mocks.service.openSocket.mockResolvedValue(makeSocket());
      await expect(invokeFrom(sender, "peer:socket-open", 1, "o", "/")).resolves.toBe(
        undefined,
      );
    });

    it("closes sockets when the window is destroyed", async () => {
      const sender = makeSender();
      const socket = makeSocket();
      mocks.service.openSocket.mockResolvedValue(socket);
      await invokeFrom(sender, "peer:socket-open", 3, "o", "/");
      sender.emit("destroyed");
      expect(socket.close).toHaveBeenCalledWith(1001, "Window closed");
      mocks.listeners.get("peer:socket-send")!({ sender }, 3, new Uint8Array([1]));
      expect(socket.send).not.toHaveBeenCalled();
    });

    it("rejects duplicate ids, bad args and more than 8 sockets per window", async () => {
      const sender = makeSender();
      mocks.service.openSocket.mockImplementation(async () => makeSocket());
      await expect(invokeFrom(sender, "peer:socket-open", 1, "o")).rejects.toThrow(
        "Invalid IPC input for peer:socket-open.",
      );
      await expect(invokeFrom(sender, "peer:socket-open", "1", "o", "/")).rejects.toThrow(
        "Invalid IPC input",
      );
      for (let id = 0; id < 8; id++) {
        await invokeFrom(sender, "peer:socket-open", id, "o", "/");
      }
      await expect(invokeFrom(sender, "peer:socket-open", 0, "o", "/")).rejects.toThrow(
        "Invalid IPC input",
      );
      await expect(invokeFrom(sender, "peer:socket-open", 8, "o", "/")).rejects.toThrow(
        "Invalid IPC input",
      );
      // Another window has its own budget.
      await expect(invokeFrom(makeSender(), "peer:socket-open", 0, "o", "/")).resolves.toBe(
        undefined,
      );
    });

    it("dispose closes every open socket and the service", async () => {
      const socket = makeSocket();
      mocks.service.openSocket.mockResolvedValue(socket);
      const service = mocks.service;
      await invoke("peer:socket-open", 1, "o", "/");
      disposePeerCollab();
      expect(socket.close).toHaveBeenCalledWith(1001, "LatexDo is closing");
      expect(service.dispose).toHaveBeenCalled();
      expect(await sharedProjectSourceFolder("x")).toBeNull();
      disposePeerCollab();
    });
  });

  describe("host commands", () => {
    it("reports status and starts/stops sharing", async () => {
      expect(await invoke("peer:host-status")).toEqual({ state: "stopped" });
      expect(await invoke("peer:host-start", "local")).toEqual({
        state: "running",
        mode: "local",
      });
      await invoke("peer:host-start", "internet");
      expect(mocks.service.startSharing).toHaveBeenLastCalledWith("internet");
      expect(await invoke("peer:host-stop")).toEqual({ state: "stopped" });
    });

    it.each([
      ["peer:host-status", [1]],
      ["peer:host-start", []],
      ["peer:host-start", ["lan"]],
      ["peer:host-stop", [1]],
      ["peer:host-invite", []],
      ["peer:host-invite", [""]],
      ["peer:resolve-invite", []],
      ["peer:host-register-project", ["a", "b"]],
      ["peer:cloud-invite", []],
      ["peer:has-folder", []],
      ["peer:forget-shared-project", []],
      ["peer:cloud-save-project", ["a"]],
      ["peer:cloud-save-project", ["a", "notarray"]],
      ["peer:cloud-save-project", ["a", [null]]],
      ["peer:cloud-save-project", ["a", [{ relativePath: 1 }]]],
      ["peer:cloud-save-project", ["a", [{ relativePath: "x" }]]],
      ["peer:cloud-save-project", ["a", new Array(5001).fill({})]],
      ["peer:host-open-folder", []],
      ["peer:host-save-project", []],
    ])("%s rejects invalid input %#", async (channel, args) => {
      await expect(Promise.resolve().then(() => invoke(channel, ...args))).rejects.toThrow(
        `Invalid IPC input for ${channel}.`,
      );
    });

    it("invites, resolves invites and cloud-invites", async () => {
      expect(await invoke("peer:host-invite", "proj")).toBe("invite:proj");
      expect(await invoke("peer:resolve-invite", "code")).toEqual({ code: "code" });
      expect(await invoke("peer:cloud-invite", "proj")).toBe("cloud:proj");
    });

    it("registers a hosted project from its local root, truncating names", async () => {
      await invoke("peer:host-register-project", "shared", "local", "n".repeat(200));
      expect(projects.getProjectRoot).toHaveBeenCalledWith("local");
      expect(mocks.service.registerHostedProject).toHaveBeenCalledWith(
        "shared",
        "/roots/local",
        "n".repeat(120),
      );
      await invoke("peer:host-register-project", "shared", "local", 5);
      expect(mocks.service.registerHostedProject).toHaveBeenLastCalledWith(
        "shared",
        "/roots/local",
        "",
      );
    });

    it("reports and forgets hosted folders", async () => {
      expect(await invoke("peer:has-folder", "p")).toBe(false);
      mocks.service.hostedProject.mockResolvedValue({ localRoot: "/src" });
      expect(await invoke("peer:has-folder", "p")).toBe(true);
      expect(await sharedProjectSourceFolder("p")).toBe("/src");
      mocks.service.hostedProject.mockResolvedValue(null);
      expect(await sharedProjectSourceFolder("p")).toBeNull();
      await invoke("peer:forget-shared-project", "p");
      expect(mocks.service.forgetHostedProject).toHaveBeenCalledWith("p");
    });
  });

  describe("saving shared projects", () => {
    const window = { id: "win" };

    it("cloud-save refuses projects not shared from this computer", async () => {
      await expect(
        invoke("peer:cloud-save-project", "p", [{ relativePath: "a.tex", content: "x" }]),
      ).rejects.toThrow("not shared from a folder");
    });

    it("cloud-save asks first and stops on cancel", async () => {
      mocks.service.hostedProject.mockResolvedValue({ localRoot: "/src" });
      mocks.fromWebContents.mockReturnValue(window);
      mocks.showMessageBox.mockResolvedValue({ response: 1 });
      expect(
        await invoke("peer:cloud-save-project", "p", [
          { relativePath: "a.tex", content: "x" },
        ]),
      ).toEqual({ saved: false });
      expect(mocks.showMessageBox).toHaveBeenCalledWith(
        window,
        expect.objectContaining({ detail: expect.stringContaining("/src") }),
      );
      expect(mocks.service.saveFilesToHostedFolder).not.toHaveBeenCalled();
    });

    it("cloud-save writes decoded files after confirmation without a window", async () => {
      mocks.service.hostedProject.mockResolvedValue({ localRoot: "/src" });
      mocks.fromWebContents.mockReturnValue(null);
      mocks.showMessageBox.mockResolvedValue({ response: 0 });
      const result = await invoke("peer:cloud-save-project", "p", [
        { relativePath: "a.tex", content: "hé" },
        { relativePath: "b.png", base64: Buffer.from([1, 2]).toString("base64") },
      ]);
      expect(mocks.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({}));
      expect(mocks.showMessageBox.mock.calls[0]).toHaveLength(1);
      const [, files] = mocks.service.saveFilesToHostedFolder.mock.calls[0];
      expect(files[0].bytes.toString("utf8")).toBe("hé");
      expect([...files[1].bytes]).toEqual([1, 2]);
      expect(result).toEqual({
        saved: true,
        folder: "/home/p",
        written: 2,
        project: { id: "p1", rootPath: "/home/p" },
      });
    });

    it("cloud-save skips the prompt when asked not to", async () => {
      mocks.service.hostedProject.mockResolvedValue({ localRoot: "/src" });
      const result = await invoke("peer:cloud-save-project", "p", [], false);
      expect(mocks.showMessageBox).not.toHaveBeenCalled();
      expect(result.saved).toBe(true);
    });

    it("host-save refuses unknown projects", async () => {
      await expect(invoke("peer:host-save-project", "p")).rejects.toThrow(
        "not shared from a folder",
      );
      await expect(invoke("peer:host-save-project", "p", true, 1)).rejects.toThrow(
        "Invalid IPC input",
      );
    });

    it("host-save asks with a window, then saves", async () => {
      mocks.service.hostedProject.mockResolvedValue({ localRoot: "/src" });
      mocks.fromWebContents.mockReturnValue(window);
      mocks.showMessageBox.mockResolvedValueOnce({ response: 1 });
      expect(await invoke("peer:host-save-project", "p")).toEqual({ saved: false });
      mocks.fromWebContents.mockReturnValue(null);
      mocks.showMessageBox.mockResolvedValueOnce({ response: 0 });
      expect(await invoke("peer:host-save-project", "p")).toEqual({
        saved: true,
        folder: "/home/p",
        written: 3,
        project: { id: "p1", rootPath: "/home/p" },
      });
      expect(await invoke("peer:host-save-project", "p", false)).toMatchObject({
        saved: true,
      });
      expect(mocks.showMessageBox).toHaveBeenCalledTimes(2);
    });

    it("host-open-folder registers existing folders only", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "peer-ipc-"));
      try {
        expect(await invoke("peer:host-open-folder", "p")).toBeNull();
        mocks.service.hostedProject.mockResolvedValue({
          localRoot: path.join(dir, "missing"),
        });
        expect(await invoke("peer:host-open-folder", "p")).toBeNull();
        const file = path.join(dir, "file");
        await writeFile(file, "x");
        mocks.service.hostedProject.mockResolvedValue({ localRoot: file });
        expect(await invoke("peer:host-open-folder", "p")).toBeNull();
        mocks.service.hostedProject.mockResolvedValue({ localRoot: dir });
        expect(await invoke("peer:host-open-folder", "p")).toEqual({
          id: "p1",
          rootPath: dir,
        });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
});
