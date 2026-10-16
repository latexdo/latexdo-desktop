import type { ProductEvent } from "./ProductEvents";

export type TourMode = "explain" | "demonstrate" | "user-action";

export interface TourDefinition {
  id: string;
  version: number;
  title: string;
  intro: string;
  steps: TourStep[];
}

export interface TourStep {
  id: string;
  featureId: string;
  targetId: string;
  /** Area to highlight when the target control is not rendered. */
  fallbackTargetId?: string;
  title: string;
  body: string;
  mode: TourMode;
  /** Button label for steps without an expected event. */
  cta?: string;
  expectedEvent?: ProductEvent["type"];
  success: string;
}

export type TourRuntimeState =
  | "idle"
  | "preparing"
  | "showing"
  | "waiting-for-user"
  | "success"
  | "transitioning"
  | "paused"
  | "completed";
