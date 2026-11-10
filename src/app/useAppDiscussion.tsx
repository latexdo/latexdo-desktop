import { useCallback } from "react";
import { useDiscussion } from "../features/discussion/useDiscussion";
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

  return { discussion, discussionVisible };
}
