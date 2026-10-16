import { describe, expect, it } from "vitest";
import { editorActivationTour } from "./index";

describe("editorActivationTour", () => {
  it("stays a short tour of the core loop", () => {
    expect(editorActivationTour.steps.length).toBeLessThanOrEqual(6);
    expect(editorActivationTour.steps.map((step) => step.id)).toEqual([
      "editor",
      "compile",
      "pdf-navigation",
      "ask-ai",
      "workspace",
    ]);
  });
});
