import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReviewSidebar } from "./ReviewSidebar";
import type { ReviewChat } from "../types";

const chat: ReviewChat = {
  id: "chat-1",
  filePath: "main.tex",
  selection: {
    startLine: 4,
    startColumn: 1,
    endLine: 4,
    endColumn: 18,
    text: "Needs a clearer claim",
  },
  comments: [
    {
      id: "comment-1",
      author: "Reviewer",
      text: "Please justify this statement.",
      timestamp: Date.UTC(2026, 0, 1, 8, 30),
    },
  ],
};

describe("ReviewSidebar", () => {
  it("shows an empty review state and starts a new thread", () => {
    const onAddChat = vi.fn();
    render(
      <ReviewSidebar
        chats={[]}
        onAddChat={onAddChat}
        onAddComment={vi.fn()}
        onDeleteChat={vi.fn()}
        onJumpToSelection={vi.fn()}
        onInsertIntoTex={vi.fn()}
      />,
    );

    expect(screen.getByText(/No review threads yet/i)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /new review thread/i }));
    expect(onAddChat).toHaveBeenCalledTimes(1);
  });

  it("adds comments on Enter, jumps to selected source, and deletes threads", () => {
    const onAddComment = vi.fn();
    const onDeleteChat = vi.fn();
    const onJumpToSelection = vi.fn();

    render(
      <ReviewSidebar
        chats={[chat]}
        onAddChat={vi.fn()}
        onAddComment={onAddComment}
        onDeleteChat={onDeleteChat}
        onJumpToSelection={onJumpToSelection}
        onInsertIntoTex={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText(/Needs a clearer claim/i));
    expect(onJumpToSelection).toHaveBeenCalledWith(chat);

    const textarea = screen.getByPlaceholderText(/write a review message/i);
    fireEvent.change(textarea, { target: { value: "Add a citation here." } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    expect(onAddComment).toHaveBeenCalledWith("chat-1", "Add a citation here.");
    expect(textarea).toHaveValue("");

    fireEvent.click(screen.getByTitle("Delete review chat"));
    expect(onDeleteChat).toHaveBeenCalledWith("chat-1");
  });

  it("inserts a thread into the TeX source from the panel", () => {
    const onInsertIntoTex = vi.fn();

    render(
      <ReviewSidebar
        chats={[chat]}
        onAddChat={vi.fn()}
        onAddComment={vi.fn()}
        onDeleteChat={vi.fn()}
        onJumpToSelection={vi.fn()}
        onInsertIntoTex={onInsertIntoTex}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /insert into tex/i }));
    expect(onInsertIntoTex).toHaveBeenCalledWith(chat);
  });

  it("disables insertion until the thread has a message and shows the inserted state", () => {
    const onInsertIntoTex = vi.fn();
    const emptyChat: ReviewChat = { ...chat, id: "chat-2", comments: [] };
    const insertedChat: ReviewChat = { ...chat, id: "chat-3", insertedInTex: true };

    render(
      <ReviewSidebar
        chats={[emptyChat, insertedChat]}
        onAddChat={vi.fn()}
        onAddComment={vi.fn()}
        onDeleteChat={vi.fn()}
        onJumpToSelection={vi.fn()}
        onInsertIntoTex={onInsertIntoTex}
      />,
    );

    const insertButton = screen.getByRole("button", { name: /insert into tex/i });
    expect(insertButton).toBeDisabled();
    fireEvent.click(insertButton);
    expect(onInsertIntoTex).not.toHaveBeenCalled();

    expect(screen.getByText(/in tex source/i)).toBeVisible();
  });
});
