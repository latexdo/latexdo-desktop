import { describe, expect, it } from "vitest";
import {
  figurePreviewCandidatePaths,
  parseIncludeGraphicsAtPosition,
} from "../figurePreview";

describe("figure preview helpers", () => {
  it("finds includegraphics targets under the cursor", () => {
    const line = "\\includegraphics[width=0.7\\linewidth]{figures/plot.png}";
    const target = parseIncludeGraphicsAtPosition(line, 20);

    expect(target).toEqual(
      expect.objectContaining({
        path: "figures/plot.png",
        startColumn: 1,
        endColumn: line.length + 1,
      }),
    );
  });

  it("resolves extensionless figures beside the active tex file and project root", () => {
    expect(figurePreviewCandidatePaths("plots/loss", "sections/results.tex")).toEqual([
      "sections/plots/loss.png",
      "plots/loss.png",
      "sections/plots/loss.jpg",
      "plots/loss.jpg",
      "sections/plots/loss.jpeg",
      "plots/loss.jpeg",
      "sections/plots/loss.svg",
      "plots/loss.svg",
      "sections/plots/loss.pdf",
      "plots/loss.pdf",
    ]);
  });

  it("rejects unsafe figure paths", () => {
    expect(figurePreviewCandidatePaths("../outside", "main.tex")).toEqual([]);
    expect(figurePreviewCandidatePaths("/absolute/plot.png", "main.tex")).toEqual([]);
  });
});
