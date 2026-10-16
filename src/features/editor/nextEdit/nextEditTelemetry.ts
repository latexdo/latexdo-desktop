export type NextEditTelemetryEvent =
  | "nes_suggestion_shown"
  | "nes_suggestion_accepted"
  | "nes_suggestion_dismissed"
  | "nes_suggestion_invalidated"
  | "nes_model_request"
  | "nes_model_parse_failure"
  | "nes_model_timeout";

export interface NextEditTelemetryDimensions {
  source?: "pattern" | "semantic" | "merged";
  editKind?: "insert" | "replace" | "delete";
  latencyBucket?: string;
  confidenceBucket?: string;
  providerKind?: "local" | "ollama" | "cloud" | "none";
}

export function recordNextEditTelemetry(
  _event: NextEditTelemetryEvent,
  _dimensions: NextEditTelemetryDimensions = {},
): void {
  // Intentionally no-op until LatexDo has a product telemetry sink. Do not log
  // old text, replacement text, or document context here.
}
