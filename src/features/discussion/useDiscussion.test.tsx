import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  advanceReceipt,
  emptyDiscussion,
  listMessages,
  postMessage,
  receiptsFor,
} from "../../../collaborations/discussion.mjs";
import type { CollaboratorPermission, DiscussionPage } from "../../types";
import * as notifications from "../notifications/notifications";
import { everyone } from "./discussionModel";
import {
  discussionPopupAllowed,
  mergeReceipts,
  useDiscussion,
  type UseDiscussionOptions,
} from "./useDiscussion";

const permissions: CollaboratorPermission[] = [
  { clientId: "me", name: "Me", role: "editor", isCurrent: true },
  { clientId: "bob", name: "Bob", role: "editor" },
  { clientId: "eve", name: "Eve", role: "viewer" },
];
const members = new Map(permissions.map((item) => [item.clientId, item.name]));

/** The real discussion rules behind a fake transport. */
function fakeServer() {
  const state = emptyDiscussion();
  const page = (query: Record<string, number> = {}): DiscussionPage => ({
    version: 1,
    seq: state.seq,
    ...listMessages(state, "me", query),
    receipts: receiptsFor(state, "me"),
    members: permissions,
  });
  const api = {
    collaborationClientId: () => "me",
    hasDiscussion: () => true,
    getDiscussion: vi.fn(async (_project: string, query?: Record<string, number>) =>
      page(query),
    ),
    sendDiscussionMessage: vi.fn(
      async (_project: string, input: Record<string, unknown>) => {
        const { message } = postMessage(state, {
          identity: { clientId: "me", clientName: "Me" },
          members,
          input,
          now: Date.now(),
        });
        return { message, seq: state.seq };
      },
    ),
    updateDiscussionReceipt: vi.fn(async (_project: string, update: unknown) => {
      advanceReceipt(state, "me", update);
      return { seq: state.seq };
    }),
  };
  const postAs = (clientId: string, input: Record<string, unknown>) =>
    postMessage(state, {
      identity: { clientId, clientName: members.get(clientId) ?? clientId },
      members,
      input: { id: `msg-${Math.random().toString(36).slice(2, 12)}`, ...input },
      now: Date.now(),
    }).message;
  return { state, api, postAs };
}

let server: ReturnType<typeof fakeServer>;
let focused = true;

function renderDiscussion(overrides: Partial<UseDiscussionOptions> = {}) {
  const signalRef = { current: (_seq: number) => undefined as void };
  const onOpen = vi.fn();
  const initialProps: UseDiscussionOptions = {
    projectId: "project_1",
    enabled: true,
    presence: [{ clientId: "bob", name: "Bob", currentFile: "main.tex", lastSeen: 1 }],
    visible: false,
    signalRef,
    onOpen,
    ...overrides,
  };
  const view = renderHook((props: UseDiscussionOptions) => useDiscussion(props), {
    initialProps,
  });
  return { ...view, signalRef, onOpen, initialProps };
}

beforeEach(() => {
  server = fakeServer();
  focused = true;
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  (window as unknown as { latexdo: unknown }).latexdo = server.api;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useDiscussion", () => {
  it("loads, reports what arrived and reads the open conversation", async () => {
    server.postAs("bob", { body: "Hello" });
    server.postAs("bob", { body: "Psst", to: "me" });
    const { result, rerender, initialProps } = renderDiscussion();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.me).toBe("me");
    expect(
      result.current.members.map((member) => [member.name, member.presence]),
    ).toEqual([
      ["Bob", "active"],
      ["Eve", "offline"],
    ]);
    expect(result.current.totals).toEqual({ unread: 2, mentions: 1 });
    await waitFor(() =>
      expect(server.api.updateDiscussionReceipt).toHaveBeenCalledWith("project_1", {
        delivered: 2,
      }),
    );
    expect(server.state.receipts.me.delivered).toBe(2);

    // Opening the panel reads the group, not the private conversation.
    rerender({ ...initialProps, visible: true });
    await waitFor(() => expect(server.state.receipts.me.read["*"]).toBe(1));
    expect(result.current.unreadAfter).toBe(0);
    expect(result.current.summaries.get(everyone)?.unread).toBe(0);
    expect(result.current.summaries.get("bob")?.unread).toBe(1);

    act(() => result.current.openConversation("bob"));
    await waitFor(() => expect(server.state.receipts.me.read.bob).toBe(2));
    expect(result.current.conversationMessages.map((message) => message.body)).toEqual([
      "Psst",
    ]);
    expect(result.current.totals.unread).toBe(0);
  });

  it("raises a notice for every message from others, labelled by kind", async () => {
    const notify = vi.spyOn(notifications, "notify");
    const { result, signalRef, onOpen } = renderDiscussion();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    server.postAs("bob", { body: "Hey @Me", mentions: ["me"] });
    server.postAs("eve", { body: "Plain" });
    server.postAs("bob", { body: "Secret", to: "me" });
    act(() => signalRef.current(3));
    await waitFor(() => expect(result.current.notices).toHaveLength(3));
    expect(
      result.current.notices.map((notice) => [notice.kind, notice.preview]),
    ).toEqual([
      ["private", "Secret"],
      ["message", "Plain"],
      ["mention", "Hey @Me"],
    ]);
    expect(notify).toHaveBeenCalledWith(
      "Bob mentioned you: Hey @Me",
      expect.objectContaining({ source: "Discussion" }),
    );
    expect(notify).toHaveBeenCalledWith(
      "Eve in the discussion: Plain",
      expect.objectContaining({ source: "Discussion" }),
    );

    // Older news does not come back on the next fetch.
    await act(() => result.current.refresh());
    expect(result.current.notices).toHaveLength(3);

    const notice = result.current.notices[0]!;
    act(() => result.current.openNotice(notice));
    expect(onOpen).toHaveBeenCalledWith("bob");
    expect(result.current.conversation).toBe("bob");
    expect(result.current.notices.map((item) => item.kind)).toEqual([
      "message",
      "mention",
    ]);
    for (const item of [...result.current.notices]) {
      act(() => result.current.dismissNotice(item.id));
    }
    expect(result.current.notices).toEqual([]);
  });

  it("follows the notification mode for popups but always keeps history", async () => {
    const notify = vi.spyOn(notifications, "notify");
    localStorage.setItem("latexdo.notificationMode", "writing");
    try {
      const { result, signalRef } = renderDiscussion();
      await waitFor(() => expect(result.current.status).toBe("ready"));
      server.postAs("eve", { body: "Group chatter" });
      server.postAs("bob", { body: "Just for you", to: "me" });
      act(() => signalRef.current(2));
      await waitFor(() => expect(result.current.notices).toHaveLength(1));
      expect(result.current.notices[0]!.kind).toBe("private");
      expect(notify).toHaveBeenCalledWith(
        "Eve in the discussion: Group chatter",
        expect.anything(),
      );
    } finally {
      localStorage.removeItem("latexdo.notificationMode");
    }
    expect(discussionPopupAllowed("do-not-disturb", "private")).toBe(false);
    expect(discussionPopupAllowed("reading", "mention")).toBe(false);
    expect(discussionPopupAllowed("writing", "mention")).toBe(true);
    expect(discussionPopupAllowed("reviewing", "message")).toBe(true);
  });

  it("notifies the system about group messages while the panel is closed", async () => {
    const shown: Array<{ title: string }> = [];
    class FakeNotification {
      static permission = "granted";
      static requestPermission = vi.fn(async () => "granted");
      onclick: (() => void) | null = null;
      close = vi.fn();
      constructor(readonly title: string) {
        shown.push(this);
      }
    }
    vi.stubGlobal("Notification", FakeNotification);
    const { result, signalRef } = renderDiscussion({ visible: false });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    server.postAs("eve", { body: "Draft is ready" });
    act(() => signalRef.current(1));
    await waitFor(() => expect(shown).toHaveLength(1));
    expect(shown[0]!.title).toBe("Eve · Discussion");
    expect(result.current.totals.unread).toBe(1);
  });

  it("stays quiet about the conversation on screen and notifies the system when away", async () => {
    const shown: Array<{ title: string; onclick: (() => void) | null }> = [];
    class FakeNotification {
      static permission = "granted";
      static requestPermission = vi.fn(async () => "granted");
      onclick: (() => void) | null = null;
      close = vi.fn();
      constructor(readonly title: string) {
        shown.push(this);
      }
    }
    vi.stubGlobal("Notification", FakeNotification);
    const { result, signalRef, onOpen } = renderDiscussion({ visible: true });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    server.postAs("bob", { body: "Hi @Me", mentions: ["me"] });
    act(() => signalRef.current(1));
    await waitFor(() => expect(server.state.receipts.me?.read["*"]).toBe(1));
    expect(result.current.notices).toEqual([]);

    focused = false;
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    server.postAs("bob", { body: "Are you there?", to: "me" });
    act(() => signalRef.current(2));
    await waitFor(() => expect(shown).toHaveLength(1));
    expect(shown[0]!.title).toBe("Bob (private message)");
    act(() => shown[0]!.onclick?.());
    expect(onOpen).toHaveBeenCalledWith("bob");

    // Asks once when allowed to, and never when refused.
    FakeNotification.permission = "default";
    server.postAs("bob", { body: "@Me again", mentions: ["me"] });
    act(() => signalRef.current(3));
    await waitFor(() => expect(shown).toHaveLength(2));
    expect(shown[1]!.title).toBe("Bob mentioned you");
    FakeNotification.permission = "denied";
    server.postAs("bob", { body: "@Me ignored", mentions: ["me"] });
    act(() => signalRef.current(4));
    await waitFor(() => expect(result.current.notices[0]?.preview).toBe("@Me ignored"));
    expect(shown).toHaveLength(2);
  });

  it("edits sent messages and fetches other edits without skipping earlier changes", async () => {
    const mine = server.postAs("me", { body: "Original" });
    const other = server.postAs("bob", { body: "Other" });
    const { result } = renderDiscussion({ visible: true });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    server.postAs("bob", {
      id: other.id,
      body: "Other corrected",
      edit: true,
      expectedRevision: other.seq,
    });
    await act(async () => result.current.edit(mine, "My correction"));
    expect(result.current.messages[0]).toMatchObject({
      body: "My correction",
      seq: mine.seq,
      updatedSeq: 4,
    });
    await act(async () => result.current.refresh());
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1].body).toBe("Other corrected");
    await expect(result.current.edit(other, "Not mine")).rejects.toThrow("Only your");
    await expect(result.current.edit(mine, "Stale edit")).rejects.toThrow("changed");
    expect(result.current.messages[0].body).toBe("My correction");
  });

  it("reacts to messages, fetches others' reactions and rolls back failures", async () => {
    const other = server.postAs("bob", { body: "Ready to submit?" });
    const { result } = renderDiscussion({ visible: true });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    server.postAs("eve", { id: other.id, react: true, reaction: "🎉" });
    await act(async () => result.current.react(result.current.messages[0], "✅"));
    expect(result.current.messages[0].reactions).toEqual({ eve: "🎉", me: "✅" });
    await act(async () => result.current.react(result.current.messages[0], null));
    expect(result.current.messages[0].reactions).toEqual({ eve: "🎉" });

    server.api.sendDiscussionMessage.mockRejectedValueOnce(new Error("Offline"));
    await act(async () => result.current.react(result.current.messages[0], "👍"));
    expect(result.current.messages[0].reactions).toEqual({ eve: "🎉" });
    expect(result.current.error).toBe("Offline");
  });

  it("sends optimistically, keeps failures to retry or delete", async () => {
    const { result } = renderDiscussion({ visible: true });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.setDraft(everyone, "draft"));
    expect(result.current.draft).toBe("draft");

    act(() => result.current.send("  First  ", []));
    expect(result.current.messages.at(-1)).toMatchObject({
      body: "First",
      local: "sending",
    });
    expect(result.current.draft).toBe("");
    await waitFor(() => expect(result.current.messages.at(-1)?.local).toBeUndefined());
    expect(result.current.messages.at(-1)).toMatchObject({
      seq: 1,
      recipients: ["bob", "eve"],
    });

    const firstId = result.current.messages[0]!.id;
    act(() => result.current.setReplyTo(everyone, firstId));
    expect(result.current.replyTo).toBe(firstId);
    server.api.sendDiscussionMessage.mockRejectedValueOnce(new Error("Offline"));
    act(() => result.current.send("Second", ["bob"]));
    await waitFor(() => expect(result.current.messages.at(-1)?.local).toBe("failed"));
    const failed = result.current.messages.at(-1)!;
    expect(failed).toMatchObject({
      error: "Offline",
      replyTo: firstId,
    });
    expect(result.current.replyTo).toBeNull();

    act(() => result.current.retry(failed.id));
    await waitFor(() => expect(result.current.messages.at(-1)?.local).toBeUndefined());
    expect(server.state.messages.at(-1)).toMatchObject({
      body: "Second",
      mentions: ["bob"],
    });

    server.api.sendDiscussionMessage.mockRejectedValueOnce("nope");
    act(() => result.current.send("Third", []));
    await waitFor(() => expect(result.current.messages.at(-1)?.local).toBe("failed"));
    expect(result.current.messages.at(-1)?.error).toBe(
      "The discussion could not be reached.",
    );
    act(() => result.current.discard(result.current.messages.at(-1)!.id));
    expect(result.current.messages.map((message) => message.body)).toEqual([
      "First",
      "Second",
    ]);

    // Nothing happens for blank text or an unknown message.
    act(() => result.current.send("   ", []));
    act(() => result.current.retry("unknown"));
    expect(result.current.messages).toHaveLength(2);
  });

  it("sends private messages to the open conversation", async () => {
    const { result } = renderDiscussion({ visible: true });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.openConversation("eve"));
    act(() => result.current.send("Just us", []));
    await waitFor(() => expect(server.state.messages).toHaveLength(1));
    expect(server.state.messages[0]).toMatchObject({ to: "eve", recipients: ["eve"] });
    expect(result.current.conversationMessages).toHaveLength(1);
  });

  it("catches up page by page and loads earlier messages on request", async () => {
    for (let index = 0; index < 130; index += 1)
      server.postAs("bob", { body: `old ${index}` });
    const { result, signalRef } = renderDiscussion();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.messages).toHaveLength(100);
    expect(result.current.hasOlder).toBe(true);

    await act(() => result.current.loadOlder());
    expect(result.current.messages).toHaveLength(130);
    expect(result.current.hasOlder).toBe(false);

    for (let index = 0; index < 250; index += 1)
      server.postAs("eve", { body: `new ${index}` });
    act(() => signalRef.current(380));
    await waitFor(() => expect(result.current.messages).toHaveLength(380));

    server.api.getDiscussion.mockRejectedValueOnce(new Error("Down"));
    await act(() => result.current.loadOlder());
    expect(result.current.error).toBe("Down");
  });

  it("reports a first load that fails and recovers on the next try", async () => {
    server.api.getDiscussion.mockRejectedValueOnce(new Error("Unreachable"));
    const { result } = renderDiscussion();
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("Unreachable");
    await act(() => result.current.refresh());
    expect(result.current.status).toBe("ready");
    expect(result.current.error).toBeNull();

    // A later failure keeps what is shown.
    server.api.getDiscussion.mockRejectedValueOnce(new Error("Blip"));
    await act(() => result.current.refresh());
    expect(result.current.status).toBe("ready");
    expect(result.current.error).toBe("Blip");
  });

  it("runs one fetch at a time and retries receipts that failed", async () => {
    server.postAs("bob", { body: "One" });
    server.api.updateDiscussionReceipt.mockRejectedValue(new Error("Busy"));
    const { result } = renderDiscussion({ visible: true });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await waitFor(() => expect(server.api.updateDiscussionReceipt).toHaveBeenCalled());
    server.api.updateDiscussionReceipt.mockReset();
    server.api.updateDiscussionReceipt.mockImplementation(async (_p, update) => {
      advanceReceipt(server.state, "me", update);
      return { seq: server.state.seq };
    });
    let release: () => void = () => undefined;
    server.api.getDiscussion.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              version: 1,
              seq: server.state.seq,
              ...listMessages(server.state, "me", { after: 1 }),
              receipts: receiptsFor(server.state, "me"),
              members: permissions,
            });
        }),
    );
    const calls = server.api.getDiscussion.mock.calls.length;
    const first = result.current.refresh();
    void result.current.refresh();
    void result.current.refresh();
    release();
    await act(() => first);
    await waitFor(() =>
      expect(server.api.getDiscussion.mock.calls.length).toBe(calls + 2),
    );
    await waitFor(() => expect(server.state.receipts.me?.delivered).toBe(1));
  });

  it("starts over for another project and does nothing when not shared", async () => {
    server.postAs("bob", { body: "Hello" });
    const { result, rerender, initialProps } = renderDiscussion();
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    rerender({ ...initialProps, enabled: false });
    expect(result.current.available).toBe(false);
    expect(result.current.messages).toEqual([]);
    expect(result.current.status).toBe("idle");
    await act(() => result.current.refresh());
    expect(result.current.messages).toEqual([]);
    rerender({ ...initialProps, projectId: null });
    await act(() => result.current.loadOlder());
    act(() => result.current.send("Nobody hears", []));
    expect(result.current.messages).toEqual([]);
  });

  it("refreshes when the window comes back", async () => {
    const { result } = renderDiscussion();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    server.postAs("bob", { body: "While you were away" });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
  });
});

describe("mergeReceipts", () => {
  it("keeps the furthest of each watermark", () => {
    expect(
      mergeReceipts(
        { me: { delivered: 5, read: { "*": 4, bob: 2 } } },
        {
          me: { delivered: 3, read: { "*": 6 } },
          bob: { delivered: 1, read: {} },
        },
      ),
    ).toEqual({
      me: { delivered: 5, read: { "*": 6, bob: 2 } },
      bob: { delivered: 1, read: {} },
    });
  });
});
