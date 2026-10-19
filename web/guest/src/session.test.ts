// @vitest-environment node
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newProjectKey } from "../../../electron/collabCrypto.js";
import {
  bytesToBase64,
  decryptBytes,
  decryptString,
  encryptBytes,
  encryptString,
} from "./crypto";
import type { WebInvite } from "./invite";
import {
  GuestError,
  GuestSession,
  type GuestEnvironment,
  type LiveFileEvents,
  type LiveFile,
} from "./session";

const projectId = `project_${"a".repeat(32)}`;
const token = `p${"a".repeat(32)}_${"b".repeat(43)}`;
const identity = {
  sessionId: "session-1",
  clientId: "client-1",
  name: "Grace",
  color: "#f00",
  emoji: "🦊",
};

interface FetchCall {
  url: string;
  init: RequestInit;
}

function response(status: number, body: string) {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

class FakeSocket {
  static instances: FakeSocket[] = [];
  static throwNext = false;
  binaryType = "";
  readyState = 1;
  sent: Uint8Array[] = [];
  closedWith: [number?, string?] | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  constructor(readonly url: string) {
    if (FakeSocket.throwNext) {
      FakeSocket.throwNext = false;
      throw new Error("blocked");
    }
    FakeSocket.instances.push(this);
  }
  send(data: Uint8Array) {
    this.sent.push(data);
  }
  close(code?: number, reason?: string) {
    this.closedWith = [code, reason];
  }
  deliver(bytes: Uint8Array) {
    const copy = bytes.slice();
    this.onmessage?.({ data: copy.buffer });
  }
}

function setup(
  handler: (call: FetchCall) => ReturnType<typeof response> = () => response(200, "{}"),
) {
  const key = newProjectKey();
  const invite: WebInvite = { token, key, projectId };
  const calls: FetchCall[] = [];
  FakeSocket.instances = [];
  const env = {
    fetch: (async (url: string, init: RequestInit) => {
      const call = { url, init };
      calls.push(call);
      return handler(call);
    }) as unknown as typeof fetch,
    WebSocket: FakeSocket as unknown as typeof WebSocket,
  } satisfies GuestEnvironment;
  const session = new GuestSession("https://collab.example", invite, identity, env);
  return { key, invite, calls, session };
}

async function logFrame(
  key: string,
  updates: Uint8Array[],
  role?: string,
  seq = 7,
  extraRaw: Uint8Array[] = [],
) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 11);
  encoding.writeVarUint(encoder, seq);
  encoding.writeVarUint(encoder, updates.length + extraRaw.length);
  for (const update of updates) {
    encoding.writeVarUint8Array(encoder, await encryptBytes(key, projectId, "text", update));
  }
  for (const raw of extraRaw) encoding.writeVarUint8Array(encoder, raw);
  if (role !== undefined) encoding.writeVarString(encoder, role);
  return encoding.toUint8Array(encoder);
}

function remoteUpdate(text: string) {
  const doc = new Y.Doc();
  doc.getText("content").insert(0, text);
  return Y.encodeStateAsUpdate(doc);
}

async function opened(file: LiveFile) {
  await vi.waitFor(() => expect(FakeSocket.instances.length).toBeGreaterThan(0));
  return FakeSocket.instances.at(-1)!;
}

function readFrame(bytes: Uint8Array) {
  const decoder = decoding.createDecoder(bytes);
  const type = decoding.readVarUint(decoder);
  return { type, payload: decoding.readVarUint8Array(decoder) };
}

const openFiles: LiveFile[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(openFiles.splice(0).map((file) => file.close().catch(() => undefined)));
});

describe("GuestSession HTTP", () => {
  it("seals the guest name once and sends the share headers", async () => {
    const { session, calls, key } = setup(() => response(200, '{"a":1}'));
    const first = await session.name();
    expect(await session.name()).toBe(first);
    expect(await decryptString(key, "", "name", first)).toBe("Grace");
    expect(await session.request("GET", "/x")).toEqual({ a: 1 });
    const call = calls[0];
    expect(call.url).toBe("https://collab.example/x");
    expect(call.init.body).toBeUndefined();
    expect(call.init.credentials).toBe("omit");
    const headers = call.init.headers as Record<string, string>;
    expect(headers["x-latexdo-share-token"]).toBe(token);
    expect(headers["x-latexdo-client-name"]).toBe(first);
    await session.request("POST", "/y", { b: 2 });
    expect(calls[1].init.body).toBe('{"b":2}');
  });

  it("treats empty and non-JSON successes as empty objects", async () => {
    let body = "";
    const { session } = setup(() => response(200, body));
    expect(await session.request("GET", "/")).toEqual({});
    body = "not json";
    expect(await session.request("GET", "/")).toEqual({});
  });

  it("raises GuestError with the server's message and code, or a status fallback", async () => {
    let next = response(403, '{"error":"Nope","code":"denied"}');
    const { session } = setup(() => next);
    const error = await session.request("GET", "/").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GuestError);
    expect(error).toMatchObject({ status: 403, message: "Nope", code: "denied" });
    next = response(500, "<html>");
    const fallback = await session.request("GET", "/").catch((e: unknown) => e);
    expect(fallback).toMatchObject({
      status: 500,
      message: "The server answered 500.",
      code: undefined,
    });
  });

  it("opens plain, sealed, damaged and missing names", async () => {
    const { session, key } = setup();
    expect(await session.openName("plain")).toBe("plain");
    expect(await session.openName(42)).toBe("");
    const sealed = await encryptString(key, "", "name", "Ada");
    expect(await session.openName(sealed)).toBe("Ada");
    const other = await encryptString(newProjectKey(), "", "name", "Eve");
    expect(await session.openName(other)).toBe("Unknown");
  });

  it("reads people lists, skipping malformed entries", async () => {
    const { session } = setup();
    expect(await session.openPeople("nope")).toEqual([]);
    expect(
      await session.openPeople([
        null,
        { clientId: 3 },
        { clientId: "a", name: "Ann", currentFile: "main.tex" },
        { clientId: "b", name: "" },
      ]),
    ).toEqual([
      { clientId: "a", name: "Ann", currentFile: "main.tex" },
      { clientId: "b", name: "Guest", currentFile: null },
    ]);
  });

  it("joins a project with its name, role and people", async () => {
    const { session, key, calls } = setup();
    const name = await encryptString(key, "", "name", "Thesis");
    const s2 = setup(() =>
      response(
        200,
        JSON.stringify({
          project: { name },
          collaboration: { currentUserRole: "editor", users: [{ clientId: "x", name: "X" }] },
        }),
      ),
    );
    // Use the same key so the name opens.
    const joined = new GuestSession(
      "https://collab.example",
      { token, key, projectId },
      identity,
      {
        fetch: ((url: string, init: RequestInit) => {
          calls.push({ url, init });
          return Promise.resolve(
            response(
              200,
              JSON.stringify({
                project: { name },
                collaboration: {
                  currentUserRole: "editor",
                  users: [{ clientId: "x", name: "X" }],
                },
              }),
            ),
          );
        }) as unknown as typeof fetch,
        WebSocket: FakeSocket as unknown as typeof WebSocket,
      },
    );
    expect(await joined.join()).toEqual({
      status: "ready",
      projectName: "Thesis",
      role: "editor",
      users: [{ clientId: "x", name: "X", currentFile: null }],
    });
    expect(calls.at(-1)!.url).toContain(`/api/shares/${token}/open`);
    expect(session.projectBase).toBe(`/api/projects/${projectId}`);
    expect(await s2.session.join()).toMatchObject({ projectName: "Unknown" });
  });

  it("falls back to defaults when the project answer is bare", async () => {
    const { session } = setup(() => response(200, "{}"));
    expect(await session.join()).toEqual({
      status: "ready",
      projectName: "Shared project",
      role: "viewer",
      users: [],
    });
  });

  it("reports pending approval and errors when joining", async () => {
    let next = response(403, '{"error":"wait","code":"approval-pending"}');
    const { session } = setup(() => next);
    expect(await session.join()).toEqual({ status: "pending" });
    next = response(410, '{"error":"Gone","code":"stopped"}');
    expect(await session.join()).toEqual({ status: "error", message: "Gone", code: "stopped" });

    const broken = new GuestSession(
      "https://c",
      { token, key: newProjectKey(), projectId },
      identity,
      {
        fetch: (() => Promise.reject("offline")) as unknown as typeof fetch,
        WebSocket: FakeSocket as unknown as typeof WebSocket,
      },
    );
    expect(await broken.join()).toEqual({
      status: "error",
      message: "Could not open the project.",
      code: undefined,
    });
    const thrown = new GuestSession(
      "https://c",
      { token, key: newProjectKey(), projectId },
      identity,
      {
        fetch: (() => Promise.reject(new Error("boom"))) as unknown as typeof fetch,
        WebSocket: FakeSocket as unknown as typeof WebSocket,
      },
    );
    expect(await thrown.join()).toEqual({ status: "error", message: "boom", code: undefined });
  });

  it("lists the tree, posts presence and reads binary files", async () => {
    let next = response(200, '[{"name":"a","relativePath":"a","type":"file"}]');
    const { session, key, calls } = setup(() => next);
    expect(await session.tree()).toHaveLength(1);
    expect(calls[0].url).toBe(`https://collab.example/api/projects/${projectId}/files`);
    next = response(200, "{}");
    expect(await session.tree()).toEqual([]);

    next = response(200, '{"users":[{"clientId":"z","name":"Zed","currentFile":"b.tex"}]}');
    expect(await session.presence("b.tex")).toEqual([
      { clientId: "z", name: "Zed", currentFile: "b.tex" },
    ]);
    expect(calls.at(-1)!.init.body).toBe('{"currentFile":"b.tex"}');

    const sealed = await encryptBytes(key, projectId, "file", new Uint8Array([1, 2, 3]));
    next = response(200, JSON.stringify({ base64: bytesToBase64(sealed) }));
    expect(await session.readBinary("fig 1.png")).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls.at(-1)!.url).toContain("path=fig%201.png");
  });

  it("builds wss and ws socket URLs", async () => {
    const { session } = setup();
    const url = new URL(await session.socketUrl("main.tex"));
    expect(url.protocol).toBe("wss:");
    expect(url.pathname).toBe(`/api/projects/${projectId}/files/collaborate`);
    expect(url.searchParams.get("path")).toBe("main.tex");
    expect(url.searchParams.get("share")).toBe(token);
    const plain = new GuestSession(
      "http://localhost:1",
      { token, key: newProjectKey(), projectId },
      identity,
    );
    expect(await plain.socketUrl("a")).toMatch(/^ws:/);
  });
});

describe("LiveFile", () => {
  function open(session: GuestSession, events: LiveFileEvents = {}) {
    const file = session.openFile("main.tex", events);
    openFiles.push(file);
    return file;
  }

  it("loads the log, applies remote edits and sends local edits as an editor", async () => {
    const { session, key } = setup();
    const statuses: string[] = [];
    const onReady = vi.fn();
    const file = open(session, { onStatus: (s) => statuses.push(s), onReady });
    const socket = await opened(file);
    expect(socket.binaryType).toBe("arraybuffer");
    expect(socket.url).toContain("path=main.tex");

    // Ignored: non-binary and empty frames.
    socket.onmessage?.({ data: "text" });
    socket.deliver(new Uint8Array());

    // Local edit before the log arrives (offline edit) is sent as a difference.
    file.text.insert(0, "local ");
    const base = remoteUpdate("server");
    socket.deliver(await logFrame(key, [base], "editor", 3, [new Uint8Array([9, 9, 9])]));
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledWith(true));
    expect(file.ready).toBe(true);
    expect(file.canEdit).toBe(true);
    expect(file.text.toString()).toContain("server");
    expect(statuses).toEqual(["connecting", "live"]);

    await vi.waitFor(() => {
      const types = socket.sent.map((bytes) => readFrame(bytes).type);
      expect(types).toContain(10);
      expect(types).toContain(12);
    });
    const updateFrame = socket.sent.find((bytes) => readFrame(bytes).type === 10)!;
    const sentUpdate = await decryptBytes(key, projectId, "text", readFrame(updateFrame).payload);
    const check = new Y.Doc();
    Y.applyUpdate(check, base);
    Y.applyUpdate(check, sentUpdate);
    expect(check.getText("content").toString()).toContain("local");

    // Live typing is batched and sent.
    const before = socket.sent.length;
    file.text.insert(0, "x");
    await vi.waitFor(() => expect(socket.sent.length).toBeGreaterThan(before), {
      timeout: 2000,
    });

    // A remote update.
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 10);
    encoding.writeVarUint(enc, 1);
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(file.doc));
    other.getText("content").insert(0, "R");
    encoding.writeVarUint8Array(
      enc,
      await encryptBytes(
        key,
        projectId,
        "text",
        Y.encodeStateAsUpdate(other, Y.encodeStateVector(file.doc)),
      ),
    );
    socket.deliver(encoding.toUint8Array(enc));
    await vi.waitFor(() => expect(file.text.toString().startsWith("R")).toBe(true));

    // A damaged update is ignored.
    const bad = encoding.createEncoder();
    encoding.writeVarUint(bad, 10);
    encoding.writeVarUint(bad, 2);
    encoding.writeVarUint8Array(bad, new Uint8Array([1, 2]));
    socket.deliver(encoding.toUint8Array(bad));
  });

  it("is read-only as a viewer and without a role, and drops pending edits", async () => {
    const { session, key } = setup();
    const onReady = vi.fn();
    const file = open(session, { onReady });
    const socket = await opened(file);
    socket.deliver(await logFrame(key, [remoteUpdate("hi")]));
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledWith(false));
    expect(file.canEdit).toBe(false);
    file.text.insert(0, "nope");
    await new Promise((r) => setTimeout(r, 300));
    expect(socket.sent.every((bytes) => readFrame(bytes).type !== 10)).toBe(true);
  });

  it("compacts a long log as an admin", async () => {
    const { session, key, calls } = setup();
    const file = open(session, {});
    const socket = await opened(file);
    const updates = Array.from({ length: 41 }, (_, i) => {
      const d = new Y.Doc();
      d.clientID = 1000 + i;
      d.getText("content").insert(0, String(i % 10));
      return Y.encodeStateAsUpdate(d);
    });
    socket.deliver(await logFrame(key, updates, "admin", 55));
    await vi.waitFor(() =>
      expect(calls.some((c) => c.url.includes("/files/log?path=main.tex"))).toBe(true),
    );
    const call = calls.find((c) => c.url.includes("/files/log"))!;
    expect(JSON.parse(call.init.body as string)).toMatchObject({ replaceUpTo: 55 });
  });

  it("applies remote cursors and presence and project changes", async () => {
    const { session, key } = setup();
    const onPresence = vi.fn();
    const onProjectChanged = vi.fn();
    const file = open(session, { onPresence, onProjectChanged });
    const socket = await opened(file);
    socket.deliver(await logFrame(key, [], "editor"));
    await vi.waitFor(() => expect(file.ready).toBe(true));

    // A remote cursor.
    const remoteDoc = new Y.Doc();
    const remote = new awarenessProtocol.Awareness(remoteDoc);
    remote.setLocalState({ user: { name: "Remote" } });
    const inner = encoding.createEncoder();
    encoding.writeVarUint(inner, 1);
    encoding.writeVarUint8Array(
      inner,
      awarenessProtocol.encodeAwarenessUpdate(remote, [remoteDoc.clientID]),
    );
    const cursor = encoding.createEncoder();
    encoding.writeVarUint(cursor, 12);
    encoding.writeVarUint8Array(
      cursor,
      await encryptBytes(key, projectId, "cursor", encoding.toUint8Array(inner)),
    );
    socket.deliver(encoding.toUint8Array(cursor));
    await vi.waitFor(() =>
      expect(file.awareness.getStates().get(remoteDoc.clientID)).toEqual({
        user: { name: "Remote" },
      }),
    );

    // A cursor frame with another inner type is ignored.
    const wrong = encoding.createEncoder();
    encoding.writeVarUint(wrong, 12);
    const wrongInner = encoding.createEncoder();
    encoding.writeVarUint(wrongInner, 2);
    encoding.writeVarUint8Array(
      wrong,
      await encryptBytes(key, projectId, "cursor", encoding.toUint8Array(wrongInner)),
    );
    socket.deliver(encoding.toUint8Array(wrong));
    // A damaged cursor frame is ignored.
    const damaged = encoding.createEncoder();
    encoding.writeVarUint(damaged, 12);
    encoding.writeVarUint8Array(damaged, new Uint8Array([1]));
    socket.deliver(encoding.toUint8Array(damaged));

    // Presence.
    const presence = encoding.createEncoder();
    encoding.writeVarUint(presence, 4);
    encoding.writeVarString(presence, JSON.stringify({ users: [{ clientId: "p", name: "P" }] }));
    socket.deliver(encoding.toUint8Array(presence));
    await vi.waitFor(() =>
      expect(onPresence).toHaveBeenCalledWith([{ clientId: "p", name: "P", currentFile: null }]),
    );
    const badPresence = encoding.createEncoder();
    encoding.writeVarUint(badPresence, 4);
    encoding.writeVarString(badPresence, "{");
    socket.deliver(encoding.toUint8Array(badPresence));

    const changed = encoding.createEncoder();
    encoding.writeVarUint(changed, 5);
    socket.deliver(encoding.toUint8Array(changed));
    const unknown = encoding.createEncoder();
    encoding.writeVarUint(unknown, 99);
    socket.deliver(encoding.toUint8Array(unknown));
    await vi.waitFor(() => expect(onProjectChanged).toHaveBeenCalledTimes(1));
    expect(onPresence).toHaveBeenCalledTimes(1);

    // Local cursor moves are sent once ready.
    const before = socket.sent.length;
    file.awareness.setLocalStateField("cursor", 5);
    await vi.waitFor(() => expect(socket.sent.length).toBeGreaterThan(before));
    expect(readFrame(socket.sent.at(-1)!).type).toBe(12);

    // Dropping the connection removes remote cursors and reconnects.
    socket.onclose?.({ code: 1006, reason: "" });
    expect(file.ready).toBe(false);
    expect(file.awareness.getStates().has(remoteDoc.clientID)).toBe(false);
  });

  it("does not send when the socket is not open", async () => {
    const { session, key } = setup();
    const file = open(session);
    const socket = await opened(file);
    socket.readyState = 0;
    socket.deliver(await logFrame(key, [], "editor"));
    await vi.waitFor(() => expect(file.ready).toBe(true));
    file.awareness.setLocalStateField("cursor", 1);
    await new Promise((r) => setTimeout(r, 20));
    expect(socket.sent).toEqual([]);
  });

  it("reconnects after an ordinary close and after a role change, with backoff", async () => {
    vi.useFakeTimers();
    const { session } = setup();
    const statuses: string[] = [];
    const file = open(session, { onStatus: (s) => statuses.push(s) });
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const first = FakeSocket.instances[0];
    first.onclose?.({ code: 1006, reason: "" });
    expect(statuses).toContain("offline");
    // A stale close from an old socket is ignored.
    first.onclose?.({ code: 1006, reason: "" });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
    FakeSocket.instances[1].onclose?.({ code: 1008, reason: "Permissions changed" });
    await vi.advanceTimersByTimeAsync(1999);
    expect(FakeSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(3));
    expect(file.ready).toBe(false);
  });

  it("stops for good on a policy close, with or without a reason", async () => {
    const { session } = setup();
    const statuses: Array<[string, string | undefined]> = [];
    const file = open(session, { onStatus: (s, d) => statuses.push([s, d]) });
    const socket = await opened(file);
    socket.onclose?.({ code: 1008, reason: "Removed" });
    expect(statuses.at(-1)).toEqual(["closed", "Removed"]);

    const second = setup();
    const events: Array<[string, string | undefined]> = [];
    const other = open(second.session, { onStatus: (s, d) => events.push([s, d]) });
    const otherSocket = await opened(other);
    otherSocket.onclose?.({ code: 1008, reason: "" });
    expect(events.at(-1)).toEqual(["closed", "The connection was closed."]);
    // Further closes do nothing once closed.
    expect(await other.close()).toBeUndefined();
  });

  it("retries when the socket cannot be created", async () => {
    vi.useFakeTimers();
    FakeSocket.throwNext = true;
    const { session } = setup();
    open(session);
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(FakeSocket.throwNext).toBe(false));
    expect(FakeSocket.instances).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
  });

  it("closes the socket if closed while connecting, and closes cleanly", async () => {
    const { session } = setup();
    const statuses: string[] = [];
    const file = session.openFile("main.tex", { onStatus: (s) => statuses.push(s) });
    // Close before the socket URL resolves.
    const closing = file.close();
    await closing;
    expect(statuses.at(-1)).toBe("closed");
    await new Promise((r) => setTimeout(r, 20));
    // A connect that had already started never keeps a socket open.
    for (const socket of FakeSocket.instances) expect(socket.closedWith).not.toBeNull();

    const s2 = setup();
    const live = s2.session.openFile("main.tex", {});
    const socket = await opened(live);
    await live.close();
    expect(socket.closedWith).toEqual([1000, "Closed"]);
    // Close after close is a no-op and a late close event is ignored.
    await live.close();
    socket.onclose?.({ code: 1006, reason: "" });
  });

  it("clears a pending reconnect timer on close", async () => {
    vi.useFakeTimers();
    const { session } = setup();
    const file = session.openFile("main.tex", {});
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    FakeSocket.instances[0].onclose?.({ code: 1006, reason: "" });
    const closing = file.close();
    await vi.advanceTimersByTimeAsync(60);
    await closing;
    await vi.advanceTimersByTimeAsync(5000);
    expect(FakeSocket.instances).toHaveLength(1);
  });
  it("closes a socket that opens after the file was closed", async () => {
    const { session } = setup();
    vi.spyOn(session, "socketUrl").mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 120));
      return "wss://late";
    });
    const file = session.openFile("main.tex", {});
    await file.close();
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    expect(FakeSocket.instances[0].closedWith).toEqual([undefined, undefined]);
    expect(FakeSocket.instances[0].onmessage).toBeNull();
  });

  it("keeps edits typed just before a disconnect in the document only", async () => {
    const { session, key } = setup();
    const file = open(session);
    const socket = await opened(file);
    socket.deliver(await logFrame(key, [], "editor"));
    await vi.waitFor(() => expect(file.ready).toBe(true));
    const before = socket.sent.length;
    file.text.insert(0, "typed");
    socket.onclose?.({ code: 1006, reason: "" });
    await new Promise((r) => setTimeout(r, 300));
    expect(socket.sent.slice(before).some((b) => readFrame(b).type === 10)).toBe(false);
    expect(file.text.toString()).toBe("typed");
  });

  it("ignores a failed compaction", async () => {
    const { session, key, calls } = setup((call) => {
      if (call.url.includes("/files/log")) throw new Error("offline");
      return response(200, "{}");
    });
    const file = open(session);
    const socket = await opened(file);
    const updates = Array.from({ length: 41 }, (_, i) => {
      const d = new Y.Doc();
      d.clientID = 5000 + i;
      d.getText("content").insert(0, "a");
      return Y.encodeStateAsUpdate(d);
    });
    socket.deliver(await logFrame(key, updates, "editor"));
    await vi.waitFor(() => expect(calls.some((c) => c.url.includes("/files/log"))).toBe(true));
    expect(file.ready).toBe(true);
  });
});
