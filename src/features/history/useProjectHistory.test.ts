import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectHistoryEntry, ProjectHistoryPage } from "../../types";
import { useProjectHistory } from "./useProjectHistory";

function entry(seq: number): ProjectHistoryEntry {
  return {
    seq,
    at: seq * 1000,
    from: "alice",
    change: {
      path: "main.tex",
      startedAt: seq * 1000,
      endedAt: seq * 1000,
      added: 1,
      removed: 0,
      hunks: [{ oldStart: 1, newStart: 1, lines: ["+Hello"] }],
    },
  };
}

const getProjectHistory =
  vi.fn<
    (project: string, options?: { before: number }) => Promise<ProjectHistoryPage>
  >();

describe("useProjectHistory", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getProjectHistory.mockReset();
    getProjectHistory.mockResolvedValue({ entries: [], cursor: null, hasMore: false });
    vi.stubGlobal("latexdo", { getProjectHistory });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("merges refreshed and older pages without duplicates or losing the older cursor", async () => {
    const { result } = renderHook(() =>
      useProjectHistory({ projectId: "project", visible: false }),
    );
    await act(() => result.current.loadOlder());
    expect(getProjectHistory).not.toHaveBeenCalled();

    getProjectHistory.mockResolvedValueOnce({
      entries: [entry(3), entry(2)],
      cursor: 2,
      hasMore: true,
    });
    await act(() => result.current.refresh());
    expect(result.current.hasMore).toBe(true);

    const updated = { ...entry(3), from: "bob" };
    getProjectHistory.mockResolvedValueOnce({
      entries: [entry(4), updated],
      cursor: 3,
      hasMore: false,
    });
    await act(() => result.current.refresh());
    expect(result.current.hasMore).toBe(true);
    expect(result.current.entries).toEqual([entry(4), updated, entry(2)]);

    getProjectHistory.mockResolvedValueOnce({
      entries: [entry(2), entry(1)],
      cursor: null,
      hasMore: false,
    });
    await act(() => result.current.loadOlder());
    expect(getProjectHistory).toHaveBeenLastCalledWith("project", { before: 2 });
    expect(result.current.entries).toEqual([entry(4), updated, entry(2), entry(1)]);
    expect(result.current).toMatchObject({
      loading: false,
      hasMore: false,
      error: null,
    });
  });

  it("polls only while visible and stops on unmount", async () => {
    const { rerender, unmount } = renderHook(useProjectHistory, {
      initialProps: { projectId: "project", visible: false },
    });
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(getProjectHistory).not.toHaveBeenCalled();
    await act(async () => rerender({ projectId: "project", visible: true }));
    expect(getProjectHistory).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(getProjectHistory).toHaveBeenCalledTimes(2);
    rerender({ projectId: "project", visible: false });
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(getProjectHistory).toHaveBeenCalledTimes(2);
    await act(async () => rerender({ projectId: "project", visible: true }));
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(getProjectHistory).toHaveBeenCalledTimes(3);
  });

  it.each([new Error("Offline"), "unavailable"])(
    "reports refresh and pagination failures (%s) and allows retry",
    async (failure) => {
      const { result } = renderHook(() =>
        useProjectHistory({ projectId: "project", visible: false }),
      );
      const message =
        failure instanceof Error ? failure.message : "Could not load the history.";
      getProjectHistory.mockRejectedValueOnce(failure);
      await act(() => result.current.refresh());
      expect(result.current).toMatchObject({ error: message, loading: false });
      getProjectHistory.mockResolvedValueOnce({
        entries: [entry(2)],
        cursor: 2,
        hasMore: true,
      });
      await act(() => result.current.refresh());
      expect(result.current.error).toBeNull();
      getProjectHistory.mockRejectedValueOnce(failure);
      await act(() => result.current.loadOlder());
      expect(result.current).toMatchObject({
        entries: [entry(2)],
        error: message,
        loading: false,
        hasMore: true,
      });
      await act(() => result.current.refresh());
      expect(result.current.error).toBeNull();
    },
  );

  it.each(["refresh", "loadOlder"] as const)(
    "discards a pending %s response after switching projects",
    async (action) => {
      const { result, rerender } = renderHook(useProjectHistory, {
        initialProps: { projectId: "first" as string | null, visible: false },
      });
      getProjectHistory.mockResolvedValueOnce({
        entries: [entry(2)],
        cursor: 2,
        hasMore: true,
      });
      await act(() => result.current.refresh());
      let resolve!: (page: ProjectHistoryPage) => void;
      getProjectHistory.mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      );
      let pending!: Promise<void>;
      act(() => {
        pending = result.current[action]();
      });
      expect(result.current.loading).toBe(true);
      rerender({ projectId: "second", visible: false });
      expect(result.current).toMatchObject({
        entries: [],
        hasMore: false,
        error: null,
      });
      await act(async () => {
        resolve({ entries: [entry(1)], cursor: 1, hasMore: true });
        await pending;
      });
      expect(result.current.entries).toEqual([]);
      await act(() => result.current.refresh());
      expect(getProjectHistory).toHaveBeenLastCalledWith("second");
      rerender({ projectId: null, visible: true });
      getProjectHistory.mockClear();
      await act(() => result.current.refresh());
      await act(() => result.current.loadOlder());
      expect(getProjectHistory).not.toHaveBeenCalled();
    },
  );
});
