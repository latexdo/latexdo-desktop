export type FeatureDiscoveryStatus =
  | "unseen"
  | "introduced"
  | "tried"
  | "mastered"
  | "dismissed";

export interface FeatureDiscoveryState {
  featureId: string;
  state: FeatureDiscoveryStatus;
  firstSeenAt?: number;
  firstUsedAt?: number;
  lastUsedAt?: number;
}

export interface TourProgressState {
  tourId: string;
  version: number;
  state: "unseen" | "introduced" | "started" | "completed" | "dismissed";
  completedSteps: string[];
  skippedSteps: string[];
  updatedAt: number;
}

interface DiscoveryStoreShape {
  tours: Record<string, TourProgressState>;
  features: Record<string, FeatureDiscoveryState>;
  analytics: OnboardingAnalyticsEvent[];
}

export interface OnboardingAnalyticsEvent {
  type:
    | "tour_step_shown"
    | "tour_step_started"
    | "tour_step_interacted"
    | "tour_step_succeeded"
    | "tour_step_failed"
    | "tour_step_skipped"
    | "tour_step_abandoned"
    | "tour_completed"
    | "tour_dismissed";
  tourId: string;
  tourVersion: number;
  stepId?: string;
  featureId?: string;
  elapsedMs?: number;
  attemptCount?: number;
  completionMethod?: "event" | "show-me" | "skip" | "manual";
  createdAt: number;
}

export const onboardingDiscoveryStorageKey = "latexdo.onboarding.discovery.v1";
const maxAnalyticsEvents = 250;

function emptyStore(): DiscoveryStoreShape {
  return {
    tours: {},
    features: {},
    analytics: [],
  };
}

export function loadDiscoveryStore(): DiscoveryStoreShape {
  try {
    const raw = JSON.parse(
      window.localStorage.getItem(onboardingDiscoveryStorageKey) ?? "null",
    ) as Partial<DiscoveryStoreShape> | null;
    if (!raw || typeof raw !== "object") return emptyStore();
    return {
      tours: raw.tours && typeof raw.tours === "object" ? raw.tours : {},
      features: raw.features && typeof raw.features === "object" ? raw.features : {},
      analytics: Array.isArray(raw.analytics) ? raw.analytics : [],
    };
  } catch {
    return emptyStore();
  }
}

function saveDiscoveryStore(store: DiscoveryStoreShape): void {
  window.localStorage.setItem(onboardingDiscoveryStorageKey, JSON.stringify(store));
}

export function getTourProgress(tourId: string, version: number): TourProgressState {
  const progress = loadDiscoveryStore().tours[tourId];
  if (progress?.version === version) return progress;
  return {
    tourId,
    version,
    state: "unseen",
    completedSteps: [],
    skippedSteps: [],
    updatedAt: Date.now(),
  };
}

export function updateTourProgress(progress: TourProgressState): void {
  const store = loadDiscoveryStore();
  store.tours[progress.tourId] = {
    ...progress,
    completedSteps: Array.from(new Set(progress.completedSteps)),
    skippedSteps: Array.from(new Set(progress.skippedSteps)),
    updatedAt: Date.now(),
  };
  saveDiscoveryStore(store);
}

export function markFeatureDiscovery(
  featureId: string,
  state: FeatureDiscoveryStatus,
): void {
  const store = loadDiscoveryStore();
  const previous = store.features[featureId];
  const now = Date.now();
  store.features[featureId] = {
    featureId,
    state,
    firstSeenAt: previous?.firstSeenAt ?? now,
    firstUsedAt:
      state === "tried" || state === "mastered"
        ? (previous?.firstUsedAt ?? now)
        : previous?.firstUsedAt,
    lastUsedAt: state === "tried" || state === "mastered" ? now : previous?.lastUsedAt,
  };
  saveDiscoveryStore(store);
}

export function recordOnboardingAnalytics(
  event: Omit<OnboardingAnalyticsEvent, "createdAt">,
): void {
  const store = loadDiscoveryStore();
  store.analytics = [
    ...store.analytics.slice(-(maxAnalyticsEvents - 1)),
    { ...event, createdAt: Date.now() },
  ];
  saveDiscoveryStore(store);
}
