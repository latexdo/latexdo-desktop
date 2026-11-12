// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DiscussionError,
  advanceReceipt,
  allowBurst,
  audienceFor,
  canSeeMessage,
  conversationFor,
  discussionLimits,
  emptyDiscussion,
  listMessages,
  normalizeDiscussion,
  postMessage,
  receiptsFor,
} from "./discussion.mjs";

const ada = { clientId: "ada", clientName: "Ada" };
const members = new Map([
  ["ada", "Ada"],
  ["bob", "Bob"],
  ["eve", "Eve"],
]);

function send(state, input, identity = ada) {
  return postMessage(state, { identity, members, input, now: 1000 });
}

describe("discussion rules", () => {
  it("repairs stored state and keeps the sequence ahead of its messages", () => {
    expect(normalizeDiscussion(null)).toEqual(emptyDiscussion());
    expect(normalizeDiscussion({ schemaVersion: 2 })).toEqual(emptyDiscussion());
    const repaired = normalizeDiscussion({
      schemaVersion: 1,
      seq: 1,
      messages: [
        { id: "m1", seq: 4, from: "ada", body: "kept" },
        { id: "m2", seq: -1, from: "ada", body: "bad seq" },
        { id: "m3", seq: 5, from: "", body: "no sender" },
        null,
      ],
      receipts: [],
    });
    expect(repaired.messages.map((message) => message.id)).toEqual(["m1"]);
    expect(repaired.seq).toBe(4);
    expect(repaired.receipts).toEqual({});
    expect(normalizeDiscussion({ schemaVersion: 1, seq: "x", messages: "x" }).seq).toBe(
      0,
    );
  });

  it("files private messages under the other person, from each side", () => {
    const state = emptyDiscussion();
    const { message } = send(state, { id: "private-1", to: "bob", body: "Hi" });
    expect(conversationFor(message, "ada")).toBe("bob");
    expect(conversationFor(message, "bob")).toBe("ada");
    expect(canSeeMessage(message, "eve")).toBe(false);
    expect(audienceFor(message)).toEqual(new Set(["ada", "bob"]));
    const group = send(state, { id: "group-01", body: "All" }).message;
    expect(conversationFor(group, "eve")).toBe("*");
    expect(audienceFor(group)).toBeNull();
  });

  it("rejects malformed input with a status", () => {
    const state = emptyDiscussion();
    const status = (input) => {
      try {
        send(state, input);
      } catch (error) {
        expect(error).toBeInstanceOf(DiscussionError);
        return error.status;
      }
      return 200;
    };
    expect(status(null)).toBe(400);
    expect(status({ id: "bad id!", body: "x" })).toBe(400);
    expect(status({ id: "message-1", body: 5 })).toBe(400);
    expect(status({ id: "message-2", body: "x", mentions: [""] })).toBe(400);
    expect(
      status({
        id: "message-3",
        body: "x",
        mentions: Array.from({ length: discussionLimits.maxMentions + 1 }, () => "bob"),
      }),
    ).toBe(400);
    expect(status({ id: "message-4", body: "x", mentions: ["bob", "bob"] })).toBe(200);
    expect(state.messages.at(-1).mentions).toEqual(["bob"]);
    // A larger limit for bodies that arrive encrypted.
    expect(
      postMessage(state, {
        identity: ada,
        members,
        input: { id: "message-5", body: "x".repeat(5000) },
        now: 1,
        maxBodyChars: 6000,
      }).created,
    ).toBe(true);
  });

  it("checks private recipients and keeps replies in their conversation", () => {
    const state = emptyDiscussion();
    const status = (input, identity = ada) => {
      try {
        send(state, input, identity);
        return 200;
      } catch (error) {
        return error.status;
      }
    };
    expect(status({ id: "to-nobody1", to: "zed", body: "x" })).toBe(404);
    expect(status({ id: "to-number1", to: 7, body: "x" })).toBe(404);
    expect(status({ id: "to-myself1", to: "ada", body: "x" })).toBe(400);
    const group = send(state, { id: "reply-grp1", body: "group" }).message;
    const secret = send(state, { id: "reply-dm01", to: "bob", body: "dm" }).message;
    const bob = { clientId: "bob", clientName: "" };
    // Bob answers the private message privately: the quote is kept.
    expect(
      send(state, { id: "reply-dm02", to: "ada", body: "ok", replyTo: secret.id }, bob)
        .message,
    ).toMatchObject({ replyTo: secret.id, name: "Anonymous" });
    // Eve cannot quote a message she cannot see; nobody quotes across conversations.
    const eve = { clientId: "eve", clientName: "Eve" };
    expect(
      send(state, { id: "reply-eve1", body: "?", replyTo: secret.id }, eve).message
        .replyTo,
    ).toBeNull();
    expect(
      send(state, { id: "reply-grp2", body: "?", replyTo: group.id }).message.replyTo,
    ).toBe(group.id);
    expect(
      send(state, { id: "reply-grp3", body: "?", replyTo: 5 }).message.replyTo,
    ).toBeNull();
    expect(
      send(state, { id: "reply-grp4", body: "?", replyTo: "missing" }).message.replyTo,
    ).toBeNull();
  });

  it("drops the oldest messages past the count and size caps", () => {
    const state = emptyDiscussion();
    for (let index = 0; index < discussionLimits.maxMessages + 3; index += 1) {
      send(state, { id: `message-${String(index).padStart(5, "0")}`, body: "x" });
    }
    expect(state.messages).toHaveLength(discussionLimits.maxMessages);
    expect(state.messages[0].seq).toBe(4);

    const big = emptyDiscussion();
    const body = "y".repeat(discussionLimits.maxStoredBodyChars);
    const count = Math.ceil(discussionLimits.maxTotalBodyChars / body.length) + 2;
    for (let index = 0; index < count; index += 1) {
      postMessage(big, {
        identity: ada,
        members,
        input: { id: `big-message-${index}`, body },
        now: index,
        maxBodyChars: body.length,
      });
    }
    const total = big.messages.reduce((sum, message) => sum + message.body.length, 0);
    expect(total).toBeLessThanOrEqual(discussionLimits.maxTotalBodyChars);
    expect(big.seq).toBe(count);
  });

  it("caps how many conversations one person tracks", () => {
    const state = emptyDiscussion();
    state.seq = 5;
    for (let index = 0; index < discussionLimits.maxConversationKeys; index += 1) {
      advanceReceipt(state, "ada", { read: { conversation: `c${index}`, seq: 1 } });
    }
    expect(() =>
      advanceReceipt(state, "ada", { read: { conversation: "one-more", seq: 1 } }),
    ).toThrow(DiscussionError);
    // Moving an existing conversation forward still works.
    expect(advanceReceipt(state, "ada", { read: { conversation: "c0", seq: 5 } })).toBe(
      true,
    );
    expect(() => advanceReceipt(state, "ada", null)).toThrow(DiscussionError);
    expect(() =>
      advanceReceipt(state, "ada", { read: { conversation: "c0" } }),
    ).toThrow(DiscussionError);
  });

  it("repairs damaged receipts and hides them from others", () => {
    const state = emptyDiscussion();
    state.seq = 3;
    state.receipts = {
      ada: { delivered: "x", read: null },
      bob: null,
      eve: { delivered: 2, read: { "*": 2, ada: 1, bob: "x" } },
    };
    expect(advanceReceipt(state, "ada", { delivered: 2 })).toBe(true);
    expect(receiptsFor(state, "ada")).toEqual({
      ada: { delivered: 2, read: {} },
      eve: { delivered: 2, read: { "*": 2, ada: 1 } },
    });
    expect(receiptsFor(state, "eve").eve.read).toEqual({ "*": 2, ada: 1 });
  });

  it("pages through what one person can see", () => {
    const state = emptyDiscussion();
    for (let index = 0; index < 5; index += 1) {
      send(state, { id: `paging-${index}0`, body: `${index}` });
    }
    send(state, { id: "paging-private", to: "bob", body: "secret" });
    expect(listMessages(state, "eve", { limit: 2 })).toMatchObject({ hasMore: true });
    expect(listMessages(state, "eve", { limit: "nope" }).messages).toHaveLength(5);
    expect(
      listMessages(state, "eve", { limit: 10_000 }).messages.length,
    ).toBeLessThanOrEqual(discussionLimits.maxPageSize);
    expect(
      listMessages(state, "bob", { after: 4 }).messages.map((m) => m.body),
    ).toEqual(["4", "secret"]);
    expect(listMessages(state, "bob", { after: 0, limit: 1 }).hasMore).toBe(true);
    expect(listMessages(state, "eve", { before: 3 }).messages).toHaveLength(2);
  });

  it("limits bursts per person", () => {
    const buckets = new Map();
    for (let index = 0; index < discussionLimits.burstMessages; index += 1) {
      expect(allowBurst(buckets, "ada", 1000 + index)).toBe(true);
    }
    expect(allowBurst(buckets, "ada", 1100)).toBe(false);
    expect(allowBurst(buckets, "bob", 1100)).toBe(true);
    expect(allowBurst(buckets, "ada", 1100 + discussionLimits.burstWindowMs + 50)).toBe(
      true,
    );
  });
});

describe("editing messages", () => {
  it("preserves order, replies and receipts and returns edits in incremental pages", () => {
    const state = emptyDiscussion();
    const original = send(state, { id: "message-1", body: "First", to: "bob" }).message;
    send(state, { id: "message-2", body: "Second", to: "bob", replyTo: original.id });
    const receipts = JSON.stringify(state.receipts);
    const result = send(state, {
      id: original.id,
      body: "Corrected",
      to: "bob",
      edit: true,
      expectedRevision: 1,
    });
    expect(result).toMatchObject({
      created: false,
      updated: true,
      message: {
        seq: 1,
        updatedSeq: 3,
        editedAt: 1000,
        body: "Corrected",
        createdAt: 1000,
      },
    });
    expect(state.messages.map((m) => m.id)).toEqual(["message-1", "message-2"]);
    expect(state.messages[1].replyTo).toBe(original.id);
    expect(JSON.stringify(state.receipts)).toBe(receipts);
    expect(listMessages(state, "bob", { after: 1, limit: 1 })).toMatchObject({
      messages: [{ id: "message-2" }],
      hasMore: true,
    });
    expect(listMessages(state, "bob", { after: 2 }).messages).toEqual([result.message]);
    expect(listMessages(state, "eve", { after: 2 }).messages).toEqual([]);
    expect(normalizeDiscussion({ ...state, seq: 0 }).seq).toBe(3);
  });
  it("rejects another sender, stale edits, missing messages, changed audience and invalid text", () => {
    const state = emptyDiscussion();
    send(state, { id: "message-1", body: "First" });
    const edit = { id: "message-1", edit: true, expectedRevision: 1, body: "Changed" };
    expect(() => send(state, edit, { clientId: "bob", clientName: "Bob" })).toThrow();
    expect(() => send(state, { ...edit, id: "missing-1" })).toThrow(
      "Message not found",
    );
    expect(() => send(state, { ...edit, to: "bob" })).toThrow("conversation");
    expect(() => send(state, { ...edit, body: " " })).toThrow("empty");
    expect(() => send(state, { ...edit, body: "x".repeat(4001) })).toThrow("too long");
    expect(state.seq).toBe(1);
    send(state, edit);
    expect(() => send(state, edit)).toThrow("changed");
    expect(state.messages[0].body).toBe("Changed");
    expect(send(state, { id: "message-1", body: "Old retry" }).message.body).toBe(
      "Changed",
    );
  });
});

describe("reacting to messages", () => {
  const bob = { clientId: "bob", clientName: "Bob" };
  const eve = { clientId: "eve", clientName: "Eve" };

  it("keeps one opaque reaction per person and returns changes in incremental pages", () => {
    const state = emptyDiscussion();
    send(state, { id: "message-1", body: "Ready?" });
    const first = send(
      state,
      { id: "message-1", react: true, reaction: "sealed-ok" },
      bob,
    );
    expect(first).toMatchObject({
      created: false,
      updated: true,
      message: {
        seq: 1,
        updatedSeq: 2,
        body: "Ready?",
        reactions: { bob: "sealed-ok" },
      },
    });
    expect(first.message.editedAt).toBeUndefined();
    send(state, { id: "message-1", react: true, reaction: "sealed-heart" }, bob);
    send(state, { id: "message-1", react: true, reaction: "sealed-ok" });
    expect(state.messages[0].reactions).toEqual({
      bob: "sealed-heart",
      ada: "sealed-ok",
    });
    expect(listMessages(state, "bob", { after: 3 }).messages).toEqual([
      state.messages[0],
    ]);
    // Setting the same reaction again changes nothing.
    expect(
      send(state, { id: "message-1", react: true, reaction: "sealed-ok" }).updated,
    ).toBeUndefined();
    send(state, { id: "message-1", react: true, reaction: null }, bob);
    send(state, { id: "message-1", react: true, reaction: null });
    expect(state.messages[0].reactions).toBeUndefined();
    expect(state.seq).toBe(6);
  });

  it("refuses hidden or missing messages and invalid reactions", () => {
    const state = emptyDiscussion();
    send(state, { id: "message-1", body: "Private", to: "bob" });
    expect(() =>
      send(state, { id: "message-1", react: true, reaction: "x" }, eve),
    ).toThrow("not found");
    expect(() => send(state, { id: "missing-1", react: true, reaction: "x" })).toThrow(
      "not found",
    );
    expect(() =>
      send(state, { id: "message-1", react: true, reaction: 5 }, bob),
    ).toThrow("Invalid reaction");
    expect(() =>
      send(
        state,
        {
          id: "message-1",
          react: true,
          reaction: "x".repeat(discussionLimits.maxReactionChars + 1),
        },
        bob,
      ),
    ).toThrow("Invalid reaction");
    expect(state.seq).toBe(1);
  });

  it("does not make an open edit stale", () => {
    const state = emptyDiscussion();
    send(state, { id: "message-1", body: "Draft" });
    send(state, { id: "message-1", react: true, reaction: "sealed-ok" }, bob);
    const edited = send(state, {
      id: "message-1",
      body: "Final",
      edit: true,
      expectedRevision: 1,
    }).message;
    expect(edited).toMatchObject({ body: "Final", reactions: { bob: "sealed-ok" } });
    send(state, { id: "message-1", react: true, reaction: null }, bob);
    expect(() =>
      send(state, { id: "message-1", body: "Again", edit: true, expectedRevision: 1 }),
    ).toThrow("changed");
    expect(
      send(state, { id: "message-1", body: "Again", edit: true, expectedRevision: 4 })
        .message.body,
    ).toBe("Again");
  });
});
