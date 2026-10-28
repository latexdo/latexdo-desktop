import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_PANEL_HEIGHT,
  DEFAULT_SPLIT_PERCENT,
} from "../features/layout/paneLayout";
import type { AppCtx19 } from "./appContext";

/** How the editor and the PDF share the main area. */
export type ViewLayoutMode = "split" | "editor" | "pdf";

/**
 * The Layout menu: split view, editor only, PDF only and focus mode. Editor
 * only is the existing hidden preview; PDF only also hides the source pane,
 * which stays mounted so the editor keeps its state.
 */
export function useAppViewLayout(ctx: AppCtx19) {
  const {
    panelVisible,
    previewShown,
    setPanelHeight,
    setPanelVisible,
    setPreviewVisible,
    setSidebarVisible,
    setSidebarWidths,
    setSplitPercent,
    setStatusMessage,
    sidebarVisible,
    togglePreview,
  } = ctx;
  const [editorHidden, setEditorHidden] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  // What focus mode hid, so leaving it brings exactly that back.
  const beforeFocusRef = useRef<{ sidebar: boolean; panel: boolean } | null>(null);

  const layoutMode: ViewLayoutMode = !previewShown
    ? "editor"
    : editorHidden
      ? "pdf"
      : "split";

  // Once the PDF goes away there is nothing to show but the editor, so a later
  // "show preview" must not come back as PDF only.
  useEffect(() => {
    if (!previewShown) setEditorHidden(false);
  }, [previewShown]);

  // Opening the sidebar or panel by any other route ends focus mode.
  const shownRef = useRef({ sidebar: sidebarVisible, panel: panelVisible });
  useEffect(() => {
    const before = shownRef.current;
    shownRef.current = { sidebar: sidebarVisible, panel: panelVisible };
    const reopened =
      (sidebarVisible && !before.sidebar) || (panelVisible && !before.panel);
    if (focusMode && reopened) {
      beforeFocusRef.current = null;
      setFocusMode(false);
    }
  }, [focusMode, panelVisible, sidebarVisible]);

  const setLayoutMode = useCallback(
    async (mode: ViewLayoutMode) => {
      setEditorHidden(mode === "pdf");
      if (mode === "editor") {
        setPreviewVisible(false);
      } else if (!previewShown) {
        // Also opens the root file when the welcome page is showing.
        await togglePreview();
      }
    },
    [previewShown, setPreviewVisible, togglePreview],
  );

  const toggleFocusMode = useCallback(() => {
    if (focusMode) {
      const before = beforeFocusRef.current;
      beforeFocusRef.current = null;
      setFocusMode(false);
      if (before) {
        setSidebarVisible(before.sidebar);
        setPanelVisible(before.panel);
      }
      return;
    }
    beforeFocusRef.current = { sidebar: sidebarVisible, panel: panelVisible };
    setSidebarVisible(false);
    setPanelVisible(false);
    setFocusMode(true);
  }, [focusMode, panelVisible, setPanelVisible, setSidebarVisible, sidebarVisible]);

  const resetPaneSizes = useCallback(() => {
    setSplitPercent(DEFAULT_SPLIT_PERCENT);
    setSidebarWidths({});
    setPanelHeight(DEFAULT_PANEL_HEIGHT);
    setStatusMessage("Pane sizes reset.");
  }, [setPanelHeight, setSidebarWidths, setSplitPercent, setStatusMessage]);

  return {
    layoutMode,
    setLayoutMode,
    focusMode,
    toggleFocusMode,
    resetPaneSizes,
  };
}
