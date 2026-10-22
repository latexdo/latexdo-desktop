// @vitest-environment node
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
const runtime = vi.hoisted(() => ({ root: "", packaged: false }));
vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return runtime.packaged;
    },
    getAppPath: () => runtime.root,
  },
}));
vi.mock("./speechRuntime.js", () => ({
  installedSpeechRoot: () => path.join(runtime.root, "installed"),
}));
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() =>
    Object.assign(new EventEmitter(), {
      killed: false,
      kill: vi.fn(function (this: { killed: boolean }) {
        this.killed = true;
        return true;
      }),
    }),
  ),
}));
import { spawn } from "node:child_process";
import { ensureBundledSpeechServer, stopBundledSpeechServer } from "./voiceStt.js";
let root: string;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "latexdo-speech-test-"));
  runtime.root = root;
  vi.stubEnv("LATEXDO_SPEECH_ROOT", root);
  vi.stubEnv("LATEXDO_SPEECH_SERVER_PATH", "");
  vi.stubEnv("LATEXDO_SPEECH_MODEL_PATH", "");
  fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 503 }));
  vi.stubGlobal("fetch", fetcher);
  vi.mocked(spawn).mockClear();
});
afterEach(async () => {
  runtime.packaged = false;
  stopBundledSpeechServer();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});
/** The speech server answers once a process has been started (count spawns). */
function answerAfterSpawn(spawnsBeforeUp = 1) {
  fetcher.mockImplementation(async () =>
    vi.mocked(spawn).mock.calls.length >= spawnsBeforeUp
      ? new Response("{}")
      : new Response("", { status: 503 }),
  );
}
const serverArgs = (
  model: string,
  port: string,
  route = "/v1/audio/transcriptions",
) => ["-m", model, "--host", "127.0.0.1", "--port", port, "--inference-path", route];
async function install(model = true) {
  await mkdir(path.join(root, "bin"), { recursive: true });
  await writeFile(
    path.join(root, "bin", "whisper-server"),
    "test boundary executable",
    { mode: 0o644 },
  );
  if (model) {
    await mkdir(path.join(root, "models"), { recursive: true });
    await writeFile(
      path.join(root, "models", "ggml-base.en.bin"),
      "test boundary model",
    );
  }
}
describe("local speech server lifecycle", () => {
  it("reuses an already running compatible server without launching a process", async () => {
    fetcher.mockResolvedValue(new Response("{}"));
    expect(
      await ensureBundledSpeechServer({
        baseUrl: "http://localhost:9090/v1/",
        model: "custom",
      }),
    ).toEqual({
      ok: true,
      baseUrl: "http://localhost:9090/v1/",
      model: "custom",
      alreadyRunning: true,
      bundled: false,
    });
    expect(fetcher.mock.calls[0][0]).toBe("http://localhost:9090/v1/models");
    expect(spawn).not.toHaveBeenCalled();
  });
  it("counts the bundled whisper.cpp server as running when its root answers", async () => {
    fetcher.mockImplementation(async (url) =>
      String(url).endsWith("/models")
        ? new Response("", { status: 404 })
        : new Response("<html></html>"),
    );
    expect(await ensureBundledSpeechServer()).toMatchObject({
      ok: true,
      alreadyRunning: true,
    });
    expect(spawn).not.toHaveBeenCalled();
  });
  it("reports missing executables and missing model separately", async () => {
    expect(await ensureBundledSpeechServer()).toMatchObject({
      ok: false,
      code: "missing-runtime",
    });
    await install(false);
    expect(await ensureBundledSpeechServer()).toMatchObject({
      ok: false,
      code: "missing-model",
    });
    expect(spawn).not.toHaveBeenCalled();
  });
  it("repairs executable permissions, starts on loopback and shares concurrent startup", async () => {
    await install();
    answerAfterSpawn();
    const first = ensureBundledSpeechServer({ baseUrl: "http://localhost:9191/v1" }),
      second = ensureBundledSpeechServer();
    expect(await first).toMatchObject({
      ok: true,
      alreadyRunning: false,
      bundled: true,
    });
    expect(await second).toEqual(await first);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(
      path.join(root, "bin", "whisper-server"),
      serverArgs(path.join(root, "models", "ggml-base.en.bin"), "9191"),
      expect.objectContaining({ stdio: "ignore", windowsHide: true }),
    );
    expect((await stat(path.join(root, "bin", "whisper-server"))).mode & 0o111).toBe(
      0o111,
    );
    expect(await ensureBundledSpeechServer()).toMatchObject({
      ok: true,
      alreadyRunning: true,
      bundled: true,
    });
    const child = vi.mocked(spawn).mock.results[0].value;
    stopBundledSpeechServer();
    stopBundledSpeechServer();
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
  it.each(["exit", "error"])(
    "clears the process after %s and can start again",
    async (event) => {
      await install();
      answerAfterSpawn();
      await ensureBundledSpeechServer();
      const child = vi.mocked(spawn).mock.results[0].value;
      child.emit(event, event === "error" ? new Error("failed") : 0);
      // The old server is gone: nothing answers until the next start.
      answerAfterSpawn(2);
      expect(await ensureBundledSpeechServer()).toMatchObject({
        ok: true,
        alreadyRunning: false,
      });
      expect(spawn).toHaveBeenCalledTimes(2);
    },
  );
  it("kills a service that never becomes ready", async () => {
    await install();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const pending = ensureBundledSpeechServer();
    // Filesystem checks use real I/O even while the startup clock is faked.
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(121_000);
    expect(await pending).toMatchObject({ ok: false, code: "start-failed" });
    expect(vi.mocked(spawn).mock.results[0].value.kill).toHaveBeenCalledOnce();
  });
  it("honors explicitly configured binary and model paths", async () => {
    const binary = path.join(root, "custom-server"),
      model = path.join(root, "custom-model");
    await writeFile(binary, "binary", { mode: 0o755 });
    await writeFile(model, "model");
    vi.stubEnv("LATEXDO_SPEECH_SERVER_PATH", binary);
    vi.stubEnv("LATEXDO_SPEECH_MODEL_PATH", model);
    answerAfterSpawn();
    expect(await ensureBundledSpeechServer({ baseUrl: "invalid url" })).toMatchObject({
      ok: true,
    });
    expect(spawn).toHaveBeenCalledWith(
      binary,
      serverArgs(model, "8080"),
      expect.anything(),
    );
  });
});

describe("local speech server discovery and startup failures", () => {
  async function installAt(dir: string, name = "whisper-server") {
    await mkdir(path.join(dir, "bin"), { recursive: true });
    await writeFile(path.join(dir, "bin", name), "binary", { mode: 0o755 });
    await mkdir(path.join(dir, "models"), { recursive: true });
    await writeFile(path.join(dir, "models", "ggml-tiny.en.bin"), "model");
  }

  it("finds the development resources folder when no root is configured", async () => {
    vi.stubEnv("LATEXDO_SPEECH_ROOT", "");
    const dev = path.join(root, "resources", "speech");
    await installAt(dev);
    answerAfterSpawn();
    expect(
      await ensureBundledSpeechServer({ baseUrl: "http://localhost/v1" }),
    ).toMatchObject({
      ok: true,
      bundled: true,
    });
    expect(spawn).toHaveBeenCalledWith(
      path.join(dev, "bin", "whisper-server"),
      serverArgs(path.join(dev, "models", "ggml-tiny.en.bin"), "8080"),
      expect.anything(),
    );
  });

  it("prefers the installed runtime and uses resourcesPath when packaged", async () => {
    vi.stubEnv("LATEXDO_SPEECH_ROOT", "");
    runtime.packaged = true;
    const resources = path.join(root, "packaged");
    const original = process.resourcesPath;
    Object.defineProperty(process, "resourcesPath", {
      value: resources,
      configurable: true,
    });
    try {
      await installAt(path.join(resources, "speech"));
      answerAfterSpawn();
      expect(await ensureBundledSpeechServer()).toMatchObject({ ok: true });
      expect(vi.mocked(spawn).mock.calls[0][0]).toBe(
        path.join(resources, "speech", "bin", "whisper-server"),
      );
    } finally {
      Object.defineProperty(process, "resourcesPath", {
        value: original,
        configurable: true,
      });
    }
  });

  it("looks for .exe servers on Windows", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    try {
      await installAt(root, "server.exe");
      answerAfterSpawn();
      expect(await ensureBundledSpeechServer()).toMatchObject({ ok: true });
      expect(vi.mocked(spawn).mock.calls[0][0]).toBe(
        path.join(root, "bin", "server.exe"),
      );
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });

  it("treats network errors as an absent server", async () => {
    fetcher.mockRejectedValue(new TypeError("refused"));
    expect(await ensureBundledSpeechServer()).toMatchObject({
      ok: false,
      code: "missing-runtime",
    });
  });

  it("aborts a probe that hangs", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fetcher.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    );
    const pending = ensureBundledSpeechServer();
    await vi.advanceTimersByTimeAsync(1200 * 4);
    expect(await pending).toMatchObject({ ok: false, code: "missing-runtime" });
  });

  it("stops waiting when the server exits during startup", async () => {
    await install();
    vi.mocked(spawn).mockImplementationOnce(() => {
      const child = Object.assign(new EventEmitter(), { killed: false, kill: vi.fn() });
      queueMicrotask(() => child.emit("exit", 1));
      return child as never;
    });
    expect(await ensureBundledSpeechServer()).toMatchObject({
      ok: false,
      code: "start-failed",
    });
  });
});
