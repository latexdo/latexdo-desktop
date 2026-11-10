import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  idleAfterMs,
  presenceDescription,
  presenceLabels,
  presenceState,
  useAttention,
} from "./presence";

describe("presence states", () => {
  it("tells active, away and offline apart", () => {
    expect(presenceState(undefined)).toBe("offline");
    expect(presenceState(null)).toBe("offline");
    // Older servers do not send the flag: being listed means active.
    expect(presenceState({})).toBe("active");
    expect(presenceState({ active: true })).toBe("active");
    expect(presenceState({ active: false })).toBe("away");
    expect(presenceLabels.away).toBe("Away");
  });

  it("describes each state", () => {
    expect(presenceDescription("active", "chapters/intro.tex")).toBe(
      "Active now · in intro.tex",
    );
    expect(presenceDescription("active", null)).toBe("Active now");
    expect(presenceDescription("away", "main.tex")).toBe(
      "Away · LatexDo is open but not in use",
    );
    expect(presenceDescription("offline")).toBe("Offline");
  });
});

describe("useAttention", () => {
  let focused = true;
  let visibility: DocumentVisibilityState = "visible";

  beforeEach(() => {
    vi.useFakeTimers();
    focused = true;
    visibility = "visible";
    vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("goes away a moment after LatexDo leaves the front, and comes back at once", () => {
    const { result } = renderHook(() => useAttention());
    expect(result.current).toBe(true);

    focused = false;
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toBe(false);

    focused = true;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(result.current).toBe(true);
  });

  it("ignores a quick switch to another window", () => {
    const { result } = renderHook(() => useAttention());
    focused = false;
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    focused = true;
    act(() => {
      vi.advanceTimersByTime(500);
      window.dispatchEvent(new Event("focus"));
      vi.advanceTimersByTime(2000);
    });
    expect(result.current).toBe(true);
  });

  it("is away while the window is hidden", () => {
    const { result } = renderHook(() => useAttention());
    visibility = "hidden";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(2000);
    });
    expect(result.current).toBe(false);
  });

  it("is away after a while without input, and back on the next one", () => {
    const { result, unmount } = renderHook(() => useAttention());
    act(() => {
      window.dispatchEvent(new Event("keydown"));
      vi.advanceTimersByTime(idleAfterMs - 20_000);
    });
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(40_000));
    expect(result.current).toBe(false);

    act(() => {
      window.dispatchEvent(new Event("pointermove"));
    });
    expect(result.current).toBe(true);

    // Input while already here changes nothing.
    act(() => {
      window.dispatchEvent(new Event("wheel"));
    });
    expect(result.current).toBe(true);
    unmount();
  });

  it("stops listening when unmounted, even with a pending change", () => {
    const { result, unmount } = renderHook(() => useAttention());
    focused = false;
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    unmount();
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current).toBe(true);
  });
});
