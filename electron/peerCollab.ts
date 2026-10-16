// Serverless collaboration: one user's LatexDo hosts the collaboration backend
// on their own computer and everyone else connects to it.
//
// This module owns the hosted server process, its reachability (local network
// or an internet tunnel), and the network bridge the renderer uses to talk to a
// host. All peer traffic goes through the main process so the renderer's
// Content-Security-Policy does not have to allow arbitrary origins.

import { randomBytes } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  decodePeerInvite,
  encodePeerInvite,
  localHostOrigin,
  normalizePeerOrigin,
} from "./peerInvite.js";
import {
  ensureCloudflared,
  startQuickTunnel,
  waitForTunnelDns,
  type QuickTunnel,
} from "./peerTunnel.js";
import type { HostSharingMode, HostSharingStatus } from "./types.js";

/** The subset of a child process the host server needs. */
export interface HostServerChild {
  stdout: NodeJS.ReadableStream | null;
  kill: () => unknown;
  once: (event: "exit", listener: () => void) => unknown;
}

export interface PeerSocketHandlers {
  onOpen: () => void;
  onMessage: (data: Uint8Array) => void;
  onClose: (code: number, reason: string) => void;
  onError: () => void;
}

export interface PeerSocket {
  send: (data: Uint8Array) => void;
  close: (code?: number, reason?: string) => void;
}

export interface PeerRequest {
  origin: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

export interface PeerResponse {
  status: number;
  statusText: string;
  text: string;
}

export interface PeerCollabDeps {
  /** Private directory for hosted project data, the helper binary and state. */
  dataDirectory: string;
  serverEntryPath: string;
  spawnServer: (entryPath: string, env: Record<string, string>) => HostServerChild;
  /** Fetch used for other people's computers; should honour system proxies. */
  fetchRemote: typeof fetch;
  onStatusChange: (status: HostSharingStatus) => void;
  networkInterfaces?: typeof os.networkInterfaces;
  ensureTunnelBinary?: typeof ensureCloudflared;
  startTunnel?: typeof startQuickTunnel;
  waitForTunnel?: typeof waitForTunnelDns;
}

type ServerBind = "loopback" | "lan";

/** How long to wait for the hosted server process to exit when stopping it. */
const serverExitTimeoutMs = 3_000;

interface RunningServer {
  bind: ServerBind;
  port: number;
  hostKey: string;
  child: HostServerChild;
}

interface HostedProject {
  localRoot: string;
  name: string;
}

const hostedProjectIdPattern = /^project_[a-f0-9]{32}$/;
const peerPathPattern = /^\/api\/(?:health|projects|shares)(?:[/?]|$)/;
const peerSocketPathPattern = /^\/api\/projects\/[^/?#]+\/files\/collaborate\?/;
const allowedMethods = new Set(["GET", "POST", "PUT", "DELETE"]);
const allowedHeaderPattern = /^(?:content-type|x-latexdo-[a-z-]+)$/;
const maxPeerRequestBodyBytes = 4 * 1024 * 1024;
const maxPeerResponseBytes = 8 * 1024 * 1024;
const maxPeerSocketFrameBytes = 1024 * 1024;
const maxKnownPeers = 200;
const serverStartTimeoutMs = 20_000;
const offStatus: HostSharingStatus = {
  active: false,
  mode: null,
  phase: "off",
  addresses: [],
};

function safeRelativeSegments(relativePath: string): boolean {
  return relativePath
    .split("/")
    .every(
      (segment) =>
        segment !== "" &&
        segment !== "." &&
        segment !== ".." &&
        segment !== ".git" &&
        segment !== "node_modules" &&
        !/[\u0000-\u001f\u007f\\]/.test(segment),
    );
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("The collaboration response is too large.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export class PeerCollabService {
  private server: RunningServer | null = null;
  private serverLock: Promise<unknown> = Promise.resolve();
  private tunnel: QuickTunnel | null = null;
  private currentStatus: HostSharingStatus = offStatus;
  /** Bumped on every start/stop so a superseded start can notice and bow out. */
  private generation = 0;
  private knownPeers: Set<string> | null = null;
  private hostedProjects: Record<string, HostedProject> | null = null;
  private disposed = false;

  constructor(private readonly deps: PeerCollabDeps) {}

  status(): HostSharingStatus {
    return { ...this.currentStatus, addresses: [...this.currentStatus.addresses] };
  }

  private setStatus(status: HostSharingStatus): void {
    this.currentStatus = status;
    if (!this.disposed) this.deps.onStatusChange(this.status());
  }

  // --- Hosted server process -------------------------------------------------

  private withServerLock<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.serverLock.then(operation, operation);
    this.serverLock = result.catch(() => undefined);
    return result;
  }

  private launchServer(bind: ServerBind): Promise<RunningServer> {
    const hostKey = randomBytes(32).toString("base64url");
    const child = this.deps.spawnServer(this.deps.serverEntryPath, {
      LATEXDO_COLLAB_HOST: bind === "lan" ? "0.0.0.0" : "127.0.0.1",
      LATEXDO_COLLAB_PORT: "0",
      LATEXDO_COLLAB_DATA_DIR: path.join(this.deps.dataDirectory, "data"),
      LATEXDO_COLLAB_CREATE_KEY: hostKey,
      LATEXDO_COLLAB_ACCESS_LOG: "false",
      // Every guest of an internet session arrives through the local tunnel
      // helper, which reports their real address in X-Forwarded-For. That is
      // only trustworthy while nothing but this computer can connect directly.
      LATEXDO_COLLAB_TRUST_PROXY: bind === "loopback" ? "true" : "false",
      LATEXDO_COLLAB_RATE_MAX: "6000",
      LATEXDO_COLLAB_MAX_PROJECTS: "500",
      LATEXDO_COLLAB_MAX_CONNECTIONS: "300",
    });

    return new Promise<RunningServer>((resolve, reject) => {
      let buffered = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(new Error("Sharing could not start on this computer."));
      }, serverStartTimeoutMs);

      child.stdout?.on("data", (chunk: Buffer | string) => {
        if (settled) return;
        buffered = `${buffered}${chunk.toString()}`.slice(-8192);
        const port = Number(/"msg":"listening".*?"port":(\d+)/.exec(buffered)?.[1]);
        if (Number.isInteger(port) && port > 0) {
          settled = true;
          clearTimeout(timer);
          resolve({ bind, port, hostKey, child });
        }
      });
      child.once("exit", () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error("Sharing could not start on this computer."));
          return;
        }
        if (this.server?.child !== child) return;
        // The server died underneath a running session.
        this.server = null;
        this.generation += 1;
        this.stopTunnel();
        if (this.currentStatus.phase !== "off") {
          this.setStatus({
            ...offStatus,
            mode: this.currentStatus.mode,
            phase: "failed",
            message: "Sharing stopped unexpectedly. Start sharing again.",
          });
        }
      });
    });
  }

  /**
   * Stops the hosted server and resolves once its process has exited, so a
   * "sharing stopped" status is only reported when nobody can reach it.
   */
  private stopServer(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return Promise.resolve();
    const child = server.child as HostServerChild & {
      exitCode?: number | null;
      signalCode?: string | null;
    };
    if (child.exitCode != null || child.signalCode != null) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, serverExitTimeoutMs);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill();
    });
  }

  /**
   * Makes sure the hosted server is running. A loopback request is satisfied by
   * any running server; `exact` forces a restart when the bind differs.
   */
  private ensureServer(bind: ServerBind, exact = false): Promise<RunningServer> {
    return this.withServerLock(async () => {
      if (this.disposed) throw new Error("LatexDo is shutting down.");
      const running = this.server;
      if (running && (running.bind === bind || (!exact && bind === "loopback"))) {
        return running;
      }
      await this.stopServer();
      await mkdir(path.join(this.deps.dataDirectory, "data"), { recursive: true });
      this.server = await this.launchServer(bind);
      return this.server;
    });
  }

  // --- Reachability ----------------------------------------------------------

  private stopTunnel(): void {
    const tunnel = this.tunnel;
    this.tunnel = null;
    tunnel?.stop();
  }

  private lanAddresses(port: number): string[] {
    const interfaces = (this.deps.networkInterfaces ?? os.networkInterfaces)();
    const addresses: string[] = [];
    for (const entries of Object.values(interfaces)) {
      for (const entry of entries ?? []) {
        if (
          entry.family === "IPv4" &&
          !entry.internal &&
          !entry.address.startsWith("169.254.")
        ) {
          addresses.push(`http://${entry.address}:${port}`);
        }
      }
    }
    return addresses.slice(0, 6);
  }

  async startSharing(mode: HostSharingMode): Promise<HostSharingStatus> {
    const generation = ++this.generation;
    const superseded = () => generation !== this.generation;
    this.stopTunnel();
    this.setStatus({
      active: false,
      mode,
      phase: "starting",
      message: "Starting…",
      addresses: [],
    });

    try {
      if (mode === "local") {
        const server = await this.ensureServer("lan", true);
        if (superseded()) return this.status();
        const addresses = this.lanAddresses(server.port);
        if (!addresses.length) {
          throw new Error(
            "This computer is not connected to a network. Connect to Wi-Fi or a cable and try again.",
          );
        }
        this.setStatus({ active: true, mode, phase: "ready", addresses });
        return this.status();
      }

      // Internet sharing keeps the server on loopback: the tunnel is the only
      // way in, and it is encrypted.
      const server = await this.ensureServer("loopback", true);
      if (superseded()) return this.status();
      this.setStatus({
        active: false,
        mode,
        phase: "starting",
        message: "Preparing a secure internet link…",
        addresses: [],
      });
      let lastPercent = -1;
      const binaryPath = await (this.deps.ensureTunnelBinary ?? ensureCloudflared)({
        directory: path.join(this.deps.dataDirectory, "bin"),
        fetchImpl: this.deps.fetchRemote,
        onProgress: (fraction) => {
          const percent = Math.floor(fraction * 20) * 5;
          if (percent === lastPercent || superseded()) return;
          lastPercent = percent;
          this.setStatus({
            active: false,
            mode,
            phase: "starting",
            message: `Downloading the secure connection helper (one time)… ${percent}%`,
            addresses: [],
          });
        },
      });
      if (superseded()) return this.status();
      this.setStatus({
        active: false,
        mode,
        phase: "starting",
        message: "Connecting…",
        addresses: [],
      });
      const tunnel = await (this.deps.startTunnel ?? startQuickTunnel)({
        binaryPath,
        port: server.port,
        homeDirectory: path.join(this.deps.dataDirectory, "tunnel-home"),
        onExit: (detail) => {
          if (this.tunnel !== tunnel) return;
          this.tunnel = null;
          this.generation += 1;
          this.setStatus({
            ...offStatus,
            mode,
            phase: "failed",
            message: `${detail} Start sharing again to get a new invite.`,
          });
        },
      });
      if (superseded()) {
        tunnel.stop();
        return this.status();
      }
      this.tunnel = tunnel;
      this.setStatus({
        active: false,
        mode,
        phase: "starting",
        message: "Almost ready. Waiting for the new address to go live…",
        addresses: [],
      });
      await (this.deps.waitForTunnel ?? waitForTunnelDns)(
        new URL(tunnel.url).hostname,
        {
          fetchImpl: this.deps.fetchRemote,
        },
      );
      if (superseded() || this.tunnel !== tunnel) return this.status();
      this.setStatus({ active: true, mode, phase: "ready", addresses: [tunnel.url] });
    } catch (error) {
      if (!superseded()) {
        this.stopTunnel();
        this.setStatus({
          ...offStatus,
          mode,
          phase: "failed",
          message:
            error instanceof Error && error.message
              ? error.message
              : "Sharing could not start.",
        });
      }
    }
    return this.status();
  }

  async stopSharing(): Promise<HostSharingStatus> {
    this.generation += 1;
    this.stopTunnel();
    await this.withServerLock(async () => {
      // A LAN-bound server stays reachable by the whole network until it is
      // stopped. The next local request restarts it on loopback only.
      if (this.server?.bind === "lan") await this.stopServer();
    });
    this.setStatus(offStatus);
    return this.status();
  }

  /** Builds the invite for one of the hosted projects, or null when not shared. */
  invite(token: string): string | null {
    const { active, addresses } = this.currentStatus;
    if (!active || !addresses.length) return null;
    try {
      return encodePeerInvite({ token, addresses });
    } catch {
      return null;
    }
  }

  // --- Known peers -----------------------------------------------------------

  private get peersFile(): string {
    return path.join(this.deps.dataDirectory, "peers.json");
  }

  private async peers(): Promise<Set<string>> {
    if (this.knownPeers) return this.knownPeers;
    let stored: unknown = [];
    try {
      stored = JSON.parse(await readFile(this.peersFile, "utf8")) as unknown;
    } catch {
      // No peers have been joined yet.
    }
    this.knownPeers = new Set(
      (Array.isArray(stored) ? stored : [])
        .map(normalizePeerOrigin)
        .filter((origin): origin is string => origin !== null),
    );
    return this.knownPeers;
  }

  private async rememberPeer(origin: string): Promise<void> {
    const peers = await this.peers();
    peers.delete(origin);
    peers.add(origin);
    while (peers.size > maxKnownPeers) {
      peers.delete(peers.values().next().value as string);
    }
    await mkdir(this.deps.dataDirectory, { recursive: true });
    const temporaryPath = `${this.peersFile}.${process.pid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify([...peers]), "utf8");
    await rename(temporaryPath, this.peersFile);
  }

  private async isLatexDoHost(origin: string, timeoutMs: number): Promise<boolean> {
    try {
      const response = await this.deps.fetchRemote(`${origin}/api/health`, {
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return false;
      const body = JSON.parse(await readBoundedText(response, 4096)) as {
        product?: unknown;
      };
      return body.product === "LatexDo collaborations";
    } catch {
      return false;
    }
  }

  /**
   * Decodes an invite and finds an address where the host actually answers.
   * Only an address that identifies itself as a LatexDo host is remembered, so
   * the bridge can never be pointed at an arbitrary service.
   */
  async resolveInvite(input: string): Promise<{ origin: string; token: string }> {
    const invite = decodePeerInvite(input);
    if (!invite) {
      throw new Error("That is not a valid invite. Ask for a new invite and paste it.");
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const reachable = await Promise.all(
        invite.addresses.map((address) => this.isLatexDoHost(address, 7_000)),
      );
      const index = reachable.indexOf(true);
      if (index >= 0) {
        const origin = invite.addresses[index];
        await this.rememberPeer(origin);
        return { origin, token: invite.token };
      }
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    const localOnly = invite.addresses.every((address) => address.startsWith("http:"));
    throw new Error(
      localOnly
        ? "Could not reach the host. Make sure you are on the same network and that LatexDo is still open and sharing on their computer."
        : "Could not reach the host. Make sure LatexDo is still open and sharing on their computer.",
    );
  }

  // --- Network bridge --------------------------------------------------------

  private async resolveTarget(
    origin: string,
  ): Promise<{ base: string; hostKey?: string }> {
    if (origin === localHostOrigin) {
      const server = await this.ensureServer("loopback");
      return { base: `http://127.0.0.1:${server.port}`, hostKey: server.hostKey };
    }
    const normalized = normalizePeerOrigin(origin);
    if (!normalized || !(await this.peers()).has(normalized)) {
      throw new Error("This collaboration host has not been joined on this computer.");
    }
    return { base: normalized };
  }

  async request(request: PeerRequest): Promise<PeerResponse> {
    const method = request.method.toUpperCase();
    if (
      !allowedMethods.has(method) ||
      !peerPathPattern.test(request.path) ||
      request.path.length > 4096 ||
      /[\u0000- \\]/.test(request.path)
    ) {
      throw new Error("Invalid collaboration request.");
    }
    const body = request.body;
    if (
      body !== undefined &&
      Buffer.byteLength(body, "utf8") > maxPeerRequestBodyBytes
    ) {
      throw new Error("The collaboration request is too large.");
    }
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      const lower = name.toLowerCase();
      if (
        allowedHeaderPattern.test(lower) &&
        lower !== "x-latexdo-host-key" &&
        typeof value === "string" &&
        value.length <= 1024 &&
        !/[\r\n]/.test(value)
      ) {
        headers[lower] = value;
      }
    }

    const target = await this.resolveTarget(request.origin);
    if (target.hostKey) headers["x-latexdo-host-key"] = target.hostKey;
    const timeoutMs = Math.min(Math.max(request.timeoutMs, 1_000), 120_000);
    // The hosted server is on loopback; never route it through a system proxy.
    const fetchImpl = target.hostKey ? fetch : this.deps.fetchRemote;
    let response: Response;
    try {
      response = await fetchImpl(`${target.base}${request.path}`, {
        method,
        headers,
        body: method === "GET" ? undefined : body,
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // Raw network errors (ECONNREFUSED, net::ERR_…) mean nothing to a user.
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new Error(
        target.hostKey
          ? "Sharing is not running on this computer. Try again."
          : timedOut
            ? "The host did not answer in time. Check both internet connections."
            : "Could not reach the host. They may have stopped sharing or closed LatexDo.",
      );
    }
    return {
      status: response.status,
      statusText: response.statusText,
      text: await readBoundedText(response, maxPeerResponseBytes),
    };
  }

  async openSocket(
    origin: string,
    pathAndQuery: string,
    handlers: PeerSocketHandlers,
  ): Promise<PeerSocket> {
    if (
      !peerSocketPathPattern.test(pathAndQuery) ||
      pathAndQuery.length > 4096 ||
      /[\u0000- \\]/.test(pathAndQuery)
    ) {
      throw new Error("Invalid collaboration socket request.");
    }
    const target = await this.resolveTarget(origin);
    const url = new URL(pathAndQuery, target.base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    let closed = false;
    socket.addEventListener("open", () => handlers.onOpen());
    socket.addEventListener("message", (event) => {
      const data: unknown = event.data;
      if (data instanceof ArrayBuffer && data.byteLength <= maxPeerSocketFrameBytes) {
        handlers.onMessage(new Uint8Array(data));
      }
    });
    socket.addEventListener("error", () => handlers.onError());
    socket.addEventListener("close", (event) => {
      if (closed) return;
      closed = true;
      handlers.onClose(event.code, event.reason);
    });
    return {
      send: (data) => {
        if (
          socket.readyState === WebSocket.OPEN &&
          data.byteLength <= maxPeerSocketFrameBytes
        ) {
          socket.send(data);
        }
      },
      close: (code, reason) => {
        if (socket.readyState === WebSocket.CLOSED) return;
        try {
          socket.close(code, reason);
        } catch {
          socket.close();
        }
      },
    };
  }

  // --- Hosted project bookkeeping --------------------------------------------

  private get hostedFile(): string {
    return path.join(this.deps.dataDirectory, "hosted-projects.json");
  }

  private async hosted(): Promise<Record<string, HostedProject>> {
    if (this.hostedProjects) return this.hostedProjects;
    const projects: Record<string, HostedProject> = {};
    try {
      const stored = JSON.parse(await readFile(this.hostedFile, "utf8")) as unknown;
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        for (const [id, value] of Object.entries(stored as Record<string, unknown>)) {
          const entry = value as Partial<HostedProject> | null;
          if (
            hostedProjectIdPattern.test(id) &&
            entry &&
            typeof entry.localRoot === "string" &&
            path.isAbsolute(entry.localRoot)
          ) {
            projects[id] = {
              localRoot: entry.localRoot,
              name: typeof entry.name === "string" ? entry.name : "",
            };
          }
        }
      }
    } catch {
      // Nothing has been shared from this computer yet.
    }
    this.hostedProjects = projects;
    return projects;
  }

  /** Remembers which local folder a hosted project was shared from. */
  async registerHostedProject(
    projectId: string,
    localRoot: string,
    name: string,
  ): Promise<void> {
    if (!hostedProjectIdPattern.test(projectId) || !path.isAbsolute(localRoot)) {
      throw new Error("Invalid hosted project.");
    }
    const projects = await this.hosted();
    projects[projectId] = { localRoot, name };
    await mkdir(this.deps.dataDirectory, { recursive: true });
    const temporaryPath = `${this.hostedFile}.${process.pid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(projects, null, 2), "utf8");
    await rename(temporaryPath, this.hostedFile);
  }

  async hostedProject(projectId: string): Promise<HostedProject | null> {
    const projects = await this.hosted();
    return Object.hasOwn(projects, projectId) ? projects[projectId] : null;
  }

  /**
   * Copies the shared copy of a hosted project back into the folder it was
   * shared from. Only regular files are written and nothing is ever deleted.
   */
  async saveHostedProject(
    projectId: string,
  ): Promise<{ folder: string; written: number }> {
    const project = await this.hostedProject(projectId);
    if (!project) {
      throw new Error("This project was not shared from a folder on this computer.");
    }
    const sourceRoot = path.join(
      this.deps.dataDirectory,
      "data",
      "projects",
      projectId,
      "files",
    );
    const targetRoot = project.localRoot;
    if (!(await lstat(targetRoot).catch(() => null))?.isDirectory()) {
      throw new Error(`The original folder no longer exists: ${targetRoot}`);
    }

    let written = 0;
    const copyDirectory = async (relativeDirectory: string): Promise<void> => {
      const entries = await readdir(path.join(sourceRoot, relativeDirectory), {
        withFileTypes: true,
      });
      for (const entry of entries) {
        const relativePath = relativeDirectory
          ? `${relativeDirectory}/${entry.name}`
          : entry.name;
        if (!safeRelativeSegments(relativePath)) continue;
        const targetPath = path.join(targetRoot, ...relativePath.split("/"));
        // Never write through a link that points outside the project folder.
        const targetStat = await lstat(targetPath).catch(() => null);
        if (targetStat?.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (targetStat && !targetStat.isDirectory()) continue;
          await mkdir(targetPath, { recursive: true });
          await copyDirectory(relativePath);
        } else if (entry.isFile()) {
          if (targetStat && !targetStat.isFile()) continue;
          const content = await readFile(
            path.join(sourceRoot, ...relativePath.split("/")),
          );
          if (targetStat && content.equals(await readFile(targetPath))) continue;
          const temporaryPath = `${targetPath}.${process.pid}.latexdo-tmp`;
          await writeFile(temporaryPath, content);
          await rename(temporaryPath, targetPath);
          written += 1;
        }
      }
    };
    await copyDirectory("");
    return { folder: targetRoot, written };
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.stopTunnel();
    void this.stopServer();
  }
}
