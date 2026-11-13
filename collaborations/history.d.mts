// Types for history.mjs, which both collaboration servers use.

export declare const historyLimits: Readonly<{
  maxEntryChars: number;
  maxEntriesPerPost: number;
  maxEntries: number;
  maxTotalChars: number;
  pageSize: number;
  maxPageSize: number;
}>;

export declare class HistoryError extends Error {
  constructor(status: number, message: string);
  readonly status: number;
}

export interface HistoryEntry {
  seq: number;
  /** When the server received it (ms). */
  at: number;
  /** The author's client id. */
  from: string;
  /** The sealed change. */
  data: string;
}

export interface HistoryState {
  schemaVersion: 1;
  seq: number;
  entries: HistoryEntry[];
}

export declare function historyEntriesFrom(body: unknown): string[];
export declare function historyPageSize(value: unknown): number;
export declare function emptyHistory(): HistoryState;
export declare function normalizeHistory(raw: unknown): HistoryState;
export declare function appendHistory(
  state: HistoryState,
  options: { from: string; data: string[]; now: number },
): HistoryEntry[];
export declare function listHistory(
  state: HistoryState,
  options?: { before?: unknown; limit?: unknown },
): { entries: HistoryEntry[]; hasMore: boolean };
