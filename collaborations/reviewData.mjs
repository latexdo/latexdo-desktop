// Review snapshots merge by stable thread/message IDs. Explicit tombstones keep
// a stale collaborator from resurrecting a deleted thread.
export function isReviewDataPath(path) {
  return path.replaceAll("\\", "/").endsWith(".latexdo/review_data.json");
}
export function mergeReviewData(saved, incoming) {
  const deletedChatIds = [
    ...new Set([...(saved.deletedChatIds ?? []), ...(incoming.deletedChatIds ?? [])]),
  ];
  const deleted = new Set(deletedChatIds);
  const chats = new Map((saved.chats ?? []).map((chat) => [chat.id, chat]));
  for (const chat of incoming.chats ?? []) {
    const previous = chats.get(chat.id);
    const comments = [
      ...new Map(
        [...(previous?.comments ?? []), ...chat.comments].map((comment) => [
          comment.id,
          comment,
        ]),
      ).values(),
    ].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
    chats.set(chat.id, { ...previous, ...chat, comments });
  }
  return {
    ...saved,
    ...incoming,
    chats: [...chats.values()].filter((chat) => !deleted.has(chat.id)),
    deletedChatIds,
  };
}
export function mergeReviewContent(saved, incoming) {
  return JSON.stringify(
    mergeReviewData(JSON.parse(saved || "{}"), JSON.parse(incoming)),
    null,
    2,
  );
}
