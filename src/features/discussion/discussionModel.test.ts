import { describe, expect, it, vi } from "vitest";
import type { DiscussionReceipt } from "../../types";
import {
  activeMentionQuery,
  bodySegments,
  buildTimeline,
  conversationOf,
  dayLabel,
  discussionMembers,
  everyone,
  insertMention,
  latestSeq,
  mentionSuggestions,
  mentionsInText,
  mergeMessages,
  messageStatus,
  newMessageId,
  noticeKind,
  notifiesMe,
  oldestSeq,
  pendingSeq,
  previewText,
  receiptBreakdown,
  summarizeConversations,
  timeLabel,
  totalUnread,
  type ChatMessage,
  type DiscussionMember,
} from "./discussionModel";

const minute = 60_000;
const base = new Date(2026, 10, 10, 12, 0).getTime();

function message(overrides: Partial<ChatMessage> & { seq: number }): ChatMessage {
  return {
    id: `m${overrides.seq}`,
    from: "bob",
    name: "Bob",
    to: null,
    recipients: ["me", "eve"],
    body: "Hello",
    mentions: [],
    replyTo: null,
    createdAt: base + overrides.seq * minute,
    ...overrides,
  };
}

const members = new Set(["me", "bob", "eve"]);

describe("conversations and merging", () => {
  it("files messages under everyone or the other person", () => {
    expect(conversationOf(message({ seq: 1 }), "me")).toBe(everyone);
    expect(conversationOf(message({ seq: 2, to: "me" }), "me")).toBe("bob");
    expect(conversationOf(message({ seq: 3, from: "me", to: "eve" }), "me")).toBe(
      "eve",
    );
  });

  it("does not let a stale fetch replace an edited message", () => {
    const original = message({ seq: 1 });
    const edited = {
      ...original,
      body: "Edited",
      updatedSeq: 5,
      editedAt: base + 1000,
    };
    expect(mergeMessages([edited, message({ seq: 2 })], [original])).toEqual([
      edited,
      message({ seq: 2 }),
    ]);
    expect(mergeMessages([original], [edited])).toEqual([edited]);
  });

  it("merges by id in server order, pending messages last", () => {
    const pending = message({ seq: pendingSeq, id: "local", local: "sending" });
    const current = [message({ seq: 2 }), pending];
    expect(mergeMessages(current, [])).toBe(current);
    const merged = mergeMessages(current, [
      message({ seq: 1 }),
      message({ seq: 2, body: "edited" }),
      { ...pending, seq: 3, local: undefined },
    ]);
    expect(merged.map((item) => [item.seq, item.body])).toEqual([
      [1, "Hello"],
      [2, "edited"],
      [3, "Hello"],
    ]);
    expect(latestSeq([...merged, pending])).toBe(3);
    expect(oldestSeq([pending, ...merged])).toBe(1);
    expect(oldestSeq([pending])).toBeNull();
  });
});

describe("check marks", () => {
  const mine = message({ seq: 5, from: "me", recipients: ["bob", "eve"] });

  it("goes from sent to delivered to read when everyone has", () => {
    const receipts: Record<string, DiscussionReceipt> = {};
    expect(messageStatus(mine, "me", receipts, members)).toBe("sent");
    receipts.bob = { delivered: 5, read: { "*": 5 } };
    expect(messageStatus(mine, "me", receipts, members)).toBe("sent");
    receipts.eve = { delivered: 6, read: {} };
    expect(messageStatus(mine, "me", receipts, members)).toBe("delivered");
    receipts.eve = { delivered: 6, read: { "*": 9 } };
    expect(messageStatus(mine, "me", receipts, members)).toBe("read");
    expect(receiptBreakdown(mine, "me", receipts, members)).toEqual({
      read: ["bob", "eve"],
      delivered: [],
      waiting: [],
    });
  });

  it("reads a private message in the sender's conversation", () => {
    const secret = message({ seq: 7, from: "me", to: "bob", recipients: ["bob"] });
    // Reading the group says nothing about the private conversation.
    const groupOnly = { bob: { delivered: 7, read: { "*": 7 } } };
    expect(messageStatus(secret, "me", groupOnly, members)).toBe("delivered");
    const read = { bob: { delivered: 7, read: { me: 7 } } };
    expect(messageStatus(secret, "me", read, members)).toBe("read");
  });

  it("ignores people who left, and shows local states", () => {
    const gone = message({ seq: 8, from: "me", recipients: ["zed"] });
    expect(messageStatus(gone, "me", {}, members)).toBe("sent");
    expect(messageStatus({ ...mine, local: "sending" }, "me", {}, members)).toBe(
      "sending",
    );
    expect(messageStatus({ ...mine, local: "failed" }, "me", {}, members)).toBe(
      "failed",
    );
    expect(
      receiptBreakdown(mine, "me", { bob: { delivered: 5, read: {} } }, members),
    ).toEqual({ read: [], delivered: ["bob"], waiting: ["eve"] });
  });
});

describe("unread counts and notifications", () => {
  it("counts unread messages from others per conversation", () => {
    const messages = [
      message({ seq: 1 }),
      message({ seq: 2, mentions: ["me"] }),
      message({ seq: 3, from: "me" }),
      message({ seq: 4, to: "me" }),
      message({ seq: pendingSeq, from: "me", local: "sending" }),
    ];
    const summaries = summarizeConversations(messages, "me", {
      me: { delivered: 4, read: { "*": 1 } },
    });
    expect(summaries.get(everyone)).toMatchObject({ unread: 1, mentions: 1 });
    expect(summaries.get(everyone)?.last?.seq).toBe(pendingSeq);
    expect(summaries.get("bob")).toMatchObject({ unread: 1, mentions: 1 });
    expect(totalUnread(summaries)).toEqual({ unread: 2, mentions: 2 });
    // A message an admin deleted is not waiting to be read.
    const deleted = summarizeConversations(
      [message({ seq: 5, body: "", deletedAt: 1, deletedBy: "ann" })],
      "me",
      { me: { delivered: 4, read: { "*": 4 } } },
    );
    expect(deleted.get(everyone)?.unread).toBe(0);
  });

  it("notifies for every message from others that I can read", () => {
    expect(notifiesMe(message({ seq: 1, mentions: ["me"] }), "me")).toBe(true);
    expect(notifiesMe(message({ seq: 2, to: "me" }), "me")).toBe(true);
    expect(notifiesMe(message({ seq: 3 }), "me")).toBe(true);
    expect(notifiesMe(message({ seq: 5, to: "eve" }), "me")).toBe(false);
    expect(noticeKind(message({ seq: 6, to: "me", mentions: ["me"] }), "me")).toBe(
      "private",
    );
    expect(noticeKind(message({ seq: 7, mentions: ["me"] }), "me")).toBe("mention");
    expect(noticeKind(message({ seq: 8 }), "me")).toBe("message");
    expect(notifiesMe(message({ seq: 4, from: "me", mentions: ["me"] }), "me")).toBe(
      false,
    );
  });

  it("lists other members: active, then away, then offline", () => {
    const list = discussionMembers(
      [
        { clientId: "me", name: "Me", role: "admin", isCurrent: true },
        { clientId: "zoe", name: "Zoe", role: "editor" },
        { clientId: "amy", name: "", role: "viewer" },
        { clientId: "bob", name: "Bob", role: "editor" },
        { clientId: "cy", name: "Cy", role: "editor" },
      ],
      "me",
      new Map([
        ["zoe", { clientId: "zoe", name: "Zoe", currentFile: "main.tex", lastSeen: 1 }],
        [
          "cy",
          { clientId: "cy", name: "Cy", currentFile: null, lastSeen: 1, active: false },
        ],
      ]),
    );
    expect(
      list.map((member) => [member.name, member.presence, member.currentFile]),
    ).toEqual([
      ["Zoe", "active", "main.tex"],
      ["Cy", "away", null],
      ["Anonymous", "offline", null],
      ["Bob", "offline", null],
    ]);
  });
});

describe("timeline", () => {
  it("adds day separators, groups runs and marks the first unread", () => {
    const yesterday = base - 24 * 60 * minute;
    const items = buildTimeline(
      [
        message({ seq: 1, createdAt: yesterday }),
        message({ seq: 2 }),
        message({ seq: 3 }),
        message({ seq: 4, createdAt: base + 30 * minute }),
        message({ seq: 5, from: "me", createdAt: base + 31 * minute }),
      ],
      { unreadAfter: 2, me: "me", now: base },
    );
    expect(items.map((item) => item.kind)).toEqual([
      "day",
      "message",
      "day",
      "message",
      "unread",
      "message",
      "message",
      "message",
    ]);
    expect(items[0]).toMatchObject({ label: "Yesterday" });
    expect(items[2]).toMatchObject({ label: "Today" });
    expect(items[4]).toMatchObject({ count: 2 });
    const runs = items.flatMap((item) =>
      item.kind === "message" ? [[item.message.seq, item.first, item.last]] : [],
    );
    expect(runs).toEqual([
      [1, true, true],
      // Seq 3 starts a new run after the "new messages" line.
      [2, true, true],
      [3, true, true],
      [4, true, true],
      [5, true, true],
    ]);
  });

  it("stacks consecutive messages and skips the line when nothing is unread", () => {
    const items = buildTimeline([message({ seq: 1 }), message({ seq: 2 })], {
      unreadAfter: 5,
      me: "me",
      now: base,
    });
    const runs = items.flatMap((item) =>
      item.kind === "message" ? [[item.first, item.last]] : [],
    );
    expect(runs).toEqual([
      [true, false],
      [false, true],
    ]);
    expect(items.some((item) => item.kind === "unread")).toBe(false);
    expect(buildTimeline([], { unreadAfter: null, me: "me" })).toEqual([]);
  });

  it("labels days and times", () => {
    expect(dayLabel(base, base)).toBe("Today");
    expect(dayLabel(base - 3 * 24 * 60 * minute, base)).toBe(
      new Date(base - 3 * 24 * 60 * minute).toLocaleDateString(undefined, {
        weekday: "long",
      }),
    );
    expect(dayLabel(new Date(2025, 0, 2).getTime(), base)).toContain("2025");
    expect(dayLabel(new Date(2026, 0, 2).getTime(), base)).not.toContain("2026");
    expect(timeLabel(base)).toMatch(/12|00/);
  });
});

describe("text", () => {
  const names = new Map([
    ["ann", "Ann"],
    ["annlee", "Ann Lee"],
    ["me", "Me"],
  ]);

  it("highlights real mentions, longest name first, and links", () => {
    expect(
      bodySegments(
        "Hi @Ann Lee and @Ann, see https://example.org/x. (@Me) mail@Ann",
        ["ann", "annlee", "me"],
        names,
        "me",
      ),
    ).toEqual([
      { kind: "text", text: "Hi " },
      { kind: "mention", text: "@Ann Lee", clientId: "annlee", isMe: false },
      { kind: "text", text: " and " },
      { kind: "mention", text: "@Ann", clientId: "ann", isMe: false },
      { kind: "text", text: ", see " },
      { kind: "link", text: "https://example.org/x", href: "https://example.org/x" },
      { kind: "text", text: ". (" },
      { kind: "mention", text: "@Me", clientId: "me", isMe: true },
      { kind: "text", text: ") mail@Ann" },
    ]);
    // "@Bob" was typed but Bob was not mentioned (or is unknown): plain text.
    expect(bodySegments("@Bob", ["bob"], names, "me")).toEqual([
      { kind: "text", text: "@Bob" },
    ]);
  });

  it("previews one line", () => {
    expect(previewText("a\n\n b  c")).toBe("a b c");
    expect(previewText("abcdef", 4)).toBe("abc…");
  });
});

describe("composer", () => {
  const people: DiscussionMember[] = [
    {
      clientId: "ann",
      name: "Ann Lee",
      role: "editor",
      presence: "active",
      currentFile: null,
    },
    {
      clientId: "bob",
      name: "Bob",
      role: "viewer",
      presence: "offline",
      currentFile: null,
    },
  ];

  it("finds the @mention being typed", () => {
    expect(activeMentionQuery("Hi @an", 6)).toEqual({ start: 3, query: "an" });
    expect(activeMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
    expect(activeMentionQuery("Hi @Ann L", 9)).toEqual({ start: 3, query: "Ann L" });
    expect(activeMentionQuery("mail@an", 7)).toBeNull();
    expect(activeMentionQuery("no mention", 5)).toBeNull();
    expect(activeMentionQuery("@a\nb", 4)).toBeNull();
    expect(activeMentionQuery("@a  b", 5)).toBeNull();
    expect(activeMentionQuery("Hi @Ann Lee ", 12)).toBeNull();
    expect(activeMentionQuery(`@${"x".repeat(41)}`, 42)).toBeNull();
  });

  it("suggests people by the start of any word", () => {
    expect(mentionSuggestions(people, "")).toHaveLength(2);
    expect(mentionSuggestions(people, "lee").map((p) => p.clientId)).toEqual(["ann"]);
    expect(mentionSuggestions(people, "B").map((p) => p.clientId)).toEqual(["bob"]);
    expect(mentionSuggestions(people, "z")).toEqual([]);
  });

  it("inserts the full name and keeps only mentions still in the text", () => {
    expect(
      insertMention("Hi @an there", { start: 3, query: "an" }, 6, "Ann Lee"),
    ).toEqual({ text: "Hi @Ann Lee there", caret: 12 });
    const chosen = new Map([
      ["ann", "Ann Lee"],
      ["bob", "Bob"],
    ]);
    expect(mentionsInText("Thanks @Ann Lee", chosen)).toEqual(["ann"]);
    expect(mentionsInText("x@Bob @Bob", chosen)).toEqual(["bob"]);
    expect(mentionsInText("x@Bob", chosen)).toEqual([]);
  });

  it("makes message ids the server accepts", () => {
    expect(newMessageId()).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    vi.stubGlobal("crypto", {});
    try {
      expect(newMessageId()).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
