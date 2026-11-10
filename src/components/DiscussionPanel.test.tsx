import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  everyone,
  summarizeConversations,
  totalUnread,
  type ChatMessage,
  type DiscussionMember,
} from "../features/discussion/discussionModel";
import type { DiscussionController } from "../features/discussion/useDiscussion";
import type { DiscussionReceipt } from "../types";
import {
  DiscussionAvatar,
  DiscussionNotices,
  DiscussionPanel,
} from "./DiscussionPanel";

const now = Date.now();
const people: DiscussionMember[] = [
  {
    clientId: "bob",
    name: "Bob Stone",
    role: "editor",
    online: true,
    currentFile: "ch/intro.tex",
  },
  { clientId: "eve", name: "Eve", role: "viewer", online: false, currentFile: null },
];

function message(overrides: Partial<ChatMessage> & { seq: number }): ChatMessage {
  return {
    id: `m${overrides.seq}`,
    from: "bob",
    name: "Bob Stone",
    to: null,
    recipients: ["me", "eve"],
    body: "Hello",
    mentions: [],
    replyTo: null,
    createdAt: now - (10 - overrides.seq) * 60_000,
    ...overrides,
  };
}

function controller(
  overrides: Partial<DiscussionController> = {},
): DiscussionController {
  const messages = overrides.messages ?? [];
  const receipts: Record<string, DiscussionReceipt> = overrides.receipts ?? {};
  const conversation = overrides.conversation ?? everyone;
  const summaries = summarizeConversations(messages, "me", receipts);
  return {
    available: true,
    me: "me",
    status: "ready",
    error: null,
    messages,
    conversation,
    conversationMessages: messages.filter((item) =>
      conversation === everyone
        ? !item.to
        : item.to === conversation || (item.from === conversation && item.to === "me"),
    ),
    openConversation: vi.fn(),
    unreadAfter: null,
    members: people,
    memberIds: new Set(["me", "bob", "eve"]),
    names: new Map([
      ["me", "Me"],
      ["bob", "Bob Stone"],
      ["eve", "Eve"],
    ]),
    receipts,
    summaries,
    totals: totalUnread(summaries),
    hasOlder: false,
    loadingOlder: false,
    loadOlder: vi.fn(async () => undefined),
    send: vi.fn(),
    retry: vi.fn(),
    discard: vi.fn(),
    refresh: vi.fn(async () => undefined),
    notices: [],
    dismissNotice: vi.fn(),
    openNotice: vi.fn(),
    draft: "",
    setDraft: vi.fn(),
    replyTo: null,
    setReplyTo: vi.fn(),
    ...overrides,
  } as DiscussionController;
}

/** Keeps the draft in state, like the real hook. */
function Harness({
  discussion,
  onOpenLink = vi.fn(),
}: {
  discussion: DiscussionController;
  onOpenLink?: (url: string) => void;
}) {
  const [draft, setDraft] = useState(discussion.draft);
  const [replyTo, setReplyTo] = useState<string | null>(discussion.replyTo);
  return (
    <DiscussionPanel
      discussion={{
        ...discussion,
        draft,
        setDraft: (key, text) => {
          discussion.setDraft(key, text);
          setDraft(text);
        },
        replyTo,
        setReplyTo: (key, id) => {
          discussion.setReplyTo(key, id);
          setReplyTo(id);
        },
      }}
      onOpenLink={onOpenLink}
    />
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("DiscussionPanel", () => {
  it("invites sharing when the project is not shared", () => {
    const onOpenShare = vi.fn();
    render(
      <DiscussionPanel
        discussion={controller({ available: false })}
        onOpenLink={vi.fn()}
        onOpenShare={onOpenShare}
      />,
    );
    expect(screen.getByText("Discuss with your co-authors")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Share project" }));
    expect(onOpenShare).toHaveBeenCalled();
  });

  it("shows loading, then a failed load with a way to try again", () => {
    const { rerender } = render(
      <DiscussionPanel
        discussion={controller({ status: "loading" })}
        onOpenLink={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Loading messages")).toBeInTheDocument();
    expect(screen.getByLabelText("Message to everyone")).toBeDisabled();
    const failed = controller({ status: "error", error: "Server down" });
    rerender(<DiscussionPanel discussion={failed} onOpenLink={vi.fn()} />);
    expect(screen.getByText("Server down")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(failed.refresh).toHaveBeenCalled();
  });

  it("lists conversations with unread badges and switches between them", () => {
    const discussion = controller({
      messages: [message({ seq: 1 }), message({ seq: 2, to: "me", body: "Private" })],
      unreadAfter: 0,
    });
    render(<Harness discussion={discussion} />);
    const tabs = screen.getByRole("tablist", { name: "Conversations" });
    expect(
      within(tabs).getByRole("tab", { name: "Everyone, 1 unread" }),
    ).toHaveAttribute("aria-selected", "true");
    fireEvent.click(
      within(tabs).getByRole("tab", { name: "Bob Stone (online), 1 unread" }),
    );
    expect(discussion.openConversation).toHaveBeenCalledWith("bob");
    expect(screen.getByText("3 people · 1 online now")).toBeInTheDocument();
    expect(screen.getByText("1 new message")).toBeInTheDocument();
  });

  it("shows a private conversation with its partner's status", () => {
    const { rerender } = render(
      <Harness discussion={controller({ conversation: "bob" })} />,
    );
    expect(screen.getByText("Online · in intro.tex")).toBeInTheDocument();
    expect(
      screen.getByText("Only you and Bob can see this conversation."),
    ).toBeInTheDocument();
    expect(screen.getByText("Say hello to Bob")).toBeInTheDocument();
    expect(screen.getByLabelText("Private message to Bob")).toHaveAttribute(
      "placeholder",
      "Message Bob privately…",
    );
    rerender(<Harness discussion={controller({ conversation: "eve" })} />);
    expect(
      screen.getByText("Offline · they will see it next time"),
    ).toBeInTheDocument();
    rerender(<Harness discussion={controller({ conversation: "gone" })} />);
    expect(screen.getByText("No longer in this project")).toBeInTheDocument();
  });

  it("explains an empty group, alone or with others", () => {
    const { rerender } = render(<Harness discussion={controller()} />);
    expect(screen.getByText(/Type @ to get someone's attention/)).toBeInTheDocument();
    rerender(<Harness discussion={controller({ members: [] })} />);
    expect(screen.getByText(/Nobody else has joined yet/)).toBeInTheDocument();
    expect(screen.getByText("1 person")).toBeInTheDocument();
  });

  it("renders senders, mentions, links and the check marks of my messages", () => {
    const onOpenLink = vi.fn();
    const discussion = controller({
      messages: [
        message({ seq: 1, body: "Hi @Me see https://example.org", mentions: ["me"] }),
        message({ seq: 2, body: "Second in a row" }),
        message({
          seq: 3,
          from: "me",
          name: "Me",
          recipients: ["bob", "eve"],
          body: "Sent",
        }),
        message({
          seq: 4,
          from: "me",
          name: "Me",
          recipients: ["bob"],
          body: "Delivered",
        }),
        message({ seq: 5, from: "me", name: "Me", recipients: ["bob"], body: "Read" }),
        message({ seq: 6, body: "Locked", undecryptable: true }),
      ],
      receipts: {
        bob: { delivered: 5, read: { "*": 5 } },
        eve: { delivered: 2, read: {} },
      },
    });
    // Seq 4 and 5 only went to Bob, who has read both; seq 3 waits for Eve.
    render(<Harness discussion={discussion} onOpenLink={onOpenLink} />);
    expect(
      screen.getAllByText("Bob Stone", { selector: ".discussion-sender" }),
    ).toHaveLength(2);
    expect(screen.getByText("@Me")).toHaveClass("is-me");
    fireEvent.click(screen.getByRole("link", { name: "https://example.org" }));
    expect(onOpenLink).toHaveBeenCalledWith("https://example.org");
    expect(
      screen.getByText("Locked").closest(".discussion-undecryptable"),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Sent. Show who received it" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Read. Show who received it" }),
    ).toHaveLength(2);

    // Who has it, and who does not yet.
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Sent. Show who received it" }));
    const info = screen.getByRole("status");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      behavior: "smooth",
    });
    expect(within(info).getByText("Read by")).toBeInTheDocument();
    expect(within(info).getByText("Bob Stone")).toBeInTheDocument();
    expect(within(info).getByText("Not delivered yet")).toBeInTheDocument();
    expect(within(info).getByText("Eve")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Message info" })[0]!);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("explains a message nobody else could receive", () => {
    render(
      <Harness
        discussion={controller({
          messages: [message({ seq: 1, from: "me", recipients: [] })],
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Message info" }));
    expect(screen.getByText(/Nobody else was in the project/)).toBeInTheDocument();
  });

  it("offers reply, copy and a private message on each message", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const discussion = controller({
      messages: [message({ seq: 1, body: "Quote me" })],
    });
    render(<Harness discussion={discussion} />);
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect(discussion.setReplyTo).toHaveBeenCalledWith(everyone, "m1");
    expect(screen.getByText("Replying to Bob Stone")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText("Message to everyone"), { key: "Escape" });
    expect(screen.queryByText("Replying to Bob Stone")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel reply" }));
    expect(screen.queryByText("Replying to Bob Stone")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy text" }));
    });
    expect(writeText).toHaveBeenCalledWith("Quote me");
    expect(screen.getByTitle("Copied")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Message Bob Stone privately" }),
    );
    expect(discussion.openConversation).toHaveBeenCalledWith("bob");
  });

  it("quotes the message replied to and jumps to it", () => {
    vi.useFakeTimers();
    const discussion = controller({
      messages: [
        message({ seq: 1, body: "Original" }),
        message({ seq: 2, from: "me", body: "Answer", replyTo: "m1" }),
        message({ seq: 3, body: "Mine quoted", replyTo: "m2" }),
        message({ seq: 4, body: "Lost", replyTo: "unloaded" }),
      ],
    });
    render(<Harness discussion={discussion} />);
    const quote = screen.getByText("Original", { selector: ".discussion-quote-text" });
    fireEvent.click(quote);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(document.querySelector(".discussion-flash")).not.toBeNull();
    act(() => vi.advanceTimersByTime(2000));
    expect(document.querySelector(".discussion-flash")).toBeNull();
    expect(
      screen.getByText("You", { selector: ".discussion-quote-name" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Earlier message")).toBeInTheDocument();
    expect(screen.getByText("Earlier message").closest("button")).toBeDisabled();
  });

  it("lets a failed message be sent again or deleted", () => {
    const discussion = controller({
      messages: [
        message({
          seq: Number.MAX_SAFE_INTEGER,
          id: "local",
          from: "me",
          local: "failed",
          createdAt: now,
          error: "Offline",
        }),
      ],
    });
    render(<Harness discussion={discussion} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Offline");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(discussion.retry).toHaveBeenCalledWith("local");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(discussion.discard).toHaveBeenCalledWith("local");
    // A local message has no actions yet.
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
  });

  it("sends with Enter, keeps Shift+Enter for new lines and mentions with @", () => {
    const discussion = controller();
    render(<Harness discussion={discussion} />);
    const input = screen.getByLabelText("Message to everyone");
    const send = screen.getByRole("button", { name: "Send message" });
    expect(send).toBeDisabled();

    fireEvent.change(input, { target: { value: "Hi @b", selectionStart: 5 } });
    const list = screen.getByRole("listbox", { name: "Mention someone" });
    expect(within(list).getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("Hi @Bob Stone ");
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.change(input, { target: { value: "Hi @Bob Stone and @Eve" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(discussion.send).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(discussion.send).toHaveBeenCalledWith("Hi @Bob Stone and @Eve", [
      "bob",
      "eve",
    ]);
  });

  it("moves through suggestions with the keyboard and the mouse", () => {
    const discussion = controller();
    render(<Harness discussion={discussion} />);
    const input = screen.getByLabelText("Message to everyone");
    fireEvent.change(input, { target: { value: "@", selectionStart: 1 } });
    let options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Tab" });
    expect(input).toHaveValue("@Eve ");

    fireEvent.change(input, { target: { value: "@Eve @", selectionStart: 6 } });
    options = screen.getAllByRole("option");
    fireEvent.mouseEnter(options[0]!);
    fireEvent.mouseDown(options[0]!);
    expect(input).toHaveValue("@Eve @Bob Stone ");

    fireEvent.change(input, { target: { value: "@", selectionStart: 1 } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.change(input, { target: { value: "@zz", selectionStart: 3 } });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("starts a mention from the @ button and closes the list on blur", () => {
    vi.useFakeTimers();
    render(<Harness discussion={controller({ draft: "Hi" })} />);
    const input = screen.getByLabelText("Message to everyone") as HTMLTextAreaElement;
    input.setSelectionRange(2, 2);
    fireEvent.click(screen.getByRole("button", { name: "Mention someone" }));
    expect(input).toHaveValue("Hi @");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.blur(input);
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("ignores Enter while composing text and counts characters near the limit", () => {
    const discussion = controller();
    render(<Harness discussion={discussion} />);
    const input = screen.getByLabelText("Message to everyone");
    fireEvent.change(input, { target: { value: "かな" } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.compositionEnd(input);
    expect(discussion.send).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "x".repeat(3800) } });
    expect(screen.getByText("3,800 / 4,000")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "x".repeat(4001) } });
    expect(screen.getByText("4,001 / 4,000")).toHaveClass("is-over");
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(discussion.send).not.toHaveBeenCalled();
  });

  it("loads earlier messages from the button and when scrolled to the top", () => {
    const discussion = controller({ messages: [message({ seq: 1 })], hasOlder: true });
    const { rerender } = render(<Harness discussion={discussion} />);
    fireEvent.click(screen.getByRole("button", { name: "Show earlier messages" }));
    expect(discussion.loadOlder).toHaveBeenCalledTimes(1);
    const log = screen.getByRole("log");
    fireEvent.scroll(log);
    expect(discussion.loadOlder).toHaveBeenCalledTimes(2);
    rerender(<Harness discussion={{ ...discussion, loadingOlder: true }} />);
    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
  });

  it("offers to jump down when new messages arrive above the fold", () => {
    const first = controller({ messages: [message({ seq: 1 })] });
    const { rerender } = render(<Harness discussion={first} />);
    const log = screen.getByRole("log");
    Object.defineProperty(log, "scrollHeight", { configurable: true, value: 2000 });
    Object.defineProperty(log, "clientHeight", { configurable: true, value: 300 });
    log.scrollTop = 200;
    fireEvent.scroll(log);
    expect(screen.getByRole("button", { name: "Jump to latest" })).toBeInTheDocument();
    const more = controller({ messages: [message({ seq: 1 }), message({ seq: 2 })] });
    rerender(<Harness discussion={more} />);
    fireEvent.click(
      screen.getByRole("button", { name: "1 new messages, jump to latest" }),
    );
    expect(screen.queryByRole("button", { name: /jump to latest/i })).toBeNull();
    log.scrollTop = 1700;
    fireEvent.scroll(log);
    expect(screen.queryByRole("button", { name: /jump to latest/i })).toBeNull();
  });

  it("warns while reconnecting", () => {
    render(<Harness discussion={controller({ error: "Blip" })} />);
    expect(screen.getByText(/Reconnecting/)).toBeInTheDocument();
  });
});

describe("DiscussionNotices", () => {
  const notices = [
    {
      id: "n1",
      conversation: everyone,
      senderId: "bob",
      senderName: "Bob",
      kind: "mention" as const,
      preview: "Look at this",
      at: now,
    },
    {
      id: "n2",
      conversation: "bob",
      senderId: "bob",
      senderName: "Bob",
      kind: "private" as const,
      preview: "Just you",
      at: now,
    },
  ];

  it("renders nothing without notices", () => {
    const { container } = render(<DiscussionNotices discussion={controller()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens, dismisses and expires notices unless hovered", () => {
    vi.useFakeTimers();
    const discussion = controller({ notices });
    render(<DiscussionNotices discussion={discussion} />);
    expect(screen.getByText("mentioned you")).toBeInTheDocument();
    expect(screen.getByText("private message")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Look at this"));
    expect(discussion.dismissNotice).toHaveBeenCalledWith("n1");
    expect(discussion.openNotice).toHaveBeenCalledWith(notices[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[1]!);
    expect(discussion.dismissNotice).toHaveBeenCalledWith("n2");

    const card = screen.getByText("Just you").closest(".discussion-notice")!;
    fireEvent.mouseEnter(card);
    vi.mocked(discussion.dismissNotice).mockClear();
    act(() => vi.advanceTimersByTime(20_000));
    expect(discussion.dismissNotice).toHaveBeenCalledWith("n1");
    expect(discussion.dismissNotice).not.toHaveBeenCalledWith("n2");
    fireEvent.mouseLeave(card);
    fireEvent.focus(card);
    fireEvent.blur(card);
    act(() => vi.advanceTimersByTime(20_000));
    expect(discussion.dismissNotice).toHaveBeenCalledWith("n2");
  });
});

describe("DiscussionAvatar", () => {
  it("shows the person's emoji and whether they are here", () => {
    const { container, rerender } = render(
      <DiscussionAvatar clientId="bob" name="Bob" online />,
    );
    expect(container.querySelector(".discussion-presence.is-online")).not.toBeNull();
    rerender(<DiscussionAvatar clientId="bob" name="Bob" />);
    expect(container.querySelector(".discussion-presence")).toBeNull();
  });
});
