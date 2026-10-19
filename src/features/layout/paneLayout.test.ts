import type { PointerEvent as ReactPointerEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SPLIT_PERCENT,
  MIN_PREVIEW_WIDTH,
  MIN_SIDEBAR_WIDTH,
  MIN_SOURCE_WIDTH,
  SPLIT_HANDLE_WIDTH,
  clampSidebarWidth,
  loadPaneLayout,
  savePaneLayout,
  splitPercentAt,
  startPaneDrag,
} from "./paneLayout";

describe("pane layout", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("follows the pointer between the source and preview minimums", () => {
    expect(splitPercentAt(600, 100, 1000)).toBe(50);
    expect(splitPercentAt(0, 100, 1000)).toBe((MIN_SOURCE_WIDTH / 1000) * 100);
    expect(splitPercentAt(5000, 100, 1000)).toBe(
      ((1000 - MIN_PREVIEW_WIDTH - SPLIT_HANDLE_WIDTH) / 1000) * 100,
    );
  });

  it("stays movable in a narrow main area next to a wide sidebar", () => {
    // 712px is what a 1280px window leaves beside the expanded AI sidebar.
    const low = splitPercentAt(0, 0, 712);
    const high = splitPercentAt(712, 0, 712);
    expect(((high - low) / 100) * 712).toBeGreaterThan(300);
  });

  it("falls back to the default split for an unmeasured container", () => {
    expect(splitPercentAt(200, 0, 0)).toBe(DEFAULT_SPLIT_PERCENT);
  });

  it("keeps the sidebar usable and leaves room for the editor", () => {
    expect(clampSidebarWidth(10, 1400)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(2000, 1400)).toBe(760);
    expect(clampSidebarWidth(2000, 900)).toBe(900 - 48 - 320);
  });

  it("round-trips saved widths and ignores corrupt storage", () => {
    savePaneLayout({ splitPercent: 40, sidebarWidths: { explorer: 300 } });
    expect(loadPaneLayout()).toEqual({
      splitPercent: 40,
      sidebarWidths: { explorer: 300 },
    });
    window.localStorage.setItem("latexdo.paneLayout.v1", "{not json");
    expect(loadPaneLayout()).toEqual({
      splitPercent: DEFAULT_SPLIT_PERCENT,
      sidebarWidths: {},
    });
  });
});

describe("loadPaneLayout sanitising", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("uses defaults for missing, non-object and invalid stored values", () => {
    const fallback = { splitPercent: DEFAULT_SPLIT_PERCENT, sidebarWidths: {} };
    expect(loadPaneLayout()).toEqual(fallback);
    window.localStorage.setItem("latexdo.paneLayout.v1", "7");
    expect(loadPaneLayout()).toEqual(fallback);
    window.localStorage.setItem(
      "latexdo.paneLayout.v1",
      JSON.stringify({ splitPercent: "40", sidebarWidths: "wide" }),
    );
    expect(loadPaneLayout()).toEqual(fallback);
  });

  it("clamps stored values and drops non-numeric widths", () => {
    window.localStorage.setItem(
      "latexdo.paneLayout.v1",
      JSON.stringify({
        splitPercent: 120,
        sidebarWidths: { a: 1, b: 99999, c: "x", d: null },
      }),
    );
    const layout = loadPaneLayout();
    expect(layout.splitPercent).toBe(95);
    expect(layout.sidebarWidths.a).toBe(MIN_SIDEBAR_WIDTH);
    expect(layout.sidebarWidths.b).toBeGreaterThan(MIN_SIDEBAR_WIDTH);
    expect(Object.keys(layout.sidebarWidths)).toEqual(["a", "b"]);
  });

  it("survives storage that cannot be written", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    try {
      expect(() =>
        savePaneLayout({ splitPercent: 30, sidebarWidths: {} }),
      ).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("startPaneDrag", () => {
  function pointerDown(
    handle: HTMLElement,
    init: { button?: number; pointerType?: string } = {},
  ) {
    const preventDefault = vi.fn();
    const event = {
      button: init.button ?? 0,
      pointerType: init.pointerType ?? "mouse",
      pointerId: 7,
      currentTarget: handle,
      preventDefault,
    } as unknown as ReactPointerEvent<HTMLElement>;
    return { event, preventDefault };
  }

  it("ignores secondary mouse buttons", () => {
    const handle = document.createElement("div");
    const onMove = vi.fn();
    const { event, preventDefault } = pointerDown(handle, { button: 2 });
    startPaneDrag(event, onMove);
    expect(preventDefault).not.toHaveBeenCalled();
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 5 }));
    expect(onMove).not.toHaveBeenCalled();
  });

  it("tracks the pointer and cleans up when the drag ends", () => {
    const handle = document.createElement("div");
    const capture = vi.fn();
    const release = vi.fn();
    Object.assign(handle, { setPointerCapture: capture, releasePointerCapture: release });
    const onMove = vi.fn();
    const onEnd = vi.fn();
    const { event, preventDefault } = pointerDown(handle, { button: 1, pointerType: "touch" });
    startPaneDrag(event, onMove, onEnd);
    expect(preventDefault).toHaveBeenCalled();
    expect(capture).toHaveBeenCalledWith(7);
    expect(handle.classList.contains("dragging")).toBe(true);
    expect(document.body.classList.contains("pane-resizing")).toBe(true);

    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 120 }));
    expect(onMove).toHaveBeenCalledWith(120);

    window.dispatchEvent(new Event("pointerup"));
    expect(release).toHaveBeenCalledWith(7);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(handle.classList.contains("dragging")).toBe(false);
    expect(document.body.classList.contains("pane-resizing")).toBe(false);

    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 200 }));
    window.dispatchEvent(new Event("blur"));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("keeps dragging when pointer capture is unavailable or throws", () => {
    const handle = document.createElement("div");
    Object.assign(handle, {
      setPointerCapture: () => {
        throw new Error("no capture");
      },
      releasePointerCapture: () => {
        throw new Error("already released");
      },
    });
    const onMove = vi.fn();
    startPaneDrag(pointerDown(handle).event, onMove);
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 40 }));
    expect(onMove).toHaveBeenCalledWith(40);
    window.dispatchEvent(new Event("pointercancel"));
    expect(handle.classList.contains("dragging")).toBe(false);

    const plain = document.createElement("div");
    Object.assign(plain, { setPointerCapture: undefined, releasePointerCapture: undefined });
    startPaneDrag(pointerDown(plain).event, onMove);
    window.dispatchEvent(new Event("blur"));
    expect(plain.classList.contains("dragging")).toBe(false);
  });
});
