import { useSyncExternalStore } from "react";
import type { CompileResult } from "../types";
import type { CollaborationConnectionStatus } from "../collaboration/collaborationTypes";

/** What the status bar's color says, most urgent first. */
export type StatusbarState = "compile-error" | "offline" | "online" | "idle";

export function statusbarStateFor(input: {
  compileResult: CompileResult | null | undefined;
  sharing: boolean;
  /** The open project is a copy kept online (shared or joined). */
  onlineCopy?: boolean;
  /** Sharing is starting, stopping or syncing with the server. */
  onlineBusy?: boolean;
  liveConnection: CollaborationConnectionStatus;
  online: boolean;
}): StatusbarState {
  const { compileResult } = input;
  if (
    compileResult &&
    (!compileResult.ok ||
      compileResult.diagnostics.some((diagnostic) => diagnostic.severity === "error"))
  ) {
    return "compile-error";
  }
  if (!input.online) return "offline";
  // Anything touching the online copy colors the bar, so it is always clear
  // when work leaves this computer.
  if (input.onlineBusy) return "online";
  if (input.sharing || input.onlineCopy) {
    if (input.liveConnection === "disconnected" || input.liveConnection === "error") {
      return "offline";
    }
    return "online";
  }
  return "idle";
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useNetworkOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
