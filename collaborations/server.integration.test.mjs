// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
    const opened = await request(base + "/open", guest, "POST", {});
    expect(opened.status).toBe(200);
    expect((await opened.json()).project.id).toBe(id);
    const presence = await (
      await request(base + "/presence", guest, "POST", { currentFile: "main.tex" })
    ).json();
    expect(presence.users).toEqual(
      expect.arrayContaining([expect.objectContaining({ clientId: guest.client })]),
    );
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
  it("holds newcomers for approval and lets an admin allow or deny them", async () => {
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
    expect(
      (
        await (
          await request(base + "/approval", owner, "PUT", { requireApproval: true })
        ).json()
      ).requireApproval,
    ).toBe(true);
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
  it("retires the invite when a collaborator is removed", async () => {
    const { token } = await shared();
    const base = `/api/shares/${token}`;
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
    ).toBe(200);
  });
  it("stops sharing for everyone but the owner and can share again", async () => {
    const { id, token } = await shared();
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
