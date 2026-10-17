// @vitest-environment node
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PeerCollabService, type PeerCollabDeps } from "./peerCollab.js";
import { decodePeerInvite, localHostOrigin } from "./peerInvite.js";
import type { HostSharingStatus } from "./types.js";

// Nothing here is mocked except the network interface list and, for the
// internet mode, the tunnel helper: the collaboration server is the real one in
// a real child process, reached over real HTTP and WebSocket connections.

const serverEntryPath = path.resolve("collaborations/server.mjs");
const realTunnel = process.env.LATEXDO_E2E_TUNNEL === "1";
// Talks to LatexDo's always-on server (or LATEXDO_COLLAB_URL): opt in with
// LATEXDO_E2E_CLOUD=1, since it needs the internet.
const realCloud = process.env.LATEXDO_E2E_CLOUD === "1";
const cloudOrigin = process.env.LATEXDO_COLLAB_URL || "https://collab.latexdo.org";

type Identity = { session: string; client: string; name: string };
const owner: Identity = { session: "owner-session", client: "owner", name: "Omar" };
const guest: Identity = { session: "guest-session", client: "guest", name: "Ada" };
const stranger: Identity = { session: "late-session", client: "late", name: "Eve" };

let root: string;
const services: PeerCollabService[] = [];

function createService(
  name: string,
  overrides: Partial<PeerCollabDeps> = {},
): { service: PeerCollabService; statuses: HostSharingStatus[] } {
  const statuses: HostSharingStatus[] = [];
  const service = new PeerCollabService({
    dataDirectory: path.join(root, name),
    serverEntryPath,
    spawnServer: (entryPath, env) =>
      spawn(process.execPath, [entryPath], {
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "inherit"],
      }),
    fetchRemote: fetch,
    onStatusChange: (status) => statuses.push(status),
    // Stand in for a LAN address with one that always exists on the test host.
    networkInterfaces: () => ({
      test0: [
        {
          address: "127.0.0.1",
          netmask: "255.0.0.0",
          family: "IPv4",
          mac: "00:00:00:00:00:00",
          internal: false,
          cidr: "127.0.0.1/8",
        },
      ],
    }),
    ...overrides,
  });
  services.push(service);
  return { service, statuses };
}

function headers(identity: Identity, token?: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-latexdo-session": identity.session,
    "x-latexdo-client": identity.client,
    "x-latexdo-client-name": identity.name,
    ...(token ? { "x-latexdo-share-token": token } : {}),
  };
}

async function call(
  service: PeerCollabService,
  origin: string,
  identity: Identity,
  method: string,
  route: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await service.request({
    origin,
    path: route,
    method,
    headers: headers(identity, token),
    body: body === undefined ? undefined : JSON.stringify(body),
    timeoutMs: 10_000,
  });
  return {
    status: response.status,
    body: response.text ? (JSON.parse(response.text) as Record<string, unknown>) : {},
  };
}

/** A minimal Yjs peer speaking the collaboration protocol over the bridge. */
async function joinDocument(
  service: PeerCollabService,
  origin: string,
  identity: Identity,
  projectId: string,
  token: string,
) {
  const doc = new Y.Doc();
  const text = doc.getText("content");
  const query = new URLSearchParams({
    path: "main.tex",
    session: identity.session,
    clientId: identity.client,
    name: identity.name,
    share: token,
  });
  let closeCode: number | null = null;
  let resolveSynced!: () => void;
  const synced = new Promise<void>((resolve) => (resolveSynced = resolve));
  const socket = await service.openSocket(
    origin,
    `/api/projects/${projectId}/files/collaborate?${query.toString()}`,
    {
      onOpen: () => {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0);
        syncProtocol.writeSyncStep1(encoder, doc);
        socket.send(encoding.toUint8Array(encoder));
      },
      onMessage: (data) => {
        const decoder = decoding.createDecoder(data);
        if (decoding.readVarUint(decoder) !== 0) return;
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0);
        const type = syncProtocol.readSyncMessage(decoder, encoder, doc, "remote");
        if (encoding.length(encoder) > 1) socket.send(encoding.toUint8Array(encoder));
        // The server's reply to our step 1 carries the document.
        if (type === syncProtocol.messageYjsSyncStep2) resolveSynced();
      },
      onError: () => undefined,
      onClose: (code) => {
        closeCode = code;
      },
    },
  );
  doc.on("update", (update: Uint8Array, updateOrigin: unknown) => {
    if (updateOrigin === "remote") return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeUpdate(encoder, update);
    socket.send(encoding.toUint8Array(encoder));
  });
  await synced;
  return { text, socket, closeCode: () => closeCode };
}

async function until(condition: () => boolean | Promise<boolean>, label: string) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "latexdo-peer-test-"));
});

afterAll(async () => {
  for (const service of services) service.dispose();
  await new Promise((resolve) => setTimeout(resolve, 150));
  await rm(root, { recursive: true, force: true });
});

describe("hosting a project from this computer", () => {
  it("lets two computers edit together and lets the owner control access", async () => {
    const host = createService("host");
    const visitor = createService("visitor");

    const started = await host.service.startSharing("local");
    expect(started).toMatchObject({ active: true, mode: "local", phase: "ready" });
    expect(started.addresses).toHaveLength(1);

    // The owner creates and shares a project on their own computer.
    const created = await call(
      host.service,
      localHostOrigin,
      owner,
      "POST",
      "/api/projects",
      { folderName: "Thesis" },
    );
    expect(created.status).toBe(200);
    const projectId = created.body.id as string;
    await call(
      host.service,
      localHostOrigin,
      owner,
      "PUT",
      `/api/projects/${projectId}/files/content?path=main.tex`,
      { content: "Hello" },
    );
    const share = await call(
      host.service,
      localHostOrigin,
      owner,
      "POST",
      `/api/projects/${projectId}/share`,
      {},
    );
    const token = share.body.token as string;
    const invite = host.service.invite(token);
    expect(decodePeerInvite(invite)).toEqual({ token, addresses: started.addresses });

    // The guest only has the invite text.
    await expect(
      visitor.service.request({
        origin: started.addresses[0],
        path: "/api/health",
        method: "GET",
        headers: {},
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow("has not been joined");
    const resolved = await visitor.service.resolveInvite(`  ${invite}\n`);
    expect(resolved).toEqual({ origin: started.addresses[0], token });
    const opened = await call(
      visitor.service,
      resolved.origin,
      guest,
      "POST",
      `/api/shares/${token}/open`,
      {},
      token,
    );
    expect(opened.status).toBe(200);
    expect(opened.body.project).toMatchObject({ id: projectId, name: "Thesis" });

    // A guest can never create projects on the host's computer.
    expect(
      (
        await call(visitor.service, resolved.origin, guest, "POST", "/api/projects", {
          folderName: "Squatter",
        })
      ).status,
    ).toBe(403);

    // Live editing in both directions, through the bridge.
    const hostDocument = await joinDocument(
      host.service,
      localHostOrigin,
      owner,
      projectId,
      token,
    );
    const guestDocument = await joinDocument(
      visitor.service,
      resolved.origin,
      guest,
      projectId,
      token,
    );
    expect(guestDocument.text.toString()).toBe("Hello");
    guestDocument.text.insert(5, " from Ada");
    await until(
      () => hostDocument.text.toString() === "Hello from Ada",
      "the host to receive the guest's edit",
    );
    hostDocument.text.insert(0, "% Omar\n");
    await until(
      () => guestDocument.text.toString() === "% Omar\nHello from Ada",
      "the guest to receive the host's edit",
    );

    // The owner turns on approval: a newcomer waits until they are let in.
    const approval = await call(
      host.service,
      localHostOrigin,
      owner,
      "PUT",
      `/api/shares/${token}/approval`,
      { requireApproval: true },
      token,
    );
    expect(approval.body.requireApproval).toBe(true);
    const knock = await call(
      visitor.service,
      resolved.origin,
      stranger,
      "POST",
      `/api/shares/${token}/open`,
      {},
      token,
    );
    expect(knock).toMatchObject({ status: 403, body: { code: "approval-pending" } });
    const waiting = await call(
      host.service,
      localHostOrigin,
      owner,
      "GET",
      `/api/shares/${token}/permissions`,
      undefined,
      token,
    );
    expect(waiting.body.pending).toEqual([
      expect.objectContaining({ clientId: "late", name: "Eve" }),
    ]);
    await call(
      host.service,
      localHostOrigin,
      owner,
      "POST",
      `/api/shares/${token}/pending/late`,
      { action: "approve" },
      token,
    );
    expect(
      (
        await call(
          visitor.service,
          resolved.origin,
          stranger,
          "POST",
          `/api/shares/${token}/open`,
          {},
          token,
        )
      ).status,
    ).toBe(200);

    // Removing someone disconnects them and retires the invite they hold.
    expect(
      (
        await call(
          host.service,
          localHostOrigin,
          owner,
          "DELETE",
          `/api/shares/${token}/collaborators/guest`,
          undefined,
          token,
        )
      ).status,
    ).toBe(204);
    await until(() => guestDocument.closeCode() === 1008, "the removed guest to drop");
    expect(
      await call(
        visitor.service,
        resolved.origin,
        guest,
        "POST",
        `/api/shares/${token}/open`,
        {},
        token,
      ),
    ).toMatchObject({ status: 403, body: { code: "access-removed" } });
    expect(
      await call(
        visitor.service,
        resolved.origin,
        { session: "fresh-session", client: "fresh", name: "Ada again" },
        "POST",
        `/api/shares/${token}/open`,
        {},
        token,
      ),
    ).toMatchObject({ status: 403, body: { code: "invite-expired" } });
    // People who were already in keep working with the invite they joined by.
    const stillIn = await call(
      visitor.service,
      resolved.origin,
      stranger,
      "POST",
      `/api/shares/${token}/presence`,
      { currentFile: "main.tex" },
      token,
    );
    expect(stillIn.status).toBe(200);
    expect(stillIn.body.token).not.toBe(token);

    // The shared edits are written back to the folder the project came from.
    const folder = path.join(root, "thesis-folder");
    const outside = path.join(root, "outside");
    await mkdir(folder, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(folder, "main.tex"), "Hello");
    await writeFile(path.join(folder, "notes.txt"), "kept");
    await host.service.registerHostedProject(projectId, folder, "Thesis");
    await call(
      host.service,
      localHostOrigin,
      owner,
      "PUT",
      `/api/projects/${projectId}/files/content?path=linked/escape.tex`,
      { content: "must not leave the folder" },
    );
    await symlink(outside, path.join(folder, "linked"));
    await until(
      async () =>
        (await readFile(
          path.join(root, "host/data/projects", projectId, "files/main.tex"),
          "utf8",
        )) === "% Omar\nHello from Ada",
      "the server to persist the live document",
    );
    expect(await host.service.saveHostedProject(projectId)).toEqual({
      folder,
      written: 1,
    });
    expect(await readFile(path.join(folder, "main.tex"), "utf8")).toBe(
      "% Omar\nHello from Ada",
    );
    expect(await readFile(path.join(folder, "notes.txt"), "utf8")).toBe("kept");
    await expect(readFile(path.join(outside, "escape.tex"), "utf8")).rejects.toThrow();

    // Stopping ends access for everyone but the owner.
    const stopped = await call(
      host.service,
      localHostOrigin,
      owner,
      "DELETE",
      `/api/projects/${projectId}/share`,
    );
    expect(stopped.body.enabled).toBe(false);
    expect(
      await call(
        visitor.service,
        resolved.origin,
        stranger,
        "GET",
        `/api/projects/${projectId}/files`,
      ),
    ).toMatchObject({ status: 403, body: { code: "sharing-stopped" } });
    expect((await host.service.stopSharing()).phase).toBe("off");
    expect(host.service.invite(token)).toBeNull();
    await expect(
      call(visitor.service, resolved.origin, stranger, "GET", "/api/health"),
    ).rejects.toThrow("Could not reach the host");
    // The owner keeps private access to the shared copy on this computer.
    const privateRead = await call(
      host.service,
      localHostOrigin,
      owner,
      "GET",
      `/api/projects/${projectId}/files/content?path=main.tex`,
    );
    expect(privateRead.body.content).toBe("% Omar\nHello from Ada");
    hostDocument.socket.close();
  }, 40_000);

  it("shares and live-edits a file larger than the cloud limits", async () => {
    const host = createService("host-large");
    const visitor = createService("visitor-large");
    const started = await host.service.startSharing("local");

    const created = await call(
      host.service,
      localHostOrigin,
      owner,
      "POST",
      "/api/projects",
      { folderName: "Large" },
    );
    const projectId = created.body.id as string;
    // A 4 MB bibliography, full of characters that JSON escapes.
    const entry = '@article{key,\n  title = {A "quoted" \\emph{title}},\n}\n';
    const content = entry.repeat(Math.ceil((4 * 1024 * 1024) / entry.length));
    const stored = await call(
      host.service,
      localHostOrigin,
      owner,
      "PUT",
      `/api/projects/${projectId}/files/content?path=main.tex`,
      { content },
    );
    expect(stored.status).toBe(204);
    const share = await call(
      host.service,
      localHostOrigin,
      owner,
      "POST",
      `/api/projects/${projectId}/share`,
      {},
    );
    const token = share.body.token as string;
    const resolved = await visitor.service.resolveInvite(host.service.invite(token)!);
    await call(
      visitor.service,
      resolved.origin,
      guest,
      "POST",
      `/api/shares/${token}/open`,
      {},
      token,
    );

    const guestDocument = await joinDocument(
      visitor.service,
      resolved.origin,
      guest,
      projectId,
      token,
    );
    expect(guestDocument.text.length).toBe(content.length);
    expect(started.active).toBe(true);
    guestDocument.socket.close(1000, "done");
  });

  it("rejects invites that do not lead to a LatexDo host and unsafe bridge requests", async () => {
    const { service } = createService("careful");
    await expect(service.resolveInvite("not an invite")).rejects.toThrow(
      "not a valid invite",
    );
    await expect(
      service.request({
        origin: localHostOrigin,
        path: "/etc/passwd",
        method: "GET",
        headers: {},
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow("Invalid collaboration request");
    await expect(
      service.openSocket(localHostOrigin, "/api/health?x=1", {
        onOpen: () => undefined,
        onMessage: () => undefined,
        onError: () => undefined,
        onClose: () => undefined,
      }),
    ).rejects.toThrow("Invalid collaboration socket request");
    await expect(
      service.registerHostedProject("../escape", "/tmp", "x"),
    ).rejects.toThrow("Invalid hosted project");
  });

  it("reports the internet link through its start, failure and loss", async () => {
    let lose: ((detail: string) => void) | undefined;
    let tunnelPort = 0;
    const { service, statuses } = createService("internet", {
      ensureTunnelBinary: async (options) => {
        options.onProgress?.(0.5);
        return "/unused/cloudflared";
      },
      startTunnel: async (options) => {
        tunnelPort = options.port;
        lose = options.onExit;
        return { url: "https://calm-green-river.trycloudflare.com", stop: () => {} };
      },
      waitForTunnel: async () => true,
    });
    const ready = await service.startSharing("internet");
    expect(ready).toEqual({
      active: true,
      mode: "internet",
      phase: "ready",
      addresses: ["https://calm-green-river.trycloudflare.com"],
    });
    expect(tunnelPort).toBeGreaterThan(0);
    expect(statuses.map((status) => status.message)).toContain(
      "Downloading the secure connection helper (one time)… 50%",
    );
    lose?.("The internet link was lost.");
    expect(service.status()).toMatchObject({ active: false, phase: "failed" });

    const failing = createService("internet-failing", {
      ensureTunnelBinary: async () => {
        throw new Error("The secure connection helper failed its integrity check.");
      },
    });
    expect(await failing.service.startSharing("internet")).toMatchObject({
      active: false,
      phase: "failed",
      message: "The secure connection helper failed its integrity check.",
    });
  }, 30_000);

  it.runIf(realTunnel)(
    "reaches a hosted project from the internet through a real tunnel",
    async () => {
      const host = createService("tunnel-host", { networkInterfaces: undefined });
      const visitor = createService("tunnel-visitor");
      const started = await host.service.startSharing("internet");
      expect(started).toMatchObject({ active: true, phase: "ready" });
      const created = await call(
        host.service,
        localHostOrigin,
        owner,
        "POST",
        "/api/projects",
        { folderName: "Over the internet" },
      );
      const projectId = created.body.id as string;
      await call(
        host.service,
        localHostOrigin,
        owner,
        "PUT",
        `/api/projects/${projectId}/files/content?path=main.tex`,
        { content: "Hello" },
      );
      const share = await call(
        host.service,
        localHostOrigin,
        owner,
        "POST",
        `/api/projects/${projectId}/share`,
        {},
      );
      const token = share.body.token as string;
      const resolved = await visitor.service.resolveInvite(
        host.service.invite(token) ?? "",
      );
      expect(resolved.origin).toMatch(/^https:\/\/.+\.trycloudflare\.com$/);
      const hostDocument = await joinDocument(
        host.service,
        localHostOrigin,
        owner,
        projectId,
        token,
      );
      const guestDocument = await joinDocument(
        visitor.service,
        resolved.origin,
        guest,
        projectId,
        token,
      );
      guestDocument.text.insert(5, " world");
      await until(
        () => hostDocument.text.toString() === "Hello world",
        "an edit to cross the internet tunnel",
      );
      hostDocument.socket.close();
      guestDocument.socket.close();
    },
    120_000,
  );

  it.runIf(realCloud)(
    "shares through the always-on server with a permanent invite and live edits",
    { timeout: 60_000 },
    async () => {
      const ownerApp = createService("cloud-owner", { cloudOrigin });
      const visitorApp = createService("cloud-visitor", { cloudOrigin });

      const created = await call(
        ownerApp.service,
        cloudOrigin,
        owner,
        "POST",
        "/api/projects",
        {
          folderName: "Cloud thesis",
        },
      );
      expect(created.status).toBe(200);
      const projectId = created.body.id as string;
      await call(
        ownerApp.service,
        cloudOrigin,
        owner,
        "PUT",
        `/api/projects/${projectId}/files/content?path=main.tex`,
        { content: "Hello" },
      );
      const share = await call(
        ownerApp.service,
        cloudOrigin,
        owner,
        "POST",
        `/api/projects/${projectId}/share`,
        {},
      );
      const token = share.body.token as string;
      const invite = (await ownerApp.service.cloudInvite(token))!;
      // The invite holds the server's fixed address, not this computer's.
      // ...and the project's encryption key, which the server never sees.
      expect(decodePeerInvite(invite)).toEqual({
        token,
        addresses: [new URL(cloudOrigin).origin],
        key: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      });

      // Newcomers wait for the owner by default; this owner lets anyone in.
      await call(
        ownerApp.service,
        cloudOrigin,
        owner,
        "PUT",
        `/api/shares/${token}/approval`,
        { requireApproval: false },
        token,
      );
      const resolved = await visitorApp.service.resolveInvite(invite);
      const opened = await call(
        visitorApp.service,
        resolved.origin,
        guest,
        "POST",
        `/api/shares/${token}/open`,
        {},
        token,
      );
      expect(opened.status).toBe(200);

      const ownerDoc = await joinDocument(
        ownerApp.service,
        cloudOrigin,
        owner,
        projectId,
        token,
      );
      const guestDoc = await joinDocument(
        visitorApp.service,
        resolved.origin,
        guest,
        projectId,
        token,
      );
      await until(() => guestDoc.text.toString() === "Hello", "guest sees the text");
      guestDoc.text.insert(5, " from Ada");
      await until(
        () => ownerDoc.text.toString() === "Hello from Ada",
        "owner sees the guest's edit",
      );
      // Through the app the text reads normally...
      await until(async () => {
        const read = await call(
          visitorApp.service,
          resolved.origin,
          guest,
          "GET",
          `/api/projects/${projectId}/files/content?path=main.tex`,
          undefined,
          token,
        );
        return read.body.content === "Hello from Ada";
      }, "decrypted read");
      // ...while the server itself only holds ciphertext.
      const raw = await fetch(
        `${new URL(cloudOrigin).origin}/api/projects/${projectId}/files/log?path=main.tex`,
        {
          headers: {
            "x-latexdo-session": owner.session,
            "x-latexdo-client": owner.client,
          },
        },
      ).then((response) => response.json() as Promise<{ entries: string[] }>);
      expect(raw.entries.length).toBeGreaterThan(0);
      const stored = raw.entries
        .map((entry) => Buffer.from(entry, "base64").toString("latin1"))
        .join("");
      expect(stored).not.toContain("Hello");
      expect(stored).not.toContain("Ada");
      const project = await fetch(
        `${new URL(cloudOrigin).origin}/api/projects/${projectId}/share`,
        {
          headers: {
            "x-latexdo-session": owner.session,
            "x-latexdo-client": owner.client,
          },
        },
      ).then((response) => response.json() as Promise<{ projectName: string }>);
      expect(project.projectName).toMatch(/^enc1:/);
      ownerDoc.socket.close();
      guestDoc.socket.close();
    },
  );
});
