// @vitest-environment node
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CloudE2ee,
  projectIdFromShareToken,
  type E2eeResponse,
  type E2eeSocket,
  type E2eeSocketHandlers,
  type RawTransport,
} from "./cloudE2ee.js";
import {
  decryptBytes,
  decryptString,
  encryptBytes,
  encryptString,
  isEncryptedString,
  newProjectKey,
} from "./collabCrypto.js";
import type { ProjectKeyStore } from "./collabKeys.js";

const hex = "a".repeat(32);
const projectId = `project_${hex}`;
const otherId = `project_${"b".repeat(32)}`;
const shareToken = `p${hex}_${"A".repeat(43)}`;
const base = `/api/projects/${projectId}`;

type Handler = (
  path: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
) => E2eeResponse | Promise<E2eeResponse>;

function ok(body: unknown, status = 200): E2eeResponse {
  return { status, statusText: "", text: JSON.stringify(body) };
}

function memoryKeys(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    store: {
      get: vi.fn(async (id: string) => map.get(id) ?? null),
      set: vi.fn(async (id: string, key: string) => {
        map.set(id, key);
      }),
    } as unknown as ProjectKeyStore,
  };
}

interface FakeServer {
  handlers: E2eeSocketHandlers;
  path: string;
  sent: Uint8Array[];
  close: ReturnType<typeof vi.fn>;
}

function setup(handler: Handler, keys = memoryKeys()) {
  const sockets: FakeServer[] = [];
  const request = vi.fn(
    async (
      path: string,
      method: string,
      headers: Record<string, string>,
      body: string | undefined,
    ) => handler(path, method, headers, body),
  );
  const transport: RawTransport = {
    request,
    openSocket: vi.fn(async (path: string, handlers: E2eeSocketHandlers) => {
      const server: FakeServer = { handlers, path, sent: [], close: vi.fn() };
      sockets.push(server);
      const socket: E2eeSocket = {
        send: (data) => server.sent.push(data),
        close: server.close,
      };
      return socket;
    }),
  };
  return { e2ee: new CloudE2ee(keys.store, transport), request, sockets, keys };
}

async function sealUpdate(key: string, update: Uint8Array, id = projectId) {
  return Buffer.from(await encryptBytes(key, id, "text", update)).toString("base64");
}

function textUpdate(content: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getText("content").insert(0, content);
  return Y.encodeStateAsUpdate(doc);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("projectIdFromShareToken", () => {
  it("maps share tokens to project ids and rejects anything else", () => {
    expect(projectIdFromShareToken(shareToken)).toBe(projectId);
    expect(projectIdFromShareToken("nope")).toBeNull();
  });
});

describe("invite keys", () => {
  it("remembers and returns keys only for valid tokens with a key", async () => {
    const { e2ee, keys } = setup(() => ok({}));
    await e2ee.rememberInviteKey("bad", "k");
    await e2ee.rememberInviteKey(shareToken, undefined);
    expect(keys.map.size).toBe(0);
    const key = newProjectKey();
    await e2ee.rememberInviteKey(shareToken, key);
    expect(await e2ee.inviteKey(shareToken)).toBe(key);
    expect(await e2ee.inviteKey("bad")).toBeNull();
  });
});

describe("HTTP requests", () => {
  it("creates a project with a fresh key and a sealed name", async () => {
    let sentBody: Record<string, string> = {};
    let sentHeaders: Record<string, string> = {};
    const { e2ee, keys } = setup((path, method, headers, body) => {
      sentBody = JSON.parse(body!);
      sentHeaders = headers;
      return ok({ id: projectId, name: sentBody.folderName });
    });
    const response = await e2ee.request(
      "/api/projects",
      "POST",
      { "x-latexdo-client-name": "Ada" },
      JSON.stringify({ folderName: "Thesis" }),
      1000,
    );
    expect(response.status).toBe(200);
    expect(JSON.parse(response.text)).toEqual({ id: projectId, name: "Thesis" });
    const key = keys.map.get(projectId)!;
    expect(isEncryptedString(sentBody.folderName)).toBe(true);
    expect(await decryptString(key, "", "name", sentHeaders["x-latexdo-client-name"])).toBe(
      "Ada",
    );
  });

  it("uses name, then a default, when creating projects", async () => {
    const bodies: Array<Record<string, string>> = [];
    const { e2ee, keys } = setup((_p, _m, _h, body) => {
      bodies.push(JSON.parse(body!));
      return ok({ id: projectId });
    });
    await e2ee.request("/api/projects", "POST", {}, JSON.stringify({ name: "N" }), 1);
    const firstKey = keys.map.get(projectId)!;
    expect(await decryptString(firstKey, "", "name", bodies[0].folderName)).toBe("N");
    await e2ee.request("/api/projects", "POST", {}, undefined, 1);
    const secondKey = keys.map.get(projectId)!;
    expect(await decryptString(secondKey, "", "name", bodies[1].folderName)).toBe(
      "Shared project",
    );
  });

  it("passes failed creates through and rejects unexpected answers", async () => {
    const failing = setup(() => ok({ error: "no" }, 500));
    expect((await failing.e2ee.request("/api/projects", "POST", {}, "{}", 1)).status).toBe(
      500,
    );
    const odd = setup(() => ok({ id: "weird" }));
    const response = await odd.e2ee.request("/api/projects", "POST", {}, "{}", 1);
    expect(response.status).toBe(502);
    expect(odd.keys.map.size).toBe(0);
  });

  it("decrypts project listings with each project's own key", async () => {
    const key = newProjectKey();
    const sealed = await encryptString(key, "", "name", "Mine");
    const keys = memoryKeys({ [projectId]: key });
    const { e2ee } = setup(
      () =>
        ok([
          { id: projectId, name: sealed, owner: { name: "plain" } },
          { id: otherId, name: sealed },
          null,
          3,
        ]),
      keys,
    );
    const response = await e2ee.request("/api/projects", "GET", {}, undefined, 1);
    expect(JSON.parse(response.text)).toEqual([
      { id: projectId, name: "Mine", owner: { name: "plain" } },
      { id: otherId, name: sealed },
      null,
      3,
    ]);
  });

  it("passes failed listings through", async () => {
    const { e2ee } = setup(() => ok({}, 401));
    expect((await e2ee.request("/api/projects", "GET", {}, undefined, 1)).status).toBe(401);
  });

  it("forwards non-project paths untouched", async () => {
    const { e2ee, request } = setup(() => ok({ hi: 1 }));
    await e2ee.request("/api/health", "GET", { a: "b" }, undefined, 5);
    await e2ee.request("/api/projects/not-a-project/files", "GET", {}, undefined, 5);
    expect(request).toHaveBeenCalledWith("/api/health", "GET", { a: "b" }, undefined, 5);
    expect(request).toHaveBeenCalledWith(
      "/api/projects/not-a-project/files",
      "GET",
      {},
      undefined,
      5,
    );
  });

  it("answers 403 when the project's key is missing", async () => {
    const { e2ee } = setup(() => ok({}));
    const response = await e2ee.request(`${base}/files`, "GET", {}, undefined, 1);
    expect(response.status).toBe(403);
    expect(JSON.parse(response.text).error).toMatch(/encryption key/);
  });

  it("rethrows other errors", async () => {
    const { e2ee } = setup(() => {
      throw new Error("network down");
    });
    await expect(e2ee.request("/api/projects", "GET", {}, undefined, 1)).rejects.toThrow(
      "network down",
    );
  });

  it("reads text files by merging the encrypted log and ignoring foreign entries", async () => {
    const key = newProjectKey();
    const entries = [
      await sealUpdate(key, textUpdate("hello")),
      await sealUpdate(newProjectKey(), textUpdate("evil")),
    ];
    const { e2ee, request } = setup(
      (path) => (path.includes("/files/log") ? ok({ entries }) : ok({})),
      memoryKeys({ [projectId]: key }),
    );
    const response = await e2ee.request(
      `${base}/files/content?path=main.tex`,
      "GET",
      { "x-latexdo-client-name": "Ada" },
      undefined,
      1,
    );
    expect(JSON.parse(response.text)).toEqual({ content: "hello" });
    expect(request.mock.calls[0][0]).toBe(`${base}/files/log?path=main.tex`);
  });

  it("passes log failures through when reading", async () => {
    const key = newProjectKey();
    for (const status of [404, 500]) {
      const { e2ee } = setup(() => ok({}, status), memoryKeys({ [projectId]: key }));
      const response = await e2ee.request(
        `${base}/files/content?path=a`,
        "GET",
        {},
        undefined,
        1,
      );
      expect(response.status).toBe(status);
    }
  });

  it("writes text files as an encrypted diff over the existing log", async () => {
    const key = newProjectKey();
    const posted: string[] = [];
    const old = textUpdate("old");
    const { e2ee } = setup(
      async (_path, method, _h, body) => {
        if (method === "GET") return ok({ entries: [await sealUpdate(key, old)] });
        posted.push(body!);
        return ok({});
      },
      memoryKeys({ [projectId]: key }),
    );
    const response = await e2ee.request(
      `${base}/files/content?path=a.tex`,
      "PUT",
      {},
      JSON.stringify({ content: "new" }),
      1,
    );
    expect(response.status).toBe(204);
    const sealed = JSON.parse(posted[0]).data as string;
    const update = await decryptBytes(
      key,
      projectId,
      "text",
      new Uint8Array(Buffer.from(sealed, "base64")),
    );
    const doc = new Y.Doc();
    Y.applyUpdate(doc, old);
    Y.applyUpdate(doc, update);
    expect(doc.getText("content").toString()).toBe("new");
  });

  it("writes into a new document when there is no log and reports post failures", async () => {
    const key = newProjectKey();
    const { e2ee } = setup(
      (_path, method) => (method === "GET" ? ok({}, 404) : ok({ error: "full" }, 413)),
      memoryKeys({ [projectId]: key }),
    );
    const response = await e2ee.request(
      `${base}/files/content?path=a.tex`,
      "PUT",
      {},
      JSON.stringify({ content: "x" }),
      1,
    );
    expect(response.status).toBe(413);
  });

  it("rejects non-string content", async () => {
    const key = newProjectKey();
    const { e2ee } = setup(() => ok({}), memoryKeys({ [projectId]: key }));
    for (const body of [JSON.stringify({ content: 3 }), undefined]) {
      const response = await e2ee.request(
        `${base}/files/content?path=a`,
        "PUT",
        {},
        body,
        1,
      );
      expect(response.status).toBe(400);
    }
  });

  it("falls through for other methods on binary paths", async () => {
    const key = newProjectKey();
    const { e2ee, request } = setup(() => ok({ deleted: true }), memoryKeys({ [projectId]: key }));
    const response = await e2ee.request(`${base}/files/binary?path=a`, "DELETE", {}, undefined, 1);
    expect(JSON.parse(response.text)).toEqual({ deleted: true });
    expect(request.mock.calls[0][1]).toBe("DELETE");
  });

  it("falls through for other methods on content paths", async () => {
    const key = newProjectKey();
    const { e2ee } = setup(() => ({ status: 204, statusText: "", text: "" }), memoryKeys({ [projectId]: key }));
    const response = await e2ee.request(`${base}/files/content?path=a`, "DELETE", {}, undefined, 1);
    expect(response.status).toBe(204);
  });

  it("decrypts binary files and reports undecryptable ones", async () => {
    const key = newProjectKey();
    const plain = new Uint8Array([1, 2, 3]);
    const good = Buffer.from(await encryptBytes(key, projectId, "file", plain)).toString(
      "base64",
    );
    let next = good;
    const { e2ee } = setup(() => ok({ base64: next }), memoryKeys({ [projectId]: key }));
    const response = await e2ee.request(`${base}/files/binary?path=a.png`, "GET", {}, undefined, 1);
    expect(JSON.parse(response.text)).toEqual({ base64: "AQID" });
    next = Buffer.from("garbage-garbage-garbage-garbage-garbage").toString("base64");
    const bad = await e2ee.request(`${base}/files/binary?path=a.png`, "GET", {}, undefined, 1);
    expect(bad.status).toBe(422);
  });

  it("serves a text file as bytes when the server says it is text", async () => {
    const key = newProjectKey();
    const entries = [await sealUpdate(key, textUpdate("<svg/>"))];
    const { e2ee } = setup(
      (path) => (path.includes("/files/binary") ? ok({}, 400) : ok({ entries })),
      memoryKeys({ [projectId]: key }),
    );
    const response = await e2ee.request(`${base}/files/binary?path=f.svg`, "GET", {}, undefined, 1);
    expect(Buffer.from(JSON.parse(response.text).base64, "base64").toString()).toBe("<svg/>");
  });

  it("passes binary failures through, including a failed text fallback", async () => {
    const key = newProjectKey();
    const notFound = setup(() => ok({}, 404), memoryKeys({ [projectId]: key }));
    expect(
      (await notFound.e2ee.request(`${base}/files/binary?path=a`, "GET", {}, undefined, 1))
        .status,
    ).toBe(404);
    const fallbackFails = setup(
      (path) => (path.includes("/files/binary") ? ok({}, 400) : ok({}, 500)),
      memoryKeys({ [projectId]: key }),
    );
    expect(
      (await fallbackFails.e2ee.request(`${base}/files/binary?path=a`, "GET", {}, undefined, 1))
        .status,
    ).toBe(500);
  });

  it("encrypts binary uploads and rejects missing data", async () => {
    const key = newProjectKey();
    let uploaded = "";
    const { e2ee } = setup(
      (_p, _m, _h, body) => {
        uploaded = JSON.parse(body!).base64;
        return ok({ ok: true });
      },
      memoryKeys({ [projectId]: key }),
    );
    await e2ee.request(
      `${base}/files/binary?path=a`,
      "PUT",
      {},
      JSON.stringify({ base64: "AQID" }),
      1,
    );
    const plain = await decryptBytes(
      key,
      projectId,
      "file",
      new Uint8Array(Buffer.from(uploaded, "base64")),
    );
    expect([...plain]).toEqual([1, 2, 3]);
    for (const body of [JSON.stringify({}), undefined]) {
      const response = await e2ee.request(`${base}/files/binary?path=a`, "PUT", {}, body, 1);
      expect(response.status).toBe(400);
    }
  });

  it("opens bundles: text logs, binaries, skipping undecryptable files", async () => {
    const key = newProjectKey();
    const binary = Buffer.from(
      await encryptBytes(key, projectId, "file", new Uint8Array([9])),
    ).toString("base64");
    const { e2ee } = setup(
      async () =>
        ok({
          revision: 7,
          files: [
            { relativePath: "main.tex", entries: [await sealUpdate(key, textUpdate("T"))] },
            { relativePath: "a.bin", base64: binary },
            { relativePath: "bad.bin", base64: "AAAA" },
            { relativePath: "dir/" },
          ],
        }),
      memoryKeys({ [projectId]: key }),
    );
    const response = await e2ee.request(`${base}/files/bundle`, "GET", {}, undefined, 1);
    expect(JSON.parse(response.text)).toEqual({
      revision: 7,
      files: [
        { relativePath: "main.tex", content: "T" },
        { relativePath: "a.bin", base64: "CQ==" },
      ],
    });
  });

  it("passes failed bundles through", async () => {
    const key = newProjectKey();
    const { e2ee } = setup(() => ok({}, 503), memoryKeys({ [projectId]: key }));
    expect((await e2ee.request(`${base}/files/bundle`, "GET", {}, undefined, 1)).status).toBe(503);
  });

  it("decrypts names in other project responses and keeps odd bodies intact", async () => {
    const key = newProjectKey();
    const sealed = await encryptString(key, "", "name", "Bob");
    const damaged = await encryptString(newProjectKey(), "", "name", "x");
    let next: E2eeResponse = ok({ members: [{ name: sealed }, { projectName: damaged }] });
    const { e2ee } = setup(() => next, memoryKeys({ [projectId]: key }));
    const response = await e2ee.request(`${base}/members`, "GET", {}, undefined, 1);
    expect(JSON.parse(response.text)).toEqual({
      members: [{ name: "Bob" }, { projectName: "Unknown" }],
    });
    next = { status: 200, statusText: "", text: "not json" };
    expect((await e2ee.request(`${base}/members`, "GET", {}, undefined, 1)).text).toBe(
      "not json",
    );
    next = { status: 204, statusText: "", text: "x" };
    expect((await e2ee.request(`${base}/members`, "GET", {}, undefined, 1)).text).toBe("x");
    next = { status: 200, statusText: "", text: "" };
    expect((await e2ee.request(`${base}/members`, "GET", {}, undefined, 1)).text).toBe("");
  });

  it("resolves projects from share-token paths and seals an already-sealed name once", async () => {
    const key = newProjectKey();
    const sealedName = await encryptString(key, "", "name", "Eve");
    const seen: Array<Record<string, string>> = [];
    const { e2ee } = setup(
      (_p, _m, headers) => {
        seen.push(headers);
        return ok({});
      },
      memoryKeys({ [projectId]: key }),
    );
    await e2ee.request(
      `/api/shares/${shareToken}/info`,
      "GET",
      { "x-latexdo-client-name": sealedName },
      undefined,
      1,
    );
    expect(seen[0]["x-latexdo-client-name"]).toBe(sealedName);
    await e2ee.request(`${base}/x`, "GET", { "x-latexdo-client-name": "Al" }, undefined, 1);
    await e2ee.request(`${base}/x`, "GET", { "x-latexdo-client-name": "Al" }, undefined, 1);
    // The same ciphertext is reused for a name.
    expect(seen[1]["x-latexdo-client-name"]).toBe(seen[2]["x-latexdo-client-name"]);
    const bad = setup(() => ok({}));
    await bad.e2ee.request("/api/shares/bogus/info", "GET", {}, undefined, 1);
    expect(bad.request).toHaveBeenCalledWith("/api/shares/bogus/info", "GET", {}, undefined, 1);
  });
});

// --- Live sockets --------------------------------------------------------------

function frame(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  write(encoder);
  return encoding.toUint8Array(encoder);
}

function logFrame(seq: number, sealed: Uint8Array[], role?: string) {
  return frame((e) => {
    encoding.writeVarUint(e, 11);
    encoding.writeVarUint(e, seq);
    encoding.writeVarUint(e, sealed.length);
    for (const s of sealed) encoding.writeVarUint8Array(e, s);
    if (role !== undefined) encoding.writeVarString(e, role);
  });
}

function editorDocFrom(messages: Uint8Array[]): Y.Doc {
  const doc = new Y.Doc();
  for (const message of messages) {
    const decoder = decoding.createDecoder(message);
    if (decoding.readVarUint(decoder) !== 0) continue;
    syncProtocol.readSyncMessage(decoder, encoding.createEncoder(), doc, "x");
  }
  return doc;
}

const flushAsync = () => new Promise((resolve) => setImmediate(resolve));
const opened = (live: { handlers: { onOpen: ReturnType<typeof vi.fn> } }) =>
  vi.waitFor(() => expect(live.handlers.onOpen).toHaveBeenCalled());
const editorText = (live: { handlers: { onMessage: ReturnType<typeof vi.fn> } }) =>
  editorDocFrom(live.handlers.onMessage.mock.calls.map((c) => c[0] as Uint8Array))
    .getText("content")
    .toString();

async function openLive(role?: string, entries: Uint8Array[] = []) {
  const key = newProjectKey();
  const env = setup(() => ok({}), memoryKeys({ [projectId]: key }));
  const handlers = {
    onOpen: vi.fn(),
    onMessage: vi.fn(),
    onClose: vi.fn(),
    onError: vi.fn(),
  };
  const socket = await env.e2ee.openSocket(
    `${base}/socket?path=main.tex&name=Ada&session=s&clientId=c`,
    handlers,
  );
  const server = env.sockets[0];
  const sealed = [];
  for (const update of entries) sealed.push(await encryptBytes(key, projectId, "text", update));
  return { ...env, key, handlers, socket, server, sealed, role };
}

describe("live sockets", () => {
  it("rejects invalid socket requests and missing keys", async () => {
    const { e2ee } = setup(() => ok({}));
    const handlers = { onOpen: vi.fn(), onMessage: vi.fn(), onClose: vi.fn(), onError: vi.fn() };
    await expect(e2ee.openSocket("/api/other", handlers)).rejects.toThrow(/Invalid/);
    await expect(e2ee.openSocket(`${base}/socket`, handlers)).rejects.toThrow(/Invalid/);
    await expect(e2ee.openSocket(`${base}/socket?path=a`, handlers)).rejects.toThrow(
      /encryption key/,
    );
  });

  it("seals the name in the socket query and keeps an already-sealed one", async () => {
    const live = await openLive();
    const name = new URLSearchParams(live.server.path.split("?")[1]).get("name")!;
    expect(await decryptString(live.key, "", "name", name)).toBe("Ada");
    const key = live.key;
    const sealed = await encryptString(key, "", "name", "Bo");
    await live.e2ee.openSocket(
      `${base}/socket?path=b.tex&name=${encodeURIComponent(sealed)}`,
      live.handlers,
    );
    expect(new URLSearchParams(live.sockets[1].path.split("?")[1]).get("name")).toBe(sealed);
  });

  it("delivers the decrypted log to the editor on connect, then live updates", async () => {
    const update = textUpdate("hello");
    const live = await openLive();
    const foreign = await encryptBytes(newProjectKey(), projectId, "text", update);
    const sealed = await encryptBytes(live.key, projectId, "text", update);
    // Nothing reaches the editor before the log.
    live.socket.send(frame((e) => encoding.writeVarUint(e, 0)));
    live.server.handlers.onMessage(logFrame(3, [sealed, foreign], "editor"));
    await opened(live);
    expect(live.handlers.onOpen).toHaveBeenCalled();
    const messages = live.handlers.onMessage.mock.calls.map((c) => c[0] as Uint8Array);
    expect(editorDocFrom(messages).getText("content").toString()).toBe("hello");
    // The last message asks the editor for its state (sync step 1).
    const last = decoding.createDecoder(messages[messages.length - 1]);
    expect(decoding.readVarUint(last)).toBe(0);
    expect(decoding.readVarUint(last)).toBe(syncProtocol.messageYjsSyncStep1);

    // A live update from the server.
    const doc = new Y.Doc();
    Y.applyUpdate(doc, update);
    const before = Y.encodeStateVector(doc);
    doc.getText("content").insert(5, "!");
    const diff = await encryptBytes(live.key, projectId, "text", Y.encodeStateAsUpdate(doc, before));
    live.server.handlers.onMessage(
      frame((e) => {
        encoding.writeVarUint(e, 10);
        encoding.writeVarUint(e, 4);
        encoding.writeVarUint8Array(e, diff);
      }),
    );
    await vi.waitFor(() => expect(editorText(live)).toBe("hello!"));
  });

  it("applies server updates and ignores foreign or malformed ones", async () => {
    const live = await openLive();
    live.server.handlers.onMessage(logFrame(0, [], "editor"));
    await opened(live);
    live.handlers.onMessage.mockClear();
    const sealed = await encryptBytes(live.key, projectId, "text", textUpdate("abc"));
    live.server.handlers.onMessage(
      frame((e) => {
        encoding.writeVarUint(e, 10);
        encoding.writeVarUint(e, 1);
        encoding.writeVarUint8Array(e, sealed);
      }),
    );
    live.server.handlers.onMessage(
      frame((e) => {
        encoding.writeVarUint(e, 10);
        encoding.writeVarUint(e, 2);
        encoding.writeVarUint8Array(e, new Uint8Array([1, 2]));
      }),
    );
    live.server.handlers.onMessage(new Uint8Array([]));
    live.server.handlers.onMessage(frame((e) => encoding.writeVarUint(e, 99)));
    await vi.waitFor(() => expect(editorText(live)).toBe("abc"));
    // Server updates are not echoed back to the server.
    expect(live.server.sent).toHaveLength(0);
  });

  it("sends the editor's edits to the server sealed and batched", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const live = await openLive();
    live.server.handlers.onMessage(logFrame(0, [], "admin"));
    await opened(live);
    const editor = new Y.Doc();
    editor.getText("content").insert(0, "typed");
    live.socket.send(
      frame((e) => {
        encoding.writeVarUint(e, 0);
        syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(editor));
      }),
    );
    expect(live.server.sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(300);
    await vi.waitFor(() => expect(live.server.sent).toHaveLength(1));
    const decoder = decoding.createDecoder(live.server.sent[0]);
    expect(decoding.readVarUint(decoder)).toBe(10);
    const update = await decryptBytes(
      live.key,
      projectId,
      "text",
      decoding.readVarUint8Array(decoder),
    );
    const check = new Y.Doc();
    Y.applyUpdate(check, update);
    expect(check.getText("content").toString()).toBe("typed");

    // Sync step 1 from the editor gets a step 2 answer.
    live.handlers.onMessage.mockClear();
    live.socket.send(
      frame((e) => {
        encoding.writeVarUint(e, 0);
        syncProtocol.writeSyncStep1(e, new Y.Doc());
      }),
    );
    expect(live.handlers.onMessage).toHaveBeenCalledTimes(1);
    // A malformed sync message is dropped.
    live.socket.send(frame((e) => {
      encoding.writeVarUint(e, 0);
      encoding.writeVarUint(e, 77);
    }));
    live.socket.send(new Uint8Array([]));
  });

  it("serves HTTP reads and writes of an open file through the live document", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const live = await openLive();
    const sealed = await encryptBytes(live.key, projectId, "text", textUpdate("live"));
    live.server.handlers.onMessage(logFrame(0, [sealed], "editor"));
    await opened(live);
    // Another open file of the same project is not this one.
    await live.e2ee.openSocket(`${base}/socket?path=other.tex`, live.handlers);
    live.sockets[1].handlers.onMessage(logFrame(0, [], "editor"));
    await vi.waitFor(() => expect(live.handlers.onOpen).toHaveBeenCalledTimes(2));
    // ...and neither is the same path in another project.
    live.keys.map.set(otherId, newProjectKey());
    await live.e2ee.openSocket(`/api/projects/${otherId}/socket?path=main.tex`, live.handlers);
    live.sockets[2].handlers.onMessage(logFrame(0, [], "editor"));
    await vi.waitFor(() => expect(live.handlers.onOpen).toHaveBeenCalledTimes(3));
    const read = await live.e2ee.request(`${base}/files/content?path=main.tex`, "GET", {}, undefined, 1);
    expect(JSON.parse(read.text)).toEqual({ content: "live" });
    // A file that is not open still goes to the server.
    live.request.mockImplementationOnce(async () => ok({}, 404));
    const closedFile = await live.e2ee.request(`${base}/files/content?path=none.tex`, "GET", {}, undefined, 1);
    expect(closedFile.status).toBe(404);
    live.handlers.onMessage.mockClear();
    const write = await live.e2ee.request(
      `${base}/files/content?path=main.tex`,
      "PUT",
      {},
      JSON.stringify({ content: "saved" }),
      1,
    );
    expect(write.status).toBe(204);
    // The save goes to the editor...
    expect(live.handlers.onMessage).toHaveBeenCalled();
    // ...and, batched, to the server.
    await vi.advanceTimersByTimeAsync(300);
    await vi.waitFor(() => expect(live.server.sent).toHaveLength(1));
    // Saving the same content changes nothing.
    await live.e2ee.request(
      `${base}/files/content?path=main.tex`,
      "PUT",
      {},
      JSON.stringify({ content: "saved" }),
      1,
    );
    await vi.advanceTimersByTimeAsync(300);
    await vi.waitFor(() => expect(live.server.sent).toHaveLength(1));
    // A bundle uses the live document as well.
    live.request.mockImplementation(async () =>
      ok({ files: [{ relativePath: "main.tex", entries: [] }] }),
    );
    const bundle = await live.e2ee.request(`${base}/files/bundle`, "GET", {}, undefined, 1);
    expect(JSON.parse(bundle.text).files[0].content).toBe("saved");
  });

  it("treats viewers as read-only", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const live = await openLive();
    const sealed = await encryptBytes(live.key, projectId, "text", textUpdate("doc"));
    live.server.handlers.onMessage(logFrame(0, [sealed], "viewer"));
    await opened(live);
    const messages = live.handlers.onMessage.mock.calls.map((c) => c[0] as Uint8Array);
    // No sync-step-1 request for viewers.
    expect(messages).toHaveLength(1);
    live.handlers.onMessage.mockClear();
    live.socket.send(
      frame((e) => {
        encoding.writeVarUint(e, 0);
        syncProtocol.writeSyncStep1(e, new Y.Doc());
      }),
    );
    expect(live.handlers.onMessage).toHaveBeenCalledTimes(1);
    expect(
      editorDocFrom(live.handlers.onMessage.mock.calls.map((c) => c[0])).getText("content").toString(),
    ).toBe("doc");
    // Their edits are never forwarded.
    const editor = new Y.Doc();
    editor.getText("content").insert(0, "x");
    live.handlers.onMessage.mockClear();
    live.socket.send(
      frame((e) => {
        encoding.writeVarUint(e, 0);
        syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(editor));
      }),
    );
    live.socket.send(frame((e) => {
      encoding.writeVarUint(e, 0);
      encoding.writeVarUint(e, 77);
    }));
    // A save while viewing is dropped rather than sent.
    await live.e2ee.request(
      `${base}/files/content?path=main.tex`,
      "PUT",
      {},
      JSON.stringify({ content: "attempt" }),
      1,
    );
    await vi.advanceTimersByTimeAsync(300);
    expect(live.server.sent).toHaveLength(0);
    expect(live.handlers.onMessage).toHaveBeenCalledTimes(1);
  });

  it("defaults to editor when the log carries no role and compacts long logs", async () => {
    const live = await openLive();
    const sealed = [];
    for (let i = 0; i < 41; i += 1) {
      const doc = new Y.Doc();
      doc.getText("content").insert(0, String(i % 10));
      sealed.push(await encryptBytes(live.key, projectId, "text", Y.encodeStateAsUpdate(doc)));
    }
    live.request.mockClear();
    await live.e2ee.openSocket(
      `${base}/socket?path=c.tex&share=${shareToken}`,
      live.handlers,
    );
    live.sockets[1].handlers.onMessage(logFrame(42, sealed));
    await vi.waitFor(() => expect(live.request).toHaveBeenCalled());
    const [path, method, headers, body] = live.request.mock.calls[0];
    expect(path).toBe(`${base}/files/log?path=c.tex`);
    expect(method).toBe("POST");
    expect(headers["x-latexdo-share-token"]).toBe(shareToken);
    expect(JSON.parse(body!).replaceUpTo).toBe(42);
    // Compaction from a socket without session/client headers.
    live.request.mockImplementation(async () => {
      throw new Error("offline");
    });
    live.server.handlers.onMessage(logFrame(50, sealed, "editor"));
    await vi.waitFor(() => expect(live.request).toHaveBeenCalledTimes(2));
    const headers2 = live.request.mock.calls[1][2];
    expect(headers2["x-latexdo-session"]).toBe("s");
    expect(headers2["x-latexdo-share-token"]).toBeUndefined();
  });

  it("relays cursors both ways sealed, dropping foreign or non-awareness ones", async () => {
    const live = await openLive();
    live.server.handlers.onMessage(logFrame(0, [], "editor"));
    await opened(live);
    live.handlers.onMessage.mockClear();
    const awareness = new Uint8Array([1, 5, 6]);
    live.socket.send(awareness);
    await vi.waitFor(() => expect(live.server.sent).toHaveLength(1));
    const decoder = decoding.createDecoder(live.server.sent[0]);
    expect(decoding.readVarUint(decoder)).toBe(12);
    const sealedCursor = decoding.readVarUint8Array(decoder);
    expect([...(await decryptBytes(live.key, projectId, "cursor", sealedCursor))]).toEqual([
      1, 5, 6,
    ]);
    // Unknown editor messages are ignored.
    live.socket.send(new Uint8Array([9]));

    const cursorFrame = (sealed: Uint8Array) =>
      frame((e) => {
        encoding.writeVarUint(e, 12);
        encoding.writeVarUint8Array(e, sealed);
      });
    live.server.handlers.onMessage(cursorFrame(sealedCursor));
    live.server.handlers.onMessage(
      cursorFrame(await encryptBytes(live.key, projectId, "cursor", new Uint8Array([2, 1]))),
    );
    live.server.handlers.onMessage(cursorFrame(new Uint8Array([0])));
    await vi.waitFor(() => expect(live.handlers.onMessage).toHaveBeenCalled());
    for (let i = 0; i < 5; i += 1) await flushAsync();
    expect(live.handlers.onMessage).toHaveBeenCalledTimes(1);
    expect([...live.handlers.onMessage.mock.calls[0][0]]).toEqual([1, 5, 6]);
  });

  it("decrypts presence and join-request frames and forwards project changes", async () => {
    const live = await openLive();
    const sealedName = await encryptString(live.key, "", "name", "Cy");
    const jsonFrame = (type: number, text: string) =>
      frame((e) => {
        encoding.writeVarUint(e, type);
        encoding.writeVarString(e, text);
      });
    // Queued until the log arrives.
    live.server.handlers.onMessage(jsonFrame(4, JSON.stringify([{ name: sealedName }])));
    await flushAsync();
    expect(live.handlers.onMessage).not.toHaveBeenCalled();
    live.server.handlers.onMessage(logFrame(0, [], "viewer"));
    await opened(live);
    const calls = () => live.handlers.onMessage.mock.calls.length;
    await vi.waitFor(() => expect(calls()).toBe(1));
    live.server.handlers.onMessage(jsonFrame(6, JSON.stringify({ name: sealedName })));
    await vi.waitFor(() => expect(calls()).toBe(2));
    live.server.handlers.onMessage(jsonFrame(6, "{bad"));
    const changed = frame((e) => encoding.writeVarUint(e, 5));
    live.server.handlers.onMessage(changed);
    await vi.waitFor(() => expect(calls()).toBe(3));
    const out = live.handlers.onMessage.mock.calls.map((c) => c[0] as Uint8Array);
    const read = (m: Uint8Array) => {
      const d = decoding.createDecoder(m);
      return [decoding.readVarUint(d), JSON.parse(decoding.readVarString(d))];
    };
    expect(read(out[0])).toEqual([4, [{ name: "Cy" }]]);
    expect(read(out[1])).toEqual([6, { name: "Cy" }]);
    expect(out[2]).toBe(changed);
    expect(out).toHaveLength(3);
  });

  it("closes cleanly, flushing pending edits and ignoring later traffic", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const live = await openLive();
    live.server.handlers.onMessage(logFrame(0, [], "editor"));
    await opened(live);
    const editor = new Y.Doc();
    editor.getText("content").insert(0, "late");
    live.socket.send(
      frame((e) => {
        encoding.writeVarUint(e, 0);
        syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(editor));
      }),
    );
    live.server.handlers.onError();
    expect(live.handlers.onError).toHaveBeenCalled();
    live.socket.close();
    expect(live.server.close).toHaveBeenCalledWith(undefined, undefined);
    expect(live.handlers.onClose).toHaveBeenCalledWith(1000, "");
    await vi.waitFor(() => expect(live.server.sent).toHaveLength(1));
    // A second close (from the server) is ignored.
    live.server.handlers.onClose(1006, "gone");
    expect(live.handlers.onClose).toHaveBeenCalledTimes(1);
    // Server traffic after close never reaches the editor.
    const before = live.handlers.onMessage.mock.calls.length;
    live.server.handlers.onMessage(frame((e) => encoding.writeVarUint(e, 5)));
    expect(live.handlers.onMessage).toHaveBeenCalledTimes(before);
    // Sending after close does nothing.
    live.socket.send(new Uint8Array([1, 2]));
    // The live session is gone: reads go back to the server.
    live.request.mockImplementation(async () => ok({}, 404));
    expect(
      (await live.e2ee.request(`${base}/files/content?path=main.tex`, "GET", {}, undefined, 1))
        .status,
    ).toBe(404);
  });

  it("closes from the server side with its code and reason", async () => {
    const live = await openLive();
    live.server.handlers.onOpen();
    live.server.handlers.onClose(4001, "revoked");
    expect(live.handlers.onClose).toHaveBeenCalledWith(4001, "revoked");
    live.socket.close(1001, "bye");
    expect(live.handlers.onClose).toHaveBeenCalledTimes(1);
  });
});

