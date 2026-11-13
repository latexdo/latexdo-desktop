import { describe, expect, it } from "vitest";
import {
  appendHistory,
  emptyHistory,
  historyEntriesFrom,
  historyLimits,
  historyPageSize,
  listHistory,
  normalizeHistory,
} from "./history.mjs";

describe("change history rules", () => {
  it("validates what a request may record", () => {
    expect(historyEntriesFrom({ entries: [{ data: "sealed" }] })).toEqual(["sealed"]);
    expect(() => historyEntriesFrom({})).toThrow("No changes");
    expect(() => historyEntriesFrom({ entries: [] })).toThrow("No changes");
    expect(() => historyEntriesFrom({ entries: [{ data: 5 }] })).toThrow("Invalid");
    expect(() =>
      historyEntriesFrom({
        entries: [{ data: "x".repeat(historyLimits.maxEntryChars + 1) }],
      }),
    ).toThrow("too large");
    expect(() =>
      historyEntriesFrom({
        entries: Array.from({ length: historyLimits.maxEntriesPerPost + 1 }, () => ({
          data: "x",
        })),
      }),
    ).toThrow("Too many");
    expect(historyPageSize("7")).toBe(7);
    expect(historyPageSize("100000")).toBe(historyLimits.maxPageSize);
    expect(historyPageSize("nope")).toBe(historyLimits.pageSize);
  });

  it("stores changes with their author and time, newest first a page at a time", () => {
    const state = emptyHistory();
    appendHistory(state, { from: "ada", data: ["a", "b"], now: 10 });
    appendHistory(state, { from: "bob", data: ["c"], now: 20 });
    expect(listHistory(state, { limit: 2 })).toEqual({
      entries: [
        { seq: 3, at: 20, from: "bob", data: "c" },
        { seq: 2, at: 10, from: "ada", data: "b" },
      ],
      hasMore: true,
    });
    expect(listHistory(state, { before: 2 })).toEqual({
      entries: [{ seq: 1, at: 10, from: "ada", data: "a" }],
      hasMore: false,
    });
    expect(normalizeHistory(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(normalizeHistory({ schemaVersion: 2 })).toEqual(emptyHistory());
  });

  it("keeps only the newest changes within the budget", () => {
    const state = emptyHistory();
    const big = "x".repeat(historyLimits.maxEntryChars);
    const fits = Math.floor(historyLimits.maxTotalChars / big.length);
    for (let index = 0; index < fits + 3; index += 1) {
      appendHistory(state, { from: "ada", data: [big], now: index });
    }
    expect(state.entries).toHaveLength(fits);
    expect(state.entries[0].seq).toBe(4);
    expect(state.seq).toBe(fits + 3);
  });
});
