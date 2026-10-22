// @vitest-environment node
import { EventEmitter } from "node:events";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cloudflaredAssetFor,
  ensureCloudflared,
  extractTarGzEntry,
  parseTunnelUrl,
  startQuickTunnel,
  waitForTunnelDns,
} from "./peerTunnel.js";

function tarGz(name: string, content: Buffer): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, "utf8");
  header.write(content.length.toString(8).padStart(11, "0"), 124, "utf8");
  header.write("0", 156, "utf8");
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512);
  return gzipSync(Buffer.concat([header, content, padding, Buffer.alloc(1024)]));
}

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "latexdo-tunnel-test-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("secure connection helper", () => {
  it("pins a checksum for every supported computer", () => {
    for (const [platform, arch] of [
      ["darwin", "arm64"],
      ["darwin", "x64"],
      ["linux", "x64"],
      ["linux", "arm64"],
      ["win32", "x64"],
    ]) {
      const asset = cloudflaredAssetFor(platform, arch);
      expect(asset?.url).toMatch(
        /^https:\/\/github\.com\/cloudflare\/cloudflared\/releases\/download\/[\d.]+\//,
      );
      expect(asset?.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(asset?.binarySha256).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(cloudflaredAssetFor("win32", "arm64")?.file).toBe(
      "cloudflared-windows-amd64.exe",
    );
    expect(cloudflaredAssetFor("freebsd", "x64")).toBeNull();
  });

  it("reads one file out of a tar archive", () => {
    const archive = tarGz("cloudflared", Buffer.from("binary"));
    expect(extractTarGzEntry(archive, "cloudflared").toString()).toBe("binary");
    expect(() => extractTarGzEntry(archive, "missing")).toThrow("does not contain");
  });

  it("never installs a download that fails the pinned checksum", async () => {
    const fetchImpl = vi.fn(async () => new Response("tampered"));
    await expect(
      ensureCloudflared({
        directory,
        platform: "linux",
        arch: "x64",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow("integrity check");
    expect(fetchImpl).toHaveBeenCalledOnce();
    await expect(stat(path.join(directory, "cloudflared-2026.10.0"))).rejects.toThrow();
    await expect(
      ensureCloudflared({ directory, platform: "freebsd", arch: "x64" }),
    ).rejects.toThrow("not available on this kind of computer");
    await expect(
      ensureCloudflared({
        directory,
        platform: "linux",
        arch: "x64",
        fetchImpl: (async () =>
          new Response("no", { status: 503 })) as unknown as typeof fetch,
      }),
    ).rejects.toThrow("Download failed (503)");
  });

  it("recognises the tunnel address in the helper's output", () => {
    expect(
      parseTunnelUrl("INF |  https://calm-green-river.trycloudflare.com   |"),
    ).toBe("https://calm-green-river.trycloudflare.com");
    expect(parseTunnelUrl("see https://api.trycloudflare.com for terms")).toBeNull();
  });

  it("waits for the address to appear on public DNS", async () => {
    const answers = [{ Status: 3 }, { Answer: [{ data: "104.16.0.1" }] }];
    const fetchImpl = vi.fn(async () => Response.json(answers.shift()));
    expect(
      await waitForTunnelDns("calm-green-river.trycloudflare.com", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        intervalMs: 1,
      }),
    ).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[0])).toContain(
      "name=calm-green-river.trycloudflare.com",
    );
    // A resolver that answers but never lists the name is a real failure…
    expect(
      await waitForTunnelDns("x.trycloudflare.com", {
        fetchImpl: (async () => Response.json({})) as unknown as typeof fetch,
        intervalMs: 1,
        timeoutMs: 20,
      }),
    ).toBe(false);
    // …while an unreachable resolver only means the wait could not be verified.
    expect(
      await waitForTunnelDns("x.trycloudflare.com", {
        fetchImpl: (async () => {
          throw new Error("offline");
        }) as unknown as typeof fetch,
        intervalMs: 1,
        timeoutMs: 20,
      }),
    ).toBe(true);
  });
});

describe("quick tunnel process", () => {
  function fakeHelper() {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      exitCode: null as number | null,
      signalCode: null,
      kill: vi.fn(() => {
        child.exitCode = 0;
        return true;
      }),
    });
    const spawnImpl = vi.fn(() => child);
    return {
      child,
      spawnImpl: spawnImpl as unknown as typeof import("node:child_process").spawn,
      spawnMock: spawnImpl,
    };
  }

  it("resolves once the address is printed and the tunnel is registered", async () => {
    const { child, spawnImpl, spawnMock } = fakeHelper();
    const onExit = vi.fn();
    vi.stubEnv("TUNNEL_TOKEN", "must-not-leak");
    const starting = startQuickTunnel({
      binaryPath: "/bin/helper",
      port: 4321,
      homeDirectory: path.join(directory, "home"),
      onExit,
      spawnImpl,
    });
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    const [binary, args, options] = spawnMock.mock.calls[0] as unknown as [
      string,
      string[],
      { env: NodeJS.ProcessEnv },
    ];
    expect(binary).toBe("/bin/helper");
    expect(args).toEqual([
      "tunnel",
      "--no-autoupdate",
      "--url",
      "http://127.0.0.1:4321",
    ]);
    expect(options.env.TUNNEL_TOKEN).toBeUndefined();
    expect(options.env.HOME).toBe(path.join(directory, "home"));
    child.stderr.emit(
      "data",
      Buffer.from("https://calm-green-river.trycloudflare.com"),
    );
    child.stderr.emit("data", Buffer.from("INF Registered tunnel connection"));
    const tunnel = await starting;
    expect(tunnel.url).toBe("https://calm-green-river.trycloudflare.com");
    child.emit("exit", 1);
    expect(onExit).toHaveBeenCalledWith("The internet link was lost.");
    tunnel.stop();
    vi.unstubAllEnvs();
  });

  it("fails clearly when the helper exits or stalls before connecting", async () => {
    const exited = fakeHelper();
    const first = startQuickTunnel({
      binaryPath: "/bin/helper",
      port: 1,
      homeDirectory: directory,
      spawnImpl: exited.spawnImpl,
    });
    await vi.waitFor(() => expect(exited.spawnMock).toHaveBeenCalled());
    exited.child.stderr.emit("data", Buffer.from("429 Too Many Requests"));
    exited.child.emit("exit", 1);
    await expect(first).rejects.toThrow("busy right now");

    const stalled = fakeHelper();
    await expect(
      startQuickTunnel({
        binaryPath: "/bin/helper",
        port: 1,
        homeDirectory: directory,
        startTimeoutMs: 20,
        spawnImpl: stalled.spawnImpl,
      }),
    ).rejects.toThrow("took too long");
    expect(stalled.child.kill).toHaveBeenCalled();
  });
});

describe("tar and DNS edge cases", () => {
  function entry(name: string, content: Buffer, type = "0", size?: string) {
    const header = Buffer.alloc(512);
    header.write(name, 0, "utf8");
    header.write(size ?? content.length.toString(8).padStart(11, "0"), 124, "utf8");
    header.write(type, 156, "utf8");
    const padding = Buffer.alloc((512 - (content.length % 512)) % 512);
    return Buffer.concat([header, content, padding]);
  }

  it("skips other entries and directories and accepts ./ prefixes", () => {
    const archive = gzipSync(
      Buffer.concat([
        entry("README", Buffer.from("x".repeat(600))),
        entry("cloudflared", Buffer.alloc(0), "5"),
        entry("./cloudflared", Buffer.from("bin")),
      ]),
    );
    expect(extractTarGzEntry(archive, "cloudflared").toString()).toBe("bin");
  });

  it("stops on a bad size field, a missing size or truncated data", () => {
    expect(() =>
      extractTarGzEntry(
        gzipSync(entry("cloudflared", Buffer.from("a"), "0", "zz")),
        "cloudflared",
      ),
    ).toThrow("does not contain");
    const noSize = Buffer.alloc(512);
    noSize.write("cloudflared", 0, "utf8");
    expect(extractTarGzEntry(gzipSync(noSize), "cloudflared").length).toBe(0);
    const truncated = entry("cloudflared", Buffer.from("abc"), "0", "00000001000");
    expect(() =>
      extractTarGzEntry(gzipSync(truncated.subarray(0, 600)), "cloudflared"),
    ).toThrow("does not contain");
  });

  it("keeps polling after an error response and stops when aborted", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => {
      controller.abort();
      return new Response("", { status: 500 });
    });
    expect(
      await waitForTunnelDns("x.trycloudflare.com", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        intervalMs: 1,
        signal: controller.signal,
      }),
    ).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("uses global fetch and default timings", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => Response.json({ Answer: [] }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const pending = waitForTunnelDns("x.trycloudflare.com");
      await vi.advanceTimersByTimeAsync(31_000);
      await expect(pending).resolves.toBe(false);
      expect(fetchMock.mock.calls.length).toBeGreaterThan(10);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
