import { describe, it, expect } from "vitest";
import { runPdfComplianceChecks } from "../pdfCompliance";
import type { PdfComplianceSettings } from "../../types";

const defaultSettings: PdfComplianceSettings = {
  enabled: true,
  checkPageCount: true,
  maxPages: 8,
  checkUnreferencedFigures: true,
  checkUncitedCitations: true,
  checkSectionsWithNoCitations: true,
  checkType3Fonts: true,
  checkAbstractWordCount: true,
  maxAbstractWords: 250,
};

function makeDoc(body: string): string {
  return "\\documentclass{article}\n\\begin{document}\n" + body + "\n\\end{document}\n";
}

describe("runPdfComplianceChecks", () => {
  it("returns empty when disabled", () => {
    const result = runPdfComplianceChecks("content", "output", {
      ...defaultSettings,
      enabled: false,
    });
    expect(result).toHaveLength(0);
  });

  it("returns empty when content is empty", () => {
    const result = runPdfComplianceChecks("", "output", defaultSettings);
    expect(result).toHaveLength(0);
  });

  it("reports nothing for a paper that passes every check", () => {
    const content = makeDoc("Hello.");
    const output = "Output written on paper.pdf (8 pages, 12345 bytes).";
    const result = runPdfComplianceChecks(content, output, defaultSettings);
    // Passing checks are not problems; they must not show up in the list.
    expect(result).toHaveLength(0);
  });

  describe("Page count", () => {
    it("warns when PDF exceeds page limit", () => {
      const content = makeDoc("Hello.");
      const output = "Output written on paper.pdf (10 pages, 12345 bytes).";
      const result = runPdfComplianceChecks(content, output, defaultSettings);
      expect(
        result.some((d) => d.message.includes("exceed") || d.message.includes("pages")),
      ).toBe(true);
    });

    it("skips page check when no output", () => {
      const content = makeDoc("Hello.");
      const result = runPdfComplianceChecks(content, "", defaultSettings);
      const pageIssues = result.filter((d) => d.message.toLowerCase().includes("page"));
      expect(pageIssues.length).toBe(0);
    });

    it("skips page check when disabled", () => {
      const content = makeDoc("Hello.");
      const output = "Output written on paper.pdf (10 pages, 12345 bytes).";
      const result = runPdfComplianceChecks(content, output, {
        ...defaultSettings,
        checkPageCount: false,
      });
      expect(
        result.some(
          (d) =>
            d.message.toLowerCase().includes("page") &&
            d.message.toLowerCase().includes("limit"),
        ),
      ).toBe(false);
    });
  });

  describe("Unreferenced figures", () => {
    it("detects unreferenced figure label", () => {
      const doc = makeDoc(
        "\\begin{figure}\\label{fig:myplot}\\caption{A plot}\\end{figure}",
      );
      const result = runPdfComplianceChecks(doc, "", defaultSettings);
      expect(result.some((d) => d.message.includes("never referenced"))).toBe(true);
    });

    it("passes when figure is referenced", () => {
      const doc = makeDoc(
        "\\begin{figure}\\label{fig:myplot}\\caption{A plot}\\end{figure} As shown in \\ref{fig:myplot}.",
      );
      const result = runPdfComplianceChecks(doc, "", defaultSettings);
      expect(result.some((d) => d.message.includes("never referenced"))).toBe(false);
    });

    it("handles figures without labels", () => {
      const doc = makeDoc("\\begin{figure}\\caption{No label}\\end{figure}");
      const result = runPdfComplianceChecks(doc, "", defaultSettings);
      const noLabelDiags = result.filter((d) => d.message.includes("no \\\\label"));
      expect(Array.isArray(result)).toBe(true);
    });

    it("skips figure check when disabled", () => {
      const doc = makeDoc("\\begin{figure}\\label{fig:x}\\caption{X}\\end{figure}");
      const result = runPdfComplianceChecks(doc, "", {
        ...defaultSettings,
        checkUnreferencedFigures: false,
      });
      expect(result.some((d) => d.message.includes("never referenced"))).toBe(false);
    });
  });

  describe("Uncited citations", () => {
    it("detects uncited bibliography entry", () => {
      const doc = makeDoc(
        "\\begin{thebibliography}\\bibitem{ref1} Author, 2024.\\end{thebibliography}",
      );
      const result = runPdfComplianceChecks(doc, "", defaultSettings);
      expect(result.some((d) => d.message.includes("never cited"))).toBe(true);
    });

    it("passes when all entries are cited", () => {
      const doc = makeDoc(
        "See \\cite{ref1}.\\begin{thebibliography}\\bibitem{ref1} Author, 2024.\\end{thebibliography}",
      );
      const result = runPdfComplianceChecks(doc, "", defaultSettings);
      expect(result.some((d) => d.message.includes("never cited"))).toBe(false);
    });

    it("skips citation check when disabled", () => {
      const doc = makeDoc(
        "\\begin{thebibliography}\\bibitem{ref1} A.\\end{thebibliography}",
      );
      const result = runPdfComplianceChecks(doc, "", {
        ...defaultSettings,
        checkUncitedCitations: false,
      });
      expect(result.some((d) => d.message.includes("never cited"))).toBe(false);
    });
  });

  describe("Sections with no citations", () => {
    it("detects section without citations", () => {
      const doc = makeDoc("\\section{Method}\nWe do X.");
      const result = runPdfComplianceChecks(doc, "", defaultSettings);
      expect(result.some((d) => d.message.includes("no citations"))).toBe(true);
    });

    it("passes section with citations", () => {
      const doc = makeDoc("\\section{Method}\nWe do X based on \\cite{ref1}.");
      const result = runPdfComplianceChecks(doc, "", defaultSettings);
      expect(result.some((d) => d.message.includes("no citations"))).toBe(false);
    });

    it("skips section citation check when disabled", () => {
      const doc = makeDoc("\\section{Method}\nNo cites.");
      const result = runPdfComplianceChecks(doc, "", {
        ...defaultSettings,
        checkSectionsWithNoCitations: false,
      });
      expect(result.some((d) => d.message.includes("no citations"))).toBe(false);
    });
  });

  describe("Type 3 fonts", () => {
    it("detects Type 3 fonts in output", () => {
      const result = runPdfComplianceChecks(
        "Content",
        "This PDF uses Type 3 fonts.",
        defaultSettings,
      );
      expect(result.some((d) => d.message.includes("Type 3"))).toBe(true);
    });

    it("skips font check when no output", () => {
      const result = runPdfComplianceChecks("Content", "", defaultSettings);
      expect(
        result.some((d) => d.message.includes("font") || d.message.includes("Type 3")),
      ).toBe(false);
    });

    it("skips font check when disabled", () => {
      const result = runPdfComplianceChecks("Content", "Type 3 fonts.", {
        ...defaultSettings,
        checkType3Fonts: false,
      });
      expect(result.some((d) => d.message.includes("Type 3"))).toBe(false);
    });
  });

  describe("Abstract word count", () => {
    it("warns when abstract exceeds word limit", () => {
      const words = Array(300).fill("word").join(" ");
      const doc =
        "\\begin{document}\\begin{abstract}" + words + "\\end{abstract}\\end{document}";
      const result = runPdfComplianceChecks(doc, "", defaultSettings);
      expect(result.some((d) => d.message.includes("Abstract"))).toBe(true);
    });

    it("skips abstract word count when disabled", () => {
      const words = Array(300).fill("word").join(" ");
      const doc =
        "\\begin{document}\\begin{abstract}" + words + "\\end{abstract}\\end{document}";
      const result = runPdfComplianceChecks(doc, "", {
        ...defaultSettings,
        checkAbstractWordCount: false,
      });
      expect(result.some((d) => d.message.includes("Abstract"))).toBe(false);
    });
  });

  describe("Edge cases", () => {
    it("handles empty bibliography", () => {
      const doc = makeDoc("Hello.");
      const result = runPdfComplianceChecks(doc, "", defaultSettings);
      expect(Array.isArray(result)).toBe(true);
    });

    it("handles compile output without page info", () => {
      const doc = makeDoc("Hello.");
      const result = runPdfComplianceChecks(
        doc,
        "Some compile log without page info.",
        defaultSettings,
      );
      expect(Array.isArray(result)).toBe(true);
    });

    it("handles very large content", () => {
      const largeDoc = makeDoc(Array(5000).fill("word").join(" "));
      const result = runPdfComplianceChecks(largeDoc, "", defaultSettings);
      expect(Array.isArray(result)).toBe(true);
    });

    it("handles unicode in content", () => {
      const doc = makeDoc("∀x ∃y P(x,y)");
      const result = runPdfComplianceChecks(doc, "", defaultSettings);
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
