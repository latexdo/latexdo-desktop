// @vitest-environment node
import { EventEmitter } from "node:events";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({
  freePorts: new Set([5173]),
  watch: null,
  children: [],
}));
vi.mock("node:net", () => ({
  default: {
    createServer: () => {
      const server = new EventEmitter();
      server.close = (callback) => callback();
      server.listen = (port) =>
        queueMicrotask(() =>
          server.emit(
            state.freePorts.has(port) ? "listening" : "error",
            new Error("occupied"),
          ),
        );
      return server;
    },
  },
}));
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const child = new EventEmitter();
    child.kill = vi.fn(() => {
      queueMicrotask(() => child.emit("exit", 0));
      return true;
    });
    state.children.push(child);
    return child;
  }),
}));
vi.mock("./clear-dev-runtime-cache.mjs", () => ({
  clearDevRuntimeCache: vi.fn(async () => {}),
  devUserDataPath: "/test/profile",
}));
vi.mock("node:fs/promises", () => ({ access: vi.fn(async () => {}) }));
vi.mock("node:fs", () => ({
  watch: vi.fn((_path, _options, callback) => {
    state.watch = callback;
    return { close: vi.fn() };
  }),
}));
vi.mock("node:module", () => ({ createRequire: () => () => "/test/electron" }));
vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn(async () => {}) }));
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { clearDevRuntimeCache } from "./clear-dev-runtime-cache.mjs";
let signals, exit, fetcher;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  state.children = [];
  state.freePorts = new Set([5173]);
  state.watch = null;
  signals = new Map();
  const on = process.on.bind(process);
  vi.spyOn(process, "on").mockImplementation((event, listener) => {
    if (event === "SIGINT" || event === "SIGTERM") {
      signals.set(event, listener);
      return process;
    }
    return on(event, listener);
  });
  exit = vi.spyOn(process, "exit").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => {});
  fetcher = vi.fn().mockResolvedValue(new Response("ready"));
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function settle() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
describe("development process supervision", () => {
  it("reuses a running Vite server and shares its URL with Electron", async () => {
    await import("./dev.mjs");
    await settle();
    expect(clearDevRuntimeCache).toHaveBeenCalledOnce();
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenCalledWith(
      "node",
      ["scripts/dev-electron.mjs"],
      expect.objectContaining({
        env: expect.objectContaining({
          VITE_DEV_SERVER_URL: "http://127.0.0.1:5173",
          LATEXDO_DEV_USER_DATA: "/test/profile",
        }),
      }),
    );
    signals.get("SIGINT")();
    await vi.advanceTimersByTimeAsync(100);
    expect(exit).toHaveBeenCalledWith(130);
    for (const child of state.children)
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
  it.each([5173, 5175])(
    "starts Vite on available port %i and stops sibling processes on failure",
    async (port) => {
      state.freePorts = new Set([port]);
      fetcher.mockRejectedValueOnce(new Error("offline"));
      await import("./dev.mjs");
      await settle();
      expect(spawn).toHaveBeenCalledTimes(3);
      expect(spawn.mock.calls[0][1]).toEqual([
        "exec",
        "vite",
        "--",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--strictPort",
      ]);
      state.children[0].emit("exit", 2, null);
      await vi.advanceTimersByTimeAsync(100);
      expect(exit).toHaveBeenCalledWith(2);
      expect(state.children[1].kill).toHaveBeenCalledOnce();
    },
  );
  it("waits for server readiness and exits when Electron closes", async () => {
    fetcher
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("", { status: 503 }));
    await import("./dev.mjs");
    await settle();
    await vi.advanceTimersByTimeAsync(250);
    expect(fetcher).toHaveBeenCalledTimes(3);
    state.children[2].emit("exit", null);
    await vi.advanceTimersByTimeAsync(100);
    expect(exit).toHaveBeenCalledWith(0);
  });
  it("waits for the compiled entry point and server before launching Electron", async () => {
    access.mockRejectedValueOnce(new Error("missing"));
    fetcher
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response("", { status: 503 }));
    await import("./dev-electron.mjs");
    await settle();
    expect(access).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(spawn).toHaveBeenCalledWith(
      "/test/electron",
      ["."],
      expect.objectContaining({
        env: expect.objectContaining({ LATEXDO_DEV_CLEAR_RUNTIME_CACHE: "1" }),
      }),
    );
    signals.get("SIGTERM")();
    await settle();
    expect(exit).toHaveBeenCalledWith(0);
  });
  it("ignores initial watcher events then coalesces rebuilds into one restart", async () => {
    await import("./dev-electron.mjs");
    await settle();
    state.watch();
    await vi.advanceTimersByTimeAsync(1000);
    expect(spawn).toHaveBeenCalledTimes(1);
    state.watch();
    await vi.advanceTimersByTimeAsync(200);
    state.watch();
    await vi.advanceTimersByTimeAsync(349);
    expect(spawn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(state.children[0].kill).toHaveBeenCalledOnce();
    state.watch();
    signals.get("SIGINT")();
    await settle();
    await vi.advanceTimersByTimeAsync(2000);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(exit).toHaveBeenCalledWith(130);
  });
  it("restarts after an independent Electron exit", async () => {
    await import("./dev-electron.mjs");
    await settle();
    state.children[0].emit("exit", 0);
    await vi.advanceTimersByTimeAsync(1000);
    state.watch();
    await vi.advanceTimersByTimeAsync(350);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(state.children[0].kill).not.toHaveBeenCalled();
  });
});
