import { beforeEach, describe, expect, it } from "vitest";
import {
  getTourProgress,
  loadDiscoveryStore,
  markFeatureDiscovery,
  onboardingDiscoveryStorageKey,
  recordOnboardingAnalytics,
  updateTourProgress,
} from "./DiscoveryStore";

describe("DiscoveryStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists versioned tour progress", () => {
    const initial = getTourProgress("editor-activation", 1);
    expect(initial.state).toBe("unseen");

    updateTourProgress({
      ...initial,
      state: "started",
      completedSteps: ["compile"],
      skippedSteps: [],
    });

    expect(getTourProgress("editor-activation", 1)).toEqual(
      expect.objectContaining({
        state: "started",
        completedSteps: ["compile"],
      }),
    );
    expect(getTourProgress("editor-activation", 2).state).toBe("unseen");
  });

  it("tracks feature discovery and analytics separately", () => {
    markFeatureDiscovery("compile", "mastered");
    recordOnboardingAnalytics({
      type: "tour_step_succeeded",
      tourId: "editor-activation",
      tourVersion: 1,
      stepId: "compile",
      featureId: "compile",
      completionMethod: "event",
    });

    const store = loadDiscoveryStore();
    expect(store.features.compile.state).toBe("mastered");
    expect(store.features.compile.firstUsedAt).toEqual(expect.any(Number));
    expect(store.analytics[0]).toEqual(
      expect.objectContaining({
        type: "tour_step_succeeded",
        stepId: "compile",
      }),
    );
    expect(window.localStorage.getItem(onboardingDiscoveryStorageKey)).toContain(
      "editor-activation",
    );
  });
});
