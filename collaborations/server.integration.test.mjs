// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import * as Y from "yjs";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as sync from "y-protocols/sync";

const captured = vi.hoisted(() => ({ server: null }));
// The HTTP server, sockets, filesystem and request handlers remain real; capture
// the server instance only so the test can reliably stop it after integration tests.
vi.mock("node:http", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: {
      ...actual.default,
      createServer(...args) {
        captured.server = actual.default.createServer(...args);
        return captured.server;
      },
    },
  };
});
let directory, origin, log;
const intervals = [];
const sockets = new Set();
let signalListeners;
const owner = { session: "owner-private-session", client: "owner-public-id" };
const guest = { session: "guest-private-session", client: "guest-public-id" };
async function request(route, identity = owner, method = "GET", body, extra = {}) {
  return fetch(origin + route, {
    method,
    headers: {
      "content-type": "application/json",
      ...(identity
        ? {
            "x-latexdo-session": identity.session,
            "x-latexdo-client": identity.client,
            "x-latexdo-client-name": "Ada",
          }
        : {}),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function approveGuest(token, identity = guest) {
  const base = `/api/shares/${token}`;
  expect((await request(base + "/open", identity, "POST", {})).status).toBe(403);
  expect(
    (
      await request(base + `/pending/${identity.client}`, owner, "POST", {
        action: "approve",
      })
    ).status,
  ).toBe(200);
}
async function create() {
  const response = await request("/api/projects", owner, "POST", {
    name: "Integration paper",
  });
  expect(response.status).toBe(200);
  return response.json();
}
async function shared() {
  const project = await create();
  const response = await request(
    `/api/projects/${project.id}/share`,
    owner,
    "POST",
    {},
  );
  expect(response.status).toBe(200);
  return { ...project, ...(await response.json()) };
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "latexdo-server-test-"));
  for (const [name, value] of Object.entries({
    HOST: "127.0.0.1",
    PORT: "0",
    DATA_DIR: directory,
    ALLOWED_ORIGINS: "https://collab.example.org",
    MAX_FILE_BYTES: "4096",
    MAX_JSON_BYTES: "8192",
    RATE_MAX: "2000",
    CREATE_RATE_MAX: "200",
    ROOM_EVICTION_MS: "10",
    ROOM_PERSIST_DELAY_MS: "10",
    ACCESS_LOG: "true",
  }))
    vi.stubEnv("LATEXDO_COLLAB_" + name, value);
  signalListeners = new Map(
    ["SIGTERM", "SIGINT"].map((name) => [name, process.listeners(name)]),
  );
  const original = setInterval;
  vi.spyOn(globalThis, "setInterval").mockImplementation((...args) => {
    const timer = original(...args);
    intervals.push(timer);
    return timer;
  });
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  await import("./server.mjs");
  if (!captured.server.listening) await once(captured.server, "listening");
  origin = `http://127.0.0.1:${captured.server.address().port}`;
});
afterAll(async () => {
  for (const socket of sockets) socket.close();
  await new Promise((resolve) => setTimeout(resolve, 40));
  for (const timer of intervals) clearInterval(timer);
  if (captured.server) {
    captured.server.closeAllConnections();
    await new Promise((resolve) => captured.server.close(resolve));
  }
  for (const [name, previous] of signalListeners ?? [])
    for (const listener of process.listeners(name))
      if (!previous.includes(listener)) process.removeListener(name, listener);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe("real collaboration HTTP service", () => {
  it("keeps concurrent review replies and explicit thread deletions", async () => {
    const { id } = await create();
    const route = `/api/projects/${id}/files/content?path=.latexdo%2Freview_data.json`;
    const chat = { id: "thread", comments: [] };
    const writes = await Promise.all(
      ["a", "b"].map((id) =>
        request(route, owner, "PUT", {
          content: JSON.stringify({
            chats: [{ ...chat, comments: [{ id, timestamp: 1, text: id }] }],
            items: [],
          }),
        }),
      ),
    );
    expect(writes.map((r) => r.status)).toEqual([204, 204]);
    const read = async () => JSON.parse((await (await request(route)).json()).content);
    expect((await read()).chats[0].comments.map((c) => c.id)).toEqual(["a", "b"]);
    expect(
      (
        await request(route, owner, "PUT", {
          content: JSON.stringify({ chats: [], items: [], deletedChatIds: ["thread"] }),
        })
      ).status,
    ).toBe(204);
    await request(route, owner, "PUT", {
      content: JSON.stringify({ chats: [chat], items: [] }),
    });
    expect((await read()).chats).toEqual([]);
  });

  it("serves health, CORS preflight and explicit unavailable routes", async () => {
    expect(await (await request("/api/health", null)).json()).toMatchObject({
      ok: true,
      websocket: true,
      compilation: "client-local",
    });
    const options = await request("/api/projects", null, "OPTIONS", undefined, {
      origin: "https://collab.example.org",
    });
    expect(options.status).toBe(204);
    expect(options.headers.get("access-control-allow-origin")).toBe(
      "https://collab.example.org",
    );
    expect(
      (
        await request("/api/health", null, "GET", undefined, {
          origin: "https://evil.example",
        })
      ).status,
    ).toBe(403);
    expect((await request("/unknown")).status).toBe(404);
    expect((await request("/api/import/docx", owner, "POST", {})).status).toBe(501);
  });
  it("requires authentication and rejects malformed JSON", async () => {
    expect((await request("/api/projects", null)).status).toBe(400);
    const response = await fetch(origin + "/api/projects", {
      method: "POST",
      headers: { "x-latexdo-session": owner.session, "x-latexdo-client": owner.client },
      body: "{not json",
    });
    expect(response.status).toBe(400);
  });
  it("creates, lists and reopens only projects owned by the session", async () => {
    const project = await create();
    const own = await (await request("/api/projects")).json();
    expect(own.projects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: project.id, name: "Integration paper" }),
      ]),
    );
    expect((await (await request("/api/projects", guest)).json()).projects).toEqual([]);
    const reopened = await (
      await request("/api/projects/open", owner, "POST", {})
    ).json();
    expect(reopened.id).toBeTruthy();
    const guestProject = await (
      await request("/api/projects/open", guest, "POST", {})
    ).json();
    expect(guestProject.id).not.toBe(project.id);
  });
  it("persists file changes, creates directories and moves entries without overwriting", async () => {
    const { id } = await create();
    const base = `/api/projects/${id}`;
    expect(
      (
        await request(base + "/files", owner, "POST", {
          relativePath: "chapters",
          type: "directory",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(base + "/files", owner, "POST", {
          relativePath: "chapters/intro.tex",
          type: "file",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(base + "/files/content?path=chapters%2Fintro.tex", owner, "PUT", {
          content: "Hello collaboration",
        })
      ).status,
    ).toBe(204);
    expect(
      await (await request(base + "/files/content?path=chapters%2Fintro.tex")).json(),
    ).toEqual({ content: "Hello collaboration" });
    expect(
      await (await request(base + "/files/exists?path=chapters%2Fintro.tex")).json(),
    ).toEqual({ exists: true });
    expect(
      await (await request(base + "/files/exists?path=absent.tex")).json(),
    ).toEqual({ exists: false });
    expect(
      (
        await request(base + "/files/move", owner, "POST", {
          fromRelativePath: "chapters/intro.tex",
          toRelativePath: "intro.tex",
        })
      ).status,
    ).toBe(200);
    const tree = await (await request(base + "/files")).json();
    expect(tree).toEqual(
      expect.arrayContaining([expect.objectContaining({ relativePath: "intro.tex" })]),
    );
    expect((await request(base + "/files/content?path=absent.tex")).status).toBe(404);
    expect(
      (
        await request(base + "/files/move", owner, "POST", {
          fromRelativePath: "absent.tex",
          toRelativePath: "target.tex",
        })
      ).status,
    ).toBe(404);
    expect((await request(base + "/files/collaborate")).status).toBe(426);
    expect((await request(base + "/unknown")).status).toBe(404);
  });
  it.each([
    "../outside",
    "/etc/passwd",
    "C:\\secret",
    ".git/config",
    "node_modules/a",
    "a\u0000b",
  ])("rejects unsafe project paths: %s", async (relativePath) => {
    const { id } = await create();
    expect(
      (
        await request(`/api/projects/${id}/files`, owner, "POST", {
          relativePath,
          type: "file",
        })
      ).status,
    ).toBe(400);
  });
  it("stores figures, bundles the project, copies and deletes files", async () => {
    const { id } = await create();
    const base = `/api/projects/${id}`;
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]);
    expect(
      (
        await request(base + "/files/binary?path=fig%2Fplot.png", owner, "PUT", {
          base64: png.toString("base64"),
        })
      ).status,
    ).toBe(204);
    await request(base + "/files/content?path=main.tex", owner, "PUT", {
      content: "\\includegraphics{fig/plot}",
    });
    const figure = await (
      await request(base + "/files/binary?path=fig%2Fplot.png")
    ).json();
    expect(Buffer.from(figure.base64, "base64")).toEqual(png);

    const bundle = await (await request(base + "/files/bundle")).json();
    expect(bundle.files).toEqual([
      { relativePath: "fig/plot.png", base64: png.toString("base64") },
      { relativePath: "main.tex", content: "\\includegraphics{fig/plot}" },
    ]);
    expect(bundle.revision).toBeGreaterThan(0);

    expect(
      (
        await request(base + "/files/copy", owner, "POST", {
          fromRelativePath: "fig",
          toRelativePath: "fig-old",
        })
      ).status,
    ).toBe(200);
    expect(
      await (await request(base + "/files/exists?path=fig-old%2Fplot.png")).json(),
    ).toEqual({ exists: true });
    expect((await request(base + "/files?path=fig-old", owner, "DELETE")).status).toBe(
      204,
    );
    expect(
      await (await request(base + "/files/exists?path=fig-old%2Fplot.png")).json(),
    ).toEqual({ exists: false });
    const state = await (await request(base + "/share")).json();
    expect(state.revision).toBeGreaterThan(bundle.revision);
  });

  it("enforces upload quotas and private project authorization", async () => {
    const { id } = await create();
    expect((await request(`/api/projects/${id}/files`, guest)).status).toBe(403);
    expect(
      (
        await request(`/api/projects/${id}/files/content?path=big.tex`, owner, "PUT", {
          content: "a".repeat(4097),
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await request(`/api/projects/${id}/files/content?path=a.tex`, owner, "PUT", {
          content: 42,
        })
      ).status,
    ).toBe(400);
  });
  it("enrolls shared members, records presence and enforces downgraded permissions", async () => {
    const { id, token } = await shared();
    const base = `/api/shares/${token}`;
    await approveGuest(token);
    const opened = await request(base + "/open", guest, "POST", {});
    expect(opened.status).toBe(200);
    expect((await opened.json()).project.id).toBe(id);
    const presence = await (
      await request(base + "/presence", guest, "POST", { currentFile: "main.tex" })
    ).json();
    expect(presence.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ clientId: guest.client, active: true }),
      ]),
    );
    // LatexDo in the background: still here, but away. Left out, it is kept.
    const away = async (body) =>
      (
        await (await request(base + "/presence", guest, "POST", body)).json()
      ).users.find((user) => user.clientId === guest.client);
    expect(await away({ currentFile: "main.tex", active: false })).toMatchObject({
      active: false,
    });
    expect(await away({ currentFile: null })).toMatchObject({ active: false });
    expect(await away({ currentFile: null, active: true })).toMatchObject({
      active: true,
    });
    expect(
      (await request(base + "/presence", guest, "POST", { active: "no" })).status,
    ).toBe(400);
    expect((await (await request(base + "/permissions")).json()).isAdmin).toBe(true);
    expect(
      (
        await request(base + "/permissions", guest, "PUT", {
          clientId: owner.client,
          role: "viewer",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(base + "/permissions", owner, "PUT", {
          clientId: guest.client,
          role: "viewer",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(`/api/projects/${id}/files/content?path=main.tex`, guest, "PUT", {
          content: "overwrite",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(base + "/permissions", owner, "PUT", {
          clientId: owner.client,
          role: "viewer",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(base + "/permissions", owner, "PUT", {
          clientId: guest.client,
          role: "root",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(base + "/permissions", owner, "PUT", {
          clientId: "absent",
          role: "viewer",
        })
      ).status,
    ).toBe(404);
    expect(
      (await request(base + "/collaborators/" + guest.client, owner, "DELETE")).status,
    ).toBe(204);
    expect((await request(base + "/open", guest, "POST", {})).status).toBe(403);
    expect(
      (await request(base + "/collaborators/" + owner.client, owner, "DELETE")).status,
    ).toBe(400);
    expect(
      (await request(base + "/collaborators/absent", owner, "DELETE")).status,
    ).toBe(404);
  });
  it("rotates invitation credentials and redacts them from logs", async () => {
    const { id, token } = await shared();
    const rotated = await (
      await request(`/api/projects/${id}/share/rotate`, owner, "POST", {})
    ).json();
    expect(rotated.token).not.toBe(token);
    // A retired invite admits nobody new.
    const refused = await request(`/api/shares/${token}/open`, guest, "POST", {});
    expect(refused.status).toBe(403);
    expect((await refused.json()).code).toBe("invite-expired");
    await approveGuest(rotated.token);
    expect(
      (
        await request(
          `/api/shares/${rotated.token}/open?secret=sensitive`,
          guest,
          "POST",
          {},
        )
      ).status,
    ).toBe(200);
    const output = log.mock.calls.flat().join("\n");
    expect(output).toContain("[redacted]");
    expect(output).not.toContain(token);
    expect(output).not.toContain("sensitive");
  });
  it("keeps existing collaborators signed in when the invite is rotated", async () => {
    const { id, token } = await shared();
    await approveGuest(token);
    await request(`/api/shares/${token}/open`, guest, "POST", {});
    const rotated = await (
      await request(`/api/projects/${id}/share/rotate`, owner, "POST", {})
    ).json();
    const presence = await request(`/api/shares/${token}/presence`, guest, "POST", {
      currentFile: null,
    });
    expect(presence.status).toBe(200);
    expect((await presence.json()).token).toBe(rotated.token);
  });
  it("lets the owner disable approval so newcomers can join directly", async () => {
    const { token } = await shared();
    const base = `/api/shares/${token}`;
    const changed = await request(base + "/approval", owner, "PUT", {
      requireApproval: false,
    });
    expect(changed.status).toBe(200);
    expect((await changed.json()).requireApproval).toBe(false);
    expect((await request(base + "/open", guest, "POST", {})).status).toBe(200);
  });
  it("preserves disabled approval for existing shares", async () => {
    const { id, token } = await shared();
    const file = path.join(directory, "projects", id, "project.json");
    const meta = JSON.parse(await readFile(file, "utf8"));
    meta.requireApproval = false;
    await writeFile(file, JSON.stringify(meta));
    const response = await request(`/api/shares/${token}/open`, guest, "POST", {});
    expect(response.status).toBe(200);
    expect((await response.json()).collaboration.requireApproval).toBe(false);
    expect((await request(`/api/projects/${id}/files`, guest)).status).toBe(200);
  });
  it("requires approval by default and lets an admin allow or deny newcomers", async () => {
    const { token } = await shared();
    const base = `/api/shares/${token}`;
    const late = { session: "late-private-session", client: "late-public-id" };
    expect(
      (await request(base + "/approval", guest, "PUT", { requireApproval: true }))
        .status,
    ).toBe(403);
    expect(
      (await request(base + "/approval", owner, "PUT", { requireApproval: "yes" }))
        .status,
    ).toBe(400);
    expect((await (await request(base + "/permissions")).json()).requireApproval).toBe(
      true,
    );
    const knock = await request(base + "/open", guest, "POST", {});
    expect(knock.status).toBe(403);
    expect((await knock.json()).code).toBe("approval-pending");
    await request(base + "/open", late, "POST", {});
    const waiting = await (await request(base + "/permissions")).json();
    expect(waiting.pending.map((entry) => entry.clientId)).toEqual([
      guest.client,
      late.client,
    ]);
    expect(
      (await request(base + "/pending/absent", owner, "POST", { action: "approve" }))
        .status,
    ).toBe(404);
    expect(
      (
        await request(base + `/pending/${guest.client}`, owner, "POST", {
          action: "maybe",
        })
      ).status,
    ).toBe(400);
    await request(base + `/pending/${guest.client}`, owner, "POST", {
      action: "approve",
      role: "viewer",
    });
    await request(base + `/pending/${late.client}`, owner, "POST", { action: "deny" });
    const admitted = await (await request(base + "/open", guest, "POST", {})).json();
    expect(admitted.collaboration.currentUserRole).toBe("viewer");
    expect(admitted.collaboration.pending).toBeUndefined();
    const denied = await request(base + "/open", late, "POST", {});
    expect(denied.status).toBe(403);
    expect((await denied.json()).code).toBe("access-removed");
  });
  it("tells the owner's open document about join requests the moment they arrive", async () => {
    const { id, token } = await shared();
    const base = `/api/shares/${token}`;
    await request(`/api/projects/${id}/files/content?path=main.tex`, owner, "PUT", {
      content: "",
    });
    await request(base + "/approval", owner, "PUT", { requireApproval: true });
    const url = new URL(`/api/projects/${id}/files/collaborate`, origin);
    url.protocol = "ws:";
    url.search = new URLSearchParams({
      session: owner.session,
      clientId: owner.client,
      path: "main.tex",
    }).toString();
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    sockets.add(socket);
    const pushed = [];
    socket.addEventListener("message", (event) => {
      const decoder = decoding.createDecoder(new Uint8Array(event.data));
      if (decoding.readVarUint(decoder) !== 6) return;
      pushed.push(JSON.parse(decoding.readVarString(decoder)).pending);
    });
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    const knock = await request(base + "/open", guest, "POST", {});
    expect((await knock.json()).code).toBe("approval-pending");
    await vi.waitFor(() =>
      expect(pushed.at(-1)?.map((entry) => entry.clientId)).toEqual([guest.client]),
    );
    await request(base + `/pending/${guest.client}`, owner, "POST", {
      action: "approve",
    });
    await vi.waitFor(() => expect(pushed.at(-1)).toEqual([]));
    expect((await request(base + "/open", guest, "POST", {})).status).toBe(200);
    socket.close();
    sockets.delete(socket);
  });
  it("offers admin rights that only take effect once the person accepts", async () => {
    const { id, token } = await shared();
    const base = `/api/shares/${token}`;
    await approveGuest(token);
    await request(base + "/open", guest, "POST", {});
    const ownerView = await (await request(base + "/permissions")).json();
    expect(ownerView.canTransferAdmin).toBe(false);
    // The owner always stays admin, so it cannot hand its seat over.
    expect(
      (
        await request(base + "/permissions", owner, "PUT", {
          clientId: guest.client,
          role: "admin",
          transfer: true,
        })
      ).status,
    ).toBe(400);
    const offered = await request(base + "/permissions", owner, "PUT", {
      clientId: guest.client,
      role: "admin",
    });
    expect(offered.status).toBe(200);
    expect(await offered.json()).toMatchObject({
      role: "editor",
      adminOffer: { from: owner.client, transfer: false },
    });
    const guestView = await (await request(base + "/permissions", guest)).json();
    expect(guestView.isAdmin).toBe(false);
    expect(
      guestView.permissions.find((item) => item.isCurrent).adminOffer,
    ).toMatchObject({ from: owner.client });

    // Withdrawn, then offered again and declined: still an editor.
    expect(
      (await request(base + "/admin-offer/" + guest.client, owner, "DELETE")).status,
    ).toBe(204);
    expect(
      (await request(base + "/admin-offer", guest, "POST", { action: "accept" }))
        .status,
    ).toBe(404);
    await request(base + "/permissions", owner, "PUT", {
      clientId: guest.client,
      role: "admin",
    });
    expect(
      (await request(base + "/admin-offer", guest, "POST", { action: "maybe" })).status,
    ).toBe(400);
    const declined = await request(base + "/admin-offer", guest, "POST", {
      action: "decline",
    });
    expect((await declined.json()).role).toBe("editor");

    await request(base + "/permissions", owner, "PUT", {
      clientId: guest.client,
      role: "admin",
    });
    const accepted = await request(base + "/admin-offer", guest, "POST", {
      action: "accept",
    });
    expect((await accepted.json()).role).toBe("admin");
    const promoted = await (await request(base + "/permissions", guest)).json();
    expect(promoted).toMatchObject({ isAdmin: true, canTransferAdmin: true });
    expect(
      (
        await request(`/api/projects/${id}/files/content?path=main.tex`, guest, "PUT", {
          content: "now an admin",
        })
      ).status,
    ).toBe(204);
    // Accepted: nothing is left to withdraw.
    expect(
      (await request(base + "/admin-offer/" + guest.client, guest, "DELETE")).status,
    ).toBe(404);
  });
  it("records sealed changes for editors and lists them for everyone, newest first", async () => {
    const { id, token } = await shared();
    await approveGuest(token);
    await request(`/api/shares/${token}/open`, guest, "POST", {});
    const route = `/api/projects/${id}/history`;
    expect(
      (await request(route, owner, "POST", { entries: [{ data: "sealed-1" }] })).status,
    ).toBe(200);
    expect(
      (await request(route, guest, "POST", { entries: [{ data: "sealed-2" }] })).status,
    ).toBe(200);
    expect((await request(route, owner, "POST", { entries: [] })).status).toBe(400);
    const page = await (await request(route, guest)).json();
    expect(page.hasMore).toBe(false);
    expect(page.entries.map((entry) => [entry.from, entry.data])).toEqual([
      [guest.client, "sealed-2"],
      [owner.client, "sealed-1"],
    ]);
    // A viewer reads the history but has no edits to add.
    await request(`/api/shares/${token}/permissions`, owner, "PUT", {
      clientId: guest.client,
      role: "viewer",
    });
    expect((await request(route, guest)).status).toBe(200);
    expect(
      (await request(route, guest, "POST", { entries: [{ data: "sealed-3" }] })).status,
    ).toBe(403);
  });
  it("retires the invite when a collaborator is removed", async () => {
    const { token } = await shared();
    const base = `/api/shares/${token}`;
    await approveGuest(token);
    await request(base + "/open", guest, "POST", {});
    expect(
      (await request(base + "/collaborators/" + guest.client, owner, "DELETE")).status,
    ).toBe(204);
    const sneaky = { session: "new-private-session", client: "new-public-id" };
    expect((await request(base + "/open", sneaky, "POST", {})).status).toBe(403);
    const state = await (
      await request(base + "/presence", owner, "POST", { currentFile: null })
    ).json();
    expect(state.token).not.toBe(token);
    expect(
      (await request(`/api/shares/${state.token}/open`, sneaky, "POST", {})).status,
    ).toBe(403);
  });
  it("stops sharing for everyone but the owner and can share again", async () => {
    const { id, token } = await shared();
    await approveGuest(token);
    await request(`/api/shares/${token}/open`, guest, "POST", {});
    expect((await request(`/api/projects/${id}/share`, guest, "DELETE")).status).toBe(
      403,
    );
    const stopped = await (
      await request(`/api/projects/${id}/share`, owner, "DELETE")
    ).json();
    expect(stopped).toMatchObject({ enabled: false });
    expect(stopped.token).toBeUndefined();
    const locked = await request(`/api/projects/${id}/files`, guest);
    expect(locked.status).toBe(403);
    expect((await locked.json()).code).toBe("sharing-stopped");
    expect((await request(`/api/shares/${token}/open`, guest, "POST", {})).status).toBe(
      404,
    );
    expect((await request(`/api/projects/${id}/files`)).status).toBe(200);
    const again = await (
      await request(`/api/projects/${id}/share`, owner, "POST", {})
    ).json();
    expect(again.token).not.toBe(token);
    expect((await request(`/api/projects/${id}/files`, guest)).status).toBe(200);
  });
  it("deletes a project only for its owner, invite and files included", async () => {
    const { id, token } = await shared();
    await approveGuest(token);
    await request(`/api/shares/${token}/open`, guest, "POST", {});
    expect((await request(`/api/projects/${id}`, guest, "DELETE")).status).toBe(403);
    const deleted = await request(`/api/projects/${id}`, owner, "DELETE");
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ deleted: true });
    expect((await request(`/api/projects/${id}/files`)).status).toBe(404);
    expect((await request(`/api/shares/${token}/open`, guest, "POST", {})).status).toBe(
      404,
    );
    const own = await (await request("/api/projects")).json();
    expect(own.projects.map((project) => project.id)).not.toContain(id);
  });
  it("applies authorized Yjs changes and persists shared document state", async () => {
    const { id, token } = await shared();
    await approveGuest(token);
    await request(`/api/shares/${token}/open`, guest, "POST", {});
    await request(`/api/projects/${id}/files/content?path=main.tex`, owner, "PUT", {
      content: "",
    });
    const url = new URL(`/api/projects/${id}/files/collaborate`, origin);
    url.protocol = "ws:";
    url.search = new URLSearchParams({
      session: guest.session,
      clientId: guest.client,
      path: "main.tex",
    }).toString();
    const socket = new WebSocket(url);
    sockets.add(socket);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    const document = new Y.Doc();
    document.getText("content").insert(0, "Shared equation: x = 1");
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    sync.writeUpdate(encoder, Y.encodeStateAsUpdate(document));
    socket.send(encoding.toUint8Array(encoder));
    await vi.waitFor(async () =>
      expect(
        await (await request(`/api/projects/${id}/files/content?path=main.tex`)).json(),
      ).toEqual({ content: "Shared equation: x = 1" }),
    );
    await vi.waitFor(async () =>
      expect(
        await readFile(
          path.join(directory, "projects", id, "files", "main.tex"),
          "utf8",
        ),
      ).toBe("Shared equation: x = 1"),
    );
    const closed = new Promise((resolve) =>
      socket.addEventListener("close", resolve, { once: true }),
    );
    await request(`/api/shares/${token}/permissions`, owner, "PUT", {
      clientId: guest.client,
      role: "viewer",
    });
    expect((await closed).code).toBe(1008);
    document.destroy();
    sockets.delete(socket);
  });
});

async function connectDocument(id, identity = owner) {
  const url = new URL(`/api/projects/${id}/files/collaborate`, origin);
  url.protocol = "ws:";
  url.search = new URLSearchParams({
    session: identity.session,
    clientId: identity.client,
    path: "main.tex",
  }).toString();
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  sockets.add(socket);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  return socket;
}
function awarenessFrame(id, clock, state) {
  const update = encoding.createEncoder();
  encoding.writeVarUint(update, 1);
  encoding.writeVarUint(update, id);
  encoding.writeVarUint(update, clock);
  encoding.writeVarString(update, JSON.stringify(state));
  const frame = encoding.createEncoder();
  encoding.writeVarUint(frame, 1);
  encoding.writeVarUint8Array(frame, encoding.toUint8Array(update));
  return encoding.toUint8Array(frame);
}
function closedSocket(socket) {
  return new Promise((resolve) =>
    socket.addEventListener("close", resolve, { once: true }),
  );
}
describe("live collaboration room lifecycle", () => {
  it("broadcasts awareness and rejects another connection claiming its identity", async () => {
    const { id } = await create();
    const first = await connectDocument(id);
    const second = await connectDocument(id);
    const messages = [];
    second.addEventListener("message", (event) =>
      messages.push(new Uint8Array(event.data)),
    );
    first.send(awarenessFrame(98765, 1, { user: { name: "Ada" } }));
    await vi.waitFor(() =>
      expect(
        messages.some(
          (bytes) => decoding.readVarUint(decoding.createDecoder(bytes)) === 1,
        ),
      ).toBe(true),
    );
    const closed = closedSocket(second);
    second.send(awarenessFrame(98765, 2, { user: { name: "Imposter" } }));
    expect((await closed).code).toBe(1008);
    first.send(awarenessFrame(98765, 2, null));
    first.close();
  });
  it("rejects malformed awareness without taking down the room", async () => {
    const { id } = await create();
    const socket = await connectDocument(id);
    const closed = closedSocket(socket);
    socket.send(new Uint8Array([1, 1, 255]));
    expect((await closed).reason).toBe("Awareness update rejected");
    expect((await request(`/api/projects/${id}/files`)).status).toBe(200);
  });
  it.each(["move", "delete", "project-delete"])(
    "preserves live HTTP edits and closes rooms during %s",
    async (action) => {
      const { id } = await create();
      const socket = await connectDocument(id);
      const base = `/api/projects/${id}`;
      expect(
        (
          await request(base + "/files/content?path=main.tex", owner, "PUT", {
            content: "Live replacement",
          })
        ).status,
      ).toBe(204);
      const bundle = await (await request(base + "/files/bundle")).json();
      expect(bundle.files).toContainEqual({
        relativePath: "main.tex",
        content: "Live replacement",
      });
      const closed = closedSocket(socket);
      const response =
        action === "move"
          ? await request(base + "/files/move", owner, "POST", {
              fromRelativePath: "main.tex",
              toRelativePath: "renamed.tex",
            })
          : action === "delete"
            ? await request(base + "/files?path=main.tex", owner, "DELETE")
            : await request(base, owner, "DELETE");
      expect(response.ok).toBe(true);
      expect((await closed).code).toBe(1012);
      if (action === "move")
        expect(
          await (await request(base + "/files/content?path=renamed.tex")).json(),
        ).toEqual({ content: "Live replacement" });
    },
  );
  it("disconnects guests when sharing stops while leaving the owner's connection usable", async () => {
    const { id, token } = await shared();
    await approveGuest(token);
    await request(`/api/shares/${token}/open`, guest, "POST", {});
    const own = await connectDocument(id);
    const visitor = await connectDocument(id, guest);
    const closed = closedSocket(visitor);
    await request(`/api/projects/${id}/share`, owner, "DELETE");
    expect((await closed).code).toBe(1008);
    expect(own.readyState).toBe(WebSocket.OPEN);
    own.close();
  });
});

describe("project discussion", () => {
  const third = { session: "third-private-session", client: "third-public-id" };
  const outsider = {
    session: "outsider-private-session",
    client: "outsider-public-id",
  };

  async function sharedWithGuests() {
    const project = await shared();
    await approveGuest(project.token, guest);
    await approveGuest(project.token, third);
    return project;
  }

  async function post(id, identity, body) {
    return request(`/api/projects/${id}/discussion`, identity, "POST", body);
  }

  async function page(id, identity, query = "") {
    const response = await request(`/api/projects/${id}/discussion${query}`, identity);
    expect(response.status).toBe(200);
    return response.json();
  }

  it("persists edits and delivers them to the original audience", async () => {
    const { id } = await sharedWithGuests();
    const initial = await post(id, owner, {
      id: "editable-001",
      to: guest.client,
      body: "Original",
    });
    const original = (await initial.json()).message;
    const input = {
      id: original.id,
      to: guest.client,
      body: "Corrected",
      edit: true,
      expectedRevision: original.seq,
    };
    expect((await post(id, guest, input)).status).toBe(409);
    const saved = await post(id, owner, input);
    expect(saved.status).toBe(200);
    const edited = (await saved.json()).message;
    expect(edited).toMatchObject({
      seq: original.seq,
      updatedSeq: 2,
      body: "Corrected",
      createdAt: original.createdAt,
    });
    expect(edited.editedAt).toBeGreaterThanOrEqual(original.createdAt);
    expect((await page(id, guest, "?after=1")).messages).toEqual([edited]);
    expect((await page(id, third, "?after=1")).messages).toEqual([]);
    expect((await post(id, owner, input)).status).toBe(409);
    const stored = JSON.parse(
      await readFile(path.join(directory, "projects", id, "discussion.json"), "utf8"),
    );
    expect(stored.messages).toEqual([edited]);
  });

  it("shares group messages with every member and private ones only with the pair", async () => {
    const { id } = await sharedWithGuests();
    const group = await post(id, owner, {
      id: "msg-group-001",
      body: "Hello everyone @Ada",
      mentions: [guest.client, "someone-who-left"],
    });
    expect(group.status).toBe(200);
    const sent = (await group.json()).message;
    expect(sent).toMatchObject({
      seq: 1,
      from: owner.client,
      to: null,
      mentions: [guest.client],
      replyTo: null,
    });
    expect(sent.recipients.sort()).toEqual([guest.client, third.client].sort());

    const secret = await post(id, owner, {
      id: "msg-private-1",
      to: guest.client,
      body: "Just for you",
      replyTo: "msg-group-001",
    });
    // A reply must stay in its conversation: a group message cannot be quoted here.
    expect((await secret.json()).message).toMatchObject({
      to: guest.client,
      recipients: [guest.client],
      replyTo: null,
    });

    const forGuest = await page(id, guest);
    expect(forGuest.messages.map((message) => message.id)).toEqual([
      "msg-group-001",
      "msg-private-1",
    ]);
    expect(forGuest.members.map((member) => member.clientId).sort()).toEqual(
      [owner.client, guest.client, third.client].sort(),
    );
    const forThird = await page(id, third);
    expect(forThird.messages.map((message) => message.id)).toEqual(["msg-group-001"]);
    expect(forThird.seq).toBe(2);

    // Only newer messages, and older ones page by page.
    expect((await page(id, guest, "?after=1")).messages.map((m) => m.id)).toEqual([
      "msg-private-1",
    ]);
    const older = await page(id, guest, "?before=2&limit=1");
    expect(older.messages.map((m) => m.id)).toEqual(["msg-group-001"]);
    expect(older.hasMore).toBe(false);

    expect((await request(`/api/projects/${id}/discussion`, outsider)).status).toBe(
      403,
    );
  });

  it("moves receipts forward and shows private read receipts only to the pair", async () => {
    const { id } = await sharedWithGuests();
    await post(id, owner, { id: "msg-receipt-1", body: "Group" });
    await post(id, owner, { id: "msg-receipt-2", to: guest.client, body: "Private" });
    const receipts = (identity, body) =>
      request(`/api/projects/${id}/discussion/receipts`, identity, "POST", body);

    expect((await receipts(guest, { delivered: 99 })).status).toBe(200);
    expect(
      (await receipts(guest, { read: { conversation: "*", seq: 1 } })).status,
    ).toBe(200);
    expect(
      (await receipts(guest, { read: { conversation: owner.client, seq: 2 } })).status,
    ).toBe(200);
    // Watermarks never go back.
    await receipts(guest, { delivered: 0 });

    const seenByOwner = (await page(id, owner)).receipts;
    expect(seenByOwner[guest.client]).toEqual({
      delivered: 2,
      read: { "*": 1, [owner.client]: 2 },
    });
    // The sender has read their own conversations.
    expect(seenByOwner[owner.client].read).toEqual({ "*": 1, [guest.client]: 2 });
    // Someone outside the private conversation does not learn about it.
    const seenByThird = (await page(id, third)).receipts;
    expect(seenByThird[guest.client]).toEqual({ delivered: 2, read: { "*": 1 } });
    expect(seenByThird[owner.client].read).toEqual({ "*": 1 });

    expect((await receipts(guest, { delivered: -1 })).status).toBe(400);
    expect((await receipts(guest, { read: { conversation: "", seq: 1 } })).status).toBe(
      400,
    );
  });

  it("validates messages, accepts retries once and lets viewers take part", async () => {
    const { id, token } = await sharedWithGuests();
    expect((await post(id, guest, { id: "x", body: "Hi" })).status).toBe(400);
    expect((await post(id, guest, { id: "msg-empty-1", body: "   " })).status).toBe(
      400,
    );
    expect(
      (await post(id, guest, { id: "msg-long-01", body: "a".repeat(4001) })).status,
    ).toBe(413);
    expect(
      (await post(id, guest, { id: "msg-self-01", to: guest.client, body: "Me" }))
        .status,
    ).toBe(400);
    expect(
      (await post(id, guest, { id: "msg-ghost-1", to: "nobody", body: "Hi" })).status,
    ).toBe(404);
    expect(
      (await post(id, guest, { id: "msg-ment-01", body: "Hi", mentions: "Ada" }))
        .status,
    ).toBe(400);

    const first = await (
      await post(id, guest, { id: "msg-retry-1", body: "Once" })
    ).json();
    const again = await (
      await post(id, guest, { id: "msg-retry-1", body: "Once" })
    ).json();
    expect(again.message).toEqual(first.message);
    // Someone else cannot reuse (or overwrite) that message.
    expect((await post(id, third, { id: "msg-retry-1", body: "Mine" })).status).toBe(
      409,
    );
    expect((await page(id, owner)).messages).toHaveLength(1);

    await request(`/api/shares/${token}/permissions`, owner, "PUT", {
      clientId: third.client,
      role: "viewer",
    });
    expect(
      (await post(id, third, { id: "msg-viewer1", body: "Viewers talk too" })).status,
    ).toBe(200);
    const replied = await (
      await post(id, owner, { id: "msg-reply-01", body: "Yes", replyTo: "msg-viewer1" })
    ).json();
    expect(replied.message.replyTo).toBe("msg-viewer1");

    // The discussion survives a restart of its cache (it is on disk).
    const saved = JSON.parse(
      await readFile(path.join(directory, "projects", id, "discussion.json"), "utf8"),
    );
    expect(saved.messages.map((message) => message.id)).toEqual([
      "msg-retry-1",
      "msg-viewer1",
      "msg-reply-01",
    ]);
  });

  it("signals the people concerned over their live connection", async () => {
    const { id } = await sharedWithGuests();
    await request(`/api/projects/${id}/files/content?path=main.tex`, owner, "PUT", {
      content: "",
    });
    const listen = async (identity) => {
      const url = new URL(`/api/projects/${id}/files/collaborate`, origin);
      url.protocol = "ws:";
      url.search = new URLSearchParams({
        session: identity.session,
        clientId: identity.client,
        path: "main.tex",
      }).toString();
      const socket = new WebSocket(url);
      socket.binaryType = "arraybuffer";
      sockets.add(socket);
      const signals = [];
      socket.addEventListener("message", (event) => {
        const decoder = decoding.createDecoder(new Uint8Array(event.data));
        if (decoding.readVarUint(decoder) !== 7) return;
        signals.push(JSON.parse(decoding.readVarString(decoder)).seq);
      });
      await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener("error", reject, { once: true });
      });
      return { socket, signals };
    };
    const forGuest = await listen(guest);
    const forThird = await listen(third);
    await post(id, owner, { id: "msg-live-001", to: guest.client, body: "Psst" });
    await vi.waitFor(() => expect(forGuest.signals).toEqual([1]));
    await post(id, owner, { id: "msg-live-002", body: "All" });
    await vi.waitFor(() => expect(forThird.signals).toEqual([2]));
    // The private message was never announced to the third person.
    expect(forThird.signals).toEqual([2]);
    for (const { socket } of [forGuest, forThird]) {
      socket.close();
      sockets.delete(socket);
    }
  });
});
