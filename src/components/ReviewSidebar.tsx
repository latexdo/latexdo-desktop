import React from "react";
import {
  Check,
  FilePlus2,
  MessageSquare,
  Plus,
  Send,
  Trash2,
  User,
} from "lucide-react";
import type { ReviewChat } from "../types";

interface ReviewSidebarProps {
  chats: ReviewChat[];
  onAddChat: () => void;
  onAddComment: (chatId: string, text: string) => void;
  onDeleteChat: (chatId: string) => void;
  onJumpToSelection: (chat: ReviewChat) => void;
  onInsertIntoTex: (chat: ReviewChat) => void;
}

export const ReviewSidebar: React.FC<ReviewSidebarProps> = ({
  chats,
  onAddChat,
  onAddComment,
  onDeleteChat,
  onJumpToSelection,
  onInsertIntoTex,
}) => {
  const [commentTexts, setCommentTexts] = React.useState<Record<string, string>>({});

  const submitComment = (chatId: string) => {
    const text = commentTexts[chatId]?.trim();
    if (!text) return;
    onAddComment(chatId, text);
    setCommentTexts((prev) => ({ ...prev, [chatId]: "" }));
  };

  return (
    <div className="review-sidebar">
      <div className="sidebar-header-actions">
        <button className="sidebar-primary-action" onClick={onAddChat}>
          <Plus size={14} />
          <span>New Review Thread</span>
        </button>
      </div>

      <div className="sidebar-list">
        {chats.length === 0 ? (
          <div className="sidebar-empty">
            <MessageSquare size={32} />
            <p>No review threads yet.</p>
            <p className="sub-text">
              Select text in the editor and start a sidebar discussion.
            </p>
          </div>
        ) : (
          chats.map((chat) => (
            <div key={chat.id} className="sidebar-item-card review-chat-card">
              <div className="review-chat-header">
                <button
                  type="button"
                  className="review-chat-selection"
                  onClick={() => onJumpToSelection(chat)}
                  title="Click to jump to selection"
                >
                  "{chat.selection.text.substring(0, 50)}
                  {chat.selection.text.length > 50 ? "..." : ""}"
                </button>
                <button
                  className="small-icon delete-button"
                  onClick={() => onDeleteChat(chat.id)}
                  title="Delete review chat"
                  aria-label="Delete review chat"
                >
                  <Trash2 size={13} />
                </button>
              </div>

              <div className="review-comments-list">
                {chat.comments.length > 0 ? (
                  chat.comments.map((comment) => (
                    <div key={comment.id} className="review-comment">
                      <div className="comment-meta">
                        <User size={12} />
                        <span className="comment-author">{comment.author}</span>
                        <span className="comment-time">
                          {new Date(comment.timestamp).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <div className="comment-text">{comment.text}</div>
                    </div>
                  ))
                ) : (
                  <div className="review-thread-empty">No messages yet.</div>
                )}
              </div>

              <div className="comment-input-area">
                <textarea
                  aria-label="Review message"
                  placeholder="Write a review message..."
                  value={commentTexts[chat.id] || ""}
                  onChange={(e) =>
                    setCommentTexts((prev) => ({ ...prev, [chat.id]: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submitComment(chat.id);
                    }
                  }}
                />
                <button
                  type="button"
                  className="comment-send-button"
                  onClick={() => submitComment(chat.id)}
                  disabled={!commentTexts[chat.id]?.trim()}
                  title="Send review message"
                  aria-label="Send review message"
                >
                  <Send size={13} />
                </button>
              </div>

              <div className="review-chat-footer">
                {chat.insertedInTex ? (
                  <span
                    className="review-chat-in-tex"
                    title="This thread is in the TeX source"
                  >
                    <Check size={13} />
                    <span>In TeX source</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="sidebar-primary-action review-insert-button"
                    onClick={() => onInsertIntoTex(chat)}
                    disabled={chat.comments.length === 0}
                    title={
                      chat.comments.length === 0
                        ? "Write a message first, then insert the thread into the TeX source"
                        : "Insert this review thread into the TeX source"
                    }
                  >
                    <FilePlus2 size={13} />
                    <span>Insert into TeX</span>
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
