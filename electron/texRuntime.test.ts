// @vitest-environment node
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  root: "",
  digest: "",
  extract: "ok" as "ok" | "fail" | "error" | "empty",
  spawnCalls: [] as Array<{ command: string; args: string[] }>,
  receivedLength: 0,
}));

vi.mock("electron", () => ({ app: { getPath: () => runtime.root } }));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    createHash: () => ({ update: vi.fn(), digest: () => runtime.digest }),
  };
});

vi.mock("node:stream/promises", () => ({
  pipeline: async (body: EventEmitter, output: { end(): void; once(e: string, f: () => void): void }) => {
    body.emit("data", { length: runtime.receivedLength });
    await new Promise<void>((resolve) => {
      output.once("close", resolve);
      output.end();
    });
  },
}));

vi.mock("node:child_process", () => ({
  spawn: (command: string, args: string[]) => {
    runtime.spawnCalls.push({ command, args });
    const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
    child.stderr = new EventEmitter();
    const output = args[args.indexOf("-C") + 1];
    queueMicrotask(async () => {
      if (runtime.extract === "error") {
        child.emit("error", new Error("tar missing"));
        return;
      }
      if (runtime.extract === "fail") {
        child.stderr.emit("data", Buffer.from("  corrupt archive \n"));
        child.emit("close", 2);
        return;
      }
      if (runtime.extract === "ok") {
        const bin = path.join(output, "TinyTeX", "bin", "x86_64");
        await mkdir(bin, { recursive: true });
        const name = process.platform === "win32" ? "latexmk.exe" : "latexmk";
        await writeFile(path.join(bin, name), "#!/bin/sh\n");
      }
      child.emit("close", 0);
    });
    return child;
  },
}));

import {
  findBundledTexBinDirectory,
  installTexRuntime,
  installedTexRoot,
  texDownloadBytes,
} from "./texRuntime.js";

const linuxSha = "54fec1c79ab437d2d52e2f918bdb738c85779d654a93e62cc44f022e227692b5";
const linuxSize = 151_904_844;
const realPlatform = process.platform;
const realArch = process.arch;

function setPlatform(platform: string, arch: string) {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  Object.defineProperty(process, "arch", { value: arch, configurable: true });
}

function okFetch() {
  return vi.fn(async () => new Response(new Uint8Array(0)));
}

beforeEach(async () => {
  runtime.root = await mkdtemp(path.join(tmpdir(), "latexdo-tex-install-"));
  runtime.digest = linuxSha;
  runtime.receivedLength = linuxSize;
  runtime.extract = "ok";
  runtime.spawnCalls = [];
  setPlatform("linux", "x64");
});

afterEach(async () => {
  setPlatform(realPlatform, realArch);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(runtime.root, { recursive: true, force: true });
});

describe("TeX runtime assets", () => {
  it("reports the pinned download size for supported platforms only", () => {
    expect(texDownloadBytes()).toBe(linuxSize);
    setPlatform("darwin", "arm64");
    expect(texDownloadBytes()).toBe(210_535_256);
    setPlatform("win32", "x64");
    expect(texDownloadBytes()).toBe(247_389_422);
    setPlatform("freebsd", "x64");
    expect(texDownloadBytes()).toBeNull();
  });

  it("installs under the user data directory", () => {
    expect(installedTexRoot()).toBe(path.join(runtime.root, "tex"));
  });

  it("refuses to install on an unsupported platform", async () => {
    setPlatform("linux", "ia32");
    const onProgress = vi.fn();
    await expect(installTexRuntime({ onProgress })).rejects.toThrow(
      "not available for linux/ia32",
    );
    expect(onProgress).not.toHaveBeenCalled();
  });
});

describe("finding the bundled TeX bin directory", () => {
  it("returns null when nothing is installed", async () => {
    expect(await findBundledTexBinDirectory()).toBeNull();
  });

  it("skips the install scratch directory, plain files and bin folders without latexmk", async () => {
    const root = installedTexRoot();
    await mkdir(path.join(root, ".install", "bin", "x"), { recursive: true });
    await writeFile(path.join(root, ".install", "bin", "x", "latexmk"), "");
    await writeFile(path.join(root, "install.json"), "{}");
    await mkdir(path.join(root, "Other", "bin", "arch"), { recursive: true });
    expect(await findBundledTexBinDirectory()).toBeNull();

    const bin = path.join(root, "TinyTeX", "bin", "x86_64");
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, "latexmk"), "");
    expect(await findBundledTexBinDirectory()).toBe(bin);
  });
});

describe("installing the TeX runtime", () => {
  it("does nothing beyond checking when a runtime is already installed", async () => {
    const bin = path.join(installedTexRoot(), "TinyTeX", "bin", "x86_64");
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, "latexmk"), "");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const onProgress = vi.fn();
    await installTexRuntime({ onProgress });
    expect(onProgress.mock.calls.map(([p]) => p.stage)).toEqual(["checking", "ready"]);
    expect(onProgress.mock.calls[1][0]).toMatchObject({
      done: true,
      receivedBytes: linuxSize,
      totalBytes: linuxSize,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("downloads, verifies, extracts and records the installation", async () => {
    const root = installedTexRoot();
    await mkdir(path.join(root, "TinyTeX", "stale"), { recursive: true });
    const fetcher = okFetch();
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    const onProgress = vi.fn();
    await installTexRuntime({ onProgress, signal: controller.signal });

    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("TinyTeX-linux-x86_64-v2026.10.tar.xz"),
      { redirect: "follow", signal: controller.signal },
    );
    expect(onProgress.mock.calls.map(([p]) => p.stage)).toEqual([
      "checking",
      "downloading",
      "verifying",
      "installing",
      "ready",
    ]);
    expect(onProgress.mock.calls[1][0].receivedBytes).toBe(linuxSize);
    expect(runtime.spawnCalls[0].command).toBe("tar");
    expect(runtime.spawnCalls[0].args[0]).toBe("-xJf");

    expect(await findBundledTexBinDirectory()).toBe(
      path.join(root, "TinyTeX", "bin", "x86_64"),
    );
    await expect(stat(path.join(root, "TinyTeX", "stale"))).rejects.toThrow();
    const record = JSON.parse(await readFile(path.join(root, "install.json"), "utf8"));
    expect(record).toMatchObject({
      version: "tinytex-v2026.10",
      platform: "linux",
      arch: "x64",
    });
    expect(Number.isNaN(Date.parse(record.installedAt))).toBe(false);
    expect(await readdir(root)).not.toContain(".install");
  });

  it("uses the system tar on macOS", async () => {
    setPlatform("darwin", "arm64");
    runtime.digest = "9962e445b56f06feb2c28f73561e523e89d550e98abf910ba60b0ffb3856921f";
    runtime.receivedLength = 210_535_256;
    vi.stubGlobal("fetch", okFetch());
    await installTexRuntime({ onProgress: vi.fn() });
    expect(runtime.spawnCalls[0].command).toBe("/usr/bin/tar");
  });

  it("uses the Windows tar with zip arguments and looks for latexmk.exe", async () => {
    setPlatform("win32", "x64");
    vi.stubEnv("SystemRoot", "D:\\Win");
    runtime.digest = "dc1d6e63b21af62130ede1dcc4113bffdc184544690a23e3f489d75340f4ff61";
    runtime.receivedLength = 247_389_422;
    vi.stubGlobal("fetch", okFetch());
    await installTexRuntime({ onProgress: vi.fn() });
    expect(runtime.spawnCalls[0].command).toBe(path.join("D:\\Win", "System32", "tar.exe"));
    expect(runtime.spawnCalls[0].args[0]).toBe("-xf");
    expect(await findBundledTexBinDirectory()).toContain("x86_64");
  });

  it("falls back to C:\\Windows when SystemRoot is unset", async () => {
    setPlatform("win32", "x64");
    vi.stubEnv("SystemRoot", undefined);
    runtime.digest = "dc1d6e63b21af62130ede1dcc4113bffdc184544690a23e3f489d75340f4ff61";
    runtime.receivedLength = 247_389_422;
    vi.stubGlobal("fetch", okFetch());
    await installTexRuntime({ onProgress: vi.fn() });
    expect(runtime.spawnCalls[0].command).toBe(
      path.join("C:\\Windows", "System32", "tar.exe"),
    );
  });

  it.each([404, 503])("fails and cleans up after HTTP %i", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status })));
    await expect(installTexRuntime({ onProgress: vi.fn() })).rejects.toThrow(
      `HTTP ${status}`,
    );
    await expect(stat(path.join(installedTexRoot(), ".install"))).rejects.toThrow();
  });

  it("fails when the response has no body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    await expect(installTexRuntime({ onProgress: vi.fn() })).rejects.toThrow(
      "HTTP 200",
    );
  });

  it("rejects a download with the wrong size", async () => {
    runtime.receivedLength = 12;
    vi.stubGlobal("fetch", okFetch());
    await expect(installTexRuntime({ onProgress: vi.fn() })).rejects.toThrow(
      "checksum verification failed",
    );
    expect(runtime.spawnCalls).toEqual([]);
  });

  it("rejects a download with the wrong checksum", async () => {
    runtime.digest = "0".repeat(64);
    vi.stubGlobal("fetch", okFetch());
    await expect(installTexRuntime({ onProgress: vi.fn() })).rejects.toThrow(
      "checksum verification failed",
    );
    expect(runtime.spawnCalls).toEqual([]);
  });

  it("reports tar failures with their stderr", async () => {
    runtime.extract = "fail";
    vi.stubGlobal("fetch", okFetch());
    await expect(installTexRuntime({ onProgress: vi.fn() })).rejects.toThrow(
      "Could not unpack the PDF builder. corrupt archive",
    );
    await expect(stat(path.join(installedTexRoot(), ".install"))).rejects.toThrow();
  });

  it("reports a tar that cannot be started", async () => {
    runtime.extract = "error";
    vi.stubGlobal("fetch", okFetch());
    await expect(installTexRuntime({ onProgress: vi.fn() })).rejects.toThrow(
      "Could not unpack the PDF builder: tar missing",
    );
  });

  it("rejects an archive without latexmk", async () => {
    runtime.extract = "empty";
    vi.stubGlobal("fetch", okFetch());
    await expect(installTexRuntime({ onProgress: vi.fn() })).rejects.toThrow(
      "did not contain latexmk",
    );
    expect(await findBundledTexBinDirectory()).toBeNull();
  });
});
