import { beforeEach, describe, expect, it } from "vitest";
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
