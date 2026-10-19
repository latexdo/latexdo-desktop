// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { deflateRawSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  root: "",
  /** Overrides sha256 digests in call order; undefined keeps the real hash. */
  digests: [] as Array<string | undefined>,
}));

vi.mock("electron", () => ({ app: { getPath: () => runtime.root } }));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  const createHash = (algorithm: string) => {
    const hash = actual.createHash(algorithm);
    const digest = hash.digest.bind(hash);
    return Object.assign(hash, {
      digest: (encoding: "hex") => runtime.digests.shift() ?? digest(encoding),
    });
  };
  return { ...actual, createHash, default: { ...actual, createHash } };
});

// The 148 MB model is never written: the stream only leaves a small stand-in.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const createWriteStream = (file: string) => {
    actual.writeFileSync(file, "model stand-in");
    return new Writable({ write: (_chunk, _encoding, callback) => callback() });
  };
  return { ...actual, createWriteStream, default: { ...actual, createWriteStream } };
});

import {
  installSpeechRuntime,
  installedSpeechExecutablePath,
  installedSpeechModelPath,
  installedSpeechRoot,
  isSpeechRuntimeInstalled,
  speechDownloadBytes,
} from "./speechRuntime.js";

const modelSize = 147_964_211;
const modelSha = "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002";
const linuxRuntime = {
  sha: "f40bab8c91c63c857a56b68810739e5665c14547f9c7873869edd71e411e346e",
  size: 1_185_878,
};
const windowsRuntimeSha =
  "446e9c96b0ceee15361b962a549b789fd0a4136926ff6ae6d7ebaa63029be9b1";

const originalPlatform = process.platform;
const originalArch = process.arch;

function setTarget(platform: string, arch: string) {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  Object.defineProperty(process, "arch", { value: arch, configurable: true });
}

type ZipEntry = { name: string; data: Buffer; method?: number; extra?: Buffer };

function buildZip(entries: ZipEntry[], options: { brokenCentral?: boolean } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const method = entry.method ?? 0;
    const name = Buffer.from(entry.name);
    const extra = entry.extra ?? Buffer.alloc(0);
    const payload = method === 8 ? deflateRawSync(entry.data) : entry.data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(extra.length, 28);
    locals.push(local, name, extra, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(options.brokenCentral ? 0xdeadbeef : 0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name, extra);
    offset += 30 + name.length + extra.length + payload.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, eocd]);
}

function streamResponse(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    { headers },
  );
}

/** A model body of exactly `size` bytes built from one reused chunk. */
function modelResponse(size: number, headers: Record<string, string> = {}) {
  const chunk = new Uint8Array(8 * 1024 * 1024);
  const chunks: Uint8Array[] = [];
  let remaining = size;
  while (remaining > 0) {
    const length = Math.min(remaining, chunk.length);
    chunks.push(length === chunk.length ? chunk : chunk.subarray(0, length));
    remaining -= length;
  }
  return streamResponse(chunks, headers);
}

const server = Buffer.from("#!/bin/sh\necho whisper\n");

function stubDownloads(
  zip: Buffer,
  model: () => Response = () => modelResponse(modelSize),
  zipHeaders: Record<string, string> = { "content-length": String(zip.length) },
) {
  const fetcher = vi.fn(async (url: string) =>
    url.endsWith(".zip") ? streamResponse([zip], zipHeaders) : model(),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

beforeEach(async () => {
  runtime.root = await mkdtemp(path.join(tmpdir(), "latexdo-speech-full-"));
  runtime.digests = [];
  setTarget("linux", "x64");
});

afterEach(async () => {
  setTarget(originalPlatform, originalArch);
  vi.unstubAllGlobals();
  await rm(runtime.root, { recursive: true, force: true });
});

describe("speech runtime installation", () => {
  it("reports download size only for supported platforms", () => {
    expect(speechDownloadBytes()).toBe(linuxRuntime.size + modelSize);
    setTarget("linux", "arm64");
    expect(speechDownloadBytes()).toBeNull();
  });

  it("refuses unsupported platforms", async () => {
    setTarget("freebsd", "x64");
    await expect(installSpeechRuntime({ onProgress: vi.fn() })).rejects.toThrow(
      "not available for freebsd/x64",
    );
  });

  it("downloads, verifies and installs the runtime and model", async () => {
    const zip = buildZip([
      { name: "bin/", data: Buffer.alloc(0) },
      { name: "README.txt", data: Buffer.from("readme"), extra: Buffer.from("xx") },
      { name: "bin/whisper-server", data: server, method: 8 },
    ]);
    const fetcher = stubDownloads(zip);
    runtime.digests = [linuxRuntime.sha, modelSha];
    const onProgress = vi.fn();
    await installSpeechRuntime({ onProgress });

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      expect.stringContaining("whisper-server-linux-x64-cpu.zip"),
      expect.stringContaining("ggml-base.en.bin"),
    ]);
    const executable = installedSpeechExecutablePath();
    expect(executable).toContain(path.join("bin", "linux", "x64", "whisper-server"));
    expect(await readFile(executable)).toEqual(server);
    expect((await stat(executable)).mode & 0o111).not.toBe(0);
    expect(await readFile(installedSpeechModelPath(), "utf8")).toBe("model stand-in");
    const manifest = JSON.parse(
      await readFile(path.join(installedSpeechRoot(), "install.json"), "utf8"),
    );
    expect(manifest).toMatchObject({
      platform: "linux",
      arch: "x64",
      model: "ggml-base.en.bin",
    });
    await expect(stat(path.join(installedSpeechRoot(), ".install"))).rejects.toThrow();

    const events = onProgress.mock.calls.map(([event]) => event);
    const stages = [...new Set(events.map((event) => event.stage))];
    expect(stages).toEqual([
      "checking",
      "downloading-runtime",
      "downloading-model",
      "verifying",
      "installing",
      "ready",
    ]);
    expect(events.at(-1)).toMatchObject({ done: true, receivedBytes: linuxRuntime.size + modelSize });
    const model = events.filter((event) => event.stage === "downloading-model");
    expect(model.at(-1)!.receivedBytes).toBe(linuxRuntime.size + modelSize);
    // A completed install is recognised once the real-size model is present.
    await truncate(installedSpeechModelPath(), modelSize);
    expect(await isSpeechRuntimeInstalled()).toBe(true);
  });

  it("installs a stored whisper-server.exe on Windows without chmod", async () => {
    setTarget("win32", "x64");
    const zip = buildZip([{ name: "Release/whisper-server.exe", data: server }]);
    stubDownloads(
      zip,
      () => modelResponse(modelSize, { "content-length": "not-a-number" }),
      {},
    );
    runtime.digests = [windowsRuntimeSha, modelSha];
    await installSpeechRuntime({ onProgress: vi.fn() });
    const executable = installedSpeechExecutablePath();
    expect(path.basename(executable)).toBe("whisper-server.exe");
    expect(await readFile(executable)).toEqual(server);
  });

  it("rejects an incomplete model download", async () => {
    stubDownloads(
      buildZip([{ name: "whisper-server", data: server }]),
      () => modelResponse(10),
      { "content-length": "bogus" },
    );
    runtime.digests = [linuxRuntime.sha];
    await expect(installSpeechRuntime({ onProgress: vi.fn() })).rejects.toThrow(
      "Speech model download looks incomplete.",
    );
    await expect(stat(path.join(installedSpeechRoot(), ".install"))).rejects.toThrow();
  });

  it("rejects a model with the wrong checksum", async () => {
    stubDownloads(buildZip([{ name: "whisper-server", data: server }]));
    runtime.digests = [linuxRuntime.sha, "0".repeat(64)];
    await expect(installSpeechRuntime({ onProgress: vi.fn() })).rejects.toThrow(
      "Speech model checksum verification failed.",
    );
    await expect(stat(installedSpeechExecutablePath())).rejects.toThrow();
  });

  it("reports a failed model HTTP download", async () => {
    stubDownloads(
      buildZip([{ name: "whisper-server", data: server }]),
      () => new Response("gone", { status: 410 }),
    );
    runtime.digests = [linuxRuntime.sha];
    await expect(installSpeechRuntime({ onProgress: vi.fn() })).rejects.toThrow(
      "Download failed: HTTP 410",
    );
  });

  it.each([
    ["is not a ZIP", Buffer.from("plain bytes that are long enough to scan here"), "not a ZIP file"],
    [
      "has a broken central directory",
      buildZip([{ name: "whisper-server", data: server }], { brokenCentral: true }),
      "invalid central directory",
    ],
    [
      "uses an unsupported compression",
      buildZip([{ name: "whisper-server", data: server, method: 12 }]),
      "Unsupported ZIP compression method 12.",
    ],
    [
      "lacks whisper-server",
      buildZip([{ name: "other", data: server }]),
      "did not contain whisper-server",
    ],
  ])("rejects a runtime archive that %s", async (_label, zip, message) => {
    stubDownloads(zip);
    runtime.digests = [linuxRuntime.sha, modelSha];
    await expect(installSpeechRuntime({ onProgress: vi.fn() })).rejects.toThrow(message);
    await expect(stat(path.join(installedSpeechRoot(), ".install"))).rejects.toThrow();
  });

  it("replaces a previous partial install", async () => {
    const executable = installedSpeechExecutablePath();
    await mkdir(path.dirname(executable), { recursive: true });
    await writeFile(executable, "old");
    stubDownloads(buildZip([{ name: "whisper-server", data: server }]), () =>
      modelResponse(modelSize, { "content-length": String(modelSize) }),
    );
    runtime.digests = [linuxRuntime.sha, modelSha];
    await installSpeechRuntime({ onProgress: vi.fn() });
    expect(await readFile(executable)).toEqual(server);
  });
});
