import * as Y from "yjs";
import { mergeReviewContent } from "../collaborations/reviewData.mjs";

interface ReviewSnapshot {
  chats?: { id: string; comments: { id: string; timestamp: number }[] }[];
  items?: unknown[];
  deletedChatIds?: string[];
}

/** Independent Y.Map entries prevent concurrent replies replacing one another. */
export function readReviewDocument(doc: Y.Doc): string {
  let content = doc.getText("content").toString() || "{}";
  const entries = doc.getMap<string>("review-entries");
  for (const fragment of entries.values())
    content = mergeReviewContent(content, fragment);
  return content;
}

export function writeReviewDocument(doc: Y.Doc, content: string): void {
  const snapshot = JSON.parse(content) as ReviewSnapshot;
  const entries = doc.getMap<string>("review-entries");
  const put = (key: string, value: unknown) => {
    const encoded = JSON.stringify(value);
    if (entries.get(key) !== encoded) entries.set(key, encoded);
  };
  doc.transact(() => {
    for (const chat of snapshot.chats ?? []) {
      put(`thread:${chat.id}`, { chats: [{ ...chat, comments: [] }] });
      for (const comment of chat.comments) {
        put(`comment:${chat.id}:${comment.id}`, {
          chats: [{ id: chat.id, comments: [comment] }],
        });
      }
    }
    for (const id of snapshot.deletedChatIds ?? [])
      put(`deleted:${id}`, { deletedChatIds: [id] });
    if (snapshot.items) put("items", { items: snapshot.items });
  }, "http");
}
