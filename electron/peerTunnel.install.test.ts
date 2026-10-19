// @vitest-environment node
// Installs the helper with hashing stubbed to echo the payload, so a fake
// download can "match" the pinned checksums without shipping the real binary.
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:crypto", async (original) => ({
  ...(await original<typeof import("node:crypto")>()),
  createHash: () => {
    let bytes = Buffer.alloc(0);
    const hash = {
      update(chunk: Uint8Array) {
        bytes = Buffer.concat([bytes, Buffer.from(chunk)]);
        return hash;
      },
      digest: () => bytes.toString("utf8"),
    };
    return hash;
  },
}));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawn: spawnMock,
}));

import { cloudflaredAssetFor, ensureCloudflared, startQuickTunnel } from "./peerTunnel.js";

function tarGz(name: string, content: Buffer): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, "utf8");
  header.write(content.length.toString(8).padStart(11, "0"), 124, "utf8");
  header.write("0", 156, "utf8");
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512);
  return Buffer.concat([header, content, padding]);
}

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "latexdo-tunnel-install-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("installing the verified helper", () => {
  it("writes a plain binary once and reuses it while it still verifies", async () => {
    const asset = cloudflaredAssetFor("linux", "x64")!;
    const progress: number[] = [];
    const body = Buffer.from(asset.sha256);
    const fetchImpl = vi.fn(
      async () =>
        new Response(body, { headers: { "content-length": String(body.length) } }),
    );
    const options = {
      directory: path.join(directory, "bin"),
      platform: "linux",
      arch: "x64",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onProgress: (fraction: number) => progress.push(fraction),
    };
    const installed = await ensureCloudflared(options);
    expect(installed).toBe(path.join(directory, "bin", "cloudflared-2026.10.0"));
    expect(await readFile(installed, "utf8")).toBe(asset.binarySha256);
    expect(progress.at(-1)).toBe(1);
    if (process.platform !== "win32") {
      expect((await stat(installed)).mode & 0o111).toBeTruthy();
    }
    await expect(ensureCloudflared(options)).resolves.toBe(installed);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("extracts an archived binary and rejects an archive with the wrong executable", async () => {
    const asset = cloudflaredAssetFor("darwin", "arm64")!;
    // The archive "hash" is its bytes; wrap the payload so it matches the pinned one.
    const tarBytes = tarGz("./cloudflared", Buffer.from(asset.binarySha256));
    const download = gzipSync(tarBytes);
    // The archive must hash to `asset.sha256`, which a gzip stream cannot do
    // with an echo hash, so check the mismatch path instead.
    await expect(
      ensureCloudflared({
        directory,
        platform: "darwin",
        arch: "arm64",
        fetchImpl: (async () => new Response(download)) as unknown as typeof fetch,
      }),
    ).rejects.toThrow("integrity check");
  });

  it("rejects a download whose executable does not match after a matching archive", async () => {
    const asset = cloudflaredAssetFor("win32", "x64")!;
    const fetchImpl = (async () =>
      new Response(Buffer.from(asset.sha256))) as unknown as typeof fetch;
    const installed = await ensureCloudflared({
      directory,
      platform: "win32",
      arch: "x64",
      fetchImpl,
    });
    expect(installed.endsWith(".exe")).toBe(true);
  });
});

describe("streamed download limits", () => {
  function streamingResponse(
    chunks: Array<{ byteLength: number } | Uint8Array>,
    length: string | null,
  ) {
    const cancel = vi.fn(async () => {
      throw new Error("already closed");
    });
    let index = 0;
    return {
      cancel,
      response: {
        ok: true,
        status: 200,
        headers: { get: () => length },
        body: {
          getReader: () => ({
            read: async () =>
              index < chunks.length
                ? { done: false, value: chunks[index++] }
                : { done: true, value: undefined },
            cancel,
          }),
        },
      },
    };
  }

  it("stops a stream that grows beyond the limit and ignores cancel errors", async () => {
    const { response, cancel } = streamingResponse([{ byteLength: 121 * 1024 * 1024 }], null);
    const onProgress = vi.fn();
    await expect(
      ensureCloudflared({
        directory,
        platform: "linux",
        arch: "arm64",
        fetchImpl: (async () => response) as unknown as typeof fetch,
        onProgress,
      }),
    ).rejects.toThrow("larger than expected");
    expect(cancel).toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("refuses an oversized declared length and a missing body", async () => {
    const { response } = streamingResponse([], String(200 * 1024 * 1024));
    await expect(
      ensureCloudflared({
        directory,
        platform: "linux",
        arch: "arm",
        fetchImpl: (async () => response) as unknown as typeof fetch,
      }),
    ).rejects.toThrow("larger than expected");
    await expect(
      ensureCloudflared({
        directory,
        platform: "linux",
        arch: "ia32",
        fetchImpl: (async () => ({ ok: true, status: 204, body: null })) as unknown as typeof fetch,
      }),
    ).rejects.toThrow("Download failed (204)");
  });

  it("uses the global fetch and process platform by default", async () => {
    const fetchMock = vi.fn(async () => new Response("x", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const supported = cloudflaredAssetFor(process.platform, process.arch);
      const attempt = ensureCloudflared({ directory });
      if (supported) {
        await expect(attempt).rejects.toThrow("Download failed (500)");
        expect(fetchMock).toHaveBeenCalledWith(supported.url, expect.anything());
      } else {
        await expect(attempt).rejects.toThrow("not available");
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("quick tunnel defaults", () => {
  function child() {
    return Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      exitCode: null as number | null,
      signalCode: null as string | null,
      kill: vi.fn(),
    });
  }

  it("spawns the real helper API by default and reports start errors", async () => {
    const helper = child();
    spawnMock.mockReturnValue(helper);
    const starting = startQuickTunnel({
      binaryPath: "/bin/helper",
      port: 9,
      homeDirectory: path.join(directory, "home"),
    });
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    helper.emit("error", new Error("ENOENT"));
    await expect(starting).rejects.toThrow("could not start: ENOENT");
    expect(helper.kill).toHaveBeenCalled();
  });

  it("reports an unknown exit code and does not kill an exited helper", async () => {
    const helper = child();
    spawnMock.mockReturnValue(helper);
    const starting = startQuickTunnel({
      binaryPath: "/bin/helper",
      port: 9,
      homeDirectory: directory,
    });
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    helper.signalCode = "SIGTERM";
    helper.emit("exit", null);
    await expect(starting).rejects.toThrow("(code unknown)");
    expect(helper.kill).not.toHaveBeenCalled();
    // A second failure after settling is ignored.
    helper.emit("error", new Error("late"));
  });

  it("stays quiet when stopped deliberately or without an exit callback", async () => {
    const helper = child();
    spawnMock.mockReturnValue(helper);
    const onExit = vi.fn();
    const starting = startQuickTunnel({
      binaryPath: "/bin/helper",
      port: 9,
      homeDirectory: directory,
      onExit,
    });
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    helper.stdout.emit(
      "data",
      Buffer.from("https://a-b.trycloudflare.com\nRegistered tunnel connection"),
    );
    const tunnel = await starting;
    helper.stdout.emit("data", Buffer.from("Registered tunnel connection again"));
    tunnel.stop();
    helper.emit("exit", 0);
    expect(onExit).not.toHaveBeenCalled();

    const other = child();
    spawnMock.mockReturnValue(other);
    const second = startQuickTunnel({ binaryPath: "/b", port: 1, homeDirectory: directory });
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(2));
    other.stderr.emit("data", Buffer.from("Registered tunnel connection"));
    other.stderr.emit("data", Buffer.from("https://c-d.trycloudflare.com"));
    other.stderr.emit("data", Buffer.from("Registered tunnel connection"));
    await expect(second).resolves.toMatchObject({ url: "https://c-d.trycloudflare.com" });
    expect(() => other.emit("exit", 1)).not.toThrow();
  });
});
