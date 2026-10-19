import { afterEach, describe, expect, it, vi } from "vitest";
import { openPeerBridgeSocket, PeerBridgeSocket, usesPeerBridge } from "./peerSocket";

type Handlers = {
  onOpen: () => void;
  onMessage: (data: Uint8Array) => void;
  onError: () => void;
  onClose: (code: number, reason: string) => void;
};

function installBridge() {
  const connection = { send: vi.fn(), close: vi.fn() };
  let handlers!: Handlers;
  const connect = vi.fn((_origin: string, _path: string, h: Handlers) => {
    handlers = h;
    return connection;
  });
  (window as unknown as { latexdo: unknown }).latexdo = {
    connectCollaborationSocket: connect,
  };
  return { connection, connect, handlers: () => handlers };
}

afterEach(() => {
  delete (window as unknown as { latexdo?: unknown }).latexdo;
});

describe("PeerBridgeSocket", () => {
  it("opens, relays messages and sends only while open", () => {
    const { connection, connect, handlers } = installBridge();
    const socket = openPeerBridgeSocket("http://peer", "ws://peer/rooms/1?x=2");
    expect(connect).toHaveBeenCalledWith("http://peer", "/rooms/1?x=2", expect.any(Object));
    expect(socket.readyState).toBe(WebSocket.CONNECTING);

    const messages: ArrayBuffer[] = [];
    const opened = vi.fn();
    socket.addEventListener("open", opened);
    socket.addEventListener("message", (e) => messages.push((e as MessageEvent).data));

    socket.send(new Uint8Array([1]));
    handlers().onMessage(new Uint8Array([9]));
    expect(connection.send).not.toHaveBeenCalled();
    expect(messages).toHaveLength(0);

    handlers().onOpen();
    handlers().onOpen();
    expect(opened).toHaveBeenCalledTimes(1);
    expect(socket.readyState).toBe(WebSocket.OPEN);

    handlers().onMessage(new Uint8Array([1, 2, 3]));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(messages[0])]).toEqual([1, 2, 3]);

    const payload = new Uint8Array([4]);
    socket.send(payload);
    expect(connection.send).toHaveBeenCalledWith(payload);
  });

  it("forwards errors and closes once", () => {
    const { connection, handlers } = installBridge();
    const socket = new PeerBridgeSocket("http://peer", "/r");
    const errors = vi.fn();
    const closes: CloseEvent[] = [];
    socket.addEventListener("error", errors);
    socket.addEventListener("close", (e) => closes.push(e as CloseEvent));

    handlers().onError();
    expect(errors).toHaveBeenCalledTimes(1);

    socket.close(1000, "bye");
    expect(socket.readyState).toBe(WebSocket.CLOSING);
    socket.close();
    expect(connection.close).toHaveBeenCalledTimes(1);
    expect(connection.close).toHaveBeenCalledWith(1000, "bye");

    handlers().onClose(1000, "bye");
    handlers().onClose(1001, "again");
    expect(socket.readyState).toBe(WebSocket.CLOSED);
    expect(closes).toHaveLength(1);
    expect(closes[0].code).toBe(1000);
    expect(closes[0].reason).toBe("bye");
    socket.close();
    expect(connection.close).toHaveBeenCalledTimes(1);
  });
});

describe("usesPeerBridge", () => {
  it("is false without a bridge and defers to the bridge otherwise", () => {
    expect(usesPeerBridge("http://x")).toBe(false);
    (window as unknown as { latexdo: unknown }).latexdo = {};
    expect(usesPeerBridge("http://x")).toBe(false);
    const check = vi.fn((url: string) => url.startsWith("peer"));
    (window as unknown as { latexdo: unknown }).latexdo = { usesCollaborationBridge: check };
    expect(usesPeerBridge("peer://a")).toBe(true);
    expect(usesPeerBridge("http://a")).toBe(false);
  });
});
