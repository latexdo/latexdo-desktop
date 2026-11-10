// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { readReviewDocument, writeReviewDocument } from "./reviewDocument.js";
const thread = {
  id: "review",
  filePath: "main.tex",
  comments: [{ id: "initial", author: "Bob", text: "Explain this", timestamp: 1 }],
};
const snapshot = { chats: [thread], items: [] };
function read(doc: Y.Doc) {
  return JSON.parse(readReviewDocument(doc));
}
describe("shared review document", () => {
  it("keeps simultaneous replies and new threads after syncing in either direction", () => {
    const a = new Y.Doc();
    writeReviewDocument(a, JSON.stringify(snapshot));
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    writeReviewDocument(
      a,
      JSON.stringify({
        ...snapshot,
        chats: [
          {
            ...thread,
            comments: [...thread.comments, { id: "a", text: "Reply A", timestamp: 2 }],
          },
        ],
      }),
    );
    writeReviewDocument(
      b,
      JSON.stringify({
        ...snapshot,
        chats: [
          {
            ...thread,
            comments: [...thread.comments, { id: "b", text: "Reply B", timestamp: 2 }],
          },
          { id: "new", comments: [] },
        ],
      }),
    );
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(read(a)).toEqual(read(b));
    expect(
      read(a)
        .chats.find((c: { id: string }) => c.id === "review")
        .comments.map((c: { id: string }) => c.id),
    ).toEqual(["initial", "a", "b"]);
    expect(read(a).chats).toHaveLength(2);
    a.destroy();
    b.destroy();
  });
  it("reads legacy reviews and keeps deletions when stale clients reply", () => {
    const a = new Y.Doc();
    a.getText("content").insert(0, JSON.stringify(snapshot));
    expect(read(a).chats).toEqual(snapshot.chats);
    writeReviewDocument(a, JSON.stringify({ chats: [], deletedChatIds: ["review"] }));
    writeReviewDocument(a, JSON.stringify(snapshot));
    expect(read(a).chats).toEqual([]);
    a.destroy();
  });
});
