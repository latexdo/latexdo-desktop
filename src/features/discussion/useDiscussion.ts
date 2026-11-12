/*
 * The project discussion's live state: it loads the messages, keeps them
 * current (instantly through the live connection, and by polling as a
 * backstop), sends new ones, reports what reached and what was read here, and
 * raises a notice when someone mentions me or writes to me privately.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { notify } from "../notifications/notifications";
import type {
  CollaboratorPermission,
  CollaboratorPresence,
  DiscussionPage,
  DiscussionReceipt,
} from "../../types";
import {
  conversationOf,
  discussionMembers,
  everyone,
  latestChangeSeq,
  maxMessageChars,
  mentionsInText,
  mergeMessages,
  myReadSeq,
  newMessageId,
  noticeKind,
  notifiesMe,
  oldestSeq,
  pendingSeq,
  previewText,
  summarizeConversations,
  totalUnread,
  type ChatMessage,
  type ConversationKey,
} from "./discussionModel";

/** How often to look for news while the discussion is open… */
const openPollMs = 4_000;
/** …and while it is not (the live connection usually comes first). */
const backgroundPollMs = 15_000;
const maxNotices = 3;
const catchUpPages = 10;

export interface DiscussionNotice {
  /** The message's id. */
  id: string;
  conversation: ConversationKey;
  senderId: string;
  senderName: string;
  kind: "mention" | "private" | "message";
  preview: string;
  at: number;
}

export interface UseDiscussionOptions {
  projectId: string | null;
  /** The project is shared and reachable. */
  enabled: boolean;
  presence: readonly CollaboratorPresence[];
  /** The discussion panel is on screen. */
  visible: boolean;
  /** The live connection calls this when the discussion changes. */
  signalRef: MutableRefObject<(seq: number) => void>;
  /** Opens the panel on a conversation (from a notice). */
  onOpen?: (conversation: ConversationKey) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The discussion could not be reached.";
}

/** Keeps the furthest of each watermark, so a slow reply never goes backwards. */
export function mergeReceipts(
  local: Record<string, DiscussionReceipt>,
  server: Record<string, DiscussionReceipt>,
): Record<string, DiscussionReceipt> {
  const merged: Record<string, DiscussionReceipt> = {};
  for (const id of new Set([...Object.keys(local), ...Object.keys(server)])) {
    const left = local[id];
    const right = server[id];
    const read: Record<string, number> = { ...right?.read };
    for (const [conversation, seq] of Object.entries(left?.read ?? {})) {
      read[conversation] = Math.max(seq, read[conversation] ?? 0);
    }
    merged[id] = {
      delivered: Math.max(left?.delivered ?? 0, right?.delivered ?? 0),
      read,
    };
  }
  return merged;
}

function windowIsFocused(): boolean {
  return (
    typeof document !== "undefined" &&
    document.visibilityState !== "hidden" &&
    (typeof document.hasFocus !== "function" || document.hasFocus())
  );
}

/** One line for the app's notification center. */
function noticeText(notice: DiscussionNotice): string {
  if (notice.kind === "private") {
    return `${notice.senderName} sent you a private message: ${notice.preview}`;
  }
  if (notice.kind === "mention") {
    return `${notice.senderName} mentioned you: ${notice.preview}`;
  }
  return `${notice.senderName} in the discussion: ${notice.preview}`;
}

function showSystemNotification(notice: DiscussionNotice, onClick: () => void): void {
  if (typeof Notification === "undefined" || Notification.permission === "denied") {
    return;
  }
  const show = () => {
    try {
      const notification = new Notification(
        notice.kind === "private"
          ? `${notice.senderName} (private message)`
          : notice.kind === "mention"
            ? `${notice.senderName} mentioned you`
            : `${notice.senderName} · Discussion`,
        // One notification per conversation: a newer message replaces it.
        { body: notice.preview, tag: `latexdo-discussion-${notice.conversation}` },
      );
      notification.onclick = () => {
        window.focus();
        onClick();
        notification.close();
      };
    } catch {
      // Notifications are a convenience; the in-app notice still shows.
    }
  };
  if (Notification.permission === "granted") show();
  else
    void Notification.requestPermission().then((result) => {
      if (result === "granted") show();
    });
}

export function useDiscussion(options: UseDiscussionOptions) {
  const { projectId, enabled, presence, visible, signalRef, onOpen } = options;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [permissions, setPermissions] = useState<CollaboratorPermission[]>([]);
  const [receipts, setReceipts] = useState<Record<string, DiscussionReceipt>>({});
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [conversation, setConversationState] = useState<ConversationKey>(everyone);
  const [unreadAfter, setUnreadAfter] = useState<number | null>(null);
  const [notices, setNotices] = useState<DiscussionNotice[]>([]);
  const [drafts, setDrafts] = useState<Record<ConversationKey, string>>({});
  const [replies, setReplies] = useState<Record<ConversationKey, string | null>>({});
  const [focused, setFocused] = useState(windowIsFocused);

  const fallbackMe = useMemo(() => window.latexdo?.collaborationClientId?.() ?? "", []);
  const me = permissions.find((item) => item.isCurrent)?.clientId ?? fallbackMe;

  const messagesRef = useRef(messages);
  const receiptsRef = useRef(receipts);
  const meRef = useRef(me);
  const projectRef = useRef(projectId);
  const enabledRef = useRef(enabled);
  const visibleRef = useRef(visible);
  const conversationRef = useRef(conversation);
  const loadedRef = useRef(false);
  const fetchedSeqRef = useRef(0);
  const inFlightRef = useRef(false);
  const againRef = useRef(false);
  const notifiedRef = useRef(new Set<string>());
  // My own receipts as the server confirmed them. What is shown may run ahead
  // (it is updated at once), but a receipt is only settled once it is here, so
  // one that failed to send goes out again.
  const confirmedRef = useRef<DiscussionReceipt>({ delivered: 0, read: {} });
  const deliveredSentRef = useRef(0);
  const readSentRef = useRef(new Map<ConversationKey, number>());
  const onOpenRef = useRef(onOpen);
  const dividerArmedRef = useRef(false);
  messagesRef.current = messages;
  receiptsRef.current = receipts;
  meRef.current = me;
  enabledRef.current = enabled;
  visibleRef.current = visible;
  conversationRef.current = conversation;
  onOpenRef.current = onOpen;

  const setMessagesNow = useCallback(
    (update: (current: ChatMessage[]) => ChatMessage[]) => {
      setMessages((current) => {
        const next = update(current);
        messagesRef.current = next;
        return next;
      });
    },
    [],
  );

  const setReceiptsNow = useCallback(
    (
      update: (
        current: Record<string, DiscussionReceipt>,
      ) => Record<string, DiscussionReceipt>,
    ) => {
      setReceipts((current) => {
        const next = update(current);
        receiptsRef.current = next;
        return next;
      });
    },
    [],
  );

  // A different project (or sharing turned off) starts from nothing.
  useEffect(() => {
    projectRef.current = projectId;
    loadedRef.current = false;
    fetchedSeqRef.current = 0;
    againRef.current = false;
    notifiedRef.current = new Set();
    confirmedRef.current = { delivered: 0, read: {} };
    deliveredSentRef.current = 0;
    readSentRef.current = new Map();
    dividerArmedRef.current = false;
    messagesRef.current = [];
    receiptsRef.current = {};
    setMessages([]);
    setPermissions([]);
    setReceipts({});
    setHasOlder(false);
    setNotices([]);
    setDrafts({});
    setReplies({});
    setUnreadAfter(null);
    setConversationState(everyone);
    setError(null);
    setStatus(projectId && enabled ? "loading" : "idle");
  }, [projectId, enabled]);

  const openConversation = useCallback((key: ConversationKey) => {
    conversationRef.current = key;
    setConversationState(key);
    // The "new messages" line marks where this visit's unread messages start.
    const read = myReadSeq(receiptsRef.current, meRef.current, key);
    const hasUnread = messagesRef.current.some(
      (message) =>
        conversationOf(message, meRef.current) === key &&
        message.from !== meRef.current &&
        !message.local &&
        message.seq > read,
    );
    setUnreadAfter(hasUnread ? read : null);
    setNotices((current) => current.filter((notice) => notice.conversation !== key));
  }, []);

  // Opening the panel (once the messages are in) shows where the unread ones
  // begin. This runs before the read receipt below clears them.
  useEffect(() => {
    if (!visible) {
      dividerArmedRef.current = false;
      return;
    }
    if (dividerArmedRef.current || status !== "ready") return;
    dividerArmedRef.current = true;
    openConversation(conversationRef.current);
  }, [openConversation, status, visible]);

  const announce = useCallback((fresh: ChatMessage[]) => {
    const meNow = meRef.current;
    const created: DiscussionNotice[] = [];
    for (const message of fresh) {
      const key = conversationOf(message, meNow);
      // Someone looking at that very conversation needs no notice.
      if (visibleRef.current && conversationRef.current === key && windowIsFocused()) {
        continue;
      }
      created.push({
        id: message.id,
        conversation: key,
        senderId: message.from,
        senderName: message.name || "Someone",
        kind: noticeKind(message, meNow),
        preview: previewText(message.body, 140),
        at: message.createdAt,
      });
    }
    if (!created.length) return;
    for (const notice of created) {
      notify(noticeText(notice), { severity: "info", source: "Discussion" });
    }
    const newestFirst = [...created].reverse();
    setNotices((current) =>
      [...newestFirst, ...current]
        .filter(
          (notice, index, all) =>
            all.findIndex((item) => item.id === notice.id) === index,
        )
        .slice(0, maxNotices),
    );
    // Also through the operating system, so it is seen outside this panel.
    const latest = newestFirst[0];
    if (latest) {
      showSystemNotification(latest, () => onOpenRef.current?.(latest.conversation));
    }
  }, []);

  const confirm = useCallback((receipt: DiscussionReceipt | undefined) => {
    if (!receipt) return;
    confirmedRef.current = mergeReceipts(
      { mine: confirmedRef.current },
      { mine: receipt },
    ).mine!;
  }, []);

  const reportDelivered = useCallback(
    (seq: number) => {
      const project = projectRef.current;
      if (
        !project ||
        seq <= Math.max(deliveredSentRef.current, confirmedRef.current.delivered)
      ) {
        return;
      }
      deliveredSentRef.current = seq;
      void window.latexdo.updateDiscussionReceipt(project, { delivered: seq }).then(
        () => confirm({ delivered: seq, read: {} }),
        () => {
          // Sent again after the next update.
          if (deliveredSentRef.current === seq) deliveredSentRef.current = 0;
        },
      );
    },
    [confirm],
  );

  const refresh = useCallback(async () => {
    const project = projectRef.current;
    if (!project || !enabledRef.current) return;
    if (inFlightRef.current) {
      againRef.current = true;
      return;
    }
    inFlightRef.current = true;
    try {
      const first = !loadedRef.current;
      let after = fetchedSeqRef.current;
      const pages: DiscussionPage[] = [
        await window.latexdo.getDiscussion(project, first ? {} : { after }),
      ];
      // Catch up on everything missed while away, a page at a time.
      while (!first && pages.at(-1)!.hasMore && pages.length < catchUpPages) {
        after = Math.max(after, latestChangeSeq(pages.at(-1)!.messages));
        pages.push(await window.latexdo.getDiscussion(project, { after }));
      }
      if (projectRef.current !== project) return;
      const last = pages.at(-1)!;
      fetchedSeqRef.current =
        first || !last.hasMore
          ? last.seq
          : Math.max(after, latestChangeSeq(last.messages));
      const meNow = last.members.find((item) => item.isCurrent)?.clientId ?? fallbackMe;
      meRef.current = meNow;
      // What had already reached this app before now: older messages are not news.
      const deliveredBefore = Math.max(
        pages[0]!.receipts[meNow]?.delivered ?? 0,
        receiptsRef.current[meNow]?.delivered ?? 0,
        deliveredSentRef.current,
      );
      confirm(last.receipts[meNow]);
      const incoming = pages.flatMap((page) => page.messages);
      setMessagesNow((current) => mergeMessages(current, incoming));
      setPermissions(last.members);
      setReceiptsNow((current) => mergeReceipts(current, last.receipts));
      if (first) setHasOlder(pages[0]!.hasMore);
      loadedRef.current = true;
      setStatus("ready");
      setError(null);

      const fresh = incoming.filter(
        (message) =>
          message.seq > deliveredBefore &&
          notifiesMe(message, meNow) &&
          !notifiedRef.current.has(message.id),
      );
      for (const message of incoming) notifiedRef.current.add(message.id);
      announce(fresh);
      reportDelivered(last.seq);
    } catch (caught) {
      if (projectRef.current !== project) return;
      setError(errorMessage(caught));
      setStatus(loadedRef.current ? "ready" : "error");
    } finally {
      inFlightRef.current = false;
      if (againRef.current) {
        againRef.current = false;
        void refresh();
      }
    }
  }, [announce, confirm, fallbackMe, reportDelivered, setMessagesNow, setReceiptsNow]);

  // Live: the connection says when something changed.
  useEffect(() => {
    signalRef.current = () => void refresh();
    return () => {
      signalRef.current = () => undefined;
    };
  }, [refresh, signalRef]);

  // Backstop: poll, faster while the discussion is open.
  useEffect(() => {
    if (!projectId || !enabled) return;
    void refresh();
    const timer = window.setInterval(
      () => void refresh(),
      visible ? openPollMs : backgroundPollMs,
    );
    return () => window.clearInterval(timer);
  }, [enabled, projectId, refresh, visible]);

  useEffect(() => {
    const update = () => {
      const now = windowIsFocused();
      setFocused(now);
      if (now) void refresh();
    };
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [refresh]);

  // Reading: the open conversation, on screen, in a focused window, is read.
  useEffect(() => {
    const project = projectRef.current;
    if (!project || !visible || !focused || status !== "ready") return;
    let newest = 0;
    for (const message of messages) {
      if (!message.local && conversationOf(message, me) === conversation) {
        newest = Math.max(newest, message.seq);
      }
    }
    const already = Math.max(
      confirmedRef.current.read[conversation] ?? 0,
      readSentRef.current.get(conversation) ?? 0,
    );
    if (!newest || newest <= already) return;
    readSentRef.current.set(conversation, newest);
    setReceiptsNow((current) =>
      mergeReceipts(current, {
        [me]: { delivered: newest, read: { [conversation]: newest } },
      }),
    );
    void window.latexdo
      .updateDiscussionReceipt(project, {
        read: { conversation, seq: newest },
      })
      .then(
        () => confirm({ delivered: newest, read: { [conversation]: newest } }),
        () => {
          // Tried again when the discussion next changes (or the next poll).
          if (readSentRef.current.get(conversation) === newest) {
            readSentRef.current.delete(conversation);
          }
        },
      );
  }, [
    confirm,
    conversation,
    focused,
    me,
    messages,
    receipts,
    setReceiptsNow,
    status,
    visible,
  ]);

  const deliver = useCallback(
    async (message: ChatMessage) => {
      const project = projectRef.current;
      if (!project) return;
      try {
        const result = await window.latexdo.sendDiscussionMessage(project, {
          id: message.id,
          to: message.to,
          body: message.body,
          mentions: message.mentions,
          replyTo: message.replyTo,
        });
        if (projectRef.current !== project) return;
        notifiedRef.current.add(result.message.id);
        setMessagesNow((current) => mergeMessages(current, [result.message]));
        const key = conversationOf(result.message, meRef.current);
        confirm({
          delivered: result.message.seq,
          read: { [key]: result.message.seq },
        });
        setReceiptsNow((current) =>
          mergeReceipts(current, {
            [meRef.current]: {
              delivered: result.message.seq,
              read: { [key]: result.message.seq },
            },
          }),
        );
      } catch (caught) {
        if (projectRef.current !== project) return;
        setMessagesNow((current) =>
          current.map((item) =>
            item.id === message.id
              ? { ...item, local: "failed", error: errorMessage(caught) }
              : item,
          ),
        );
      }
    },
    [confirm, setMessagesNow, setReceiptsNow],
  );

  const send = useCallback(
    (body: string, mentions: string[]) => {
      const text = body.trim();
      if (!text || !projectRef.current) return;
      const key = conversationRef.current;
      const myName =
        permissions.find((item) => item.isCurrent)?.name ??
        messagesRef.current.find((item) => item.from === meRef.current)?.name ??
        "You";
      const message: ChatMessage = {
        id: newMessageId(),
        seq: pendingSeq,
        from: meRef.current,
        name: myName,
        to: key === everyone ? null : key,
        recipients: [],
        body: text,
        mentions,
        replyTo: replies[key] ?? null,
        createdAt: Date.now(),
        local: "sending",
      };
      setMessagesNow((current) => [...current, message]);
      setDrafts((current) => ({ ...current, [key]: "" }));
      setReplies((current) => ({ ...current, [key]: null }));
      setUnreadAfter(null);
      void deliver(message);
    },
    [deliver, permissions, replies, setMessagesNow],
  );

  const edit = useCallback(
    async (message: ChatMessage, body: string) => {
      const project = projectRef.current;
      const text = body.trim();
      if (!project || !enabledRef.current)
        throw new Error("This project is not shared.");
      if (message.from !== meRef.current || message.local || message.undecryptable) {
        throw new Error("Only your sent messages can be edited.");
      }
      if (!text || text.length > maxMessageChars)
        throw new Error("Enter a message of up to 4,000 characters.");
      if (text === message.body) return;
      const names = new Map(
        permissions.map((member) => [member.clientId, member.name]),
      );
      const result = await window.latexdo.sendDiscussionMessage(project, {
        id: message.id,
        to: message.to,
        replyTo: message.replyTo,
        body: text,
        mentions: mentionsInText(text, names),
        edit: true,
        expectedRevision: message.updatedSeq ?? message.seq,
      });
      if (projectRef.current !== project) return;
      if (result.message.body !== text || !result.message.editedAt) {
        throw new Error(
          "The collaboration server does not support message editing yet.",
        );
      }
      setMessagesNow((current) => mergeMessages(current, [result.message]));
    },
    [permissions, setMessagesNow],
  );

  /** Sets this person's reaction to a message, or removes it with null. */
  const react = useCallback(
    async (message: ChatMessage, emoji: string | null) => {
      const project = projectRef.current;
      const me = meRef.current;
      if (!project || !enabledRef.current || message.local) return;
      const previous = message.reactions?.[me] ?? null;
      if (previous === emoji) return;
      const withReaction = (value: string | null) => (current: ChatMessage[]) =>
        current.map((item) => {
          if (item.id !== message.id) return item;
          const reactions = { ...item.reactions };
          if (value === null) delete reactions[me];
          else reactions[me] = value;
          return {
            ...item,
            reactions: Object.keys(reactions).length ? reactions : undefined,
          };
        });
      // Shown at once; the server's copy replaces it when it arrives.
      setMessagesNow(withReaction(emoji));
      try {
        const result = await window.latexdo.sendDiscussionMessage(project, {
          id: message.id,
          to: message.to,
          replyTo: null,
          body: "",
          mentions: [],
          react: true,
          reaction: emoji,
        });
        if (projectRef.current !== project) return;
        if ((result.message.reactions?.[me] ?? null) !== emoji) {
          throw new Error("The collaboration server does not support reactions yet.");
        }
        setMessagesNow((current) => mergeMessages(current, [result.message]));
      } catch (caught) {
        if (projectRef.current !== project) return;
        setMessagesNow(withReaction(previous));
        setError(errorMessage(caught));
      }
    },
    [setMessagesNow],
  );

  const retry = useCallback(
    (id: string) => {
      const message = messagesRef.current.find(
        (item) => item.id === id && item.local === "failed",
      );
      if (!message) return;
      const again: ChatMessage = { ...message, local: "sending", error: undefined };
      setMessagesNow((current) =>
        current.map((item) => (item.id === id ? again : item)),
      );
      void deliver(again);
    },
    [deliver, setMessagesNow],
  );

  const discard = useCallback(
    (id: string) => {
      setMessagesNow((current) =>
        current.filter((item) => !(item.id === id && item.local === "failed")),
      );
    },
    [setMessagesNow],
  );

  const loadOlder = useCallback(async () => {
    const project = projectRef.current;
    const before = oldestSeq(messagesRef.current);
    if (!project || before === null || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await window.latexdo.getDiscussion(project, { before });
      if (projectRef.current !== project) return;
      for (const message of page.messages) notifiedRef.current.add(message.id);
      setMessagesNow((current) => mergeMessages(current, page.messages));
      setHasOlder(page.hasMore);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, setMessagesNow]);

  const here = useMemo(
    () => new Map(presence.map((user) => [user.clientId, user])),
    [presence],
  );

  const members = useMemo(
    () => discussionMembers(permissions, me, here),
    [me, here, permissions],
  );

  const memberIds = useMemo(
    () => new Set(permissions.map((item) => item.clientId)),
    [permissions],
  );

  /** Everyone's current name, falling back to the name a message was sent under. */
  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const message of messages) map.set(message.from, message.name);
    for (const item of permissions) map.set(item.clientId, item.name || "Anonymous");
    return map;
  }, [messages, permissions]);

  const summaries = useMemo(
    () => summarizeConversations(messages, me, receipts),
    [me, messages, receipts],
  );
  const totals = useMemo(() => totalUnread(summaries), [summaries]);

  const conversationMessages = useMemo(
    () => messages.filter((message) => conversationOf(message, me) === conversation),
    [conversation, me, messages],
  );

  const dismissNotice = useCallback((id: string) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  const openNotice = useCallback(
    (notice: DiscussionNotice) => {
      openConversation(notice.conversation);
      onOpenRef.current?.(notice.conversation);
    },
    [openConversation],
  );

  const setDraft = useCallback((key: ConversationKey, text: string) => {
    setDrafts((current) =>
      current[key] === text ? current : { ...current, [key]: text },
    );
  }, []);

  const setReplyTo = useCallback((key: ConversationKey, id: string | null) => {
    setReplies((current) => ({ ...current, [key]: id }));
  }, []);

  return {
    available: Boolean(projectId && enabled),
    me,
    status,
    error,
    messages,
    conversation,
    conversationMessages,
    openConversation,
    unreadAfter,
    members,
    memberIds,
    names,
    receipts,
    summaries,
    totals,
    hasOlder,
    loadingOlder,
    loadOlder,
    send,
    edit,
    react,
    retry,
    discard,
    refresh,
    notices,
    dismissNotice,
    openNotice,
    draft: drafts[conversation] ?? "",
    setDraft,
    replyTo: replies[conversation] ?? null,
    setReplyTo,
  };
}

export type DiscussionController = ReturnType<typeof useDiscussion>;
