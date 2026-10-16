// A WebSocket to a project hosted on someone's computer. The connection itself
// lives in the Electron main process (see electron/peerCollab.ts); this class
// gives the collaboration provider the same events and methods as a WebSocket.

type PeerSocketConnection = {
  send: (data: Uint8Array) => void;
  close: (code?: number, reason?: string) => void;
};

export class PeerBridgeSocket extends EventTarget {
  binaryType: BinaryType = "arraybuffer";
  readonly bufferedAmount = 0;
  readyState: number = WebSocket.CONNECTING;
  private readonly connection: PeerSocketConnection;

  constructor(origin: string, pathAndQuery: string) {
    super();
    this.connection = window.latexdo.connectCollaborationSocket(origin, pathAndQuery, {
      onOpen: () => {
        if (this.readyState !== WebSocket.CONNECTING) return;
        this.readyState = WebSocket.OPEN;
        this.dispatchEvent(new Event("open"));
      },
      onMessage: (data) => {
        if (this.readyState !== WebSocket.OPEN) return;
        const buffer = new ArrayBuffer(data.byteLength);
        new Uint8Array(buffer).set(data);
        this.dispatchEvent(new MessageEvent("message", { data: buffer }));
      },
      onError: () => {
        this.dispatchEvent(new Event("error"));
      },
      onClose: (code, reason) => {
        if (this.readyState === WebSocket.CLOSED) return;
        this.readyState = WebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close", { code, reason }));
      },
    });
  }

  send(data: Uint8Array): void {
    if (this.readyState === WebSocket.OPEN) this.connection.send(data);
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === WebSocket.CLOSING || this.readyState === WebSocket.CLOSED) {
      return;
    }
    this.readyState = WebSocket.CLOSING;
    this.connection.close(code, reason);
  }
}

/** True when a backend is only reachable through the desktop app's bridge. */
export function usesPeerBridge(apiBaseUrl: string): boolean {
  return (
    typeof window.latexdo?.usesCollaborationBridge === "function" &&
    window.latexdo.usesCollaborationBridge(apiBaseUrl)
  );
}

export function openPeerBridgeSocket(apiBaseUrl: string, url: string): WebSocket {
  const target = new URL(url);
  return new PeerBridgeSocket(
    apiBaseUrl,
    `${target.pathname}${target.search}`,
  ) as unknown as WebSocket;
}
