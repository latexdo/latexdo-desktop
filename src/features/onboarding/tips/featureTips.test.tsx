import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markFeatureDiscovery } from "../core/DiscoveryStore";
import { emitProductEvent } from "../core/ProductEvents";
import { FeatureTipCard } from "./FeatureTipCard";
import {
  featureTips,
  loadTipsState,
  nextTip,
  recordTipDone,
  recordTipShown,
  saveTipsState,
  tipPacing,
  type TipsState,
} from "./featureTips";
import { tipTickMs, useFeatureTips } from "./useFeatureTips";

const day = 24 * 60 * 60 * 1000;
const start = Date.UTC(2026, 10, 1);
const [aiTip, jumpTip] = featureTips;

function seasoned(overrides: Partial<TipsState> = {}): TipsState {
  return {
    firstSeenAt: start,
    activeMs: tipPacing.minActiveMs,
    lastTipAt: null,
    tips: {},
    ...overrides,
  };
}

const nothingUsed = () => false;

describe("when a tip may appear", () => {
  it("waits for a day and some real use", () => {
    expect(nextTip(seasoned(), start + day - 1, nothingUsed)).toBeNull();
    expect(
      nextTip(
        seasoned({ activeMs: tipPacing.minActiveMs - 1 }),
        start + 2 * day,
        nothingUsed,
      ),
    ).toBeNull();
    expect(nextTip(seasoned(), start + day, nothingUsed)?.id).toBe("ai-choice");
  });

  it("skips features already used and spaces tips days apart", () => {
    const now = start + 10 * day;
    expect(nextTip(seasoned(), now, (id) => id === aiTip!.featureId)?.id).toBe(
      jumpTip!.id,
    );
    const shown = recordTipShown(seasoned(), aiTip!, now);
    expect(nextTip(shown, now + tipPacing.gapMs - 1, nothingUsed)).toBeNull();
    // Three days later: the next tip, not the same one again.
    expect(nextTip(shown, now + tipPacing.gapMs, nothingUsed)?.id).toBe(jumpTip!.id);
  });

  it("brings a postponed tip back once, much later, and never a followed one", () => {
    const now = start + 10 * day;
    const others = (id: string) => id !== aiTip!.featureId;
    let state = recordTipShown(seasoned(), aiTip!, now);
    expect(nextTip(state, now + tipPacing.retryMs - 1, others)).toBeNull();
    expect(nextTip(state, now + tipPacing.retryMs, others)?.id).toBe("ai-choice");
    state = recordTipShown(state, aiTip!, now + tipPacing.retryMs);
    expect(nextTip(state, now + 10 * tipPacing.retryMs, others)).toBeNull();
    const followed = recordTipDone(recordTipShown(seasoned(), aiTip!, now), aiTip!);
    expect(nextTip(followed, now + 10 * tipPacing.retryMs, others)).toBeNull();
  });

  it("keeps its progress across launches", () => {
    localStorage.clear();
    const fresh = loadTipsState(start);
    expect(fresh).toEqual({
      firstSeenAt: start,
      activeMs: 0,
      lastTipAt: null,
      tips: {},
    });
    saveTipsState({ ...fresh, activeMs: 5 });
    expect(loadTipsState(start + day).activeMs).toBe(5);
  });
});

describe("offering tips in the app", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(start + 3 * day);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    saveTipsState(seasoned());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  function setup(inUse: Record<string, boolean> = {}) {
    const onAction = vi.fn();
    const onTurnOff = vi.fn();
    const hook = renderHook(
      (props: { enabled: boolean; inUse: Record<string, boolean> }) =>
        useFeatureTips({ ...props, onAction, onTurnOff }),
      { initialProps: { enabled: true, inUse } },
    );
    return { ...hook, onAction, onTurnOff };
  }

  it("shows a tip at a quiet moment and follows its action", async () => {
    const { result, onAction } = setup();
    expect(result.current.tip).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(tipTickMs));
    expect(result.current.tip?.id).toBe("ai-choice");
    act(() => result.current.accept());
    expect(onAction).toHaveBeenCalledWith("open-ai-settings");
    expect(result.current.tip).toBeNull();
    expect(loadTipsState().tips["ai-choice"]?.done).toBe(true);
  });

  it("does not interrupt typing or a dialog", async () => {
    const { result } = setup();
    await act(() => vi.advanceTimersByTimeAsync(tipTickMs - 5_000));
    fireEvent.keyDown(window, { key: "a" });
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(result.current.tip).toBeNull();

    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
    await act(() => vi.advanceTimersByTimeAsync(tipTickMs));
    expect(result.current.tip).toBeNull();
    dialog.remove();
    await act(() => vi.advanceTimersByTimeAsync(tipTickMs));
    expect(result.current.tip?.id).toBe("ai-choice");
  });

  it("skips what is already in use and what was just discovered", async () => {
    const { result } = setup({ "ai.provider-choice": true });
    await act(() => vi.advanceTimersByTimeAsync(tipTickMs));
    expect(result.current.tip?.id).toBe("pdf-source-jump");
    // Doing the very thing the tip suggests closes it for good.
    act(() => emitProductEvent({ type: "synctex:navigated" }));
    expect(result.current.tip).toBeNull();
    expect(loadTipsState().tips["pdf-source-jump"]?.done).toBe(true);
  });

  it("stays quiet when turned off or in a quieter notification mode", async () => {
    markFeatureDiscovery("ai.provider-choice", "unseen");
    localStorage.setItem("latexdo.notificationMode", "writing");
    const { result, rerender } = setup();
    await act(() => vi.advanceTimersByTimeAsync(tipTickMs));
    expect(result.current.tip).toBeNull();
    localStorage.removeItem("latexdo.notificationMode");
    rerender({ enabled: false, inUse: {} });
    await act(() => vi.advanceTimersByTimeAsync(5 * tipTickMs));
    expect(result.current.tip).toBeNull();
  });
});

describe("FeatureTipCard", () => {
  it("offers the action, a later option and a way to turn tips off", () => {
    const props = { onAccept: vi.fn(), onLater: vi.fn(), onTurnOff: vi.fn() };
    const view = render(<FeatureTipCard tip={aiTip!} {...props} />);
    expect(screen.getByText("Did you know?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Choose my AI" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    fireEvent.click(screen.getByRole("button", { name: "Turn off tips" }));
    expect(props.onAccept).toHaveBeenCalled();
    expect(props.onLater).toHaveBeenCalled();
    expect(props.onTurnOff).toHaveBeenCalled();

    view.rerender(<FeatureTipCard tip={jumpTip!} {...props} />);
    expect(screen.getByRole("button", { name: "Got it" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Not now" })).toBeNull();
  });
});
