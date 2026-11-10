import { expect, it } from "vitest";
import { mergeReviewData, isReviewDataPath } from "./reviewData.mjs";
it("merges stale snapshots without losing another reviewer or reply", () => {
  const chat = { id: "one", comments: [{ id: "a", timestamp: 1, text: "Initial" }] };
  const saved = {
    chats: [
      {
        ...chat,
        comments: [...chat.comments, { id: "b", timestamp: 2, text: "Reply" }],
      },
      { id: "two", comments: [] },
    ],
  };
  const incoming = {
    chats: [
      {
        ...chat,
        comments: [...chat.comments, { id: "c", timestamp: 3, text: "Another reply" }],
      },
    ],
  };
  const merged = mergeReviewData(saved, incoming);
  expect(merged.chats[0].comments.map((c) => c.id)).toEqual(["a", "b", "c"]);
  expect(merged.chats).toHaveLength(2);
  expect(mergeReviewData(merged, incoming)).toEqual(merged);
  const deleted = mergeReviewData(merged, { deletedChatIds: ["one"] });
  expect(mergeReviewData(deleted, incoming).chats.map((c) => c.id)).toEqual(["two"]);
});
it("recognizes review files in research-space subfolders", () => {
  expect(isReviewDataPath("paper/.latexdo/review_data.json")).toBe(true);
  expect(isReviewDataPath("main.tex")).toBe(false);
});
