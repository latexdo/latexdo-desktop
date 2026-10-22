import * as sync from "y-protocols/sync";
import { encodeAwarenessUpdate } from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CollaborationApiError } from "./collaborationApi";
import { LatexDoWebsocketProvider } from "./websocketProvider";
import type { CollaborationConnectionStatus } from "./collaborationTypes";

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  binaryType: BinaryType = "blob";
  readyState = FakeWebSocket.CONNECTING;
  bufferedAmount = 0;
  closeCode: number | null = null;
  readonly sent: unknown[] = [];

  constructor(readonly url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }

  send(message: unknown): void {
    this.sent.push(message);
  }

  close(code = 1000, reason = ""): void {
    this.closeCode = code ?? 1000;
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent("close", { code, reason }));
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  receive(data: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

const originalWebSocket = globalThis.WebSocket;

function installFakeWebSocket(webSocket: typeof WebSocket): void {
  globalThis.WebSocket = webSocket;
}

function syncedState(provider: LatexDoWebsocketProvider): { synced: boolean } {
  return provider as unknown as { synced: boolean };
}

function presenceFrame(snapshot: unknown): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 4);
  encoding.writeVarString(encoder, JSON.stringify(snapshot));
  return encoding.toUint8Array(encoder).buffer as ArrayBuffer;
}

describe("LatexDoWebsocketProvider", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    installFakeWebSocket(FakeWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("applies real Yjs synchronization and awareness frames without echoing remote updates", async () => {
    const doc = new Y.Doc();
    const remote = new Y.Doc();
    const awareness = new Awareness(doc);
    const remoteAwareness = new Awareness(remote);
    const onSynced = vi.fn();
    const onProjectChanged = vi.fn();
    const onStatusChange = vi.fn();
    const provider = new LatexDoWebsocketProvider({
      url: "wss://collab.example.org/socket",
      doc,
      awareness,
      onSynced,
      onProjectChanged,
      onStatusChange,
    });
    const socket = FakeWebSocket.instances[0];
    socket.open();
    try {
      const hello = encoding.createEncoder();
      encoding.writeVarUint(hello, 0);
      sync.writeSyncStep1(hello, remote);
      const sent = socket.sent.length;
      socket.receive(encoding.toUint8Array(hello).buffer);
      await Promise.resolve();
      expect(socket.sent.length).toBeGreaterThan(sent);
      expect(onSynced).toHaveBeenCalledOnce();
      remote.getText("content").insert(0, "Shared document");
      const update = encoding.createEncoder();
      encoding.writeVarUint(update, 0);
      sync.writeUpdate(update, Y.encodeStateAsUpdate(remote));
      socket.receive(encoding.toUint8Array(update).buffer);
      await Promise.resolve();
      expect(doc.getText("content").toString()).toBe("Shared document");
      expect(onSynced).toHaveBeenCalledOnce();
      remoteAwareness.setLocalState({ user: { name: "Grace" } });
      const frame = encoding.createEncoder();
      encoding.writeVarUint(frame, 1);
      encoding.writeVarUint8Array(
        frame,
        encodeAwarenessUpdate(remoteAwareness, [remote.clientID]),
      );
      socket.receive(encoding.toUint8Array(frame).buffer);
      await Promise.resolve();
      expect(awareness.getStates().get(remote.clientID)).toEqual({
        user: { name: "Grace" },
      });
      awareness.setLocalState({ user: { name: "Ada" } });
      const changed = encoding.createEncoder();
      encoding.writeVarUint(changed, 5);
      encoding.writeVarString(changed, JSON.stringify({ revision: 42 }));
      socket.receive(encoding.toUint8Array(changed).buffer);
      await Promise.resolve();
      expect(onProjectChanged).toHaveBeenCalledWith(42);
      for (const bytes of [
        [255],
        [0],
        [1, 0],
        [1, 1, 255],
        [4, 1, 123],
        [5, 1, 123],
        [6, 1, 123],
      ])
        socket.receive(new Uint8Array(bytes).buffer);
      await Promise.resolve();
      expect(onProjectChanged).toHaveBeenCalledOnce();
      socket.dispatchEvent(new Event("error"));
      expect(onStatusChange).toHaveBeenLastCalledWith("error");
    } finally {
      provider.destroy();
      awareness.destroy();
      remoteAwareness.destroy();
      doc.destroy();
      remote.destroy();
    }
  });

  it("handles immediate WebSocket construction failures", () => {
    vi.useFakeTimers();
    const statuses: CollaborationConnectionStatus[] = [];
    const ThrowingWebSocket = class {
      constructor() {
        throw new Error("invalid websocket url");
      }
    };
    installFakeWebSocket(ThrowingWebSocket as unknown as typeof WebSocket);

    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const provider = new LatexDoWebsocketProvider({
      url: "wss://collab.example.org/socket",
      doc,
      awareness,
      onStatusChange: (status) => statuses.push(status),
    });

    expect(statuses).toEqual(["connecting", "error"]);
    provider.destroy();
    awareness.destroy();
    doc.destroy();
  });

  it("resets synced state on close and ignores malformed messages", () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const provider = new LatexDoWebsocketProvider({
      url: "wss://collab.example.org/socket",
      doc,
      awareness,
    });
    const socket = FakeWebSocket.instances[0];
    socket.open();
    syncedState(provider).synced = true;

    expect(() => socket.receive(new ArrayBuffer(0))).not.toThrow();
    expect(() => socket.receive(Uint8Array.of(1).buffer)).not.toThrow();
    socket.close();

    expect(syncedState(provider).synced).toBe(false);
    provider.destroy();
    awareness.destroy();
    doc.destroy();
  });

  it("adds jitter before reconnecting a disconnected client", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const provider = new LatexDoWebsocketProvider({
      url: "wss://collab.example.org/socket",
      doc,
      awareness,
    });

    FakeWebSocket.instances[0].close();
    vi.advanceTimersByTime(374);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    provider.destroy();
    awareness.destroy();
    doc.destroy();
  });

  it("requests a fresh single-use URL before every reconnect", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const urlFactory = vi
      .fn<() => Promise<string>>()
      .mockResolvedValue("wss://collab.example.org/socket?ticket=single-use");
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const provider = new LatexDoWebsocketProvider({
      url: urlFactory,
      doc,
      awareness,
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(urlFactory).toHaveBeenCalledTimes(1);
    FakeWebSocket.instances[0].close();
    await vi.advanceTimersByTimeAsync(375);

    expect(urlFactory).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances).toHaveLength(2);

    provider.destroy();
    awareness.destroy();
    doc.destroy();
  });

  it("does not retry permanent collaboration ticket failures", async () => {
    vi.useFakeTimers();
    const urlFactory = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(
        new CollaborationApiError(
          413,
          "This file is too large for real-time collaboration.",
        ),
      );
    const onConnectionError = vi.fn();
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const provider = new LatexDoWebsocketProvider({
      url: urlFactory,
      doc,
      awareness,
      onConnectionError,
    });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(urlFactory).toHaveBeenCalledTimes(1);
    expect(onConnectionError).toHaveBeenCalledWith(
      "This file is too large for real-time collaboration.",
      413,
    );
    expect(FakeWebSocket.instances).toHaveLength(0);

    provider.destroy();
    awareness.destroy();
    doc.destroy();
  });

  it("stops and reports an oversized server-side collaboration close", () => {
    vi.useFakeTimers();
    const onConnectionError = vi.fn();
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const provider = new LatexDoWebsocketProvider({
      url: "wss://collab.example.org/socket",
      doc,
      awareness,
      onConnectionError,
    });
    const socket = FakeWebSocket.instances[0];
    socket.open();

    socket.close(1009, "Collaboration state exceeds protocol limit");
    vi.advanceTimersByTime(60_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(onConnectionError).toHaveBeenCalledWith(
      "Collaboration state exceeds protocol limit",
      413,
    );
    provider.destroy();
    awareness.destroy();
    doc.destroy();
  });

  it("queues outbound updates while the browser socket is backpressured", () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const provider = new LatexDoWebsocketProvider({
      url: "wss://collab.example.org/socket",
      doc,
      awareness,
    });
    const socket = FakeWebSocket.instances[0];
    socket.bufferedAmount = 600 * 1024;
    socket.open();

    expect(socket.sent).toHaveLength(0);
    socket.bufferedAmount = 0;
    vi.advanceTimersByTime(50);
    expect(socket.sent.length).toBeGreaterThanOrEqual(1);

    provider.destroy();
    awareness.destroy();
    doc.destroy();
  });

  it("closes and resyncs instead of growing the outbound queue without bound", () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const provider = new LatexDoWebsocketProvider({
      url: "wss://collab.example.org/socket",
      doc,
      awareness,
    });
    const socket = FakeWebSocket.instances[0];
    socket.bufferedAmount = 600 * 1024;
    socket.open();

    const text = doc.getText("content");
    for (
      let index = 0;
      index < 300 && socket.readyState === FakeWebSocket.OPEN;
      index += 1
    ) {
      text.insert(text.length, "x");
    }

    expect(socket.closeCode).toBe(1013);

    provider.destroy();
    awareness.destroy();
    doc.destroy();
  });

  it("delivers validated project presence snapshots", () => {
    const onPresenceChange = vi.fn();
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const provider = new LatexDoWebsocketProvider({
      url: "wss://collab.example.org/socket",
      doc,
      awareness,
      onPresenceChange,
    });
    const socket = FakeWebSocket.instances[0];

    socket.receive(
      presenceFrame({
        version: 1,
        users: [
          {
            clientId: "client-1",
            name: "Ada",
            currentFile: "main.tex",
            lastSeen: 1_723_000_000_000,
            role: "editor",
          },
        ],
      }),
    );

    expect(onPresenceChange).toHaveBeenCalledWith([
      {
        clientId: "client-1",
        name: "Ada",
        currentFile: "main.tex",
        lastSeen: 1_723_000_000_000,
        role: "editor",
      },
    ]);

    provider.destroy();
    awareness.destroy();
    doc.destroy();
  });

  it("delivers validated join requests and ignores malformed ones", () => {
    const onJoinRequests = vi.fn();
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const provider = new LatexDoWebsocketProvider({
      url: "wss://collab.example.org/socket",
      doc,
      awareness,
      onJoinRequests,
    });
    const socket = FakeWebSocket.instances[0];
    const frame = (snapshot: unknown) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 6);
      encoding.writeVarString(encoder, JSON.stringify(snapshot));
      return encoding.toUint8Array(encoder).buffer as ArrayBuffer;
    };

    socket.receive(
      frame({
        version: 1,
        pending: [{ clientId: "web-1", name: "Ada", requestedAt: 1_723_000_000_000 }],
      }),
    );
    socket.receive(frame({ version: 1, pending: [{ clientId: 7, name: "Eve" }] }));
    socket.receive(frame({ version: 2, pending: [] }));

    expect(onJoinRequests).toHaveBeenCalledTimes(1);
    expect(onJoinRequests).toHaveBeenCalledWith([
      { clientId: "web-1", name: "Ada", requestedAt: 1_723_000_000_000 },
    ]);

    provider.destroy();
    awareness.destroy();
    doc.destroy();
  });

  it("ignores malformed and duplicate project presence users", () => {
    const onPresenceChange = vi.fn();
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const provider = new LatexDoWebsocketProvider({
      url: "wss://collab.example.org/socket",
      doc,
      awareness,
      onPresenceChange,
    });
    const socket = FakeWebSocket.instances[0];
    const duplicate = {
      clientId: "client-1",
      name: "Ada",
      currentFile: null,
      lastSeen: 1,
      role: "admin",
    };

    socket.receive(presenceFrame({ version: 2, users: [] }));
    socket.receive(presenceFrame({ version: 1, users: [duplicate, duplicate] }));
    socket.receive(
      presenceFrame({
        version: 1,
        users: [{ ...duplicate, role: "owner" }],
      }),
    );

    expect(onPresenceChange).not.toHaveBeenCalled();

    provider.destroy();
    awareness.destroy();
    doc.destroy();
  });

  it("closes oversized inbound collaboration frames", () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const provider = new LatexDoWebsocketProvider({
      url: "wss://collab.example.org/socket",
      doc,
      awareness,
    });
    const socket = FakeWebSocket.instances[0];
    socket.open();

    socket.receive(new ArrayBuffer(64 * 1024 * 1024 + 1));

    expect(socket.closeCode).toBe(1009);

    provider.destroy();
    awareness.destroy();
    doc.destroy();
  });
});
