import { MonacoBinding } from "y-monaco";
import * as Y from "yjs";
import type * as monaco from "monaco-editor";
import { CollaborationClient } from "./CollaborationClient";
import type {
  CollaborationConnectionStatus,
  CollaborationRoomOptions,
} from "./collaborationTypes";
import type { CollaboratorPresence } from "../types";
import type { EditOrigin } from "../features/editor/nextEdit/nextEditTypes";
import type { EditorMutationOrigin } from "./editProvenance";
import { remoteCursorCss, type RemoteCursor } from "./collaboratorLook";

export interface CollaborationTextTransaction {
  kind: "local" | "remote";
  before: string;
  after: string;
  origin: unknown;
}

export interface MonacoCollaborationBindingOptions extends CollaborationRoomOptions {
  editor: monaco.editor.IStandaloneCodeEditor;
  mutationOrigin?: EditorMutationOrigin;
  onTextTransaction?: (event: CollaborationTextTransaction) => void;
  onStatusChange?: (status: CollaborationConnectionStatus) => void;
  onConnectionError?: (message: string, status?: number) => void;
  onSynced?: () => void;
  onPresenceChange?: (users: CollaboratorPresence[]) => void;
  onProjectChanged?: (revision: number) => void;
}

export class MonacoCollaborationBinding {
  readonly key: string;
  private readonly editor: monaco.editor.IStandaloneCodeEditor;
  private readonly client: CollaborationClient;
  private readonly mutationOrigin: EditorMutationOrigin | null;
  private readonly onTextTransaction?: (event: CollaborationTextTransaction) => void;
  private binding: MonacoBinding | null = null;
  private selectionDisposable: monaco.IDisposable | null = null;
  private transactionRelease: (() => void) | null = null;
  private yTextSnapshot = "";
  private disposed = false;
  /** Colors and labels the other people's cursors in this editor. */
  private cursorStyle: HTMLStyleElement | null = null;
  private remoteCursorRenderQueued = false;

  constructor(options: MonacoCollaborationBindingOptions) {
    this.key = `${options.projectId}:${options.relativePath}:${options.shareToken ?? ""}:${options.clientName}`;
    this.editor = options.editor;
    this.mutationOrigin = options.mutationOrigin ?? null;
    this.onTextTransaction = options.onTextTransaction;
    this.client = new CollaborationClient({
      ...options,
      onSynced: () => {
        this.attach();
        if (!this.disposed) options.onSynced?.();
      },
      onPresenceChange: (users) => {
        if (!this.disposed) options.onPresenceChange?.(users);
      },
      onProjectChanged: (revision) => {
        if (!this.disposed) options.onProjectChanged?.(revision);
      },
    });
  }

  destroy(): void {
    this.disposed = true;
    this.client.awareness.off("change", this.updateCursorStyle);
    this.client.awareness.off("change", this.queueRemoteCursorRender);
    this.cursorStyle?.remove();
    this.cursorStyle = null;
    this.releaseTransactionOrigin();
    this.client.doc.off("beforeObserverCalls", this.beforeObserverCalls);
    this.client.doc.off("afterTransaction", this.afterTransaction);
    this.selectionDisposable?.dispose();
    this.selectionDisposable = null;
    this.binding?.destroy();
    this.binding = null;
    this.client.destroy();
  }

  private attach(): void {
    if (this.disposed || this.binding) {
      return;
    }
    const model = this.editor.getModel();
    if (!model) {
      return;
    }

    this.yTextSnapshot = this.client.text.toString();
    this.client.doc.on("beforeObserverCalls", this.beforeObserverCalls);
    this.client.doc.on("afterTransaction", this.afterTransaction);
    this.binding = new MonacoBinding(
      this.client.text,
      model,
      new Set([this.editor]),
      this.client.awareness,
    );
    // y-monaco redraws remote cursors the moment awareness changes. A cursor
    // move fired by Monaco while it is applying other decorations (ghost text,
    // diagnostics) would then call deltaDecorations inside deltaDecorations,
    // which Monaco rejects. Redraw once the current editor update is done.
    this.client.awareness.off("change", this.binding._rerenderDecorations);
    this.client.awareness.on("change", this.queueRemoteCursorRender);
    this.selectionDisposable = this.editor.onDidChangeCursorSelection(() => {
      this.updateSelectionAwareness();
    });
    this.updateSelectionAwareness();
    this.client.awareness.on("change", this.updateCursorStyle);
    this.updateCursorStyle();
  }

  private queueRemoteCursorRender = (): void => {
    if (this.remoteCursorRenderQueued) return;
    this.remoteCursorRenderQueued = true;
    queueMicrotask(() => {
      this.remoteCursorRenderQueued = false;
      if (!this.disposed) this.binding?._rerenderDecorations();
    });
  };

  private updateCursorStyle = (): void => {
    if (this.disposed || typeof document === "undefined") return;
    const awareness = this.client.awareness;
    const cursors: RemoteCursor[] = [];
    awareness.getStates().forEach((state, clientID) => {
      if (clientID === awareness.clientID) return;
      const user = (state as { user?: Record<string, unknown> }).user;
      if (!user) return;
      cursors.push({
        clientID,
        name: typeof user.name === "string" ? user.name : "",
        emoji: typeof user.emoji === "string" ? user.emoji : "",
        color: typeof user.color === "string" ? user.color : "",
      });
    });
    if (!this.cursorStyle) {
      this.cursorStyle = document.createElement("style");
      this.cursorStyle.dataset.latexdoRemoteCursors = this.key;
      document.head.appendChild(this.cursorStyle);
    }
    this.cursorStyle.textContent = remoteCursorCss(cursors);
  };

  private beforeObserverCalls = (transaction: Y.Transaction): void => {
    if (!this.transactionTouchesText(transaction)) return;
    const origin = this.editOriginForTransaction(transaction);
    const kind = origin === "user" ? "local" : "remote";
    this.releaseTransactionOrigin();
    this.transactionRelease = this.mutationOrigin?.enter(origin) ?? null;
    this.onTextTransaction?.({
      kind,
      before: this.yTextSnapshot,
      after: this.client.text.toString(),
      origin: transaction.origin,
    });
  };

  private afterTransaction = (transaction: Y.Transaction): void => {
    if (this.transactionTouchesText(transaction)) {
      this.yTextSnapshot = this.client.text.toString();
    }
    this.releaseTransactionOrigin();
  };

  private transactionTouchesText(transaction: Y.Transaction): boolean {
    for (const changedType of transaction.changed.keys()) {
      if ((changedType as unknown) === this.client.text) return true;
    }
    return false;
  }

  private editOriginForTransaction(transaction: Y.Transaction): EditOrigin {
    if (transaction.local && transaction.origin === this.binding) {
      return "user";
    }
    return "remote";
  }

  private releaseTransactionOrigin(): void {
    this.transactionRelease?.();
    this.transactionRelease = null;
  }

  private updateSelectionAwareness(): void {
    const model = this.editor.getModel();
    const selection = this.editor.getSelection();
    if (!model || !selection) {
      return;
    }
    const anchorOffset = model.getOffsetAt({
      lineNumber: selection.selectionStartLineNumber,
      column: selection.selectionStartColumn,
    });
    const headOffset = model.getOffsetAt({
      lineNumber: selection.positionLineNumber,
      column: selection.positionColumn,
    });
    this.client.awareness.setLocalStateField("selection", {
      anchor: Y.createRelativePositionFromTypeIndex(this.client.text, anchorOffset),
      head: Y.createRelativePositionFromTypeIndex(this.client.text, headOffset),
    });
  }
}
