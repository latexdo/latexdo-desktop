import type { RebuttalItem, ReviewChat } from "../../types";

const legacyReviewPlaceholderText = "Add your comment here...";

export function removeLegacyReviewPlaceholders(chats: ReviewChat[]): {
  chats: ReviewChat[];
  changed: boolean;
} {
  let changed = false;
  const cleaned = chats.map((chat) => {
    const comments = chat.comments.filter((comment) => {
      const keep =
        comment.text.trim() !== legacyReviewPlaceholderText ||
        comment.author !== "Reviewer";
      if (!keep) {
        changed = true;
      }
      return keep;
    });
    return comments.length === chat.comments.length ? chat : { ...chat, comments };
  });

  return { chats: cleaned, changed };
}

export function normalizeRebuttalItem(item: RebuttalItem): RebuttalItem {
  return {
    ...item,
    insertedInTex: Boolean(item.insertedInTex),
  };
}
