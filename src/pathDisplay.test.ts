import { describe, expect, it } from "vitest";
import { fileNameForDisplay, pathForDisplay } from "./pathDisplay";

describe("path display helpers", () => {
  it("decodes percent-encoded path segments for UI labels", () => {
    expect(pathForDisplay("chapters/My%20Paper%20Draft.tex")).toBe(
      "chapters/My Paper Draft.tex",
    );
    expect(fileNameForDisplay("/tmp/My%20Figure.pdf")).toBe("My Figure.pdf");
  });

  it("leaves malformed percent escapes visible instead of throwing", () => {
    expect(pathForDisplay("figures/100% complete%20draft.png")).toBe(
      "figures/100% complete draft.png",
    );
  });
});
