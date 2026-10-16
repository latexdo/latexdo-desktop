// Internet reachability for a project hosted on the user's own computer.
//
// Home and campus routers drop incoming connections, so a guest on another
// network cannot reach the host directly. LatexDo runs Cloudflare's `cloudflared`
// in "quick tunnel" mode: the host makes one outbound connection and receives a
// temporary https://<random>.trycloudflare.com address. No account, no port
// forwarding, and nothing for the user to rent.
//
// The helper binary is downloaded on first use and is only ever executed after
// its SHA-256 matches the value pinned below.

import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";

interface CloudflaredAsset {
  file: string;
  /** SHA-256 of the downloaded release asset. */
  sha256: string;
  /** SHA-256 of the executable itself (differs from `sha256` for archives). */
  binarySha256: string;
  archive?: boolean;
}

export const cloudflaredVersion = "2026.10.0";
const cloudflaredDownloadBase = `https://github.com/cloudflare/cloudflared/releases/download/${cloudflaredVersion}/`;
const maxCloudflaredDownloadBytes = 120 * 1024 * 1024;

const cloudflaredAssets: Record<string, CloudflaredAsset> = {
  "darwin-arm64": {
    file: "cloudflared-darwin-arm64.tgz",
    sha256: "a2f79ff7b9420aa537d74af239f376da170bbabeb529aec416002adac6a72e70",
    binarySha256: "72edfd3eea463aef4d5cb89e2e209cecb048cc756c2b01915de2e0ad7cb39830",
    archive: true,
  },
  "darwin-x64": {
    file: "cloudflared-darwin-amd64.tgz",
    sha256: "903845b81828c8cb3c5d13d816a2de71c06a3da5785469df8eb0e1b736d92f9f",
    binarySha256: "0560c9ab7281ac3f746055323623ed23bc0405b6dab9400474020cba33a978da",
    archive: true,
  },
  "linux-x64": {
    file: "cloudflared-linux-amd64",
    sha256: "d33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db",
    binarySha256: "d33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db",
  },
  "linux-arm64": {
    file: "cloudflared-linux-arm64",
    sha256: "e6422b9d4f72d3194bc5a38676f13667c06666523217b842a877d72a80b5ac08",
    binarySha256: "e6422b9d4f72d3194bc5a38676f13667c06666523217b842a877d72a80b5ac08",
  },
  "linux-arm": {
    file: "cloudflared-linux-arm",
    sha256: "1dbe8e4ec17e74bb7f49cf91db6a4903bd0f9fe41984556c7503e40b765fd099",
    binarySha256: "1dbe8e4ec17e74bb7f49cf91db6a4903bd0f9fe41984556c7503e40b765fd099",
  },
  "linux-ia32": {
    file: "cloudflared-linux-386",
    sha256: "f6fbd789e6ce9c824d4d560cbbfad2753d55ce398ece16b4c9fbf17271dceab3",
    binarySha256: "f6fbd789e6ce9c824d4d560cbbfad2753d55ce398ece16b4c9fbf17271dceab3",
  },
  "win32-x64": {
    file: "cloudflared-windows-amd64.exe",
    sha256: "86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c",
    binarySha256: "86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c",
  },
  "win32-ia32": {
    file: "cloudflared-windows-386.exe",
    sha256: "0630a8779e9823a1a3b091698b8e71874e0f7b205559219f52fdd301466b5546",
    binarySha256: "0630a8779e9823a1a3b091698b8e71874e0f7b205559219f52fdd301466b5546",
  },
};

export function cloudflaredAssetFor(
  platform: string,
  arch: string,
): (CloudflaredAsset & { url: string }) | null {
  // Windows on ARM runs the x64 build through emulation; there is no native one.
  const key =
    platform === "win32" && arch === "arm64" ? "win32-x64" : `${platform}-${arch}`;
  const asset = Object.hasOwn(cloudflaredAssets, key) ? cloudflaredAssets[key] : null;
  return asset ? { ...asset, url: `${cloudflaredDownloadBase}${asset.file}` } : null;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Reads one regular file out of a gzip-compressed tar archive. */
export function extractTarGzEntry(archive: Uint8Array, entryName: string): Buffer {
  const tar = gunzipSync(archive, { maxOutputLength: maxCloudflaredDownloadBytes * 2 });
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const size = Number.parseInt(
      header.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim() || "0",
      8,
    );
    if (!Number.isSafeInteger(size) || size < 0) break;
    const typeFlag = String.fromCharCode(header[156] || 48);
    const start = offset + 512;
    if (
      (typeFlag === "0" || typeFlag === "\0") &&
      name.replace(/^\.\//, "") === entryName
    ) {
      if (start + size > tar.length) break;
      return Buffer.from(tar.subarray(start, start + size));
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
  throw new Error(`The downloaded archive does not contain ${entryName}.`);
}

export interface EnsureCloudflaredOptions {
  directory: string;
  platform?: string;
  arch?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Called with a 0..1 fraction while the helper downloads. */
  onProgress?: (fraction: number) => void;
}

async function verifiedBinary(filePath: string, expected: string): Promise<boolean> {
  try {
    return sha256(await readFile(filePath)) === expected;
  } catch {
    return false;
  }
}

async function downloadBytes(
  url: string,
  options: EnsureCloudflaredOptions,
): Promise<Uint8Array> {
  const response = await (options.fetchImpl ?? fetch)(url, {
    redirect: "follow",
    signal: options.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}).`);
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxCloudflaredDownloadBytes) {
    throw new Error("The download is larger than expected.");
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxCloudflaredDownloadBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("The download is larger than expected.");
    }
    chunks.push(value);
    if (declared > 0) options.onProgress?.(Math.min(1, received / declared));
  }
  return Buffer.concat(chunks);
}

/**
 * Returns the path of a checksum-verified cloudflared executable, downloading
 * it into `directory` when it is missing or does not match the pinned hash.
 */
export async function ensureCloudflared(
  options: EnsureCloudflaredOptions,
): Promise<string> {
  const platform = options.platform ?? process.platform;
  const asset = cloudflaredAssetFor(platform, options.arch ?? process.arch);
  if (!asset) {
    throw new Error(
      "Sharing over the internet is not available on this kind of computer. Use local network sharing instead.",
    );
  }
  const binaryPath = path.join(
    options.directory,
    `cloudflared-${cloudflaredVersion}${platform === "win32" ? ".exe" : ""}`,
  );
  if (await verifiedBinary(binaryPath, asset.binarySha256)) return binaryPath;

  await mkdir(options.directory, { recursive: true });
  const downloaded = await downloadBytes(asset.url, options);
  if (sha256(downloaded) !== asset.sha256) {
    throw new Error("The secure connection helper failed its integrity check.");
  }
  const binary = asset.archive
    ? extractTarGzEntry(downloaded, "cloudflared")
    : downloaded;
  if (sha256(binary) !== asset.binarySha256) {
    throw new Error("The secure connection helper failed its integrity check.");
  }
  const temporaryPath = `${binaryPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, binary, { mode: 0o755 });
    await chmod(temporaryPath, 0o755);
    await rename(temporaryPath, binaryPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return binaryPath;
}

const tunnelUrlPattern = /https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/;

export function parseTunnelUrl(text: string): string | null {
  return tunnelUrlPattern.exec(text)?.[0] ?? null;
}

/**
 * Waits until a freshly created tunnel hostname resolves on public DNS.
 *
 * A new hostname takes a few seconds to appear. Looking it up too early through
 * the system resolver caches the "not found" answer and keeps the address
 * unusable for much longer, so this asks a public DNS-over-HTTPS resolver
 * instead and never touches the system cache.
 */
export async function waitForTunnelDns(
  hostname: string,
  options: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    intervalMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<boolean> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const interval = options.intervalMs ?? 1_500;
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  let resolverAnswered = false;
  while (Date.now() < deadline && !options.signal?.aborted) {
    try {
      const response = await fetchImpl(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
        {
          headers: { accept: "application/dns-json" },
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (response.ok) {
        resolverAnswered = true;
        const body = (await response.json()) as { Answer?: unknown[] };
        if (Array.isArray(body.Answer) && body.Answer.length > 0) return true;
      }
    } catch {
      // The resolver is unreachable; keep waiting out the propagation delay.
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  // Without a resolver answer the fixed wait above is the best available signal.
  return !resolverAnswered;
}

export interface QuickTunnelOptions {
  binaryPath: string;
  port: number;
  /** Empty directory used as the helper's home so user configs never apply. */
  homeDirectory: string;
  startTimeoutMs?: number;
  onExit?: (detail: string) => void;
  spawnImpl?: typeof spawn;
}

export interface QuickTunnel {
  url: string;
  stop: () => void;
}

function tunnelEnvironment(homeDirectory: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    // TUNNEL_* variables reconfigure cloudflared (for example a named tunnel
    // token); a quick tunnel must not inherit them.
    if (!name.toUpperCase().startsWith("TUNNEL_")) environment[name] = value;
  }
  return { ...environment, HOME: homeDirectory, USERPROFILE: homeDirectory };
}

/** Starts a quick tunnel to a loopback port and resolves once it is routable. */
export async function startQuickTunnel(
  options: QuickTunnelOptions,
): Promise<QuickTunnel> {
  await mkdir(options.homeDirectory, { recursive: true });
  const child: ChildProcess = (options.spawnImpl ?? spawn)(
    options.binaryPath,
    ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${options.port}`],
    {
      env: tunnelEnvironment(options.homeDirectory),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  let stopped = false;
  let recentOutput = "";
  const stop = () => {
    stopped = true;
    if (child.exitCode === null && child.signalCode === null) child.kill();
  };

  return new Promise<QuickTunnel>((resolve, reject) => {
    let url: string | null = null;
    let connected = false;
    let settled = false;

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stop();
      reject(new Error(message));
    };
    const timer = setTimeout(
      () => fail("The internet link took too long to start. Check your connection."),
      options.startTimeoutMs ?? 60_000,
    );

    const onOutput = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      recentOutput = `${recentOutput}${text}`.slice(-4000);
      url ??= parseTunnelUrl(recentOutput);
      // The address is printed before the tunnel is attached to Cloudflare's
      // edge; it only answers once a connection has been registered.
      if (/Registered tunnel connection/i.test(text)) connected = true;
      if (url && connected && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ url, stop });
      }
    };
    child.stdout?.on("data", onOutput);
    child.stderr?.on("data", onOutput);
    child.once("error", (error) =>
      fail(`The internet link could not start: ${error.message}`),
    );
    child.once("exit", (code) => {
      if (!settled) {
        fail(
          /rate.?limit|429|Too Many Requests/i.test(recentOutput)
            ? "The free internet link is busy right now. Try again in a minute."
            : `The internet link stopped while starting (code ${code ?? "unknown"}).`,
        );
        return;
      }
      if (!stopped) options.onExit?.("The internet link was lost.");
    });
  });
}
