/*
 * The project discussion: messages people with access to a shared project
 * send each other, to everyone or to one person, with delivery and read
 * receipts. This module holds the rules (what a message may contain, who may
 * see it, how receipts advance); server.mjs stores and serves the state.
 *
 * Receipts are watermarks on the message sequence. `delivered` is global: the
 * person's app received every message up to it. `read` is per conversation
 * ("*" for everyone, or the other person's client id for a private one), so
 * reading the group does not mark an unopened private message as read.
 */

export const discussionLimits = Object.freeze({
  /** Characters in one message, as typed. */
  maxBodyChars: 4000,
  /** A message body as stored (an encrypted body is longer than its text). */
  maxStoredBodyChars: 32 * 1024,
  maxMentions: 50,
  /** Older messages are dropped past this many… */
  maxMessages: 2000,
  /** …or past this many stored body characters in all. */
  maxTotalBodyChars: 4 * 1024 * 1024,
  pageSize: 100,
  maxPageSize: 200,
  /** Messages one person may send in a burst… */
  burstMessages: 20,
  /** …within this window. */
  burstWindowMs: 10_000,
  maxConversationKeys: 200,
});

export const everyoneConversation = "*";

const messageIdPattern = /^[A-Za-z0-9_-]{8,64}$/;
const clientIdPattern = /^[^\u0000-\u001f\u007f]{1,160}$/;

export class DiscussionError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function emptyDiscussion() {
  return { schemaVersion: 1, seq: 0, messages: [], receipts: {} };
}

function isClientId(value) {
  return typeof value === "string" && clientIdPattern.test(value);
}

function isSeq(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** A stored discussion, repaired: unknown or damaged entries are dropped. */
export function normalizeDiscussion(raw) {
  if (!raw || typeof raw !== "object" || raw.schemaVersion !== 1) {
    return emptyDiscussion();
  }
  const messages = Array.isArray(raw.messages)
    ? raw.messages.filter(
        (message) =>
          message &&
          typeof message === "object" &&
          isSeq(message.seq) &&
          typeof message.id === "string" &&
          isClientId(message.from) &&
          typeof message.body === "string",
      )
    : [];
  const lastSeq = messages.length ? messages[messages.length - 1].seq : 0;
  const receipts =
    raw.receipts && typeof raw.receipts === "object" && !Array.isArray(raw.receipts)
      ? raw.receipts
      : {};
  return {
    schemaVersion: 1,
    seq: isSeq(raw.seq) ? Math.max(raw.seq, lastSeq) : lastSeq,
    messages,
    receipts,
  };
}

/** True when this person may see the message. */
export function canSeeMessage(message, clientId) {
  return !message.to || message.from === clientId || message.to === clientId;
}

/** The conversation a message belongs to, seen from this person's side. */
export function conversationFor(message, clientId) {
  if (!message.to) return everyoneConversation;
  return message.from === clientId ? message.to : message.from;
}

function cleanMentions(value, members) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > discussionLimits.maxMentions) {
    throw new DiscussionError(400, "Invalid mentions.");
  }
  const mentions = [];
  for (const item of value) {
    if (!isClientId(item)) throw new DiscussionError(400, "Invalid mentions.");
    // A mention of someone who left the project is quietly dropped.
    if (members.has(item) && !mentions.includes(item)) mentions.push(item);
  }
  return mentions;
}

/**
 * Validates and stores a new message. `members` maps every client id with
 * access to the project to its name. Re-sending a message with the same id
 * (a retry) returns the stored one instead of a duplicate.
 */
export function postMessage(state, { identity, members, input, now, maxBodyChars }) {
  if (!input || typeof input !== "object") {
    throw new DiscussionError(400, "Message must be JSON.");
  }
  const id = input.id;
  if (typeof id !== "string" || !messageIdPattern.test(id)) {
    throw new DiscussionError(400, "Invalid message id.");
  }
  const existing = state.messages.find((message) => message.id === id);
  if (existing) {
    if (existing.from !== identity.clientId) {
      throw new DiscussionError(409, "Message id already used.");
    }
    return { message: existing, created: false };
  }

  const body = typeof input.body === "string" ? input.body : "";
  const limit = maxBodyChars ?? discussionLimits.maxBodyChars;
  if (!body.trim()) throw new DiscussionError(400, "A message cannot be empty.");
  if (body.length > limit) {
    throw new DiscussionError(413, "This message is too long.");
  }

  let to = null;
  if (input.to !== undefined && input.to !== null) {
    if (!isClientId(input.to) || !members.has(input.to)) {
      throw new DiscussionError(404, "That person is no longer in this project.");
    }
    if (input.to === identity.clientId) {
      throw new DiscussionError(400, "You cannot send a private message to yourself.");
    }
    to = input.to;
  }

  let replyTo = null;
  if (input.replyTo !== undefined && input.replyTo !== null) {
    const target =
      typeof input.replyTo === "string"
        ? state.messages.find((message) => message.id === input.replyTo)
        : undefined;
    // Only a message the sender can see, in the same conversation.
    if (
      target &&
      canSeeMessage(target, identity.clientId) &&
      conversationFor(target, identity.clientId) === (to ?? everyoneConversation)
    ) {
      replyTo = target.id;
    }
  }

  const recipients = to
    ? [to]
    : [...members.keys()].filter((clientId) => clientId !== identity.clientId);
  const seq = state.seq + 1;
  const message = {
    id,
    seq,
    from: identity.clientId,
    name: identity.clientName || "Anonymous",
    to,
    recipients,
    body,
    mentions: cleanMentions(input.mentions, members),
    replyTo,
    createdAt: now,
  };
  state.seq = seq;
  state.messages.push(message);
  if (state.messages.length > discussionLimits.maxMessages) {
    state.messages.splice(0, state.messages.length - discussionLimits.maxMessages);
  }
  let total = state.messages.reduce((sum, item) => sum + item.body.length, 0);
  while (total > discussionLimits.maxTotalBodyChars && state.messages.length > 1) {
    total -= state.messages.shift().body.length;
  }
  // Sending is reading: the sender has seen their own conversation.
  advanceReceipt(state, identity.clientId, {
    delivered: seq,
    read: { conversation: to ?? everyoneConversation, seq },
  });
  return { message, created: true };
}

function receiptFor(state, clientId) {
  const current = Object.hasOwn(state.receipts, clientId)
    ? state.receipts[clientId]
    : undefined;
  if (current && typeof current === "object") {
    if (!isSeq(current.delivered)) current.delivered = 0;
    if (!current.read || typeof current.read !== "object") current.read = {};
    return current;
  }
  const created = { delivered: 0, read: {} };
  Object.defineProperty(state.receipts, clientId, {
    value: created,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return created;
}

/**
 * Moves this person's watermarks forward (never back). Returns true when
 * something changed and the others should hear about it.
 */
export function advanceReceipt(state, clientId, update) {
  if (!update || typeof update !== "object") {
    throw new DiscussionError(400, "Invalid receipt.");
  }
  const receipt = receiptFor(state, clientId);
  let changed = false;
  if (update.delivered !== undefined) {
    if (!isSeq(update.delivered)) throw new DiscussionError(400, "Invalid receipt.");
    const delivered = Math.min(update.delivered, state.seq);
    if (delivered > receipt.delivered) {
      receipt.delivered = delivered;
      changed = true;
    }
  }
  if (update.read !== undefined) {
    const read = update.read;
    if (
      !read ||
      typeof read !== "object" ||
      !isClientId(read.conversation) ||
      !isSeq(read.seq)
    ) {
      throw new DiscussionError(400, "Invalid receipt.");
    }
    const seq = Math.min(read.seq, state.seq);
    const previous = Object.hasOwn(receipt.read, read.conversation)
      ? receipt.read[read.conversation]
      : 0;
    if (seq > previous) {
      if (
        !Object.hasOwn(receipt.read, read.conversation) &&
        Object.keys(receipt.read).length >= discussionLimits.maxConversationKeys
      ) {
        throw new DiscussionError(429, "Too many conversations.");
      }
      Object.defineProperty(receipt.read, read.conversation, {
        value: seq,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      changed = true;
    }
    // Reading implies the message arrived.
    if (seq > receipt.delivered) {
      receipt.delivered = seq;
      changed = true;
    }
  }
  return changed;
}

/**
 * What one person may know about everyone's receipts: the group watermark,
 * and for private conversations only the one they are part of.
 */
export function receiptsFor(state, clientId) {
  const out = {};
  for (const [owner, receipt] of Object.entries(state.receipts)) {
    if (!receipt || typeof receipt !== "object") continue;
    const read = {};
    const source = receipt.read && typeof receipt.read === "object" ? receipt.read : {};
    if (owner === clientId) {
      for (const [conversation, seq] of Object.entries(source)) {
        if (isSeq(seq)) read[conversation] = seq;
      }
    } else {
      if (isSeq(source[everyoneConversation])) {
        read[everyoneConversation] = source[everyoneConversation];
      }
      if (Object.hasOwn(source, clientId) && isSeq(source[clientId])) {
        read[clientId] = source[clientId];
      }
    }
    out[owner] = { delivered: isSeq(receipt.delivered) ? receipt.delivered : 0, read };
  }
  return out;
}

function pageSize(value) {
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size <= 0) return discussionLimits.pageSize;
  return Math.min(size, discussionLimits.maxPageSize);
}

/**
 * One page of the messages this person can see: newer than `after`, or (for
 * scrolling back) older than `before`; the latest page when neither is given.
 */
export function listMessages(state, clientId, { after, before, limit } = {}) {
  const size = pageSize(limit);
  const visible = state.messages.filter((message) => canSeeMessage(message, clientId));
  const afterSeq = Number(after);
  const beforeSeq = Number(before);
  if (after !== undefined && after !== null && after !== "" && isSeq(afterSeq)) {
    const newer = visible.filter((message) => message.seq > afterSeq);
    return {
      messages: newer.slice(0, size),
      hasMore: newer.length > size,
    };
  }
  const older =
    before !== undefined && before !== null && before !== "" && isSeq(beforeSeq)
      ? visible.filter((message) => message.seq < beforeSeq)
      : visible;
  return {
    messages: older.slice(-size),
    hasMore: older.length > size,
  };
}

/** Who should be told that something changed (everyone for the group). */
export function audienceFor(message) {
  return message.to ? new Set([message.from, message.to]) : null;
}

/** A per-person sliding window; true when the person may send now. */
export function allowBurst(buckets, clientId, now) {
  const windowStart = now - discussionLimits.burstWindowMs;
  const recent = (buckets.get(clientId) ?? []).filter((at) => at > windowStart);
  if (recent.length >= discussionLimits.burstMessages) {
    buckets.set(clientId, recent);
    return false;
  }
  recent.push(now);
  buckets.set(clientId, recent);
  return true;
}
