/*
 * The project discussion, as the app sees it: conversations (everyone, or one
 * other person), unread counts, the check marks on one's own messages, and
 * the text of a message split into plain text, @mentions and links.
 *
 * Everything here is pure, so the panel and the notifications agree.
 */

import { presenceState, type PresenceState } from "../../collaboration/presence";
import type {
  CollaboratorPermission,
  CollaboratorPresence,
  CollaboratorRole,
  DiscussionMessage,
  DiscussionReceipt,
} from "../../types";

/** The conversation everyone in the project sees. */
export const everyone = "*";

/** A conversation: everyone ("*"), or the other person's client id. */
export type ConversationKey = string;

export type LocalState = "sending" | "failed";

/** A message as shown: from the server, or still on its way there. */
export interface ChatMessage extends DiscussionMessage {
  local?: LocalState;
  error?: string;
}

/**
 * The check marks on one's own message:
 * sending (clock) → sent (one check) → delivered (two) → read (two, blue).
 */
export type MessageStatus = "sending" | "failed" | "sent" | "delivered" | "read";

export interface DiscussionMember {
  clientId: string;
  name: string;
  role: CollaboratorRole;
  /** Active (using LatexDo), away (open in the background) or offline. */
  presence: PresenceState;
  /** This person's file, when they have one open. */
  currentFile: string | null;
}

/** Messages that are still local sort after every message the server has. */
export const pendingSeq = Number.MAX_SAFE_INTEGER;

/** How long apart two messages can be and still stack as one group. */
const groupWindowMs = 5 * 60 * 1000;

export function conversationOf(
  message: DiscussionMessage,
  me: string,
): ConversationKey {
  if (!message.to) return everyone;
  return message.from === me ? message.to : message.from;
}

/** Adds or replaces messages by id, keeping server order. */
export function mergeMessages(
  current: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
): ChatMessage[] {
  if (!incoming.length) return current as ChatMessage[];
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    const previous = byId.get(message.id);
    if (
      !previous ||
      previous.local ||
      (message.updatedSeq ?? message.seq) >= (previous.updatedSeq ?? previous.seq)
    ) {
      byId.set(message.id, message);
    }
  }
  return [...byId.values()].sort(
    (left, right) => left.seq - right.seq || left.createdAt - right.createdAt,
  );
}

/** The newest sequence number the server confirmed. */
export function latestSeq(messages: readonly ChatMessage[]): number {
  let latest = 0;
  for (const message of messages) {
    if (!message.local && message.seq > latest) latest = message.seq;
  }
  return latest;
}

/** Cursor for incremental fetching, including edits of older messages. */
export function latestChangeSeq(messages: readonly ChatMessage[]): number {
  return messages.reduce(
    (latest, message) =>
      message.local ? latest : Math.max(latest, message.updatedSeq ?? message.seq),
    0,
  );
}

/** The oldest sequence number loaded, for loading earlier messages. */
export function oldestSeq(messages: readonly ChatMessage[]): number | null {
  for (const message of messages) {
    if (!message.local) return message.seq;
  }
  return null;
}

function readWatermark(
  receipts: Record<string, DiscussionReceipt>,
  clientId: string,
  conversation: ConversationKey,
): number {
  return receipts[clientId]?.read?.[conversation] ?? 0;
}

/** How far this app has read a conversation. */
export function myReadSeq(
  receipts: Record<string, DiscussionReceipt>,
  me: string,
  conversation: ConversationKey,
): number {
  return readWatermark(receipts, me, conversation);
}

/** The people a message is still waiting on: its recipients who are still here. */
function activeRecipients(
  message: DiscussionMessage,
  me: string,
  memberIds: ReadonlySet<string>,
): string[] {
  return message.recipients.filter((id) => id !== me && memberIds.has(id));
}

/** The conversation a recipient files this message under. */
function recipientConversation(message: DiscussionMessage): ConversationKey {
  // A private message is, from the recipient's side, the sender's conversation.
  return message.to ? message.from : everyone;
}

export function messageStatus(
  message: ChatMessage,
  me: string,
  receipts: Record<string, DiscussionReceipt>,
  memberIds: ReadonlySet<string>,
): MessageStatus {
  if (message.local === "sending") return "sending";
  if (message.local === "failed") return "failed";
  const recipients = activeRecipients(message, me, memberIds);
  if (!recipients.length) return "sent";
  const conversation = recipientConversation(message);
  if (
    recipients.every((id) => readWatermark(receipts, id, conversation) >= message.seq)
  ) {
    return "read";
  }
  if (recipients.every((id) => (receipts[id]?.delivered ?? 0) >= message.seq)) {
    return "delivered";
  }
  return "sent";
}

export interface ReceiptBreakdown {
  read: string[];
  delivered: string[];
  waiting: string[];
}

/** Who has read, received, or not yet received one of my messages. */
export function receiptBreakdown(
  message: DiscussionMessage,
  me: string,
  receipts: Record<string, DiscussionReceipt>,
  memberIds: ReadonlySet<string>,
): ReceiptBreakdown {
  const breakdown: ReceiptBreakdown = { read: [], delivered: [], waiting: [] };
  const conversation = recipientConversation(message);
  for (const id of activeRecipients(message, me, memberIds)) {
    if (readWatermark(receipts, id, conversation) >= message.seq) {
      breakdown.read.push(id);
    } else if ((receipts[id]?.delivered ?? 0) >= message.seq) {
      breakdown.delivered.push(id);
    } else {
      breakdown.waiting.push(id);
    }
  }
  return breakdown;
}

export interface ConversationSummary {
  unread: number;
  /** Unread messages that mention me (or are private to me). */
  mentions: number;
  last: ChatMessage | null;
}

/** Unread counts and the latest message of every conversation. */
export function summarizeConversations(
  messages: readonly ChatMessage[],
  me: string,
  receipts: Record<string, DiscussionReceipt>,
): Map<ConversationKey, ConversationSummary> {
  const summaries = new Map<ConversationKey, ConversationSummary>();
  for (const message of messages) {
    const key = conversationOf(message, me);
    const summary = summaries.get(key) ?? { unread: 0, mentions: 0, last: null };
    summary.last = message;
    if (
      message.from !== me &&
      !message.local &&
      message.seq > myReadSeq(receipts, me, key)
    ) {
      summary.unread += 1;
      if (message.to === me || message.mentions.includes(me)) summary.mentions += 1;
    }
    summaries.set(key, summary);
  }
  return summaries;
}

export function totalUnread(summaries: Map<ConversationKey, ConversationSummary>): {
  unread: number;
  mentions: number;
} {
  let unread = 0;
  let mentions = 0;
  for (const summary of summaries.values()) {
    unread += summary.unread;
    mentions += summary.mentions;
  }
  return { unread, mentions };
}

/**
 * True when this message should reach me as a notification: anything someone
 * else sends where I can read it (the group, or privately to me). Whether I am
 * already looking at that conversation is decided where it arrives.
 */
export function notifiesMe(message: DiscussionMessage, me: string): boolean {
  return message.from !== me && (!message.to || message.to === me);
}

/** How a notification describes the message. */
export function noticeKind(
  message: DiscussionMessage,
  me: string,
): "private" | "mention" | "message" {
  if (message.to === me) return "private";
  return message.mentions.includes(me) ? "mention" : "message";
}

const presenceOrder: Record<PresenceState, number> = { active: 0, away: 1, offline: 2 };

/** Everyone but me: active people first, then away, then offline; by name. */
export function discussionMembers(
  permissions: readonly CollaboratorPermission[],
  me: string,
  presence: ReadonlyMap<string, CollaboratorPresence>,
): DiscussionMember[] {
  return permissions
    .filter((permission) => permission.clientId !== me && !permission.isCurrent)
    .map((permission) => {
      const here = presence.get(permission.clientId);
      return {
        clientId: permission.clientId,
        name: permission.name || "Anonymous",
        role: permission.role,
        presence: presenceState(here),
        currentFile: here?.currentFile ?? null,
      };
    })
    .sort(
      (left, right) =>
        presenceOrder[left.presence] - presenceOrder[right.presence] ||
        left.name.localeCompare(right.name),
    );
}

// --- Timeline ----------------------------------------------------------------

export type TimelineItem =
  | { kind: "day"; key: string; label: string }
  | { kind: "unread"; key: string; count: number }
  | {
      kind: "message";
      key: string;
      message: ChatMessage;
      /** The first of a run from the same person: shows the name and avatar. */
      first: boolean;
      /** The last of a run: carries the bubble's tail. */
      last: boolean;
    };

function dayKey(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function dayLabel(at: number, now = Date.now()): string {
  const day = new Date(at);
  const today = new Date(now);
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  const startOfDay = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
  ).getTime();
  const days = Math.round((startOfToday - startOfDay) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) {
    return day.toLocaleDateString(undefined, { weekday: "long" });
  }
  return day.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    ...(day.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

export function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Lays out one conversation: day separators, a "new messages" line before the
 * first message that was unread when the conversation was opened, and runs of
 * messages from the same person.
 */
export function buildTimeline(
  messages: readonly ChatMessage[],
  options: { unreadAfter: number | null; me: string; now?: number },
): TimelineItem[] {
  const isUnread = (message: ChatMessage) =>
    options.unreadAfter !== null &&
    message.from !== options.me &&
    !message.local &&
    message.seq > options.unreadAfter;
  const unreadCount = messages.filter(isUnread).length;
  const firstUnread = unreadCount ? messages.findIndex(isUnread) : -1;
  const continues = (left: ChatMessage, right: ChatMessage) =>
    left.from === right.from &&
    dayKey(left.createdAt) === dayKey(right.createdAt) &&
    right.createdAt - left.createdAt < groupWindowMs;
  // A run ends at a new day, another person, a pause, or the "new" line.
  const breaksBefore = (index: number) =>
    index === 0 ||
    index === firstUnread ||
    !continues(messages[index - 1]!, messages[index]!);

  const items: TimelineItem[] = [];
  messages.forEach((message, index) => {
    const day = dayKey(message.createdAt);
    if (index === 0 || dayKey(messages[index - 1]!.createdAt) !== day) {
      items.push({
        kind: "day",
        key: `day-${day}`,
        label: dayLabel(message.createdAt, options.now),
      });
    }
    if (index === firstUnread) {
      items.push({ kind: "unread", key: "unread", count: unreadCount });
    }
    items.push({
      kind: "message",
      key: message.id,
      message,
      first: breaksBefore(index),
      last: index === messages.length - 1 || breaksBefore(index + 1),
    });
  });
  return items;
}

// --- Text: mentions and links -------------------------------------------------

export type BodySegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; text: string; clientId: string; isMe: boolean }
  | { kind: "link"; text: string; href: string };

const linkPattern = /\bhttps?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]}]/gi;

function linkSegments(text: string): BodySegment[] {
  const segments: BodySegment[] = [];
  let index = 0;
  for (const match of text.matchAll(linkPattern)) {
    const start = match.index ?? 0;
    if (start > index) segments.push({ kind: "text", text: text.slice(index, start) });
    segments.push({ kind: "link", text: match[0], href: match[0] });
    index = start + match[0].length;
  }
  if (index < text.length) segments.push({ kind: "text", text: text.slice(index) });
  return segments;
}

/**
 * Splits a message into text, @mentions (only of people it really mentions)
 * and links. Longer names are matched first, so "@Ann Lee" wins over "@Ann".
 */
export function bodySegments(
  body: string,
  mentions: readonly string[],
  names: ReadonlyMap<string, string>,
  me: string,
): BodySegment[] {
  const candidates = mentions
    .map((clientId) => ({ clientId, token: `@${names.get(clientId) ?? ""}` }))
    .filter((candidate) => candidate.token.length > 1)
    .sort((left, right) => right.token.length - left.token.length);
  const segments: BodySegment[] = [];
  let buffer = "";
  let index = 0;
  while (index < body.length) {
    const atBoundary = index === 0 || /\s|[([{"']/.test(body[index - 1] ?? "");
    const candidate =
      body[index] === "@" && atBoundary
        ? candidates.find((item) => body.startsWith(item.token, index))
        : undefined;
    if (candidate) {
      if (buffer) segments.push(...linkSegments(buffer));
      buffer = "";
      segments.push({
        kind: "mention",
        text: candidate.token,
        clientId: candidate.clientId,
        isMe: candidate.clientId === me,
      });
      index += candidate.token.length;
    } else {
      buffer += body[index];
      index += 1;
    }
  }
  if (buffer) segments.push(...linkSegments(buffer));
  return segments;
}

/** One line of a message, for previews and quotes. */
export function previewText(body: string, max = 120): string {
  const line = body.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// --- Composer ------------------------------------------------------------------

export interface MentionQuery {
  /** Where the "@" is. */
  start: number;
  query: string;
}

/** The @mention being typed at the caret, if any. */
export function activeMentionQuery(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s|[([{"']/.test(before[at - 1] ?? "")) return null;
  const query = before.slice(at + 1);
  // A trailing space ends the mention (as after choosing a name).
  if (query.length > 40 || /[\n\r@]/.test(query) || /\s{2}|\s$/.test(query)) {
    return null;
  }
  return { start: at, query };
}

/** People whose name matches what follows the "@" (any word, from its start). */
export function mentionSuggestions(
  members: readonly DiscussionMember[],
  query: string,
): DiscussionMember[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return members.slice(0, 8);
  return members
    .filter((member) => {
      const name = member.name.toLocaleLowerCase();
      return (
        name.startsWith(needle) ||
        name.split(/\s+/).some((word) => word.startsWith(needle))
      );
    })
    .slice(0, 8);
}

/** Replaces the typed "@que" with "@Full Name " and returns the new caret. */
export function insertMention(
  text: string,
  mention: MentionQuery,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const inserted = `@${name} `;
  const after = text.slice(caret).replace(/^ /, "");
  return {
    text: `${text.slice(0, mention.start)}${inserted}${after}`,
    caret: mention.start + inserted.length,
  };
}

/** The people still mentioned in the text (a deleted "@Name" is no mention). */
export function mentionsInText(
  text: string,
  chosen: ReadonlyMap<string, string>,
): string[] {
  const ids: string[] = [];
  for (const [clientId, name] of chosen) {
    const token = `@${name}`;
    let from = 0;
    while (from <= text.length) {
      const found = text.indexOf(token, from);
      if (found < 0) break;
      const boundary = found === 0 || /\s|[([{"']/.test(text[found - 1] ?? "");
      if (boundary) {
        ids.push(clientId);
        break;
      }
      from = found + 1;
    }
  }
  return ids;
}

/** A message id the server accepts: 8–64 of A–Z, a–z, 0–9, "_" and "-". */
export function newMessageId(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `m-${random}`;
}

export const maxMessageChars = 4000;
