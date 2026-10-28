import type { PointerEvent as ReactPointerEvent } from "react";

const paneLayoutStorageKey = "latexdo.paneLayout.v1";

export const MIN_SOURCE_WIDTH = 180;
export const MIN_PREVIEW_WIDTH = 200;
export const SPLIT_HANDLE_WIDTH = 6;
export const DEFAULT_SPLIT_PERCENT = 52;
export const DEFAULT_PANEL_HEIGHT = 200;
export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 760;
/** Space the editor and preview keep no matter how wide a sidebar is dragged. */
const MIN_MAIN_AREA_WIDTH = 320;
const ACTIVITY_BAR_WIDTH = 48;

export interface PaneLayout {
  splitPercent: number;
  sidebarWidths: Record<string, number>;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function loadPaneLayout(): PaneLayout {
  const fallback: PaneLayout = {
    splitPercent: DEFAULT_SPLIT_PERCENT,
    sidebarWidths: {},
  };
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(paneLayoutStorageKey) ?? "null",
    );
    if (!parsed || typeof parsed !== "object") return fallback;
    const record = parsed as Partial<PaneLayout>;
    const sidebarWidths: Record<string, number> = {};
    if (record.sidebarWidths && typeof record.sidebarWidths === "object") {
      for (const [view, width] of Object.entries(record.sidebarWidths)) {
        if (typeof width === "number" && Number.isFinite(width)) {
          sidebarWidths[view] = clamp(width, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
        }
      }
    }
    return {
      splitPercent:
        typeof record.splitPercent === "number" && Number.isFinite(record.splitPercent)
          ? clamp(record.splitPercent, 5, 95)
          : fallback.splitPercent,
      sidebarWidths,
    };
  } catch {
    return fallback;
  }
}

export function savePaneLayout(layout: PaneLayout): void {
  try {
    window.localStorage.setItem(paneLayoutStorageKey, JSON.stringify(layout));
  } catch {
    // Layout persistence is best effort.
  }
}

export function clampSidebarWidth(width: number, viewportWidth: number): number {
  const max = Math.max(
    MIN_SIDEBAR_WIDTH,
    Math.min(
      MAX_SIDEBAR_WIDTH,
      viewportWidth - ACTIVITY_BAR_WIDTH - MIN_MAIN_AREA_WIDTH,
    ),
  );
  return Math.round(clamp(width, MIN_SIDEBAR_WIDTH, max));
}

/** Source-pane share of the split container for a pointer at `clientX`. */
export function splitPercentAt(
  clientX: number,
  containerLeft: number,
  containerWidth: number,
): number {
  if (containerWidth <= 0) return DEFAULT_SPLIT_PERCENT;
  const maxSourceWidth = containerWidth - MIN_PREVIEW_WIDTH - SPLIT_HANDLE_WIDTH;
  const sourceWidth = clamp(
    clientX - containerLeft,
    MIN_SOURCE_WIDTH,
    Math.max(MIN_SOURCE_WIDTH, maxSourceWidth),
  );
  return (sourceWidth / containerWidth) * 100;
}

/**
 * Runs a pane drag, horizontal unless `axis` is "y". The handle captures the
 * pointer so the drag keeps tracking over the editor, the PDF canvas and
 * embedded frames. `onMove` gets the pointer coordinate along the axis.
 */
export function startPaneDrag(
  event: ReactPointerEvent<HTMLElement>,
  onMove: (position: number) => void,
  onEnd?: () => void,
  axis: "x" | "y" = "x",
): void {
  if (event.button !== 0 && event.pointerType === "mouse") return;
  event.preventDefault();
  const handle = event.currentTarget;
  const pointerId = event.pointerId;
  try {
    handle.setPointerCapture?.(pointerId);
  } catch {
    // Pointer capture is an enhancement; window listeners still track the drag.
  }
  const bodyClass = axis === "y" ? "pane-resizing-row" : "pane-resizing";
  handle.classList.add("dragging");
  document.body.classList.add(bodyClass);

  const handleMove = (moveEvent: PointerEvent) => {
    onMove(axis === "y" ? moveEvent.clientY : moveEvent.clientX);
  };
  const handleEnd = () => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleEnd);
    window.removeEventListener("pointercancel", handleEnd);
    window.removeEventListener("blur", handleEnd);
    try {
      handle.releasePointerCapture?.(pointerId);
    } catch {
      // The capture may already be gone.
    }
    handle.classList.remove("dragging");
    document.body.classList.remove(bodyClass);
    onEnd?.();
  };
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleEnd);
  window.addEventListener("pointercancel", handleEnd);
  window.addEventListener("blur", handleEnd);
}
