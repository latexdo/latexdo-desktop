/*
 * Whether someone in a shared project is really here.
 *
 * - active: LatexDo is in front (window focused, not hidden) and used lately;
 * - away: LatexDo is open, but in the background or left idle;
 * - offline: LatexDo is closed, or the project is not open (not in the list).
 */

import { useEffect, useState } from "react";
import type { CollaboratorPresence } from "../types";

export type PresenceState = "active" | "away" | "offline";

/** No keyboard, mouse or scroll for this long counts as away. */
export const idleAfterMs = 5 * 60 * 1000;
/** A quick switch to another window and back is not "away". */
const settleMs = 1500;
const idleCheckMs = 15_000;

export function presenceState(
  user: Pick<CollaboratorPresence, "active"> | null | undefined,
): PresenceState {
  if (!user) return "offline";
  return user.active === false ? "away" : "active";
}

export const presenceLabels: Record<PresenceState, string> = {
  active: "Active now",
  away: "Away",
  offline: "Offline",
};

/** One line saying where someone is, for tooltips and headers. */
export function presenceDescription(
  state: PresenceState,
  currentFile?: string | null,
): string {
  if (state === "offline") return "Offline";
  if (state === "away") return "Away · LatexDo is open but not in use";
  const file = currentFile?.split("/").pop();
  return file ? `Active now · in ${file}` : "Active now";
}

function inFront(): boolean {
  return (
    document.visibilityState !== "hidden" &&
    (typeof document.hasFocus !== "function" || document.hasFocus())
  );
}

/** True while this person is using LatexDo (see the states above). */
export function useAttention(): boolean {
  const [here, setHere] = useState(inFront);

  useEffect(() => {
    let lastInput = Date.now();
    let settleTimer: number | null = null;
    let current = inFront();

    const evaluate = () => {
      const next = inFront() && Date.now() - lastInput < idleAfterMs;
      if (next === current) {
        if (settleTimer !== null) {
          window.clearTimeout(settleTimer);
          settleTimer = null;
        }
        return;
      }
      // Coming back shows at once; leaving waits a moment.
      if (next) {
        current = true;
        setHere(true);
        return;
      }
      settleTimer ??= window.setTimeout(() => {
        settleTimer = null;
        const settled = inFront() && Date.now() - lastInput < idleAfterMs;
        if (settled !== current) {
          current = settled;
          setHere(settled);
        }
      }, settleMs);
    };
    const onInput = () => {
      lastInput = Date.now();
      if (!current) evaluate();
    };

    const windowEvents = ["focus", "blur"] as const;
    const inputEvents = ["pointerdown", "pointermove", "keydown", "wheel"] as const;
    for (const name of windowEvents) window.addEventListener(name, evaluate);
    for (const name of inputEvents) {
      window.addEventListener(name, onInput, { passive: true, capture: true });
    }
    document.addEventListener("visibilitychange", evaluate);
    const idleTimer = window.setInterval(evaluate, idleCheckMs);
    return () => {
      for (const name of windowEvents) window.removeEventListener(name, evaluate);
      for (const name of inputEvents) {
        window.removeEventListener(name, onInput, { capture: true });
      }
      document.removeEventListener("visibilitychange", evaluate);
      window.clearInterval(idleTimer);
      if (settleTimer !== null) window.clearTimeout(settleTimer);
    };
  }, []);

  return here;
}
