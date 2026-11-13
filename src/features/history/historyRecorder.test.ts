import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryChange } from "../../types";
import { HistoryRecorder, HistoryUploader } from "./historyRecorder";

describe("HistoryRecorder", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function recorder() {
    const changes: HistoryChange[] = [];
    let clock = 1000;
    const rec = new HistoryRecorder({
      path: "main.tex",
      onChange: (change) => changes.push(change),
      now: () => clock,
    });
    return { rec, changes, tick: (ms: number) => (clock += ms) };
  }

  it("groups typing into one change that ends after a pause", () => {
    const { rec, changes, tick } = recorder();
    rec.record({ kind: "local", before: "Intro\nEnd", after: "Intro\nA\nEnd" });
    tick(500);
    rec.record({ kind: "local", before: "Intro\nA\nEnd", after: "Intro\nAB\nEnd" });
    expect(changes).toEqual([]);
    vi.advanceTimersByTime(30_000);
    expect(changes).toEqual([
      {
        path: "main.tex",
        startedAt: 1000,
        endedAt: 1500,
        added: 1,
        removed: 0,
        hunks: [{ oldStart: 1, newStart: 1, lines: [" Intro", "+AB", " End"] }],
      },
    ]);
  });

  it("closes my change before someone else's edit so it holds only mine", () => {
    const { rec, changes } = recorder();
    rec.record({ kind: "local", before: "a\nb", after: "a!\nb" });
    // Their edit to line 2 arrives: my change ends on the text before it.
    rec.record({ kind: "remote", before: "a!\nb", after: "a!\nb?" });
    expect(changes).toHaveLength(1);
    expect(changes[0]!.hunks[0]!.lines).toEqual(["-a", "+a!", " b"]);
    // Their edit alone records nothing here; their own app records it.
    rec.record({ kind: "remote", before: "a!\nb?", after: "a!\nb??" });
    vi.advanceTimersByTime(60_000);
    expect(changes).toHaveLength(1);
  });

  it("ends long sessions, skips edits that cancel out and flushes on close", () => {
    const { rec, changes } = recorder();
    rec.record({ kind: "local", before: "x", after: "xy" });
    for (let step = 0; step < 20; step += 1) {
      vi.advanceTimersByTime(20_000);
      rec.record({ kind: "local", before: "xy", after: "xy" });
    }
    expect(changes).toHaveLength(1);
    rec.record({ kind: "local", before: "xy", after: "xyz" });
    rec.record({ kind: "local", before: "xyz", after: "xy" });
    vi.advanceTimersByTime(30_000);
    expect(changes).toHaveLength(1);
    rec.record({ kind: "local", before: "xy", after: "xy\nlast" });
    rec.dispose();
    expect(changes).toHaveLength(2);
  });
});

describe("HistoryUploader", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const change = (path: string): HistoryChange => ({
    path,
    startedAt: 1,
    endedAt: 2,
    added: 1,
    removed: 0,
    hunks: [],
  });

  it("sends at most about once a minute and keeps failed batches", async () => {
    const send = vi.fn(async () => {});
    const uploader = new HistoryUploader(send);
    uploader.add(change("a.tex"));
    uploader.add(change("b.tex"));
    await vi.advanceTimersByTimeAsync(59_000);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(send).toHaveBeenCalledWith([change("a.tex"), change("b.tex")]);

    send.mockRejectedValueOnce(new Error("offline"));
    uploader.add(change("c.tex"));
    await uploader.flush();
    expect(uploader.pending).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenLastCalledWith([change("c.tex")]);
    expect(uploader.pending).toBe(0);
  });
});
