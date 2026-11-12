import { useCallback, useEffect } from "react";
import { useDiscussion } from "../features/discussion/useDiscussion";
import { loadNotificationMode } from "../features/notifications/notifications";
import type { AppCtx21 } from "./appContext";

// The shared project's discussion: its panel, badge and notices.
export function useAppDiscussion(ctx: AppCtx21) {
  const {
    activeSidebar,
    collaborationState,
    discussionSignalRef,
    openSidebar,
    projectId,
    sidebarVisible,
  } = ctx;
  const enabled = Boolean(
    projectId &&
    collaborationState.enabled &&
    window.latexdo.hasDiscussion?.(projectId),
  );
  const discussionVisible = sidebarVisible && activeSidebar === "discussion";

  const showDiscussion = useCallback(() => openSidebar("discussion"), [openSidebar]);

  const discussion = useDiscussion({
    projectId: projectId || null,
    enabled,
    presence: collaborationState.users,
    visible: discussionVisible,
    signalRef: discussionSignalRef,
    onOpen: showDiscussion,
  });

  // The unread count also shows on the app icon (Dock / taskbar), except in
  // Do Not Disturb, which hides unread badges.
  const unread =
    enabled && loadNotificationMode() !== "do-not-disturb"
      ? discussion.totals.unread
      : 0;
  useEffect(() => {
    void window.latexdo.setUnreadBadge?.(unread)?.catch(() => undefined);
  }, [unread]);
  useEffect(
    () => () => void window.latexdo.setUnreadBadge?.(0)?.catch(() => undefined),
    [],
  );

  return { discussion, discussionVisible };
}
