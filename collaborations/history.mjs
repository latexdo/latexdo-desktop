/*
 * The change history of a shared project: who changed which file, and when.
 * Each person's app records its own edits as small diffs and sends them here
 * sealed (end-to-end encrypted), so the server only knows the author, the
 * time and the size. It keeps the most recent changes within a size budget.
 *
 * Both servers use these rules; each stores the entries its own way.
 */

export const historyLimits = Object.freeze({
  /** One sealed change (a diff with some context, encrypted). */
  maxEntryChars: 96 * 1024,
  /** Changes one request may add. */
  maxEntriesPerPost: 50,
  /** Older changes are dropped past this many… */
  maxEntries: 5000,
  /** …or past this much stored, per project. */
  maxTotalChars: 10 * 1024 * 1024,
  pageSize: 50,
  maxPageSize: 200,
});

export class HistoryError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** The sealed changes in a request body, validated. */
export function historyEntriesFrom(body) {
  const entries = body && typeof body === "object" ? body.entries : undefined;
  if (!Array.isArray(entries) || !entries.length) {
    throw new HistoryError(400, "No changes to record.");
  }
  if (entries.length > historyLimits.maxEntriesPerPost) {
    throw new HistoryError(413, "Too many changes at once.");
  }
  return entries.map((entry) => {
    const data = entry && typeof entry === "object" ? entry.data : undefined;
    if (typeof data !== "string" || !data) {
      throw new HistoryError(400, "Invalid change.");
    }
    if (data.length > historyLimits.maxEntryChars) {
      throw new HistoryError(413, "This change is too large to record.");
    }
    return data;
  });
}

/** A page size from a query string value. */
export function historyPageSize(value) {
  const size = Number(value);
  return Number.isSafeInteger(size) && size > 0
    ? Math.min(size, historyLimits.maxPageSize)
    : historyLimits.pageSize;
}

/** An in-memory history (the Node server keeps it as one JSON file). */
export function emptyHistory() {
  return { schemaVersion: 1, seq: 0, entries: [] };
}

export function normalizeHistory(raw) {
  if (!raw || typeof raw !== "object" || raw.schemaVersion !== 1) return emptyHistory();
  const entries = Array.isArray(raw.entries)
    ? raw.entries.filter(
        (entry) =>
          entry &&
          Number.isSafeInteger(entry.seq) &&
          Number.isSafeInteger(entry.at) &&
          typeof entry.from === "string" &&
          typeof entry.data === "string",
      )
    : [];
  const last = entries.at(-1)?.seq ?? 0;
  return {
    schemaVersion: 1,
    seq: Number.isSafeInteger(raw.seq) ? Math.max(raw.seq, last) : last,
    entries,
  };
}

/** Adds one person's changes, newest last, and drops the oldest past the budget. */
export function appendHistory(state, { from, data, now }) {
  const added = data.map((item) => ({ seq: ++state.seq, at: now, from, data: item }));
  state.entries.push(...added);
  const total = state.entries.reduce((sum, entry) => sum + entry.data.length, 0);
  let drop = Math.max(0, state.entries.length - historyLimits.maxEntries);
  let dropped = 0;
  for (let index = 0; index < drop; index += 1)
    dropped += state.entries[index].data.length;
  while (drop < state.entries.length && total - dropped > historyLimits.maxTotalChars) {
    dropped += state.entries[drop].data.length;
    drop += 1;
  }
  if (drop) state.entries.splice(0, drop);
  return added;
}

/** Newest first, a page at a time: `before` is the oldest seq already shown. */
export function listHistory(state, { before, limit } = {}) {
  const size = historyPageSize(limit);
  const beforeSeq = Number(before);
  const older =
    Number.isSafeInteger(beforeSeq) && beforeSeq > 0
      ? state.entries.filter((entry) => entry.seq < beforeSeq)
      : state.entries;
  const page = older.slice(-size).reverse();
  return { entries: page, hasMore: older.length > size };
}
