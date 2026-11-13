import { useCallback, useEffect, useRef, useState } from "react";
import { loadNotificationMode } from "../../notifications/notifications";
import { markFeatureDiscovery } from "../core/DiscoveryStore";
import { subscribeProductEvents, type ProductEvent } from "../core/ProductEvents";
import {
  featureUsed,
  loadTipsState,
  nextTip,
  recordTipDone,
  recordTipShown,
  saveTipsState,
  type FeatureTip,
  type TipRequirement,
} from "./featureTips";

/** How often active time is counted and a tip considered. */
export const tipTickMs = 60_000;
/** A tip waits until the person has stopped typing for this long. */
const quietAfterTypingMs = 15_000;

/** The feature an event shows was used, if any. */
export function featureForEvent(event: ProductEvent): string | null {
  switch (event.type) {
    case "synctex:navigated":
      return "pdf.source-jump";
    case "pdf:listen-opened":
      return "pdf.listen";
    case "command:run":
      return `command.${event.command}`;
    case "sidebar:opened":
      return `sidebar.${event.view}`;
    case "tool:opened":
      return `tool.${event.tool}`;
    default:
      return null;
  }
}

function markUsed(featureId: string): void {
  if (!featureUsed(featureId)) markFeatureDiscovery(featureId, "tried");
}

/** Whether now is a polite moment for a tip. */
function quietMoment(lastKeyAt: number, now: number): boolean {
  if (typeof document === "undefined") return false;
  if (document.visibilityState === "hidden") return false;
  if (typeof document.hasFocus === "function" && !document.hasFocus()) return false;
  // Never over a dialog or during the guided tour, and never mid-sentence.
  if (document.querySelector('[aria-modal="true"], .tour-coachmark')) return false;
  if (now - lastKeyAt < quietAfterTypingMs) return false;
  // Only the default mode allows popups that are not errors or warnings.
  return loadNotificationMode() === "reviewing";
}

export interface UseFeatureTipsOptions {
  /** The "Feature tips" setting. */
  enabled: boolean;
  /** Features in use right now (e.g. a non-default AI chosen), by feature id. */
  inUse: Record<string, boolean>;
  /** What tips may rely on: a shared project, tools switched on. */
  available?: Partial<Record<TipRequirement, boolean>>;
  /** Runs a menu command (a tip's button). */
  onAction: (command: string) => void;
  /** Turns the setting off. */
  onTurnOff: () => void;
}

export function useFeatureTips({
  enabled,
  inUse,
  available = {},
  onAction,
  onTurnOff,
}: UseFeatureTipsOptions) {
  const availableRef = useRef(available);
  availableRef.current = available;
  const [tip, setTip] = useState<FeatureTip | null>(null);
  const tipRef = useRef<FeatureTip | null>(null);
  tipRef.current = tip;
  const lastKeyAtRef = useRef(0);

  // What the app reports as in use counts as discovered.
  const inUseKey = Object.entries(inUse)
    .filter(([, value]) => value)
    .map(([featureId]) => featureId)
    .join();
  useEffect(() => {
    for (const featureId of inUseKey ? inUseKey.split(",") : []) markUsed(featureId);
    if (tipRef.current && inUseKey.split(",").includes(tipRef.current.featureId)) {
      saveTipsState(recordTipDone(loadTipsState(), tipRef.current));
      setTip(null);
    }
  }, [inUseKey]);

  useEffect(
    () =>
      subscribeProductEvents((event) => {
        const featureId = featureForEvent(event);
        if (!featureId) return;
        markUsed(featureId);
        // Found it while the tip was up: job done.
        if (tipRef.current?.featureId === featureId) {
          saveTipsState(recordTipDone(loadTipsState(), tipRef.current));
          setTip(null);
        }
      }),
    [],
  );

  useEffect(() => {
    const onKey = () => {
      lastKeyAtRef.current = Date.now();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Count time actually spent in LatexDo, and offer a tip at a quiet moment.
  useEffect(() => {
    if (!enabled) {
      setTip(null);
      return;
    }
    const timer = window.setInterval(() => {
      const now = Date.now();
      const focused =
        document.visibilityState !== "hidden" &&
        (typeof document.hasFocus !== "function" || document.hasFocus());
      if (!focused) return;
      let state = loadTipsState(now);
      state = { ...state, activeMs: state.activeMs + tipTickMs };
      if (!tipRef.current && quietMoment(lastKeyAtRef.current, now)) {
        const ready = new Set(
          (Object.keys(availableRef.current) as TipRequirement[]).filter(
            (key) => availableRef.current[key],
          ),
        );
        const next = nextTip(state, now, undefined, undefined, ready);
        if (next) {
          state = recordTipShown(state, next, now);
          markFeatureDiscovery(next.featureId, "introduced");
          setTip(next);
        }
      }
      saveTipsState(state);
    }, tipTickMs);
    return () => window.clearInterval(timer);
  }, [enabled]);

  /** Follows the tip's action (or acknowledges a tip without one). */
  const accept = useCallback(() => {
    const current = tipRef.current;
    if (!current) return;
    saveTipsState(recordTipDone(loadTipsState(), current));
    setTip(null);
    if (current.action) onAction(current.action.command);
  }, [onAction]);

  /** "Not now": it may come back once, much later. */
  const later = useCallback(() => setTip(null), []);

  const turnOff = useCallback(() => {
    setTip(null);
    onTurnOff();
  }, [onTurnOff]);

  return { tip, accept, later, turnOff };
}
