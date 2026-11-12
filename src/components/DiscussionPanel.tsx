/*
 * The project discussion panel: everyone in a shared project can talk here,
 * to the whole group or privately to one person, @mention each other, reply
 * to a message, and see whether their own messages arrived (one check), were
 * received (two checks) and were read (two blue checks).
 */

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  ArrowDown,
  AtSign,
  Check,
  CheckCheck,
  Clock3,
  Copy,
  CornerUpLeft,
  Info,
  Lock,
  Pencil,
  MessageCircle,
  MessageCircleMore,
  RefreshCw,
  SendHorizontal,
  Smile,
  SmilePlus,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { collaboratorLook } from "../collaboration/collaboratorLook";
import {
  presenceDescription,
  presenceLabels,
  type PresenceState,
} from "../collaboration/presence";
import {
  activeMentionQuery,
  bodySegments,
  buildTimeline,
  everyone,
  insertMention,
  maxMessageChars,
  mentionSuggestions,
  mentionsInText,
  messageStatus,
  previewText,
  receiptBreakdown,
  timeLabel,
  type ChatMessage,
  type DiscussionMember,
  type MentionQuery,
  type MessageStatus,
} from "../features/discussion/discussionModel";
import type { DiscussionController } from "../features/discussion/useDiscussion";
import "../features/discussion/discussion.css";

/** Scrolled this close to the end, new messages keep the view at the end. */
const stickToBottomPx = 96;

// --- Small pieces --------------------------------------------------------------

export function DiscussionAvatar({
  clientId,
  name,
  size = 28,
  presence,
}: {
  clientId: string;
  name: string;
  size?: number;
  /** A green dot when active, gray when away, none when offline. */
  presence?: PresenceState;
}) {
  const look = collaboratorLook(clientId);
  return (
    <span
      className="discussion-avatar"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.52),
        ["--person" as string]: look.color,
      }}
      aria-hidden="true"
      title={name}
    >
      <span className="discussion-avatar-emoji">{look.emoji}</span>
      {presence === "active" || presence === "away" ? (
        <span className="discussion-presence" data-presence={presence} />
      ) : null}
    </span>
  );
}

const statusLabels: Record<MessageStatus, string> = {
  sending: "Sending",
  failed: "Not sent",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
};

function StatusIcon({ status }: { status: MessageStatus }) {
  if (status === "sending") return <Clock3 size={12} aria-hidden="true" />;
  if (status === "failed") return <AlertCircle size={13} aria-hidden="true" />;
  if (status === "sent") return <Check size={14} aria-hidden="true" />;
  return <CheckCheck size={14} aria-hidden="true" />;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function fullDate(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MessageBody({
  message,
  names,
  me,
  onOpenLink,
}: {
  message: ChatMessage;
  names: ReadonlyMap<string, string>;
  me: string;
  onOpenLink: (url: string) => void;
}) {
  if (message.undecryptable) {
    return (
      <span className="discussion-undecryptable">
        <Lock size={12} aria-hidden="true" />
        {message.body}
      </span>
    );
  }
  return (
    <>
      {bodySegments(message.body, message.mentions, names, me).map((segment, index) => {
        if (segment.kind === "mention") {
          return (
            <span
              key={index}
              className={`discussion-mention ${segment.isMe ? "is-me" : ""}`}
            >
              {segment.text}
            </span>
          );
        }
        if (segment.kind === "link") {
          return (
            <a
              key={index}
              href={segment.href}
              className="discussion-link"
              onClick={(event) => {
                event.preventDefault();
                onOpenLink(segment.href);
              }}
            >
              {segment.text}
            </a>
          );
        }
        return <span key={index}>{segment.text}</span>;
      })}
    </>
  );
}

// --- One message -----------------------------------------------------------------

// --- Reactions -------------------------------------------------------------------

const quickReactions = [
  ["👍", "Thumbs up"],
  ["✅", "OK"],
  ["❤️", "Heart"],
  ["😂", "Laughing"],
  ["😮", "Surprised"],
  ["🙏", "Thank you"],
  ["🎉", "Celebrate"],
  ["👀", "Looking"],
] as const;

interface ReactionGroup {
  emoji: string;
  people: string[];
  mine: boolean;
}

/** Reactions grouped by emoji, in the order they first appear. */
function reactionGroups(
  reactions: Record<string, string> | undefined,
  me: string,
): ReactionGroup[] {
  const groups = new Map<string, ReactionGroup>();
  for (const [clientId, emoji] of Object.entries(reactions ?? {})) {
    const group = groups.get(emoji) ?? { emoji, people: [], mine: false };
    group.people.push(clientId);
    if (clientId === me) group.mine = true;
    groups.set(emoji, group);
  }
  return [...groups.values()];
}

interface MessageRowProps {
  message: ChatMessage;
  first: boolean;
  last: boolean;
  me: string;
  inGroup: boolean;
  status: MessageStatus | null;
  names: ReadonlyMap<string, string>;
  quoted: ChatMessage | null | undefined;
  infoOpen: boolean;
  info: ReactNode;
  onReply: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage, text: string) => Promise<void>;
  onReact: (message: ChatMessage, emoji: string | null) => void;
  onMessagePrivately: (clientId: string) => void;
  onToggleInfo: (id: string) => void;
  onRetry: (id: string) => void;
  onDiscard: (id: string) => void;
  onJumpTo: (id: string) => void;
  onOpenLink: (url: string) => void;
}

const MessageRow = memo(function MessageRow({
  message,
  first,
  last,
  me,
  inGroup,
  status,
  names,
  quoted,
  infoOpen,
  info,
  onReply,
  onEdit,
  onReact,
  onMessagePrivately,
  onToggleInfo,
  onRetry,
  onDiscard,
  onJumpTo,
  onOpenLink,
}: MessageRowProps) {
  const mine = message.from === me;
  const mentionsMe = !mine && message.mentions.includes(me);
  const senderName = names.get(message.from) ?? message.name;
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const saveEdit = async () => {
    if (!editing || saving || !editText.trim() || editText.length > maxMessageChars)
      return;
    setSaving(true);
    setEditError("");
    try {
      await onEdit(editing, editText);
      setEditing(null);
    } catch (error) {
      setEditError(
        error instanceof Error ? error.message : "Could not save this edit. Try again.",
      );
    } finally {
      setSaving(false);
    }
  };
  const look = collaboratorLook(message.from);
  const [reacting, setReacting] = useState(false);
  const reactionPickerRef = useRef<HTMLDivElement>(null);
  const reactionToggleRef = useRef<HTMLButtonElement>(null);
  const myReaction = message.reactions?.[me] ?? null;
  const reactions = reactionGroups(message.reactions, me);
  const chooseReaction = (emoji: string) => {
    setReacting(false);
    onReact(message, myReaction === emoji ? null : emoji);
  };
  useEffect(() => {
    if (!reacting) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !reactionPickerRef.current?.contains(target) &&
        !reactionToggleRef.current?.contains(target)
      ) {
        setReacting(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [reacting]);

  const copy = () => {
    void navigator.clipboard?.writeText(message.body).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div
      id={`discussion-message-${message.id}`}
      className={[
        "discussion-row",
        mine ? "is-mine" : "is-theirs",
        first ? "is-first" : "",
        last ? "is-last" : "",
        mentionsMe ? "mentions-me" : "",
        message.local ? `is-${message.local}` : "",
        reacting ? "is-reacting" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {!mine ? (
        <div className="discussion-row-avatar">
          {first ? (
            <DiscussionAvatar clientId={message.from} name={senderName} size={26} />
          ) : null}
        </div>
      ) : null}
      <div className="discussion-row-content">
        <div
          className="discussion-bubble"
          style={{ ["--person" as string]: look.color }}
        >
          {!mine && first && inGroup ? (
            <div className="discussion-sender">{senderName}</div>
          ) : null}
          {message.replyTo ? (
            <button
              type="button"
              className="discussion-quote"
              onClick={() => quoted && onJumpTo(quoted.id)}
              disabled={!quoted}
              style={
                quoted
                  ? { ["--person" as string]: collaboratorLook(quoted.from).color }
                  : undefined
              }
            >
              <span className="discussion-quote-name">
                {quoted
                  ? quoted.from === me
                    ? "You"
                    : (names.get(quoted.from) ?? quoted.name)
                  : "Earlier message"}
              </span>
              <span className="discussion-quote-text">
                {quoted ? previewText(quoted.body, 90) : "Scroll up to load it."}
              </span>
            </button>
          ) : null}
          {editing ? (
            <form
              className="discussion-edit"
              onSubmit={(event) => {
                event.preventDefault();
                void saveEdit();
              }}
            >
              <textarea
                autoFocus
                aria-label="Edit message"
                value={editText}
                disabled={saving}
                onChange={(event) => setEditText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === "Escape" && !saving) {
                    event.preventDefault();
                    setEditing(null);
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void saveEdit();
                  }
                }}
              />
              {editError ? <span role="alert">{editError}</span> : null}
              {editText.length > maxMessageChars ? (
                <span role="alert">Messages can contain up to 4,000 characters.</span>
              ) : null}
              <div className="discussion-edit-actions">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    saving || !editText.trim() || editText.length > maxMessageChars
                  }
                >
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          ) : (
            <div className="discussion-text">
              <MessageBody
                message={message}
                names={names}
                me={me}
                onOpenLink={onOpenLink}
              />
              <span
                className={`discussion-meta-spacer ${message.editedAt ? "is-edited" : ""}`}
                aria-hidden="true"
              />
            </div>
          )}
          <span className="discussion-meta" title={fullDate(message.createdAt)}>
            {message.editedAt ? (
              <span title={`Edited ${fullDate(message.editedAt)}`}>Edited</span>
            ) : null}
            <time dateTime={new Date(message.createdAt).toISOString()}>
              {timeLabel(message.createdAt)}
            </time>
            {mine && status ? (
              <button
                type="button"
                className={`discussion-status is-${status}`}
                onClick={() => onToggleInfo(message.id)}
                aria-label={`${statusLabels[status]}. Show who received it`}
                aria-expanded={infoOpen}
                title={statusLabels[status]}
                disabled={status === "sending" || status === "failed"}
              >
                <StatusIcon status={status} />
              </button>
            ) : null}
          </span>
        </div>
        {message.local === "failed" ? (
          <div className="discussion-failed" role="alert">
            <span>{message.error ?? "Not sent."}</span>
            <button type="button" onClick={() => onRetry(message.id)}>
              <RefreshCw size={12} aria-hidden="true" />
              Retry
            </button>
            <button type="button" onClick={() => onDiscard(message.id)}>
              <Trash2 size={12} aria-hidden="true" />
              Delete
            </button>
          </div>
        ) : null}
        {infoOpen ? info : null}
        {reactions.length ? (
          <div className="discussion-reactions" role="group" aria-label="Reactions">
            {reactions.map((group) => {
              const who = group.people
                .map((clientId) =>
                  clientId === me ? "You" : (names.get(clientId) ?? "Someone"),
                )
                .join(", ");
              return (
                <button
                  key={group.emoji}
                  type="button"
                  className={`discussion-reaction ${group.mine ? "is-mine" : ""}`}
                  title={group.mine ? `${who} · click to remove yours` : who}
                  aria-label={`${group.emoji} ${group.people.length}: ${who}`}
                  aria-pressed={group.mine}
                  disabled={Boolean(message.local)}
                  onClick={() => chooseReaction(group.emoji)}
                >
                  <span aria-hidden="true">{group.emoji}</span>
                  <span className="discussion-reaction-count">
                    {group.people.length}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
        {message.local ? null : (
          <div
            className="discussion-row-actions"
            role="toolbar"
            aria-label="Message actions"
          >
            <button
              type="button"
              ref={reactionToggleRef}
              onClick={() => setReacting((open) => !open)}
              title="React"
              aria-label="React"
              aria-expanded={reacting}
              className={reacting ? "is-on" : undefined}
            >
              <SmilePlus size={14} />
            </button>
            <button
              type="button"
              onClick={() => onReply(message)}
              title="Reply"
              aria-label="Reply"
            >
              <CornerUpLeft size={14} />
            </button>
            <button
              type="button"
              onClick={copy}
              title={copied ? "Copied" : "Copy text"}
              aria-label="Copy text"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
            {!mine && inGroup ? (
              <button
                type="button"
                onClick={() => onMessagePrivately(message.from)}
                title={`Message ${firstName(senderName)} privately`}
                aria-label={`Message ${senderName} privately`}
              >
                <MessageCircle size={14} />
              </button>
            ) : null}
            {mine && !message.undecryptable ? (
              <button
                type="button"
                title="Edit message"
                aria-label="Edit message"
                disabled={saving}
                onClick={() => {
                  setEditing(message);
                  setEditText(message.body);
                  setEditError("");
                }}
              >
                <Pencil size={14} />
              </button>
            ) : null}
            {mine ? (
              <button
                type="button"
                onClick={() => onToggleInfo(message.id)}
                title="Message info"
                aria-label="Message info"
              >
                <Info size={14} />
              </button>
            ) : null}
          </div>
        )}
        {reacting ? (
          <div
            ref={reactionPickerRef}
            className="discussion-reaction-picker"
            role="menu"
            aria-label="Choose a reaction"
            onKeyDown={(event) => {
              if (event.key === "Escape") setReacting(false);
            }}
          >
            {quickReactions.map(([emoji, label]) => (
              <button
                key={emoji}
                type="button"
                role="menuitem"
                className={myReaction === emoji ? "is-mine" : undefined}
                title={myReaction === emoji ? `Remove ${label}` : label}
                aria-label={myReaction === emoji ? `Remove ${label}` : label}
                onClick={() => chooseReaction(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
});

// --- Composer --------------------------------------------------------------------

const conversationEmojis = [
  ["😀", "Grinning face"],
  ["😊", "Smiling face"],
  ["😂", "Tears of joy"],
  ["😍", "Heart eyes"],
  ["🤔", "Thinking"],
  ["😅", "Sweat smile"],
  ["😢", "Crying"],
  ["😮", "Surprised"],
  ["👍", "Thumbs up"],
  ["👎", "Thumbs down"],
  ["👏", "Clapping"],
  ["🙌", "Raised hands"],
  ["🙏", "Thank you"],
  ["👋", "Waving"],
  ["💪", "Flexed biceps"],
  ["❤️", "Heart"],
  ["🎉", "Celebration"],
  ["✨", "Sparkles"],
  ["🔥", "Fire"],
  ["✅", "Check mark"],
  ["👀", "Eyes"],
  ["💡", "Idea"],
  ["🚀", "Rocket"],
  ["📚", "Books"],
] as const;

interface ComposerProps {
  conversationName: string;
  isPrivate: boolean;
  draft: string;
  members: readonly DiscussionMember[];
  replyTo: ChatMessage | null;
  replyName: string;
  disabled: boolean;
  focusKey: string;
  onDraftChange: (text: string) => void;
  onSend: (text: string, mentions: string[]) => void;
  onCancelReply: () => void;
}

function Composer({
  conversationName,
  isPrivate,
  draft,
  members,
  replyTo,
  replyName,
  disabled,
  focusKey,
  onDraftChange,
  onSend,
  onCancelReply,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const emojiId = useId();
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (emojiOpen)
      emojiPickerRef.current
        ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
        ?.focus();
  }, [emojiOpen]);
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [active, setActive] = useState(0);
  // Names chosen from the list; a name still in the text is a mention.
  const chosenRef = useRef(new Map<string, string>());
  const composingRef = useRef(false);
  // React also reports a "selection" on key presses; only a moved caret counts.
  const lastSelectionRef = useRef({ value: draft, caret: -1 });

  const suggestions = useMemo(
    () => (mention ? mentionSuggestions(members, mention.query) : []),
    [members, mention],
  );
  const listOpen = Boolean(mention) && suggestions.length > 0;

  // Fit the text: one line when empty, growing up to a few lines.
  useLayoutEffect(() => {
    const area = textareaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, 168)}px`;
  }, [draft]);

  // Switching conversation, or choosing Reply, puts the caret here.
  useEffect(() => {
    textareaRef.current?.focus();
    setEmojiOpen(false);
  }, [focusKey, replyTo?.id]);

  useEffect(() => {
    setActive(0);
  }, [mention?.query]);

  const updateMention = (text: string, caret: number) => {
    lastSelectionRef.current = { value: text, caret };
    setMention(activeMentionQuery(text, caret));
  };

  const choose = (member: DiscussionMember) => {
    const area = textareaRef.current;
    if (!area || !mention) return;
    const result = insertMention(draft, mention, area.selectionStart, member.name);
    chosenRef.current.set(member.clientId, member.name);
    onDraftChange(result.text);
    setMention(null);
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(result.caret, result.caret);
    });
  };

  const insertEmoji = (emoji: string) => {
    const area = textareaRef.current;
    if (!area || disabled) return;
    const start = area.selectionStart;
    const end = area.selectionEnd;
    const text = draft.slice(0, start) + emoji + draft.slice(end);
    if (text.length > maxMessageChars) return;
    onDraftChange(text);
    setEmojiOpen(false);
    setMention(null);
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  const submit = () => {
    const text = draft.trim();
    if (!text || disabled || text.length > maxMessageChars) return;
    // Names typed in full also count, so "@Ann" works without the list.
    for (const member of members) {
      if (draft.includes(`@${member.name}`))
        chosenRef.current.set(member.clientId, member.name);
    }
    onSend(text, mentionsInText(text, chosenRef.current));
    setEmojiOpen(false);
    chosenRef.current = new Map();
    setMention(null);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (composingRef.current || event.nativeEvent.isComposing) return;
    if (emojiOpen && event.key === "Escape") return;
    if (listOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((index) => (index + step + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const member = suggestions[active];
        if (member) choose(member);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMention(null);
        return;
      }
    }
    if (event.key === "Escape" && replyTo) {
      event.preventDefault();
      onCancelReply();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      submit();
    }
  };

  const startMention = () => {
    setEmojiOpen(false);
    const area = textareaRef.current;
    if (!area) return;
    const caret = area.selectionStart ?? draft.length;
    const needsSpace = caret > 0 && !/\s/.test(draft[caret - 1] ?? "");
    const insert = `${needsSpace ? " " : ""}@`;
    const text = `${draft.slice(0, caret)}${insert}${draft.slice(caret)}`;
    onDraftChange(text);
    const next = caret + insert.length;
    setMention({ start: next - 1, query: "" });
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(next, next);
    });
  };

  const tooLong = draft.length > maxMessageChars;
  const nearLimit = draft.length > maxMessageChars - 500;
  const canSend = Boolean(draft.trim()) && !disabled && !tooLong;

  return (
    <div
      className="discussion-composer"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setEmojiOpen(false);
      }}
      onKeyDown={(event) => {
        if (emojiOpen && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setEmojiOpen(false);
          emojiButtonRef.current?.focus();
        }
      }}
    >
      {replyTo ? (
        <div className="discussion-reply-preview">
          <CornerUpLeft size={14} aria-hidden="true" />
          <div
            className="discussion-reply-preview-text"
            style={{ ["--person" as string]: collaboratorLook(replyTo.from).color }}
          >
            <strong>Replying to {replyName}</strong>
            <span>{previewText(replyTo.body, 80)}</span>
          </div>
          <button
            type="button"
            className="discussion-icon-button"
            onClick={onCancelReply}
            aria-label="Cancel reply"
            title="Cancel reply (Esc)"
          >
            <X size={14} />
          </button>
        </div>
      ) : null}
      {listOpen ? (
        <ul
          className="discussion-mention-list"
          id={listId}
          role="listbox"
          aria-label="Mention someone"
        >
          {suggestions.map((member, index) => (
            <li
              key={member.clientId}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={index === active ? "is-active" : ""}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                // Keep the caret in the text while choosing.
                event.preventDefault();
                choose(member);
              }}
            >
              <DiscussionAvatar
                clientId={member.clientId}
                name={member.name}
                size={22}
                presence={member.presence}
              />
              <span className="discussion-mention-name">{member.name}</span>
              <span className="discussion-mention-role">{member.role}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {emojiOpen && !disabled ? (
        <div
          ref={emojiPickerRef}
          className="discussion-emoji-picker"
          id={emojiId}
          role="group"
          aria-label="Emojis"
        >
          {conversationEmojis.map(([emoji, label]) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              title={label}
              onClick={() => insertEmoji(emoji)}
              disabled={
                draft.length -
                  ((textareaRef.current?.selectionEnd ?? 0) -
                    (textareaRef.current?.selectionStart ?? 0)) +
                  emoji.length >
                maxMessageChars
              }
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
      <div className={`discussion-input ${isPrivate ? "is-private" : ""}`}>
        <button
          type="button"
          className="discussion-icon-button"
          onClick={startMention}
          disabled={disabled || !members.length}
          title="Mention someone (@)"
          aria-label="Mention someone"
        >
          <AtSign size={16} />
        </button>
        <button
          ref={emojiButtonRef}
          type="button"
          className="discussion-icon-button"
          aria-label="Add emoji"
          title="Add emoji"
          aria-expanded={emojiOpen && !disabled}
          aria-controls={emojiOpen && !disabled ? emojiId : undefined}
          disabled={disabled}
          onClick={() => {
            setMention(null);
            setEmojiOpen((open) => !open);
          }}
        >
          <Smile size={16} />
        </button>
        <textarea
          ref={textareaRef}
          rows={1}
          value={draft}
          disabled={disabled}
          placeholder={
            isPrivate ? `Message ${conversationName} privately…` : "Message everyone…"
          }
          aria-label={
            isPrivate ? `Private message to ${conversationName}` : "Message to everyone"
          }
          role="combobox"
          aria-expanded={listOpen}
          aria-controls={listOpen ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={listOpen ? `${listId}-${active}` : undefined}
          onChange={(event) => {
            setEmojiOpen(false);
            onDraftChange(event.target.value);
            updateMention(event.target.value, event.target.selectionStart);
          }}
          onSelect={(event) => {
            const { value, selectionStart } = event.currentTarget;
            const last = lastSelectionRef.current;
            if (last.value === value && last.caret === selectionStart) return;
            updateMention(value, selectionStart);
          }}
          onKeyDown={onKeyDown}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onBlur={() => window.setTimeout(() => setMention(null), 120)}
        />
        <button
          type="button"
          className="discussion-send"
          onClick={submit}
          disabled={!canSend}
          title="Send (Enter)"
          aria-label="Send message"
        >
          <SendHorizontal size={16} />
        </button>
      </div>
      <div className="discussion-composer-hint" aria-hidden={!nearLimit}>
        {nearLimit ? (
          <span className={tooLong ? "is-over" : ""}>
            {draft.length.toLocaleString()} / {maxMessageChars.toLocaleString()}
          </span>
        ) : (
          <span>
            <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line ·{" "}
            <kbd>@</kbd> to mention
          </span>
        )}
      </div>
    </div>
  );
}

// --- Panel -----------------------------------------------------------------------

export interface DiscussionPanelProps {
  discussion: DiscussionController;
  onOpenLink: (url: string) => void;
  onOpenShare?: () => void;
}

export function DiscussionPanel({
  discussion,
  onOpenLink,
  onOpenShare,
}: DiscussionPanelProps) {
  const {
    available,
    me,
    status,
    error,
    conversation,
    conversationMessages,
    openConversation,
    unreadAfter,
    members,
    memberIds,
    names,
    receipts,
    summaries,
    hasOlder,
    loadingOlder,
    loadOlder,
    send,
    edit,
    react,
    retry,
    discard,
    refresh,
    messages,
    draft,
    setDraft,
    replyTo,
    setReplyTo,
  } = discussion;
  const listRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const [newBelow, setNewBelow] = useState(0);
  const [infoFor, setInfoFor] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const previousCountRef = useRef(0);
  const restoreRef = useRef<{ height: number; top: number } | null>(null);

  const inGroup = conversation === everyone;
  const partner = inGroup
    ? null
    : members.find((member) => member.clientId === conversation);
  const partnerName = inGroup
    ? "Everyone"
    : (partner?.name ?? names.get(conversation) ?? "Someone");
  const activeCount = members.filter((member) => member.presence === "active").length;
  const awayCount = members.filter((member) => member.presence === "away").length;

  const byId = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages],
  );
  const timeline = useMemo(
    () => buildTimeline(conversationMessages, { unreadAfter, me }),
    [conversationMessages, me, unreadAfter],
  );
  const replyMessage = replyTo ? (byId.get(replyTo) ?? null) : null;

  const scrollToBottom = useCallback((smooth = false) => {
    const list = listRef.current;
    if (!list) return;
    if (typeof list.scrollTo === "function") {
      list.scrollTo({ top: list.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    } else {
      list.scrollTop = list.scrollHeight;
    }
    atBottomRef.current = true;
    setShowJump(false);
    setNewBelow(0);
  }, []);

  // A new conversation opens at its first unread message, or at its end.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    setInfoFor(null);
    const divider = list.querySelector<HTMLElement>(".discussion-unread-divider");
    if (divider) {
      list.scrollTop = Math.max(0, divider.offsetTop - 48);
      atBottomRef.current = false;
    } else {
      scrollToBottom();
    }
    previousCountRef.current = conversationMessages.length;
    // Only when the conversation (or the panel's data) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation, status]);

  // New messages keep the view at the end when it was there; otherwise a
  // "new messages" button offers to jump down.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const restore = restoreRef.current;
    if (restore) {
      // Older messages were added above: stay where the reader was.
      list.scrollTop = list.scrollHeight - restore.height + restore.top;
      restoreRef.current = null;
      previousCountRef.current = conversationMessages.length;
      return;
    }
    const added = conversationMessages.length - previousCountRef.current;
    previousCountRef.current = conversationMessages.length;
    if (added <= 0) return;
    const newest = conversationMessages.at(-1);
    if (atBottomRef.current || newest?.from === me) {
      scrollToBottom(true);
    } else {
      setNewBelow((count) => count + added);
      setShowJump(true);
    }
  }, [conversationMessages, me, scrollToBottom]);

  // Message info opens below the message: keep it in view.
  useEffect(() => {
    if (!infoFor) return;
    document
      .querySelector(`#discussion-message-${CSS.escape(infoFor)} .discussion-info`)
      ?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [infoFor]);

  const onScroll = () => {
    const list = listRef.current;
    if (!list) return;
    const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
    atBottomRef.current = distance < stickToBottomPx;
    if (atBottomRef.current) {
      setShowJump(false);
      setNewBelow(0);
    } else if (distance > list.clientHeight) {
      setShowJump(true);
    }
    if (list.scrollTop < 40 && hasOlder && !loadingOlder) requestOlder();
  };

  const requestOlder = () => {
    const list = listRef.current;
    if (list) restoreRef.current = { height: list.scrollHeight, top: list.scrollTop };
    void loadOlder();
  };

  const jumpTo = useCallback((id: string) => {
    const element = document.getElementById(`discussion-message-${id}`);
    if (!element) return;
    element.scrollIntoView?.({ block: "center", behavior: "smooth" });
    setFlashId(id);
    window.setTimeout(
      () => setFlashId((current) => (current === id ? null : current)),
      1600,
    );
  }, []);

  const reply = useCallback(
    (message: ChatMessage) => setReplyTo(conversation, message.id),
    [conversation, setReplyTo],
  );
  const toggleInfo = useCallback(
    (id: string) => setInfoFor((current) => (current === id ? null : id)),
    [],
  );

  const infoCard = (message: ChatMessage) => {
    const breakdown = receiptBreakdown(message, me, receipts, memberIds);
    const nameList = (ids: string[]) =>
      ids.map((id) => names.get(id) ?? "Someone").join(", ");
    const rows: Array<{ key: string; label: string; icon: ReactNode; ids: string[] }> =
      [
        {
          key: "read",
          label: "Read by",
          icon: <CheckCheck size={13} />,
          ids: breakdown.read,
        },
        {
          key: "delivered",
          label: "Delivered to",
          icon: <CheckCheck size={13} />,
          ids: breakdown.delivered,
        },
        {
          key: "waiting",
          label: "Not delivered yet",
          icon: <Check size={13} />,
          ids: breakdown.waiting,
        },
      ];
    const visibleRows = rows.filter((row) => row.ids.length);
    return (
      <div className="discussion-info" role="status">
        {visibleRows.length ? (
          visibleRows.map((row) => (
            <div key={row.key} className={`discussion-info-row is-${row.key}`}>
              <span className="discussion-info-icon" aria-hidden="true">
                {row.icon}
              </span>
              <span className="discussion-info-label">{row.label}</span>
              <span className="discussion-info-names">{nameList(row.ids)}</span>
            </div>
          ))
        ) : (
          <div className="discussion-info-row">
            <span className="discussion-info-names">
              Nobody else was in the project when you sent this.
            </span>
          </div>
        )}
      </div>
    );
  };

  if (!available) {
    return (
      <div className="discussion-panel">
        <div className="discussion-empty">
          <span className="discussion-empty-icon" aria-hidden="true">
            <MessageCircleMore size={26} />
          </span>
          <strong>Discuss with your co-authors</strong>
          <p>
            Share this project to talk with the people working on it, mention them with
            @, and see when they have read your messages.
          </p>
          {onOpenShare ? (
            <button type="button" className="discussion-primary" onClick={onOpenShare}>
              Share project
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="discussion-panel">
      <div className="discussion-people" role="tablist" aria-label="Conversations">
        <PersonTab
          selected={inGroup}
          label="Everyone"
          unread={summaries.get(everyone)?.unread ?? 0}
          mentioned={(summaries.get(everyone)?.mentions ?? 0) > 0}
          onSelect={() => openConversation(everyone)}
          icon={
            <span className="discussion-everyone-icon" aria-hidden="true">
              <Users size={15} />
            </span>
          }
        />
        {members.map((member) => (
          <PersonTab
            key={member.clientId}
            selected={conversation === member.clientId}
            label={firstName(member.name)}
            fullLabel={`${member.name} (${presenceLabels[member.presence].toLowerCase()})`}
            presence={member.presence}
            unread={summaries.get(member.clientId)?.unread ?? 0}
            mentioned={(summaries.get(member.clientId)?.unread ?? 0) > 0}
            onSelect={() => openConversation(member.clientId)}
            icon={
              <DiscussionAvatar
                clientId={member.clientId}
                name={member.name}
                size={30}
                presence={member.presence}
              />
            }
          />
        ))}
      </div>

      <div className="discussion-thread-header">
        {inGroup ? (
          <>
            <span className="discussion-everyone-icon is-large" aria-hidden="true">
              <Users size={16} />
            </span>
            <div className="discussion-thread-title">
              <strong>Everyone</strong>
              <span>
                {members.length + 1} {members.length ? "people" : "person"}
                {activeCount ? ` · ${activeCount} active` : ""}
                {awayCount ? ` · ${awayCount} away` : ""}
              </span>
            </div>
          </>
        ) : (
          <>
            <DiscussionAvatar
              clientId={conversation}
              name={partnerName}
              size={32}
              presence={partner?.presence}
            />
            <div className="discussion-thread-title">
              <strong>{partnerName}</strong>
              <span>
                {!partner
                  ? "No longer in this project"
                  : partner.presence === "offline"
                    ? "Offline · they will see it next time"
                    : presenceDescription(partner.presence, partner.currentFile)}
              </span>
            </div>
          </>
        )}
      </div>

      {!inGroup ? (
        <div className="discussion-private-note">
          <Lock size={12} aria-hidden="true" />
          Only you and {firstName(partnerName)} can see this conversation.
        </div>
      ) : null}

      <div className="discussion-messages-wrap">
        <div
          ref={listRef}
          className="discussion-messages"
          role="log"
          aria-live="polite"
          aria-label={inGroup ? "Messages to everyone" : `Messages with ${partnerName}`}
          onScroll={onScroll}
          tabIndex={0}
        >
          {status === "loading" ? (
            <div className="discussion-skeleton" aria-label="Loading messages">
              <span />
              <span className="is-mine" />
              <span />
            </div>
          ) : status === "error" ? (
            <div className="discussion-empty is-error" role="alert">
              <span className="discussion-empty-icon" aria-hidden="true">
                <AlertCircle size={24} />
              </span>
              <strong>The discussion could not be loaded</strong>
              <p>{error}</p>
              <button
                type="button"
                className="discussion-primary"
                onClick={() => void refresh()}
              >
                Try again
              </button>
            </div>
          ) : (
            <>
              {hasOlder ? (
                <button
                  type="button"
                  className="discussion-load-older"
                  onClick={requestOlder}
                  disabled={loadingOlder}
                >
                  {loadingOlder ? "Loading…" : "Show earlier messages"}
                </button>
              ) : null}
              {timeline.length === 0 ? (
                <div className="discussion-empty is-inline">
                  <span className="discussion-empty-icon" aria-hidden="true">
                    {inGroup ? (
                      <MessageCircleMore size={24} />
                    ) : (
                      <MessageCircle size={24} />
                    )}
                  </span>
                  <strong>
                    {inGroup
                      ? "Start the conversation"
                      : `Say hello to ${firstName(partnerName)}`}
                  </strong>
                  <p>
                    {inGroup
                      ? members.length
                        ? "Everyone in the project sees these messages. Type @ to get someone's attention."
                        : "Nobody else has joined yet. Messages you write here wait for them."
                      : "Messages here are private between the two of you."}
                  </p>
                </div>
              ) : (
                timeline.map((item) => {
                  if (item.kind === "day") {
                    return (
                      <div key={item.key} className="discussion-day" role="separator">
                        <span>{item.label}</span>
                      </div>
                    );
                  }
                  if (item.kind === "unread") {
                    return (
                      <div
                        key={item.key}
                        className="discussion-unread-divider"
                        role="separator"
                      >
                        <span>
                          {item.count} new {item.count === 1 ? "message" : "messages"}
                        </span>
                      </div>
                    );
                  }
                  const message = item.message;
                  const mine = message.from === me;
                  return (
                    <div
                      key={item.key}
                      className={
                        flashId === message.id ? "discussion-flash" : undefined
                      }
                    >
                      <MessageRow
                        message={message}
                        first={item.first}
                        last={item.last}
                        me={me}
                        inGroup={inGroup}
                        status={
                          mine ? messageStatus(message, me, receipts, memberIds) : null
                        }
                        names={names}
                        quoted={
                          message.replyTo
                            ? (byId.get(message.replyTo) ?? null)
                            : undefined
                        }
                        infoOpen={infoFor === message.id}
                        info={infoFor === message.id ? infoCard(message) : null}
                        onReply={reply}
                        onEdit={edit}
                        onReact={react}
                        onMessagePrivately={openConversation}
                        onToggleInfo={toggleInfo}
                        onRetry={retry}
                        onDiscard={discard}
                        onJumpTo={jumpTo}
                        onOpenLink={onOpenLink}
                      />
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>
        {showJump ? (
          <button
            type="button"
            className="discussion-jump"
            onClick={() => scrollToBottom(true)}
            aria-label={
              newBelow ? `${newBelow} new messages, jump to latest` : "Jump to latest"
            }
          >
            <ArrowDown size={14} aria-hidden="true" />
            {newBelow ? <span>{newBelow} new</span> : null}
          </button>
        ) : null}
      </div>

      {error && status === "ready" ? (
        <div className="discussion-offline" role="status">
          <AlertCircle size={12} aria-hidden="true" />
          Reconnecting… messages you send will be retried.
        </div>
      ) : null}

      <Composer
        conversationName={firstName(partnerName)}
        isPrivate={!inGroup}
        draft={draft}
        members={members}
        replyTo={replyMessage}
        replyName={
          replyMessage
            ? replyMessage.from === me
              ? "yourself"
              : (names.get(replyMessage.from) ?? replyMessage.name)
            : ""
        }
        disabled={status !== "ready"}
        focusKey={conversation}
        onDraftChange={(text) => setDraft(conversation, text)}
        onSend={send}
        onCancelReply={() => setReplyTo(conversation, null)}
      />
    </div>
  );
}

function PersonTab({
  selected,
  label,
  fullLabel,
  unread,
  mentioned,
  icon,
  presence,
  onSelect,
}: {
  selected: boolean;
  label: string;
  fullLabel?: string;
  unread: number;
  mentioned: boolean;
  icon: ReactNode;
  presence?: PresenceState;
  onSelect: () => void;
}) {
  const name = fullLabel ?? label;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={`discussion-person ${selected ? "is-selected" : ""}`}
      data-presence={presence}
      onClick={onSelect}
      title={name}
      aria-label={unread ? `${name}, ${unread} unread` : name}
    >
      <span className="discussion-person-icon">
        {icon}
        {unread ? (
          <span
            className={`discussion-badge ${mentioned ? "is-mention" : ""}`}
            aria-hidden="true"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </span>
      <span className="discussion-person-label">{label}</span>
    </button>
  );
}

// --- Notices ---------------------------------------------------------------------

const noticeLifetimeMs = 12_000;

export function DiscussionNotices({
  discussion,
}: {
  discussion: DiscussionController;
}) {
  const { notices, dismissNotice, openNotice } = discussion;
  if (!notices.length) return null;
  return (
    <div className="discussion-notices" aria-live="polite">
      {notices.map((notice) => (
        <DiscussionNoticeCard
          key={notice.id}
          notice={notice}
          onOpen={() => {
            dismissNotice(notice.id);
            openNotice(notice);
          }}
          onDismiss={() => dismissNotice(notice.id)}
        />
      ))}
    </div>
  );
}

function DiscussionNoticeCard({
  notice,
  onOpen,
  onDismiss,
}: {
  notice: DiscussionController["notices"][number];
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(onDismiss, noticeLifetimeMs);
    return () => window.clearTimeout(timer);
  }, [onDismiss, paused]);
  return (
    <div
      className="discussion-notice"
      role="alert"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <button type="button" className="discussion-notice-main" onClick={onOpen}>
        <DiscussionAvatar
          clientId={notice.senderId}
          name={notice.senderName}
          size={32}
        />
        <span className="discussion-notice-text">
          <span className="discussion-notice-title">
            <strong>{notice.senderName}</strong>
            {notice.kind === "private" ? (
              <span className="discussion-notice-kind">
                <Lock size={11} aria-hidden="true" /> private message
              </span>
            ) : notice.kind === "mention" ? (
              <span className="discussion-notice-kind">
                <AtSign size={11} aria-hidden="true" /> mentioned you
              </span>
            ) : (
              <span className="discussion-notice-kind">
                <MessageCircle size={11} aria-hidden="true" /> new message
              </span>
            )}
          </span>
          <span className="discussion-notice-preview">{notice.preview}</span>
          <span className="discussion-notice-action">Open discussion</span>
        </span>
      </button>
      <button
        type="button"
        className="discussion-icon-button discussion-notice-close"
        onClick={onDismiss}
        aria-label="Dismiss"
        title="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
