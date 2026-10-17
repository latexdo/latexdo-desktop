import { IndexeddbPersistence } from "y-indexeddb";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { collaborationWebSocketUrl } from "./collaborationApi";
import type { CollaborationClientOptions } from "./collaborationTypes";
import { openPeerBridgeSocket, usesPeerBridge } from "./peerSocket";
import { LatexDoWebsocketProvider } from "./websocketProvider";

const yTextName = "content";

function persistenceName(projectId: string, relativePath: string): string {
  return `latexdo:${projectId}:${relativePath}`;
}

export class CollaborationClient {
  readonly doc: Y.Doc;
  readonly text: Y.Text;
  readonly awareness: Awareness;
  private readonly provider: LatexDoWebsocketProvider;
  private readonly persistence: IndexeddbPersistence;

  constructor(options: CollaborationClientOptions) {
    this.doc = new Y.Doc();
    this.text = this.doc.getText(yTextName);
    this.awareness = new Awareness(this.doc);
    this.awareness.setLocalState({
      user: {
        name: options.clientName,
        color: options.color,
        emoji: options.emoji,
      },
      file: options.relativePath,
    });
    this.persistence = new IndexeddbPersistence(
      persistenceName(options.projectId, options.relativePath),
      this.doc,
    );
    this.provider = new LatexDoWebsocketProvider({
      url: () => collaborationWebSocketUrl(options),
      createSocket: usesPeerBridge(options.apiBaseUrl)
        ? (url) => openPeerBridgeSocket(options.apiBaseUrl, url)
        : undefined,
      doc: this.doc,
      awareness: this.awareness,
      onStatusChange: options.onStatusChange,
      onConnectionError: options.onConnectionError,
      onSynced: options.onSynced,
      onPresenceChange: options.onPresenceChange,
    });
  }

  destroy(): void {
    this.provider.destroy();
    this.awareness.destroy();
    void this.persistence.destroy();
    this.doc.destroy();
  }
}
