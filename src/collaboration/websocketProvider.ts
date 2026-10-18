import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import { Awareness } from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { CollaborationApiError } from "./collaborationApi";
import type { CollaborationConnectionStatus } from "./collaborationTypes";
import type {
  CollaborationJoinRequest,
  CollaboratorPresence,
  CollaboratorRole,
} from "../types";

const messageSync = 0;
const messageAwareness = 1;
const messageProjectPresence = 4;
/** The project's files changed (added, moved, deleted or replaced). */
const messageProjectChanged = 5;
/** Admins only: who is waiting to join the project, sent when it changes. */
const messageJoinRequests = 6;
const reconnectInitialDelayMs = 750;
const reconnectMaxDelayMs = 10_000;
const outboundHighWaterBytes = 512 * 1024;
const maxQueuedMessages = 256;
// A whole document travels in one sync message, and a project shared from
// someone's computer may hold files up to 32 MB (a large .bib, for example).
const maxInboundMessageBytes = 64 * 1024 * 1024;
const maxQueuedBytes = 96 * 1024 * 1024;
const outboundDrainDelayMs = 50;
const maxPresenceFrameBytes = 128 * 1024;
const maxPresenceUsers = 50;
const maxJoinRequests = 50;

type AwarenessChange = {
  added: number[];
  updated: number[];
  removed: number[];
};

export interface LatexDoWebsocketProviderOptions {
  url: string | (() => Promise<string>);
  /** Opens the connection; defaults to a browser WebSocket. */
  createSocket?: (url: string) => WebSocket;
  doc: Y.Doc;
  awareness: Awareness;
  onStatusChange?: (status: CollaborationConnectionStatus) => void;
  onConnectionError?: (message: string, status?: number) => void;
  onSynced?: () => void;
  onPresenceChange?: (users: CollaboratorPresence[]) => void;
  onProjectChanged?: (revision: number) => void;
  onJoinRequests?: (pending: CollaborationJoinRequest[]) => void;
}

function isCollaboratorRole(value: unknown): value is CollaboratorRole {
  return value === "admin" || value === "editor" || value === "viewer";
}

function parseProjectPresence(value: unknown): CollaboratorPresence[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as { version?: unknown; users?: unknown };
  if (snapshot.version !== 1 || !Array.isArray(snapshot.users)) return null;
  if (snapshot.users.length > maxPresenceUsers) return null;

  const users: CollaboratorPresence[] = [];
  const clientIds = new Set<string>();
  for (const value of snapshot.users) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const user = value as Record<string, unknown>;
    if (
      typeof user.clientId !== "string" ||
      !user.clientId ||
      user.clientId.length > 160 ||
      clientIds.has(user.clientId) ||
      typeof user.name !== "string" ||
      user.name.length > 80 ||
      (user.currentFile !== null &&
        (typeof user.currentFile !== "string" || user.currentFile.length > 512)) ||
      typeof user.lastSeen !== "number" ||
      !Number.isSafeInteger(user.lastSeen) ||
      user.lastSeen < 0 ||
      !isCollaboratorRole(user.role)
    ) {
      return null;
    }
    clientIds.add(user.clientId);
    users.push({
      clientId: user.clientId,
      name: user.name,
      currentFile: user.currentFile,
      lastSeen: user.lastSeen,
      role: user.role,
    });
  }
  return users;
}

function parseJoinRequests(value: unknown): CollaborationJoinRequest[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as { version?: unknown; pending?: unknown };
  if (snapshot.version !== 1 || !Array.isArray(snapshot.pending)) return null;
  if (snapshot.pending.length > maxJoinRequests) return null;
  const pending: CollaborationJoinRequest[] = [];
  for (const value of snapshot.pending) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const request = value as Record<string, unknown>;
    if (
      typeof request.clientId !== "string" ||
      !request.clientId ||
      request.clientId.length > 160 ||
      typeof request.name !== "string" ||
      request.name.length > 80 ||
      typeof request.requestedAt !== "number" ||
      !Number.isSafeInteger(request.requestedAt)
    ) {
      return null;
    }
    pending.push({
      clientId: request.clientId,
      name: request.name,
      requestedAt: request.requestedAt,
    });
  }
  return pending;
}

export class LatexDoWebsocketProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  private readonly url: string | (() => Promise<string>);
  private readonly createSocket: (url: string) => WebSocket;
  private readonly onStatusChange?: (status: CollaborationConnectionStatus) => void;
  private readonly onConnectionError?: (message: string, status?: number) => void;
  private readonly onSynced?: () => void;
  private readonly onPresenceChange?: (users: CollaboratorPresence[]) => void;
  private readonly onProjectChanged?: (revision: number) => void;
  private readonly onJoinRequests?: (pending: CollaborationJoinRequest[]) => void;
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private outboundDrainTimer: number | null = null;
  private readonly outboundQueue: Uint8Array[] = [];
  private outboundQueueBytes = 0;
  private reconnectAttempt = 0;
  private shouldConnect = true;
  private synced = false;

  constructor(options: LatexDoWebsocketProviderOptions) {
    this.url = options.url;
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url));
    this.doc = options.doc;
    this.awareness = options.awareness;
    this.onStatusChange = options.onStatusChange;
    this.onConnectionError = options.onConnectionError;
    this.onSynced = options.onSynced;
    this.onPresenceChange = options.onPresenceChange;
    this.onProjectChanged = options.onProjectChanged;
    this.onJoinRequests = options.onJoinRequests;
    this.doc.on("update", this.handleDocUpdate);
    this.awareness.on("update", this.handleAwarenessUpdate);
    this.connect();
  }

  destroy(): void {
    this.shouldConnect = false;
    this.synced = false;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearOutboundQueue();
    this.awareness.off("update", this.handleAwarenessUpdate);
    this.doc.off("update", this.handleDocUpdate);
    this.sendAwarenessUpdate([this.doc.clientID]);
    this.socket?.close(1000, "Collaboration closed");
    this.socket = null;
  }

  private connect(): void {
    if (!this.shouldConnect) {
      return;
    }
    this.reportStatus("connecting");
    if (typeof this.url === "string") {
      this.openSocket(this.url);
      return;
    }
    void this.url().then(
      (url) => {
        if (this.shouldConnect) {
          this.openSocket(url);
        }
      },
      (error: unknown) => {
        if (!this.shouldConnect) {
          return;
        }
        this.socket = null;
        this.synced = false;
        this.reportStatus("error");
        if (error instanceof Error) {
          this.onConnectionError?.(
            error.message.slice(0, 500),
            error instanceof CollaborationApiError ? error.status : undefined,
          );
        }
        if (
          error instanceof CollaborationApiError &&
          [400, 403, 404, 413, 415].includes(error.status)
        ) {
          this.shouldConnect = false;
          return;
        }
        this.scheduleReconnect();
      },
    );
  }

  private openSocket(url: string): void {
    let socket: WebSocket;
    try {
      socket = this.createSocket(url);
    } catch {
      this.socket = null;
      this.synced = false;
      this.reportStatus("error");
      this.scheduleReconnect();
      return;
    }
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.reportStatus("connected");
      this.sendSyncStep1();
      this.sendAwarenessUpdate([this.doc.clientID]);
    });

    socket.addEventListener("message", (event) => {
      void this.handleMessage(event.data);
    });

    socket.addEventListener("close", (event) => {
      if (this.socket === socket) {
        this.socket = null;
      }
      this.clearOutboundQueue();
      this.synced = false;
      this.reportStatus("disconnected");
      if (event.code === 1008 || event.code === 1009) {
        this.shouldConnect = false;
        this.onConnectionError?.(
          event.reason.slice(0, 500) ||
            "This document cannot use real-time collaboration.",
          event.code === 1009 ? 413 : 403,
        );
        return;
      }
      this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      this.reportStatus("error");
    });
  }

  private scheduleReconnect(): void {
    if (!this.shouldConnect || this.reconnectTimer !== null) {
      return;
    }
    const ceiling = Math.min(
      reconnectMaxDelayMs,
      reconnectInitialDelayMs * 2 ** Math.min(this.reconnectAttempt, 8),
    );
    const delay = Math.round(ceiling * (0.5 + Math.random() * 0.5));
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private async handleMessage(data: unknown): Promise<void> {
    const buffer =
      data instanceof ArrayBuffer
        ? data
        : data instanceof Blob
          ? await data.arrayBuffer()
          : null;
    if (
      !buffer ||
      buffer.byteLength === 0 ||
      buffer.byteLength > maxInboundMessageBytes
    ) {
      if (buffer && buffer.byteLength > maxInboundMessageBytes) {
        this.socket?.close(1009, "Collaboration frame is too large");
      }
      return;
    }

    let decoder: decoding.Decoder;
    let messageType: number;
    try {
      decoder = decoding.createDecoder(new Uint8Array(buffer));
      messageType = decoding.readVarUint(decoder);
    } catch {
      return;
    }

    if (messageType === messageSync) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      try {
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
      } catch {
        return;
      }
      if (encoding.length(encoder) > 1) {
        this.send(encoding.toUint8Array(encoder));
      }
      if (!this.synced) {
        this.synced = true;
        this.reconnectAttempt = 0;
        this.onSynced?.();
      }
      return;
    }

    if (messageType === messageAwareness) {
      try {
        if (!decoding.hasContent(decoder)) return;
        const update = decoding.readVarUint8Array(decoder);
        if (!update.byteLength) return;
        awarenessProtocol.applyAwarenessUpdate(this.awareness, update, this);
      } catch {
        return;
      }
      return;
    }

    if (messageType === messageProjectPresence) {
      if (buffer.byteLength > maxPresenceFrameBytes) return;
      try {
        const raw = decoding.readVarString(decoder);
        if (decoding.hasContent(decoder) || raw.length > maxPresenceFrameBytes) return;
        const users = parseProjectPresence(JSON.parse(raw) as unknown);
        if (users) this.onPresenceChange?.(users);
      } catch {
        return;
      }
    }

    if (messageType === messageProjectChanged) {
      try {
        const raw = decoding.readVarString(decoder);
        const revision = (JSON.parse(raw) as { revision?: unknown }).revision;
        if (typeof revision === "number" && Number.isFinite(revision)) {
          this.onProjectChanged?.(revision);
        }
      } catch {
        return;
      }
    }

    if (messageType === messageJoinRequests) {
      if (buffer.byteLength > maxPresenceFrameBytes) return;
      try {
        const pending = parseJoinRequests(
          JSON.parse(decoding.readVarString(decoder)) as unknown,
        );
        if (pending) this.onJoinRequests?.(pending);
      } catch {
        return;
      }
    }
  }

  private readonly handleDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) {
      return;
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, update);
    this.send(encoding.toUint8Array(encoder));
  };

  private readonly handleAwarenessUpdate = (
    changes: AwarenessChange,
    origin: unknown,
  ) => {
    if (origin === this) {
      return;
    }
    this.sendAwarenessUpdate([
      ...changes.added,
      ...changes.updated,
      ...changes.removed,
    ]);
  };

  private sendSyncStep1(): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.send(encoding.toUint8Array(encoder));
  }

  private sendAwarenessUpdate(clientIds: number[]): void {
    if (!clientIds.length) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, clientIds),
    );
    this.send(encoding.toUint8Array(encoder));
  }

  private send(message: Uint8Array): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    if (
      this.outboundQueue.length > 0 ||
      (socket.bufferedAmount ?? 0) >= outboundHighWaterBytes
    ) {
      this.enqueueOutbound(message, socket);
      return;
    }
    socket.send(message);
  }

  private enqueueOutbound(message: Uint8Array, socket: WebSocket): void {
    if (
      this.outboundQueue.length >= maxQueuedMessages ||
      this.outboundQueueBytes + message.byteLength > maxQueuedBytes
    ) {
      this.clearOutboundQueue();
      socket.close(1013, "Collaboration client overloaded");
      return;
    }
    this.outboundQueue.push(message);
    this.outboundQueueBytes += message.byteLength;
    this.scheduleOutboundDrain();
  }

  private scheduleOutboundDrain(): void {
    if (this.outboundDrainTimer !== null || !this.outboundQueue.length) {
      return;
    }
    this.outboundDrainTimer = window.setTimeout(() => {
      this.outboundDrainTimer = null;
      this.flushOutboundQueue();
    }, outboundDrainDelayMs);
  }

  private flushOutboundQueue(): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      this.clearOutboundQueue();
      return;
    }
    while (
      this.outboundQueue.length > 0 &&
      (socket.bufferedAmount ?? 0) < outboundHighWaterBytes
    ) {
      const message = this.outboundQueue.shift();
      if (!message) break;
      this.outboundQueueBytes -= message.byteLength;
      socket.send(message);
    }
    this.scheduleOutboundDrain();
  }

  private clearOutboundQueue(): void {
    if (this.outboundDrainTimer !== null) {
      window.clearTimeout(this.outboundDrainTimer);
      this.outboundDrainTimer = null;
    }
    this.outboundQueue.length = 0;
    this.outboundQueueBytes = 0;
  }

  private reportStatus(status: CollaborationConnectionStatus): void {
    this.onStatusChange?.(status);
  }
}
