import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AppCtx19 } from "./appContext";
import { useAppViewLayout } from "./useAppViewLayout";

function setup(overrides: Partial<Record<string, unknown>> = {}) {
  const ctx = {
    panelVisible: true,
    previewShown: true,
    sidebarVisible: true,
    setPanelHeight: vi.fn(),
    setPanelVisible: vi.fn(),
    setPreviewVisible: vi.fn(),
    setSidebarVisible: vi.fn(),
    setSidebarWidths: vi.fn(),
    setSplitPercent: vi.fn(),
    setStatusMessage: vi.fn(),
    togglePreview: vi.fn(),
    ...overrides,
  };
  const hook = renderHook(({ c }) => useAppViewLayout(c as unknown as AppCtx19), {
    initialProps: { c: ctx },
  });
  return { ctx, hook };
}

describe("useAppViewLayout", () => {
  it("switches between split, editor only and PDF only", async () => {
    const { ctx, hook } = setup();
    expect(hook.result.current.layoutMode).toBe("split");
    await act(() => hook.result.current.setLayoutMode("pdf"));
    expect(hook.result.current.layoutMode).toBe("pdf");
    expect(ctx.togglePreview).not.toHaveBeenCalled();
    await act(() => hook.result.current.setLayoutMode("editor"));
    expect(ctx.setPreviewVisible).toHaveBeenCalledWith(false);
    await act(() => hook.result.current.setLayoutMode("split"));
    expect(hook.result.current.layoutMode).toBe("split");
  });

  it("shows the preview when it is hidden, and forgets PDF only once it closes", async () => {
    const { ctx, hook } = setup({ previewShown: false });
    expect(hook.result.current.layoutMode).toBe("editor");
    await act(() => hook.result.current.setLayoutMode("pdf"));
    expect(ctx.togglePreview).toHaveBeenCalledTimes(1);
    hook.rerender({ c: { ...ctx, previewShown: true } });
    expect(hook.result.current.layoutMode).toBe("pdf");
    hook.rerender({ c: { ...ctx, previewShown: false } });
    hook.rerender({ c: { ...ctx, previewShown: true } });
    expect(hook.result.current.layoutMode).toBe("split");
  });

  it("hides the sidebar and panel in focus mode and restores them after", () => {
    const { ctx, hook } = setup({ panelVisible: false });
    act(() => hook.result.current.toggleFocusMode());
    expect(ctx.setSidebarVisible).toHaveBeenLastCalledWith(false);
    expect(ctx.setPanelVisible).toHaveBeenLastCalledWith(false);
    hook.rerender({ c: { ...ctx, sidebarVisible: false, panelVisible: false } });
    expect(hook.result.current.focusMode).toBe(true);
    act(() => hook.result.current.toggleFocusMode());
    expect(hook.result.current.focusMode).toBe(false);
    expect(ctx.setSidebarVisible).toHaveBeenLastCalledWith(true);
    expect(ctx.setPanelVisible).toHaveBeenLastCalledWith(false);
  });

  it("leaves focus mode when the sidebar is opened another way", () => {
    const { ctx, hook } = setup();
    act(() => hook.result.current.toggleFocusMode());
    hook.rerender({ c: { ...ctx, sidebarVisible: false, panelVisible: false } });
    hook.rerender({ c: { ...ctx, sidebarVisible: true, panelVisible: false } });
    expect(hook.result.current.focusMode).toBe(false);
  });

  it("resets every pane size", () => {
    const { ctx, hook } = setup();
    act(() => hook.result.current.resetPaneSizes());
    expect(ctx.setSplitPercent).toHaveBeenCalledWith(52);
    expect(ctx.setSidebarWidths).toHaveBeenCalledWith({});
    expect(ctx.setPanelHeight).toHaveBeenCalledWith(200);
  });
});
