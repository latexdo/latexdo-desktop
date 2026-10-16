// @vitest-environment node
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
const runtime = vi.hoisted(() => ({ root: "" }));
vi.mock("electron", () => ({
  app: { isPackaged: false, getAppPath: () => runtime.root },
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
