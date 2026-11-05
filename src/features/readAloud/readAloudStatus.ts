// What "Listen to paper" is doing, for the status bar. The PDF pane owns the
// player; this tiny store lets the app shell show and color its state.
import { useSyncExternalStore } from "react";
import type { ReadAloudStatus } from "./useReadAloud";

export interface ReadAloudStatusSnapshot {
  status: ReadAloudStatus;
  page: number | null;
  /** "This computer", "OpenAI", "ElevenLabs". */
  voiceSource: string;
  toggle: (() => void) | null;
}

const idle: ReadAloudStatusSnapshot = {
  status: "idle",
  page: null,
  voiceSource: "",
  toggle: null,
};

let snapshot = idle;
const listeners = new Set<() => void>();

export function publishReadAloudStatus(next: ReadAloudStatusSnapshot | null): void {
  const value = next ?? idle;
  if (
    value.status === snapshot.status &&
    value.page === snapshot.page &&
    value.voiceSource === snapshot.voiceSource &&
    value.toggle === snapshot.toggle
  ) {
    return;
  }
  snapshot = value;
  for (const listener of listeners) listener();
}

export function useReadAloudStatus(): ReadAloudStatusSnapshot {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => snapshot,
    () => idle,
  );
}

/** Reading out loud right now (or about to): the status bar takes its color. */
export function isReadingAloud(status: ReadAloudStatus): boolean {
  return status === "playing" || status === "preparing";
}
