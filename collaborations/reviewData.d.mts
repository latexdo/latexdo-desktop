export interface ReviewThread {
  id: string;
  comments: { id: string; timestamp: number; [key: string]: unknown }[];
  [key: string]: unknown;
}
export function isReviewDataPath(path: string): boolean;
export function mergeReviewData<
  T extends {
    chats?: { id: string; comments: { id: string; timestamp: number }[] }[];
    deletedChatIds?: string[];
  },
>(saved: T, incoming: T): T & { deletedChatIds: string[] };
export function mergeReviewContent(saved: string, incoming: string): string;
