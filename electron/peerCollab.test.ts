// @vitest-environment node
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostSharingStatus } from "./types.js";

const e2ee = vi.hoisted(() => ({
  transport: null as null | {
    request: (...args: unknown[]) => Promise<unknown>;
    openSocket: (...args: unknown[]) => Promise<unknown>;
  },
  inviteKey: vi.fn(),
  rememberInviteKey: vi.fn(),
  request: vi.fn(),
  openSocket: vi.fn(),
}));

vi.mock("./cloudE2ee.js", () => ({
  CloudE2ee: vi.fn(function (this: unknown, _store: unknown, transport: never) {
    e2ee.transport = transport;
    return {
      inviteKey: e2ee.inviteKey,
      rememberInviteKey: e2ee.rememberInviteKey,
      request: e2ee.request,
      openSocket: e2ee.openSocket,
    };
  }),
}));

const tunnelDefaults = vi.hoisted(() => ({
  ensureCloudflared: vi.fn(async () => "/bin/default"),
  startQuickTunnel: vi.fn(async () => ({ url: "https://d.trycloudflare.com", stop: () => {} })),
  waitForTunnelDns: vi.fn(async () => undefined),
}));
vi.mock("./peerTunnel.js", () => tunnelDefaults);

const { PeerCollabService } = await import("./peerCollab.js");
const { decodePeerInvite, encodePeerInvite, localHostOrigin } = await import(
  "./peerInvite.js"
);
type Deps = ConstructorParameters<typeof PeerCollabService>[0];

const cloud = "https://collab.example";
const token = "tok_abcdefghijklmnop";
const key = "k".repeat(43);
const projectId = `project_${"a".repeat(32)}`;

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  exitCode: number | null = null;
  signalCode: string | null = null;
  exitOnKill = true;
  kill = vi.fn(() => {
    if (!this.exitOnKill) return;
    setImmediate(() => this.exit());
  });
  listen(port = 4321) {
    this.stdout.write(`{"level":"info","msg":"listening","port":${port}}\n`);
  }
  exit() {
    this.exitCode = 0;
    this.emit("exit");
  }
}

let root: string;
let children: FakeChild[];
let statuses: HostSharingStatus[];
let autoListen: boolean;

function healthy(body: unknown = { product: "LatexDo collaborations" }, ok = true) {
  return new Response(JSON.stringify(body), { status: ok ? 200 : 503 });
}

function make(overrides: Partial<Deps> = {}) {
  const deps: Deps = {
    dataDirectory: path.join(root, "data-dir"),
    serverEntryPath: "/server.mjs",
    spawnServer: vi.fn(() => {
      const child = new FakeChild();
      children.push(child);
      if (autoListen) setImmediate(() => child.listen(4000 + children.length));
      return child;
    }),
    fetchRemote: vi.fn(async () => healthy()) as unknown as typeof fetch,
    onStatusChange: (status) => statuses.push(status),
    networkInterfaces: () => ({
      en0: [
        { family: "IPv4", internal: false, address: "192.168.1.5" } as never,
        { family: "IPv4", internal: true, address: "127.0.0.1" } as never,
        { family: "IPv6", internal: false, address: "fe80::1" } as never,
        { family: "IPv4", internal: false, address: "169.254.3.3" } as never,
      ],
      lo: undefined,
    }),
    ensureTunnelBinary: vi.fn(async () => "/bin/cloudflared"),
    startTunnel: vi.fn(async () => ({ url: "https://abc.trycloudflare.com", stop: vi.fn() })),
    waitForTunnel: vi.fn(async () => undefined),
    cloudOrigin: `${cloud}/`,
    ...overrides,
  };
  return { service: new PeerCollabService(deps), deps };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "peer-collab-unit-"));
  children = [];
  statuses = [];
  autoListen = true;
  vi.clearAllMocks();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

describe("hosted server", () => {
  it("starts sharing on the local network with LAN addresses", async () => {
    const { service, deps } = make();
    const status = await service.startSharing("local");
    expect(status).toEqual({
      active: true,
      mode: "local",
      phase: "ready",
      addresses: ["http://192.168.1.5:4001"],
    });
    const env = (deps.spawnServer as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(env.LATEXDO_COLLAB_HOST).toBe("0.0.0.0");
    expect(env.LATEXDO_COLLAB_TRUST_PROXY).toBe("false");
    expect(service.invite(token)).toMatch(/^latexdo-invite:/);
    expect(decodePeerInvite(service.invite(token))?.addresses).toEqual([
      "http://192.168.1.5:4001",
    ]);
    // An invalid token cannot become an invite.
    expect(service.invite("x")).toBeNull();

    const stopped = await service.stopSharing();
    expect(stopped.phase).toBe("off");
    expect(children[0].kill).toHaveBeenCalled();
    expect(service.invite(token)).toBeNull();
  });

  it("fails without a network connection", async () => {
    const { service } = make({ networkInterfaces: () => ({}) });
    const status = await service.startSharing("local");
    expect(status.phase).toBe("failed");
    expect(status.message).toMatch(/not connected to a network/);
  });

  it("uses the operating system's interfaces by default", async () => {
    const spy = vi.spyOn(os, "networkInterfaces").mockReturnValue({});
    const { service } = make({ networkInterfaces: undefined });
    await service.startSharing("local");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("reports a server that exits before listening", async () => {
    autoListen = false;
    const { service } = make();
    const starting = service.startSharing("local");
    await vi.waitFor(() => expect(children).toHaveLength(1));
    children[0].exit();
    const status = await starting;
    expect(status.message).toBe("Sharing could not start on this computer.");
  });

  it("times out a server that never listens and ignores later output", async () => {
    vi.useFakeTimers();
    autoListen = false;
    const { service } = make();
    const starting = service.startSharing("local");
    await vi.waitFor(() => expect(children).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(20_000);
    const status = await starting;
    expect(status.message).toBe("Sharing could not start on this computer.");
    expect(children[0].kill).toHaveBeenCalled();
    // Output and exit after giving up change nothing.
    children[0].listen();
    children[0].emit("exit");
    expect(service.status().phase).toBe("failed");
  });

  it("reports a server that dies during a session", async () => {
    const { service } = make();
    await service.startSharing("local");
    children[0].exit();
    expect(service.status()).toMatchObject({
      phase: "failed",
      mode: "local",
      message: "Sharing stopped unexpectedly. Start sharing again.",
    });
  });

  it("stays off when a server dies after sharing stopped", async () => {
    const { service } = make();
    // A loopback server, started by a bridge request, survives stopSharing.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
    await service.request({
      origin: localHostOrigin,
      path: "/api/health",
      method: "get",
      headers: {},
      timeoutMs: 1,
    });
    await service.stopSharing();
    statuses.length = 0;
    children[0].exit();
    expect(statuses).toEqual([]);
    expect(service.status().phase).toBe("off");
  });

  it("ignores the exit of a server that was already replaced", async () => {
    const { service } = make();
    await service.startSharing("local");
    await service.startSharing("internet");
    expect(children).toHaveLength(2);
    expect(service.status().phase).toBe("ready");
    // The first child exited when it was stopped; a late duplicate does nothing.
    children[0].emit("exit");
    expect(service.status().phase).toBe("ready");
  });

  it("does not wait for a server that already exited, and gives up waiting after a while", async () => {
    const { service } = make();
    await service.startSharing("local");
    children[0].exitCode = 1;
    await service.stopSharing();
    expect(children[0].kill).not.toHaveBeenCalled();

    vi.useFakeTimers();
    const second = make();
    const starting = second.service.startSharing("local");
    await vi.waitFor(() => expect(children).toHaveLength(2));
    await vi.advanceTimersByTimeAsync(0);
    await starting;
    children[1].exitOnKill = false;
    const stopping = second.service.stopSharing();
    await vi.advanceTimersByTimeAsync(3_000);
    expect((await stopping).phase).toBe("off");
  });

  it("refuses to start once disposed", async () => {
    const { service } = make();
    await service.startSharing("local");
    service.dispose();
    statuses.length = 0;
    const status = await service.startSharing("local");
    expect(status.message).toBe("LatexDo is shutting down.");
    // Disposed services report nothing.
    expect(statuses).toEqual([]);
  });

  it("lets a newer start supersede an older local start", async () => {
    const { service } = make();
    const first = service.startSharing("local");
    const second = service.startSharing("local");
    await first;
    expect((await second).phase).toBe("ready");
    expect(children).toHaveLength(1);
  });
});

describe("internet sharing", () => {
  it("opens a tunnel and reports its address and download progress", async () => {
    const ensureTunnelBinary = vi.fn(async ({ onProgress }) => {
      onProgress(0.01);
      onProgress(0.02);
      onProgress(0.5);
      return "/bin/cloudflared";
    });
    const { service, deps } = make({ ensureTunnelBinary: ensureTunnelBinary as never });
    const status = await service.startSharing("internet");
    expect(status).toEqual({
      active: true,
      mode: "internet",
      phase: "ready",
      addresses: ["https://abc.trycloudflare.com"],
    });
    const env = (deps.spawnServer as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(env.LATEXDO_COLLAB_HOST).toBe("127.0.0.1");
    const messages = statuses.map((s) => s.message);
    expect(messages).toContain("Downloading the secure connection helper (one time)… 0%");
    expect(messages).toContain("Downloading the secure connection helper (one time)… 50%");
    expect(messages.filter((m) => m?.endsWith("… 0%"))).toHaveLength(1);
    expect(deps.waitForTunnel).toHaveBeenCalledWith("abc.trycloudflare.com", expect.anything());
  });

  it("uses the bundled tunnel helpers by default", async () => {
    const { service } = make({
      ensureTunnelBinary: undefined,
      startTunnel: undefined,
      waitForTunnel: undefined,
    });
    expect((await service.startSharing("internet")).addresses).toEqual([
      "https://d.trycloudflare.com",
    ]);
    expect(tunnelDefaults.ensureCloudflared).toHaveBeenCalled();
    expect(tunnelDefaults.startQuickTunnel).toHaveBeenCalledWith(
      expect.objectContaining({ binaryPath: "/bin/default", port: 4001 }),
    );
    expect(tunnelDefaults.waitForTunnelDns).toHaveBeenCalledWith(
      "d.trycloudflare.com",
      expect.anything(),
    );
  });

  it("fails when the tunnel exits, but not for an old tunnel", async () => {
    let onExit: ((detail: string) => void) | undefined;
    const startTunnel = vi.fn(async (options: { onExit: (d: string) => void }) => {
      onExit = options.onExit;
      return { url: "https://abc.trycloudflare.com", stop: vi.fn() };
    });
    const { service } = make({ startTunnel: startTunnel as never });
    await service.startSharing("internet");
    const oldExit = onExit!;
    await service.startSharing("internet");
    oldExit("Old.");
    expect(service.status().phase).toBe("ready");
    onExit!("The link dropped.");
    expect(service.status()).toMatchObject({
      phase: "failed",
      message: "The link dropped. Start sharing again to get a new invite.",
    });
  });

  it("bows out at each step when superseded", async () => {
    // During the server start.
    {
      const { service } = make();
      const first = service.startSharing("internet");
      const stopping = service.stopSharing();
      await first;
      await stopping;
      expect(service.status().phase).toBe("off");
      expect(statuses.some((s) => s.message === "Preparing a secure internet link…")).toBe(
        false,
      );
    }
    // During the helper download, including progress.
    {
      let release!: () => void;
      let progress!: (f: number) => void;
      const ensureTunnelBinary = vi.fn(
        ({ onProgress }: { onProgress: (f: number) => void }) =>
          new Promise<string>((resolve) => {
            progress = onProgress;
            release = () => resolve("/bin/x");
          }),
      );
      const { service, deps } = make({ ensureTunnelBinary: ensureTunnelBinary as never });
      const first = service.startSharing("internet");
      await vi.waitFor(() => expect(ensureTunnelBinary).toHaveBeenCalled());
      await service.stopSharing();
      statuses.length = 0;
      progress(0.9);
      release();
      await first;
      expect(statuses).toEqual([]);
      expect(deps.startTunnel).not.toHaveBeenCalled();
    }
    // While the tunnel starts.
    {
      const stop = vi.fn();
      let release!: () => void;
      const startTunnel = vi.fn(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ url: "https://t.example", stop });
          }),
      );
      const { service } = make({ startTunnel: startTunnel as never });
      const first = service.startSharing("internet");
      await vi.waitFor(() => expect(startTunnel).toHaveBeenCalled());
      await service.stopSharing();
      release();
      await first;
      expect(stop).toHaveBeenCalled();
    }
    // While waiting for the address.
    {
      let release!: () => void;
      const waitForTunnel = vi.fn(
        () => new Promise<void>((resolve) => (release = resolve)),
      );
      const { service } = make({ waitForTunnel: waitForTunnel as never });
      const first = service.startSharing("internet");
      await vi.waitFor(() => expect(waitForTunnel).toHaveBeenCalled());
      await service.stopSharing();
      release();
      expect((await first).phase).toBe("off");
    }
  });

  it("reports errors, with a fallback message, unless superseded", async () => {
    const { service } = make({
      ensureTunnelBinary: vi.fn(async () => {
        throw "no";
      }) as never,
    });
    expect((await service.startSharing("internet")).message).toBe("Sharing could not start.");

    let reject!: (e: Error) => void;
    const second = make({
      waitForTunnel: vi.fn(() => new Promise<void>((_, r) => (reject = r))) as never,
    });
    const first = second.service.startSharing("internet");
    await vi.waitFor(() => expect(second.deps.waitForTunnel).toHaveBeenCalled());
    await second.service.stopSharing();
    reject(new Error("late failure"));
    expect((await first).phase).toBe("off");
  });
});

describe("cloud invites", () => {
  it("builds invites with the project key", async () => {
    const { service } = make();
    expect(service.cloudOrigin).toBe(cloud);
    e2ee.inviteKey.mockResolvedValueOnce(key);
    const invite = await service.cloudInvite(token);
    expect(decodePeerInvite(invite)).toEqual({ token, addresses: [cloud], key });
    e2ee.inviteKey.mockResolvedValueOnce(null);
    expect(await service.cloudInvite(token)).toBeNull();
    e2ee.inviteKey.mockResolvedValueOnce("bad key");
    expect(await service.cloudInvite(token)).toBeNull();
  });

  it("has no cloud invites without a cloud server", async () => {
    const { service } = make({ cloudOrigin: undefined });
    expect(service.cloudOrigin).toBeNull();
    expect(await service.cloudInvite(token)).toBeNull();
  });

  it("routes the encryption layer's traffic to the cloud server", async () => {
    const fetchRemote = vi.fn(async () => new Response("ok", { status: 201, statusText: "Created" }));
    const { service } = make({ fetchRemote: fetchRemote as never });
    e2ee.inviteKey.mockResolvedValueOnce(null);
    await service.cloudInvite(token);
    const response = await e2ee.transport!.request("/api/projects", "POST", {}, "{}", 1000);
    expect(response).toEqual({ status: 201, statusText: "Created", text: "ok" });
    expect(fetchRemote).toHaveBeenCalledWith(`${cloud}/api/projects`, expect.anything());

    const sockets: FakeWebSocket[] = [];
    vi.stubGlobal("WebSocket", fakeWebSocketClass(sockets));
    await e2ee.transport!.openSocket("/api/projects/x/files/collaborate?a=1", handlers());
    expect(sockets[0].url.toString()).toBe(`wss://collab.example/api/projects/x/files/collaborate?a=1`);
  });
});

describe("invites from other computers", () => {
  const invite = (addresses: string[], withKey?: string) =>
    encodePeerInvite({ token, addresses, key: withKey });

  it("rejects invalid invites", async () => {
    const { service } = make();
    await expect(service.resolveInvite("nonsense")).rejects.toThrow(/not a valid invite/);
  });

  it("joins the first host that answers and remembers it", async () => {
    const fetchRemote = vi.fn(async (url: string) =>
      url.startsWith("http://10.0.0.1") ? healthy({ product: "other" }) : healthy(),
    );
    const { service } = make({ fetchRemote: fetchRemote as never });
    const result = await service.resolveInvite(
      invite(["http://10.0.0.1:1", "http://10.0.0.2:2"]),
    );
    expect(result).toEqual({ origin: "http://10.0.0.2:2", token });
    const stored = JSON.parse(
      await readFile(path.join(root, "data-dir", "peers.json"), "utf8"),
    );
    expect(stored).toEqual(["http://10.0.0.2:2"]);

    // The joined host can now be used through the bridge.
    fetchRemote.mockResolvedValueOnce(new Response("{}"));
    expect(
      (
        await service.request({
          origin: "http://10.0.0.2:2/",
          path: "/api/projects",
          method: "GET",
          headers: {},
          timeoutMs: 5,
        })
      ).status,
    ).toBe(200);
  });

  it("keeps only the most recent peers", async () => {
    await mkdir(path.join(root, "data-dir"), { recursive: true });
    const many = Array.from({ length: 200 }, (_, i) => `http://10.1.${Math.floor(i / 250)}.${i}:1`);
    await writeFile(
      path.join(root, "data-dir", "peers.json"),
      JSON.stringify([...many, "not a url"]),
    );
    const { service } = make();
    await service.resolveInvite(invite(["http://10.9.9.9:9"]));
    const stored = JSON.parse(
      await readFile(path.join(root, "data-dir", "peers.json"), "utf8"),
    ) as string[];
    expect(stored).toHaveLength(200);
    expect(stored[0]).toBe(many[1]);
    expect(stored.at(-1)).toBe("http://10.9.9.9:9");
  });

  it("ignores a peers file that is not a list", async () => {
    await mkdir(path.join(root, "data-dir"), { recursive: true });
    await writeFile(path.join(root, "data-dir", "peers.json"), '{"a":1}');
    const { service } = make();
    await service.resolveInvite(invite(["http://10.0.0.3:3"]));
    expect(
      JSON.parse(await readFile(path.join(root, "data-dir", "peers.json"), "utf8")),
    ).toEqual(["http://10.0.0.3:3"]);
  });

  it("stores the key for the cloud server, and needs one", async () => {
    const { service } = make();
    expect(await service.resolveInvite(invite([cloud], key))).toEqual({
      origin: cloud,
      token,
    });
    expect(e2ee.rememberInviteKey).toHaveBeenCalledWith(token, key);
    await expect(service.resolveInvite(invite([cloud]))).rejects.toThrow(/incomplete/);
  });

  it("retries once, then explains why the host could not be reached", async () => {
    vi.useFakeTimers();
    const fetchRemote = vi.fn(async (url: string) => {
      if (url.includes("down")) throw new Error("ECONNREFUSED");
      if (url.includes("sick")) return healthy({}, false);
      return new Response("x".repeat(5000));
    });
    const { service } = make({ fetchRemote: fetchRemote as never });
    const local = service.resolveInvite(invite(["http://down.local:1", "http://sick.local:2"]));
    const localCheck = expect(local).rejects.toThrow(/same network/);
    await vi.advanceTimersByTimeAsync(2_000);
    await localCheck;
    expect(fetchRemote).toHaveBeenCalledTimes(4);

    const remote = service.resolveInvite(invite(["https://big.example"]));
    const remoteCheck = expect(remote).rejects.toThrow(
      "Could not reach the host. Make sure LatexDo is still open and sharing on their computer.",
    );
    await vi.advanceTimersByTimeAsync(2_000);
    await remoteCheck;
  });
});

describe("network bridge", () => {
  const base = { origin: localHostOrigin, path: "/api/health", method: "GET", headers: {}, timeoutMs: 10 };

  it("rejects invalid requests", async () => {
    const { service } = make();
    for (const bad of [
      { method: "PATCH" },
      { path: "/etc/passwd" },
      { path: `/api/health?${"a".repeat(4100)}` },
      { path: "/api/health\\x" },
    ]) {
      await expect(service.request({ ...base, ...bad })).rejects.toThrow(
        "Invalid collaboration request.",
      );
    }
    await expect(
      service.request({ ...base, method: "POST", body: "a".repeat(96 * 1024 * 1024 + 1) }),
    ).rejects.toThrow("The collaboration request is too large.");
  });

  it("talks to the local server with its host key and only safe headers", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const { service } = make();
    const response = await service.request({
      ...base,
      method: "post",
      path: "/api/projects",
      body: "{}",
      headers: {
        "Content-Type": "application/json",
        "X-LatexDo-Session": "s",
        "x-latexdo-host-key": "forged",
        "x-latexdo-long": "a".repeat(2000),
        "x-latexdo-crlf": "a\r\nb",
        cookie: "secret",
        "x-latexdo-number": 5 as never,
      },
    });
    expect(response).toEqual({ status: 204, statusText: "", text: "" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:4001/api/projects");
    const headers = init.headers as Record<string, string>;
    expect(Object.keys(headers).sort()).toEqual([
      "content-type",
      "x-latexdo-host-key",
      "x-latexdo-session",
    ]);
    expect(headers["x-latexdo-host-key"]).not.toBe("forged");
    expect(init.body).toBe("{}");

    // GET never carries a body.
    await service.request({ ...base, body: "ignored" });
    expect((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body).toBeUndefined();

    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(service.request(base)).rejects.toThrow(
      "Sharing is not running on this computer. Try again.",
    );
  });

  it("explains failures reaching another computer", async () => {
    const fetchRemote = vi.fn(async () => healthy());
    const { service } = make({ fetchRemote: fetchRemote as never });
    await service.resolveInvite(encodePeerInvite({ token, addresses: ["http://10.0.0.7:7"] }));
    const request = { ...base, origin: "http://10.0.0.7:7" };
    const timeout = new Error("slow");
    timeout.name = "TimeoutError";
    fetchRemote.mockRejectedValueOnce(timeout);
    await expect(service.request(request)).rejects.toThrow(/did not answer in time/);
    fetchRemote.mockRejectedValueOnce("weird");
    await expect(service.request(request)).rejects.toThrow(/may have stopped sharing/);
  });

  it("refuses hosts that were never joined", async () => {
    const { service } = make();
    await expect(service.request({ ...base, origin: "http://10.0.0.8:8" })).rejects.toThrow(
      /has not been joined/,
    );
    await expect(service.request({ ...base, origin: "ftp://x" })).rejects.toThrow(
      /has not been joined/,
    );
  });

  it("sends cloud traffic through the encryption layer", async () => {
    const { service } = make();
    e2ee.request.mockResolvedValue({ status: 200, statusText: "OK", text: "{}" });
    expect(await service.request({ ...base, origin: cloud, timeoutMs: 999_999 })).toEqual({
      status: 200,
      statusText: "OK",
      text: "{}",
    });
    expect(e2ee.request).toHaveBeenCalledWith("/api/health", "GET", {}, undefined, 120_000);

    e2ee.openSocket.mockResolvedValue("sealed-socket");
    expect(
      await service.openSocket(cloud, "/api/projects/p/files/collaborate?x=1", handlers()),
    ).toBe("sealed-socket");
  });
});

interface FakeWebSocket {
  url: URL;
  binaryType: string;
  readyState: number;
  sent: unknown[];
  listeners: Record<string, Array<(event: unknown) => void>>;
  emit: (type: string, event?: unknown) => void;
  close: ReturnType<typeof vi.fn>;
  send: (data: unknown) => void;
  addEventListener: (type: string, listener: (event: unknown) => void) => void;
}

function fakeWebSocketClass(sockets: FakeWebSocket[]) {
  return class {
    static OPEN = 1;
    static CLOSED = 3;
    binaryType = "";
    readyState = 0;
    sent: unknown[] = [];
    listeners: Record<string, Array<(event: unknown) => void>> = {};
    close = vi.fn();
    constructor(readonly url: URL) {
      sockets.push(this as unknown as FakeWebSocket);
    }
    addEventListener(type: string, listener: (event: unknown) => void) {
      (this.listeners[type] ??= []).push(listener);
    }
    emit(type: string, event?: unknown) {
      for (const listener of this.listeners[type] ?? []) listener(event);
    }
    send(data: unknown) {
      this.sent.push(data);
    }
  };
}

function handlers() {
  return { onOpen: vi.fn(), onMessage: vi.fn(), onClose: vi.fn(), onError: vi.fn() };
}

describe("collaboration sockets", () => {
  it("rejects invalid socket paths", async () => {
    const { service } = make();
    for (const bad of [
      "/api/health",
      `/api/projects/p/files/collaborate?${"a".repeat(4100)}`,
      "/api/projects/p/files/collaborate?a b",
    ]) {
      await expect(service.openSocket(localHostOrigin, bad, handlers())).rejects.toThrow(
        "Invalid collaboration socket request.",
      );
    }
  });

  it("bridges a local socket's events and sends", async () => {
    const sockets: FakeWebSocket[] = [];
    vi.stubGlobal("WebSocket", fakeWebSocketClass(sockets));
    const { service } = make();
    const events = handlers();
    const socket = await service.openSocket(
      localHostOrigin,
      "/api/projects/p/files/collaborate?path=a",
      events,
    );
    const raw = sockets[0];
    expect(raw.url.toString()).toBe("ws://127.0.0.1:4001/api/projects/p/files/collaborate?path=a");
    expect(raw.binaryType).toBe("arraybuffer");

    raw.emit("open");
    expect(events.onOpen).toHaveBeenCalled();
    raw.emit("message", { data: new Uint8Array([1, 2]).buffer });
    raw.emit("message", { data: "text" });
    raw.emit("message", { data: { byteLength: 1e9 } });
    expect(events.onMessage).toHaveBeenCalledTimes(1);
    expect(events.onMessage).toHaveBeenCalledWith(new Uint8Array([1, 2]));
    raw.emit("error");
    expect(events.onError).toHaveBeenCalled();

    socket.send(new Uint8Array([1]));
    expect(raw.sent).toEqual([]);
    raw.readyState = 1;
    socket.send(new Uint8Array([2]));
    socket.send({ byteLength: 1e9 } as Uint8Array);
    expect(raw.sent).toEqual([new Uint8Array([2])]);

    socket.close(4000, "bye");
    expect(raw.close).toHaveBeenCalledWith(4000, "bye");
    raw.close.mockImplementationOnce(() => {
      throw new Error("invalid code");
    });
    socket.close(1, "bad");
    expect(raw.close).toHaveBeenLastCalledWith();
    raw.readyState = 3;
    raw.close.mockClear();
    socket.close();
    expect(raw.close).not.toHaveBeenCalled();

    raw.emit("close", { code: 1000, reason: "done" });
    raw.emit("close", { code: 1001, reason: "again" });
    expect(events.onClose).toHaveBeenCalledTimes(1);
    expect(events.onClose).toHaveBeenCalledWith(1000, "done");
  });
});

describe("hosted projects", () => {
  const hostedFile = () => path.join(root, "data-dir", "hosted-projects.json");

  it("validates, registers, finds and forgets hosted projects", async () => {
    const { service } = make();
    await expect(service.registerHostedProject("nope", "/x", "n")).rejects.toThrow(
      "Invalid hosted project.",
    );
    await expect(service.registerHostedProject(projectId, "relative", "n")).rejects.toThrow(
      "Invalid hosted project.",
    );
    await expect(service.forgetHostedProject("nope")).rejects.toThrow("Invalid hosted project.");

    const folder = path.join(root, "paper");
    await service.registerHostedProject(projectId, folder, "Paper");
    expect(await service.hostedProject(projectId)).toEqual({ localRoot: folder, name: "Paper" });
    expect(await service.hostedProject("toString")).toBeNull();

    // A fresh service reads it back from disk.
    const again = make().service;
    expect(await again.hostedProject(projectId)).toEqual({ localRoot: folder, name: "Paper" });

    const copy = path.join(root, "data-dir", "data", "projects", projectId);
    await mkdir(copy, { recursive: true });
    await again.forgetHostedProject(projectId);
    expect(await again.hostedProject(projectId)).toBeNull();
    await expect(readFile(path.join(copy, "x"))).rejects.toThrow();
    expect(JSON.parse(await readFile(hostedFile(), "utf8"))).toEqual({});
    // Forgetting an unknown project is harmless.
    await again.forgetHostedProject(`project_${"b".repeat(32)}`);
  });

  it("keeps only valid entries from the stored file", async () => {
    await mkdir(path.join(root, "data-dir"), { recursive: true });
    await writeFile(
      hostedFile(),
      JSON.stringify({
        [projectId]: { localRoot: "/abs", name: 5 },
        project_bad: { localRoot: "/abs" },
        [`project_${"c".repeat(32)}`]: null,
        [`project_${"d".repeat(32)}`]: { localRoot: "rel" },
        [`project_${"e".repeat(32)}`]: { localRoot: 7 },
      }),
    );
    const { service } = make();
    expect(await service.hostedProject(projectId)).toEqual({ localRoot: "/abs", name: "" });
    expect(await service.hostedProject(`project_${"c".repeat(32)}`)).toBeNull();
    expect(await service.hostedProject(`project_${"d".repeat(32)}`)).toBeNull();
  });

  it("ignores a stored file that is a list", async () => {
    await mkdir(path.join(root, "data-dir"), { recursive: true });
    await writeFile(hostedFile(), "[]");
    expect(await make().service.hostedProject(projectId)).toBeNull();
  });

  it("refuses to save projects that were not shared from a folder", async () => {
    const { service } = make();
    await expect(service.saveHostedProject(projectId)).rejects.toThrow(/not shared from a folder/);
    await expect(service.saveFilesToHostedFolder(projectId, [])).rejects.toThrow(
      /not shared from a folder/,
    );
  });

  it("copies the shared copy back into its folder safely", async () => {
    const { service } = make();
    const folder = path.join(root, "paper");
    await mkdir(folder);
    await service.registerHostedProject(projectId, folder, "Paper");
    const files = path.join(root, "data-dir", "data", "projects", projectId, "files");
    await mkdir(path.join(files, "chapters", "deep"), { recursive: true });
    await writeFile(path.join(files, "main.tex"), "main");
    await writeFile(path.join(files, "chapters", "deep", "a.tex"), "a");
    // Links in the shared copy are skipped.
    await symlink(path.join(files, "main.tex"), path.join(files, "link.tex"));
    expect(await service.saveHostedProject(projectId)).toEqual({ folder, written: 2 });
    expect(await readFile(path.join(folder, "chapters", "deep", "a.tex"), "utf8")).toBe("a");
    // Unchanged files are not rewritten.
    expect((await service.saveHostedProject(projectId)).written).toBe(0);
  });

  it("never writes through links, over folders, or outside the folder", async () => {
    const { service } = make();
    const folder = path.join(root, "paper");
    const outside = path.join(root, "outside");
    await mkdir(folder);
    await mkdir(outside);
    await service.registerHostedProject(projectId, folder, "Paper");
    await symlink(outside, path.join(folder, "linked"));
    await writeFile(path.join(folder, "plain"), "file");
    await mkdir(path.join(folder, "dir"));
    await symlink(path.join(outside, "t"), path.join(folder, "link.tex"));
    await writeFile(path.join(folder, "old.tex"), "old");

    const bytes = (text: string) => Buffer.from(text);
    const result = await service.saveFilesToHostedFolder(projectId, [
      { relativePath: "../escape.tex", bytes: bytes("x") },
      { relativePath: ".git/config", bytes: bytes("x") },
      { relativePath: "linked/a.tex", bytes: bytes("x") },
      { relativePath: "plain/a.tex", bytes: bytes("x") },
      { relativePath: "dir", bytes: bytes("x") },
      { relativePath: "link.tex", bytes: bytes("x") },
      { relativePath: "old.tex", bytes: bytes("new") },
    ]);
    expect(result).toEqual({ folder, written: 1 });
    expect(await readFile(path.join(folder, "old.tex"), "utf8")).toBe("new");
    await expect(readFile(path.join(outside, "a.tex"))).rejects.toThrow();
  });

  it("refuses a folder that no longer exists", async () => {
    const { service } = make();
    const folder = path.join(root, "gone");
    await service.registerHostedProject(projectId, folder, "Gone");
    await expect(service.saveFilesToHostedFolder(projectId, [])).rejects.toThrow(
      `The original folder no longer exists: ${folder}`,
    );
  });
});
