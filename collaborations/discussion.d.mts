// Types for discussion.mjs, which both collaboration servers use.

export declare const discussionLimits: Readonly<{
  maxBodyChars: number;
  maxStoredBodyChars: number;
  maxMentions: number;
  maxMessages: number;
  maxTotalBodyChars: number;
  pageSize: number;
  maxPageSize: number;
  burstMessages: number;
  burstWindowMs: number;
  maxConversationKeys: number;
  maxReactionChars: number;
  maxReactionsPerMessage: number;
}>;

export declare const everyoneConversation: "*";

export declare class DiscussionError extends Error {
  constructor(status: number, message: string, code?: string);
  readonly status: number;
  readonly code?: string;
}

export interface DiscussionMessage {
  id: string;
  seq: number;
  from: string;
  name: string;
  to: string | null;
  recipients: string[];
  body: string;
  mentions: string[];
  replyTo: string | null;
  createdAt: number;
  editedAt?: number;
  updatedSeq?: number;
  /** Revision at which the text last changed (reactions do not count). */
  bodySeq?: number;
  /** Each person's reaction, as an opaque (sealed) value, by client id. */
  reactions?: Record<string, string>;
  /** Set when an admin removed the message (its body is then empty). */
  deletedAt?: number;
  deletedBy?: string;
}

export interface DiscussionReceipt {
  delivered: number;
  read: Record<string, number>;
}

export interface DiscussionState {
  schemaVersion: 1;
  seq: number;
  messages: DiscussionMessage[];
  receipts: Record<string, DiscussionReceipt>;
}

export interface DiscussionIdentity {
  clientId: string;
  clientName: string;
}

export interface ReceiptUpdate {
  delivered?: number;
  read?: { conversation: string; seq: number };
}

export declare function emptyDiscussion(): DiscussionState;
export declare function normalizeDiscussion(raw: unknown): DiscussionState;
export declare function canSeeMessage(
  message: DiscussionMessage,
  clientId: string,
): boolean;
export declare function conversationFor(
  message: DiscussionMessage,
  clientId: string,
): string;
export declare function postMessage(
  state: DiscussionState,
  options: {
    identity: DiscussionIdentity;
    members: Map<string, string>;
    input: unknown;
    now: number;
    maxBodyChars?: number;
    /** True for admins, who may delete any message they can see. */
    canModerate?: boolean;
  },
): { message: DiscussionMessage; created: boolean; updated?: boolean };
export declare function advanceReceipt(
  state: DiscussionState,
  clientId: string,
  update: unknown,
): boolean;
export declare function receiptsFor(
  state: DiscussionState,
  clientId: string,
): Record<string, DiscussionReceipt>;
export declare function listMessages(
  state: DiscussionState,
  clientId: string,
  options?: {
    after?: string | number;
    before?: string | number;
    limit?: string | number;
  },
): { messages: DiscussionMessage[]; hasMore: boolean };
export declare function audienceFor(message: DiscussionMessage): Set<string> | null;
export declare function allowBurst(
  buckets: Map<string, number[]>,
  clientId: string,
  now: number,
): boolean;
