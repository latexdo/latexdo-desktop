import React from "react";
import { Check, ChevronRight, Eye, FastForward, Play } from "lucide-react";
import {
  getTourProgress,
  markFeatureDiscovery,
  recordOnboardingAnalytics,
  updateTourProgress,
} from "../core/DiscoveryStore";
import { subscribeProductEvents, type ProductEvent } from "../core/ProductEvents";
import type { TourDefinition, TourRuntimeState, TourStep } from "../core/TourTypes";

interface TourOverlayProps {
  tour: TourDefinition;
  launchNonce: number;
  onPrepare: () => void;
  onRevealStep?: (step: TourStep) => void;
  onStepAction?: (step: TourStep) => void;
  onRestore: () => void;
}

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function targetElements(step: TourStep): HTMLElement[][] {
  return [step.targetId, step.fallbackTargetId]
    .filter((id): id is string => Boolean(id))
    .map((id) =>
      Array.from(document.querySelectorAll<HTMLElement>(`[data-tour-id="${id}"]`)),
    );
}

function isRendered(element: HTMLElement): boolean {
  const bounds = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return (
    bounds.width > 0 &&
    bounds.height > 0 &&
    style.visibility !== "hidden" &&
    style.display !== "none"
  );
}

/** The part of the element that is really visible: inside the window and
 * not clipped by a scrolling ancestor such as an overflowing toolbar. */
function visibleRect(element: HTMLElement): TargetRect | null {
  if (!isRendered(element)) return null;
  const bounds = element.getBoundingClientRect();
  let top = Math.max(bounds.top, 0);
  let left = Math.max(bounds.left, 0);
  let bottom = Math.min(bounds.bottom, window.innerHeight);
  let right = Math.min(bounds.right, window.innerWidth);
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = window.getComputedStyle(parent);
    if (style.overflowX === "visible" && style.overflowY === "visible") continue;
    const clip = parent.getBoundingClientRect();
    top = Math.max(top, clip.top);
    left = Math.max(left, clip.left);
    bottom = Math.min(bottom, clip.bottom);
    right = Math.min(right, clip.right);
  }
  if (right - left < 8 || bottom - top < 8) return null;
  return { top, left, width: right - left, height: bottom - top };
}

function isOnScreen(element: HTMLElement): boolean {
  return visibleRect(element) !== null;
}

/** The step's control, or its fallback area when the control is not rendered. */
function findTarget(
  step: TourStep,
  accepts: (element: HTMLElement) => boolean,
): HTMLElement | null {
  for (const candidates of targetElements(step)) {
    const match = candidates.find(accepts);
    if (match) return match;
  }
  return null;
}

function rectForStep(step: TourStep): TargetRect | null {
  const element = findTarget(step, isOnScreen);
  return element ? visibleRect(element) : null;
}

/** Scrolls the step's control into view, e.g. inside an overflowing toolbar. */
function scrollStepIntoView(step: TourStep): void {
  findTarget(step, isRendered)?.scrollIntoView?.({
    block: "nearest",
    inline: "nearest",
  });
}

function stepMatchesEvent(step: TourStep, event: ProductEvent): boolean {
  return step.expectedEvent === event.type;
}

export const TourOverlay: React.FC<TourOverlayProps> = ({
  tour,
  launchNonce,
  onPrepare,
  onRestore,
  onRevealStep,
  onStepAction,
}) => {
  const [runtimeState, setRuntimeState] = React.useState<TourRuntimeState>("idle");
  const [visible, setVisible] = React.useState(false);
  const [currentStepIndex, setCurrentStepIndex] = React.useState(0);
  const [targetRect, setTargetRect] = React.useState<TargetRect | null>(null);
  const [successMessage, setSuccessMessage] = React.useState("");
  const [startedAt, setStartedAt] = React.useState(0);
  const [attemptCount, setAttemptCount] = React.useState(0);
  // The step whose "Show me" was used; its primary button becomes "Next".
  const [shownStepId, setShownStepId] = React.useState<string | null>(null);
  const shownStepRef = React.useRef<string | null>(null);
  const currentStep = tour.steps[currentStepIndex];
  const transitionTimerRef = React.useRef<number | undefined>(undefined);
  const stepCompletedRef = React.useRef(false);
  const revealRef = React.useRef(onRevealStep);
  revealRef.current = onRevealStep;
  const actionRef = React.useRef(onStepAction);
  actionRef.current = onStepAction;
  const showTimerRef = React.useRef<number | undefined>(undefined);

  React.useEffect(
    () => () => {
      window.clearTimeout(transitionTimerRef.current);
      window.clearTimeout(showTimerRef.current);
    },
    [],
  );

  React.useEffect(() => {
    if (!visible || runtimeState !== "waiting-for-user" || !currentStep) return;
    revealRef.current?.(currentStep);
    // Once the revealed panel has rendered, bring the control on screen.
    const timer = window.setTimeout(() => {
      scrollStepIntoView(currentStep);
      setTargetRect(rectForStep(currentStep));
    }, 60);
    return () => window.clearTimeout(timer);
  }, [currentStep, runtimeState, visible]);

  const updateTargetRect = React.useCallback(() => {
    if (!currentStep) {
      setTargetRect(null);
      return;
    }
    setTargetRect(rectForStep(currentStep));
  }, [currentStep]);

  React.useEffect(() => {
    if (launchNonce <= 0) return;
    const progress = getTourProgress(tour.id, tour.version);
    if (progress.state === "completed" || progress.state === "dismissed") return;
    const timer = window.setTimeout(() => {
      setVisible(true);
      setRuntimeState("showing");
      updateTourProgress({
        ...progress,
        state: "introduced",
      });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [launchNonce, tour.id, tour.version]);

  React.useEffect(() => {
    if (!visible || runtimeState === "showing" || runtimeState === "idle") return;
    updateTargetRect();
    const onResize = () => updateTargetRect();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    const timer = window.setInterval(updateTargetRect, 500);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
      window.clearInterval(timer);
    };
  }, [runtimeState, updateTargetRect, visible]);

  React.useEffect(() => {
    if (!visible || runtimeState !== "waiting-for-user" || !currentStep) return;
    const shownStepKey = `${tour.id}:${tour.version}:${currentStep.id}`;
    if (shownStepRef.current === shownStepKey) return;
    shownStepRef.current = shownStepKey;
    const progress = getTourProgress(tour.id, tour.version);
    updateTourProgress({
      ...progress,
      state: "started",
    });
    markFeatureDiscovery(currentStep.featureId, "introduced");
    recordOnboardingAnalytics({
      type: "tour_step_shown",
      tourId: tour.id,
      tourVersion: tour.version,
      stepId: currentStep.id,
      featureId: currentStep.featureId,
      attemptCount,
    });
  }, [attemptCount, currentStep, runtimeState, tour.id, tour.version, visible]);

  React.useEffect(() => {
    if (runtimeState !== "waiting-for-user" || !currentStep?.expectedEvent) return;
    return subscribeProductEvents((event) => {
      if (!stepMatchesEvent(currentStep, event)) return;
      completeStep("event");
    });
    // completeStep intentionally reads current runtime state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, runtimeState]);

  const startTour = () => {
    setRuntimeState("preparing");
    onPrepare();
    shownStepRef.current = null;
    setShownStepId(null);
    setCurrentStepIndex(0);
    setSuccessMessage("");
    setStartedAt(Date.now());
    setAttemptCount(1);
    stepCompletedRef.current = false;
    transitionTimerRef.current = window.setTimeout(() => {
      setRuntimeState("waiting-for-user");
      updateTargetRect();
      recordOnboardingAnalytics({
        type: "tour_step_started",
        tourId: tour.id,
        tourVersion: tour.version,
        stepId: tour.steps[0]?.id,
        featureId: tour.steps[0]?.featureId,
        attemptCount: 1,
      });
    }, 80);
  };

  const completeTour = (completionMethod: "manual" | "skip") => {
    window.clearTimeout(transitionTimerRef.current);
    window.clearTimeout(showTimerRef.current);
    stepCompletedRef.current = true;
    const progress = getTourProgress(tour.id, tour.version);
    updateTourProgress({
      ...progress,
      state: completionMethod === "skip" ? "dismissed" : "completed",
    });
    recordOnboardingAnalytics({
      type: completionMethod === "skip" ? "tour_dismissed" : "tour_completed",
      tourId: tour.id,
      tourVersion: tour.version,
      elapsedMs: Date.now() - startedAt,
      completionMethod,
    });
    setRuntimeState("completed");
    setVisible(false);
    setSuccessMessage("");
    onRestore();
  };

  const completeStep = (completionMethod: "event" | "skip" | "manual") => {
    if (!currentStep || stepCompletedRef.current || runtimeState !== "waiting-for-user")
      return;
    stepCompletedRef.current = true;
    const progress = getTourProgress(tour.id, tour.version);
    const completedSteps =
      completionMethod === "skip"
        ? progress.completedSteps
        : Array.from(new Set([...progress.completedSteps, currentStep.id]));
    const skippedSteps =
      completionMethod === "skip"
        ? Array.from(new Set([...progress.skippedSteps, currentStep.id]))
        : progress.skippedSteps;
    updateTourProgress({
      ...progress,
      state: "started",
      completedSteps,
      skippedSteps,
    });
    markFeatureDiscovery(
      currentStep.featureId,
      completionMethod === "skip"
        ? "dismissed"
        : completionMethod === "event"
          ? "mastered"
          : "tried",
    );
    recordOnboardingAnalytics({
      type: completionMethod === "skip" ? "tour_step_skipped" : "tour_step_succeeded",
      tourId: tour.id,
      tourVersion: tour.version,
      stepId: currentStep.id,
      featureId: currentStep.featureId,
      elapsedMs: Date.now() - startedAt,
      attemptCount,
      completionMethod,
    });
    setSuccessMessage(completionMethod === "skip" ? "Skipped." : currentStep.success);
    setRuntimeState("success");
    transitionTimerRef.current = window.setTimeout(
      () => {
        if (currentStepIndex >= tour.steps.length - 1) {
          completeTour("manual");
          return;
        }
        stepCompletedRef.current = false;
        setTargetRect(null);
        setCurrentStepIndex((index) => index + 1);
        setAttemptCount((count) => count + 1);
        setSuccessMessage("");
        setRuntimeState("waiting-for-user");
      },
      completionMethod === "skip" ? 180 : 650,
    );
  };

  // "Show me" performs the step in the real workspace; the step still only
  // completes when the product reports the expected event.
  const showStep = () => {
    if (!currentStep) return;
    const step = currentStep;
    setShownStepId(step.id);
    setAttemptCount((count) => count + 1);
    recordOnboardingAnalytics({
      type: "tour_step_interacted",
      tourId: tour.id,
      tourVersion: tour.version,
      stepId: step.id,
      featureId: step.featureId,
      elapsedMs: Date.now() - startedAt,
      attemptCount: attemptCount + 1,
      completionMethod: "manual",
    });
    onRevealStep?.(step);
    window.clearTimeout(showTimerRef.current);
    // Let the revealed panel mount before acting on it.
    showTimerRef.current = window.setTimeout(() => {
      scrollStepIntoView(step);
      actionRef.current?.(step);
      setTargetRect(rectForStep(step));
    }, 0);
  };

  const abandonTour = () => completeTour("skip");

  if (!visible) return null;

  if (runtimeState === "showing") {
    return (
      <div className="tour-prompt-backdrop" role="presentation">
        <section
          className="tour-prompt"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-prompt-title"
        >
          <div className="tour-prompt-icon">
            <Play size={18} />
          </div>
          <h2 id="tour-prompt-title">{tour.title}</h2>
          <p>{tour.intro}</p>
          <div className="tour-prompt-actions">
            <button type="button" className="tour-primary" onClick={startTour}>
              Start interactive tour <ChevronRight size={15} />
            </button>
            <button type="button" className="tour-secondary" onClick={abandonTour}>
              Skip for now
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="tour-layer" role="presentation">
      {!targetRect && <div className="tour-scrim" />}
      {targetRect ? (
        <div
          // Re-keyed on "Show me" so the highlight pulses where to look.
          key={shownStepId === currentStep?.id ? "shown" : "idle"}
          className={`tour-spotlight ${
            shownStepId === currentStep?.id ? "tour-spotlight-pulse" : ""
          }`}
          style={{
            top: targetRect.top - 8,
            left: targetRect.left - 8,
            width: targetRect.width + 16,
            height: targetRect.height + 16,
          }}
        />
      ) : null}
      <section
        className={`tour-coachmark ${targetRect && targetRect.left + targetRect.width / 2 > window.innerWidth / 2 ? "tour-coachmark-left" : ""}`}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-step-title"
      >
        <div className="tour-progress" aria-label="Tour progress">
          <i
            style={{
              width: `${((currentStepIndex + 1) / tour.steps.length) * 100}%`,
            }}
          />
        </div>
        <span className="tour-step-count">
          Step {currentStepIndex + 1} of {tour.steps.length}
        </span>
        <h2 id="tour-step-title">{currentStep?.title}</h2>
        {successMessage ? (
          <div className="tour-success" role="status">
            <Check size={14} /> {successMessage}
          </div>
        ) : (
          <p>{currentStep?.body}</p>
        )}
        <div className="tour-actions">
          {currentStep?.expectedEvent && shownStepId !== currentStep.id ? (
            <button
              type="button"
              className="tour-primary"
              disabled={runtimeState !== "waiting-for-user"}
              onClick={showStep}
            >
              <Eye size={14} /> Show me
            </button>
          ) : (
            <button
              type="button"
              className="tour-primary"
              disabled={runtimeState !== "waiting-for-user"}
              onClick={() => completeStep("manual")}
            >
              {(currentStep?.expectedEvent ? undefined : currentStep?.cta) ?? "Next"}{" "}
              <ChevronRight size={14} />
            </button>
          )}
          {shownStepId !== currentStep?.id ? (
            <button
              type="button"
              className="tour-ghost"
              disabled={runtimeState !== "waiting-for-user"}
              onClick={() => completeStep("skip")}
            >
              <FastForward size={14} /> Skip step
            </button>
          ) : null}
          <button type="button" className="tour-ghost" onClick={abandonTour}>
            Skip tour
          </button>
        </div>
      </section>
    </div>
  );
};
