// @vitest-environment node
import { mkdtemp, mkdir, writeFile, truncate, rm, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
const runtime = vi.hoisted(() => ({ root: "" }));
vi.mock("electron", () => ({ app: { getPath: () => runtime.root } }));
import {
  installedSpeechRoot,
  installedSpeechExecutablePath,
  installedSpeechModelPath,
  isSpeechRuntimeInstalled,
  installSpeechRuntime,
  listInstalledSpeechFiles,
} from "./speechRuntime.js";
beforeEach(async () => {
  runtime.root = await mkdtemp(path.join(tmpdir(), "latexdo-speech-install-"));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(runtime.root, { recursive: true, force: true });
});
describe("speech installer integrity", () => {
  it("requires a nonempty executable and a complete model before reusing an installation", async () => {
    expect(await isSpeechRuntimeInstalled()).toBe(false);
    expect(await listInstalledSpeechFiles()).toEqual([]);
    const model = installedSpeechModelPath(),
      binary = installedSpeechExecutablePath();
    await mkdir(path.dirname(model), { recursive: true });
    await writeFile(model, "short");
    expect(await isSpeechRuntimeInstalled()).toBe(false);
    await truncate(model, 147964211);
    expect(await isSpeechRuntimeInstalled()).toBe(false);
    await mkdir(path.dirname(binary), { recursive: true });
    await writeFile(binary, "");
    expect(await isSpeechRuntimeInstalled()).toBe(false);
    await writeFile(binary, "executable fixture");
    expect(await isSpeechRuntimeInstalled()).toBe(true);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const onProgress = vi.fn();
    await installSpeechRuntime({ onProgress });
    expect(onProgress.mock.calls.map(([event]) => event.stage)).toEqual([
      "checking",
      "ready",
    ]);
    expect(onProgress.mock.calls.at(-1)![0].done).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await listInstalledSpeechFiles()).toContain(
      path.relative(installedSpeechRoot(), model),
    );
  });
  it.each([403, 404, 503])(
    "cleans partial installation after HTTP %i",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("denied", { status })),
      );
      await expect(installSpeechRuntime({ onProgress: vi.fn() })).rejects.toThrow(
        `HTTP ${status}`,
      );
      await expect(
        stat(path.join(installedSpeechRoot(), ".install")),
      ).rejects.toThrow();
      expect(await isSpeechRuntimeInstalled()).toBe(false);
    },
  );
  it("rejects tampered runtime bytes and never downloads a model after verification fails", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(new Uint8Array([80, 75, 3, 4]), {
          headers: { "content-length": "4" },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const onProgress = vi.fn();
    await expect(installSpeechRuntime({ onProgress })).rejects.toThrow(
      "checksum verification failed",
    );
    expect(fetcher).toHaveBeenCalledOnce();
    expect(onProgress.mock.calls.map(([event]) => event.stage)).toContain(
      "downloading-runtime",
    );
    expect(onProgress.mock.calls.at(-1)![0].receivedBytes).toBe(4);
    await expect(stat(installedSpeechExecutablePath())).rejects.toThrow();
    await expect(stat(path.join(installedSpeechRoot(), ".install"))).rejects.toThrow();
  });
  it("passes cancellation to the download and cleans its staging directory", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn(async (_url, options) => {
      options.signal.throwIfAborted();
      return new Response();
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(
      installSpeechRuntime({ signal: controller.signal, onProgress: vi.fn() }),
    ).rejects.toThrow();
    expect(fetcher.mock.calls[0][1].signal).toBe(controller.signal);
    await expect(stat(path.join(installedSpeechRoot(), ".install"))).rejects.toThrow();
  });
});
