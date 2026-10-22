import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  persistence: vi.fn(),
  persistenceDestroy: vi.fn(() => Promise.resolve()),
  provider: vi.fn(),
  providerDestroy: vi.fn(),
  openPeerBridgeSocket: vi.fn(() => ({ kind: "peer-socket" })),
  usesPeerBridge: vi.fn(() => false),
  collaborationWebSocketUrl: vi.fn(() => "wss://example.test/ws"),
}));

vi.mock("y-indexeddb", () => ({
  IndexeddbPersistence: class {
    constructor(name: string, doc: unknown) {
      mocks.persistence(name, doc);
    }
    destroy = mocks.persistenceDestroy;
  },
}));
vi.mock("./websocketProvider", () => ({
  LatexDoWebsocketProvider: class {
    constructor(options: unknown) {
      mocks.provider(options);
    }
    destroy = mocks.providerDestroy;
  },
}));
vi.mock("./peerSocket", () => ({
  openPeerBridgeSocket: mocks.openPeerBridgeSocket,
  usesPeerBridge: mocks.usesPeerBridge,
}));
vi.mock("./collaborationApi", () => ({
  collaborationWebSocketUrl: mocks.collaborationWebSocketUrl,
}));

import { CollaborationClient } from "./CollaborationClient";
import type { CollaborationClientOptions } from "./collaborationTypes";

const options = {
  apiBaseUrl: "https://api.example.test",
  projectId: "p1",
  relativePath: "main.tex",
  clientName: "Ada",
  color: "#f00",
  emoji: "🦊",
  onStatusChange: vi.fn(),
  onConnectionError: vi.fn(),
  onSynced: vi.fn(),
  onPresenceChange: vi.fn(),
  onProjectChanged: vi.fn(),
  onJoinRequests: vi.fn(),
} as unknown as CollaborationClientOptions;

type ProviderOptions = {
  url: () => string;
  createSocket?: (url: string) => unknown;
  onSynced: unknown;
};

describe("CollaborationClient", () => {
  beforeEach(() => vi.clearAllMocks());

  it("wires the doc, awareness, persistence and provider together", () => {
    const client = new CollaborationClient(options);
    expect(client.text).toBe(client.doc.getText("content"));
    expect(client.awareness.getLocalState()).toEqual({
      user: { name: "Ada", color: "#f00", emoji: "🦊" },
      file: "main.tex",
    });
    expect(mocks.persistence).toHaveBeenCalledWith("latexdo:p1:main.tex", client.doc);
    const providerOptions = mocks.provider.mock.calls[0][0] as ProviderOptions;
    expect(providerOptions.createSocket).toBeUndefined();
    expect(providerOptions.onSynced).toBe(options.onSynced);
    expect(providerOptions.url()).toBe("wss://example.test/ws");
    expect(mocks.collaborationWebSocketUrl).toHaveBeenCalledWith(options);
    client.destroy();
  });

  it("uses the peer bridge socket when the API base needs it", () => {
    mocks.usesPeerBridge.mockReturnValueOnce(true);
    const client = new CollaborationClient(options);
    const providerOptions = mocks.provider.mock.calls[0][0] as ProviderOptions;
    expect(providerOptions.createSocket?.("wss://x")).toEqual({ kind: "peer-socket" });
    expect(mocks.openPeerBridgeSocket).toHaveBeenCalledWith(
      "https://api.example.test",
      "wss://x",
    );
    client.destroy();
  });

  it("tears everything down on destroy", () => {
    const client = new CollaborationClient(options);
    const destroyDoc = vi.spyOn(client.doc, "destroy");
    client.destroy();
    expect(mocks.providerDestroy).toHaveBeenCalledTimes(1);
    expect(mocks.persistenceDestroy).toHaveBeenCalledTimes(1);
    expect(destroyDoc).toHaveBeenCalled();
    expect(client.awareness.getLocalState()).toBeNull();
  });
});
