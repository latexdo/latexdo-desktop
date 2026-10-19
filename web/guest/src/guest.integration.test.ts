// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PeerCollabService } from "../../../electron/peerCollab.js";
import { parseWebInvite } from "./invite";
import { GuestSession, type LiveFile } from "./session";

// A desktop owner (the real app bridge and encryption layer) and a browser
// guest (this page's code) editing together through the always-on server.
// Opt in with LATEXDO_E2E_CLOUD=1; LATEXDO_COLLAB_URL picks the server.
const realCloud = process.env.LATEXDO_E2E_CLOUD === "1";
const cloudOrigin = process.env.LATEXDO_COLLAB_URL || "https://collab.latexdo.org";

const run = `${Date.now()}`;
const owner = { session: `owner-session-${run}`, client: `owner-${run}`, name: "Omar" };

let root: string;
let service: PeerCollabService;

async function call(
  method: string,
  route: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await service.request({
    origin: cloudOrigin,
    path: route,
    method,
    headers: {
      "content-type": "application/json",
      "x-latexdo-session": owner.session,
      "x-latexdo-client": owner.client,
      "x-latexdo-client-name": owner.name,
      ...(token ? { "x-latexdo-share-token": token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    timeoutMs: 15_000,
  });
  return {
    status: response.status,
    body: response.text ? (JSON.parse(response.text) as Record<string, unknown>) : {},
  };
}

/** The owner's editor, as the desktop renderer sees it through the bridge. */
async function ownerEditor(projectId: string, token: string) {
  const doc = new Y.Doc();
  const text = doc.getText("content");
  const awareness = new awarenessProtocol.Awareness(doc);
  const query = new URLSearchParams({
    path: "main.tex",
    session: owner.session,
    clientId: owner.client,
    name: owner.name,
    share: token,
  });
  // Join requests the server pushes to the owner, names already decrypted.
  const joinRequests: Array<Array<{ clientId: string; name: string }>> = [];
  let resolveSynced!: () => void;
  const synced = new Promise<void>((resolve) => (resolveSynced = resolve));
  const socket = await service.openSocket(
    cloudOrigin,
    `/api/projects/${projectId}/files/collaborate?${query}`,
    {
      onOpen: () => {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0);
        syncProtocol.writeSyncStep1(encoder, doc);
        socket.send(encoding.toUint8Array(encoder));
      },
      onMessage: (data) => {
        const decoder = decoding.createDecoder(data);
        const type = decoding.readVarUint(decoder);
        if (type === 6) {
          const snapshot = JSON.parse(decoding.readVarString(decoder)) as {
            pending: Array<{ clientId: string; name: string }>;
          };
          joinRequests.push(snapshot.pending);
          return;
        }
        if (type === 1) {
          awarenessProtocol.applyAwarenessUpdate(
            awareness,
            decoding.readVarUint8Array(decoder),
            "remote",
          );
          return;
        }
        if (type !== 0) return;
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0);
        const kind = syncProtocol.readSyncMessage(decoder, encoder, doc, "remote");
        if (encoding.length(encoder) > 1) socket.send(encoding.toUint8Array(encoder));
        if (kind === syncProtocol.messageYjsSyncStep2) resolveSynced();
      },
      onError: () => undefined,
      onClose: () => undefined,
    },
  );
  doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin === "remote") return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeUpdate(encoder, update);
    socket.send(encoding.toUint8Array(encoder));
  });
  await synced;
  return { text, awareness, socket, joinRequests };
}

async function until(condition: () => boolean | Promise<boolean>, label: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

function guestFor(link: string, name: string, id: string): GuestSession {
  const invite = parseWebInvite(link);
  if (!invite) throw new Error("The web link did not parse.");
  return new GuestSession(new URL(cloudOrigin).origin, invite, {
    sessionId: `web-session-${id}-${run}`,
    clientId: `web-${id}-${run}`,
    name,
    color: "#2f6fdb",
    emoji: "🦊",
  });
}

describe.runIf(realCloud)("co-author web editor", () => {
  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "latexdo-web-guest-"));
    service = new PeerCollabService({
      dataDirectory: path.join(root, "owner"),
      serverEntryPath: path.resolve("collaborations/server.mjs"),
      spawnServer: () => {
        throw new Error("Not used: the project is on the always-on server.");
      },
      fetchRemote: fetch,
      onStatusChange: () => undefined,
      cloudOrigin,
    });
  });

  afterAll(async () => {
    service?.dispose();
    await rm(root, { recursive: true, force: true });
  });

  it(
    "lets a browser guest join from a web link and edit live with the desktop owner",
    { timeout: 90_000 },
    async () => {
      const created = await call("POST", "/api/projects", { folderName: "Web thesis" });
      expect(created.status).toBe(200);
      const projectId = created.body.id as string;
      await call("PUT", `/api/projects/${projectId}/files/content?path=main.tex`, {
        content: "Hello",
      });
      const figure = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
      const upload = await call(
        "PUT",
        `/api/projects/${projectId}/files/binary?path=${encodeURIComponent("figures/plot.png")}`,
        { base64: Buffer.from(figure).toString("base64") },
      );
      expect(upload.status).toBeLessThan(300);
      const share = await call("POST", `/api/projects/${projectId}/share`, {});
      const token = share.body.token as string;
      const invite = (await service.cloudInvite(token))!;
      const link = `${new URL(cloudOrigin).origin}/join#${invite.slice("latexdo-invite:".length)}`;

      // New guests wait for the owner to approve them.
      const ada = guestFor(new URL(link).hash, "Ada", "ada");
      expect((await ada.join()).status).toBe("pending");
      await call(
        "POST",
        `/api/shares/${token}/pending/${encodeURIComponent(ada.identity.clientId)}`,
        { action: "approve" },
        token,
      );
      const joined = await ada.join();
      expect(joined).toMatchObject({
        status: "ready",
        projectName: "Web thesis",
        role: "editor",
      });

      const files = await ada.tree();
      expect(JSON.stringify(files)).toContain("main.tex");
      expect(JSON.stringify(files)).toContain("figures/plot.png");
      expect(await ada.readBinary("figures/plot.png")).toEqual(figure);

      const ownerDoc = await ownerEditor(projectId, token);
      let canEdit = false;
      const adaFile: LiveFile = ada.openFile("main.tex", {
        onReady: (value) => (canEdit = value),
      });
      await until(() => adaFile.text.toString() === "Hello", "the guest sees the text");
      expect(canEdit).toBe(true);

      adaFile.text.insert(5, " from the browser");
      await until(
        () => ownerDoc.text.toString() === "Hello from the browser",
        "the owner sees the guest's edit",
      );
      ownerDoc.text.insert(0, "% Omar\n");
      await until(
        () => adaFile.text.toString() === "% Omar\nHello from the browser",
        "the guest sees the owner's edit",
      );

      // The guest's cursor reaches the desktop with the guest's name.
      adaFile.awareness.setLocalStateField("selection", { anchor: 0, head: 0 });
      await until(
        () =>
          [...ownerDoc.awareness.getStates().values()].some(
            (state) => (state as { user?: { name?: string } }).user?.name === "Ada",
          ),
        "the owner sees the guest's cursor",
      );

      // With approval on, a newcomer waits and the owner's open editor hears
      // about it at once (by name, decrypted on the owner's side).
      await call(
        "PUT",
        `/api/shares/${token}/approval`,
        { requireApproval: true },
        token,
      );
      const eve = guestFor(link, "Eve", "eve");
      expect((await eve.join()).status).toBe("pending");
      await until(
        () =>
          ownerDoc.joinRequests.some((pending) =>
            pending.some(
              (request) =>
                request.clientId === eve.identity.clientId && request.name === "Eve",
            ),
          ),
        "the owner is told Eve is waiting",
      );
      // A viewer reads along but cannot change anything.
      await call(
        "POST",
        `/api/shares/${token}/pending/${encodeURIComponent(eve.identity.clientId)}`,
        { action: "approve", role: "viewer" },
        token,
      );
      expect(await eve.join()).toMatchObject({ status: "ready", role: "viewer" });
      let eveCanEdit: boolean | null = null;
      const eveFile = eve.openFile("main.tex", {
        onReady: (value) => (eveCanEdit = value),
      });
      await until(
        () => eveFile.text.toString() === "% Omar\nHello from the browser",
        "the viewer reads the text",
      );
      expect(eveCanEdit).toBe(false);
      eveFile.text.insert(0, "vandalism ");
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(ownerDoc.text.toString()).toBe("% Omar\nHello from the browser");

      // The server stores only ciphertext, names included.
      await adaFile.close();
      await eveFile.close();
      ownerDoc.socket.close();
      const raw = await fetch(
        `${new URL(cloudOrigin).origin}/api/projects/${projectId}/files/log?path=main.tex`,
        {
          headers: {
            "x-latexdo-session": owner.session,
            "x-latexdo-client": owner.client,
          },
        },
      ).then((response) => response.json() as Promise<{ entries: string[] }>);
      const stored = raw.entries
        .map((entry) => Buffer.from(entry, "base64").toString("latin1"))
        .join("");
      expect(stored).not.toContain("browser");
      expect(stored).not.toContain("Omar");
      const people = await fetch(
        `${new URL(cloudOrigin).origin}/api/shares/${token}/permissions`,
        {
          headers: {
            "x-latexdo-session": owner.session,
            "x-latexdo-client": owner.client,
            "x-latexdo-share-token": token,
          },
        },
      ).then(
        (response) =>
          response.json() as Promise<{ permissions: Array<{ name: string }> }>,
      );
      expect(people.permissions.length).toBeGreaterThanOrEqual(3);
      // (This raw request sent no name, so the owner shows as "Anonymous".)
      const storedNames = JSON.stringify(people.permissions);
      for (const name of ["Ada", "Eve", "Omar"])
        expect(storedNames).not.toContain(name);
      expect(
        people.permissions.filter((person) => /^enc1:/.test(person.name)),
      ).toHaveLength(2);

      // A link without its key is refused before anything is sent.
      expect(parseWebInvite(link.split("#")[0]!)).toBeNull();

      await call("DELETE", `/api/projects/${projectId}/share`, undefined, token);
    },
  );
});
