import { describe, it, expect } from "vitest";
import { runStructureChecks } from "../structureAssistant";
import type { StructureAssistantSettings } from "../../types";

const defaultSettings: StructureAssistantSettings = {
  enabled: true,
  checkAbstractStructure: true,
  checkIntroductionStructure: true,
  checkRelatedWorkLength: true,
  checkMethodReproducibility: true,
  checkResultsDiscussion: true,
  checkConclusionClaims: true,
};

function makeDoc(sections: Record<string, string>): string {
  let doc = "\\documentclass{article}\n\\begin{document}\n";
  for (const [name, body] of Object.entries(sections)) {
    doc += `\\section{${name}}\n${body}\n`;
  }
  doc += "\\end{document}\n";
  return doc;
}

describe("runStructureChecks", () => {
  it("returns empty when disabled", () => {
    const result = runStructureChecks("some content", {
      ...defaultSettings,
      enabled: false,
    });
    expect(result).toHaveLength(0);
  });

  it("returns empty when content is empty", () => {
    const result = runStructureChecks("", defaultSettings);
    expect(result).toHaveLength(0);
  });

  describe("Abstract structure", () => {
    it("warns when abstract is missing", () => {
      const doc = makeDoc({ Introduction: "Hello." });
      const result = runStructureChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("Abstract not found"))).toBe(true);
    });

    it("warns when abstract is too short", () => {
      const doc =
        "\\begin{document}\n\\begin{abstract}\nShort.\n\\end{abstract}\n\\end{document}";
      const result = runStructureChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("very short"))).toBe(true);
    });

    it("passes when abstract has all elements", () => {
      const doc =
        "\\begin{document}\n\\begin{abstract}\nThe problem of X remains challenging. We propose a novel method to address it. Our experiments achieve state-of-the-art results. The key contribution is a new framework. This text is now long enough to pass the word count threshold.\n\\end{abstract}\n\\end{document}";
      const result = runStructureChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("Abstract missing"))).toBe(false);
    });

    it("detects abstract with abstract command", () => {
      const doc =
        "\\begin{document}\n\\abstract{The problem is hard. We propose a novel solution. Our experimental results show improvement. The key contribution is a new framework. This text is long enough to pass the minimum word count threshold for a proper abstract. Additional sentences make this abstract longer than before. We continue writing until we exceed fifty words which is the required minimum. This should be enough now.}\n\\end{document}";
      const result = runStructureChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("very short"))).toBe(false);
    });

    it("warns about missing elements in abstract", () => {
      const doc =
        "\\begin{document}\n\\begin{abstract}\nThe problem is challenging. The text is now long enough to pass the word count threshold easily.\n\\end{abstract}\n\\end{document}";
      const result = runStructureChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("Abstract missing"))).toBe(true);
    });

    it("skips abstract checks when disabled", () => {
      const doc =
        "\\begin{document}\n\\begin{abstract}\nShort.\n\\end{abstract}\n\\end{document}";
      const result = runStructureChecks(doc, {
        ...defaultSettings,
        checkAbstractStructure: false,
      });
      expect(result.some((d) => d.message.includes("Abstract"))).toBe(false);
    });
  });

  describe("Introduction structure", () => {
    it("warns when introduction is missing", () => {
      const doc = makeDoc({ "Related Work": "Some review." });
      const result = runStructureChecks(doc, defaultSettings);
      expect(
        result.some((d) => d.message.includes("Introduction section not found")),
      ).toBe(true);
    });

    it("warns when introduction lacks elements", () => {
      const doc = makeDoc({
        Introduction: "We do X. This is a paper.",
        Method: "Something.",
      });
      const result = runStructureChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("Introduction missing"))).toBe(true);
    });

    it("passes when introduction has all elements", () => {
      const doc = makeDoc({
        Introduction:
          "This problem is important and widespread. However existing methods are limited. We propose a novel contribution. The rest of this paper is organized as follows.",
      });
      const result = runStructureChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("Introduction missing"))).toBe(
        false,
      );
    });

    it("skips introduction checks when disabled", () => {
      const doc = makeDoc({ Introduction: "Hi." });
      const result = runStructureChecks(doc, {
        ...defaultSettings,
        checkIntroductionStructure: false,
      });
      expect(result.some((d) => d.message.includes("Introduction"))).toBe(false);
    });
  });

  describe("Related Work", () => {
    it("does not require a section literally titled Related Work", () => {
      const doc = makeDoc({ Introduction: "Hello." });
      const result = runStructureChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("Related Work"))).toBe(false);
    });

    it("warns when related work is too brief", () => {
      const doc = makeDoc({
        "Related Work": "Prior work exists. It is limited.\n\\cite{ref1}",
      });
      const result = runStructureChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("too brief"))).toBe(true);
    });

    it("skips related work checks when disabled", () => {
      const doc = makeDoc({ "Related Work": "Brief." });
      const result = runStructureChecks(doc, {
        ...defaultSettings,
        checkRelatedWorkLength: false,
      });
      expect(result.some((d) => d.message.includes("Related Work"))).toBe(false);
    });
  });

  describe("Method section", () => {
    it("does not require a section literally titled Method", () => {
      const doc = makeDoc({ Introduction: "Hi." });
      const result = runStructureChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("Method"))).toBe(false);
    });

    it("warns when an ML method lacks reproducibility details", () => {
      const doc = makeDoc({
        Method:
          "We do X. Our neural network is improved by fine-tuning with gradient descent.",
      });
      const result = runStructureChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("Method section missing"))).toBe(
        true,
      );
    });

    it("does not judge non-ML methods by ML criteria", () => {
      const doc = makeDoc({ Method: "We interviewed twelve developers." });
      const result = runStructureChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("Method section missing"))).toBe(
        false,
      );
    });

    it("skips method checks when disabled", () => {
      const doc = makeDoc({ Method: "Brief." });
      const result = runStructureChecks(doc, {
        ...defaultSettings,
        checkMethodReproducibility: false,
      });
      expect(result.some((d) => d.message.includes("Method"))).toBe(false);
    });
  });

  describe("Results section", () => {
    it("does not require a section literally titled Results", () => {
      const doc = makeDoc({ Introduction: "Hi." });
      const result = runStructureChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("Results"))).toBe(false);
    });

    it("warns when results lack proper elements", () => {
      const doc = makeDoc({ Results: "Our method works well." });
      const result = runStructureChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("Results section"))).toBe(true);
    });

    it("skips results checks when disabled", () => {
      const doc = makeDoc({ Results: "Brief." });
      const result = runStructureChecks(doc, {
        ...defaultSettings,
        checkResultsDiscussion: false,
      });
      expect(result.some((d) => d.message.includes("Results"))).toBe(false);
    });
  });

  describe("Conclusion section", () => {
    it("warns when conclusion is missing", () => {
      const doc = makeDoc({ Introduction: "Hi." });
      const result = runStructureChecks(doc, defaultSettings);
      expect(
        result.some((d) => d.message.includes("Conclusion section not found")),
      ).toBe(true);
    });

    it("warns when conclusion lacks elements", () => {
      const doc = makeDoc({ Conclusion: "Hi." });
      const result = runStructureChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("Conclusion"))).toBe(true);
    });

    it("skips conclusion checks when disabled", () => {
      const doc = makeDoc({ Conclusion: "Hi." });
      const result = runStructureChecks(doc, {
        ...defaultSettings,
        checkConclusionClaims: false,
      });
      expect(result.some((d) => d.message.includes("Conclusion"))).toBe(false);
    });
  });

  describe("Edge cases", () => {
    it("handles empty input gracefully", () => {
      const result = runStructureChecks(
        "\\begin{document}\\end{document}",
        defaultSettings,
      );
      expect(Array.isArray(result)).toBe(true);
    });

    it("handles content with only preamble", () => {
      const result = runStructureChecks("\\documentclass{article}", defaultSettings);
      expect(Array.isArray(result)).toBe(true);
    });

    it("handles large content without crashing", () => {
      const largeSection = "Word ".repeat(10000);
      const doc = makeDoc({ Introduction: largeSection });
      const result = runStructureChecks(doc, defaultSettings);
      expect(Array.isArray(result)).toBe(true);
    });

    it("handles unicode math symbols", () => {
      const doc =
        "\\begin{document}\n\\begin{abstract}\n∀ problem ∃ solution. We propose a novel method. Results show improvement. Our contribution is key. This text is long enough.\n\\end{abstract}\n\\end{document}";
      const result = runStructureChecks(doc, defaultSettings);
      expect(Array.isArray(result)).toBe(true);
    });

    it("handles nested section titles", () => {
      const doc = makeDoc({
        Introduction:
          "Motivation: important. Gap: however limited. Contribution: we propose. Roadmap: section.",
      });
      const result = runStructureChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("Introduction missing"))).toBe(
        false,
      );
    });
  });
});
