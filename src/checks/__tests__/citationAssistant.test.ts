import { describe, it, expect } from "vitest";
import { runCitationChecks } from "../citationAssistant";
import type { CitationAssistantSettings } from "../../types";

const defaultSettings: CitationAssistantSettings = {
  enabled: true,
  detectMissingCitations: true,
  detectUnusedEntries: true,
  detectDuplicateReferences: true,
  detectBrokenLinks: true,
  suggestCitationKeys: true,
  importMetadataSources: true,
  warnOldCitations: true,
};

function makeDoc(body: string): string {
  return "\\documentclass{article}\n\\begin{document}\n" + body + "\n\\end{document}\n";
}

describe("runCitationChecks", () => {
  it("returns empty when disabled", () => {
    expect(
      runCitationChecks("content", { ...defaultSettings, enabled: false }),
    ).toHaveLength(0);
  });

  it("returns empty for empty content", () => {
    expect(runCitationChecks("", defaultSettings)).toHaveLength(0);
  });

  describe("Missing citations", () => {
    it("detects missing citations in claim paragraphs", () => {
      const doc = makeDoc(
        "Our proposed method achieves state-of-the-art results on all benchmarks.",
      );
      const result = runCitationChecks(doc, defaultSettings);
      expect(
        result.some((d) => d.message.includes("without supporting citations")),
      ).toBe(true);
    });

    it("passes when claims have citations", () => {
      const doc = makeDoc(
        "Our proposed method achieves state-of-the-art results \\cite{ref1}.",
      );
      const result = runCitationChecks(doc, defaultSettings);
      expect(
        result.some((d) => d.message.includes("without supporting citations")),
      ).toBe(false);
    });

    it("skips when disabled", () => {
      const doc = makeDoc("Our proposed method is novel.");
      const result = runCitationChecks(doc, {
        ...defaultSettings,
        detectMissingCitations: false,
      });
      expect(result.some((d) => d.message.includes("without supporting"))).toBe(false);
    });
  });

  describe("Unused bibliography entries", () => {
    it("detects unused bibitem", () => {
      const doc = makeDoc(
        "\\begin{thebibliography}\\bibitem{ref1} Author.\\end{thebibliography}",
      );
      const result = runCitationChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("Unused"))).toBe(true);
    });

    it("passes when all bibitems are cited", () => {
      const doc = makeDoc(
        "See \\cite{ref1}.\\begin{thebibliography}\\bibitem{ref1} Author.\\end{thebibliography}",
      );
      const result = runCitationChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("Unused"))).toBe(false);
    });

    it("handles nocite star", () => {
      const doc = makeDoc(
        "\\nocite{*}\\begin{thebibliography}\\bibitem{ref1} Author.\\end{thebibliography}",
      );
      const result = runCitationChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("Unused"))).toBe(false);
    });

    it("skips when disabled", () => {
      const doc = makeDoc(
        "\\begin{thebibliography}\\bibitem{ref1} A.\\end{thebibliography}",
      );
      const result = runCitationChecks(doc, {
        ...defaultSettings,
        detectUnusedEntries: false,
      });
      expect(result.some((d) => d.message.includes("Unused"))).toBe(false);
    });
  });

  describe("Duplicate references", () => {
    it("detects duplicate bibitem keys", () => {
      const doc = makeDoc(
        "\\begin{thebibliography}\\bibitem{ref1} A.\\bibitem{ref1} B.\\end{thebibliography}",
      );
      const result = runCitationChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("Duplicate"))).toBe(true);
    });

    it("reports the duplicate bibitem at the line of the repeated entry", () => {
      const doc = makeDoc(
        [
          "\\begin{thebibliography}{9}",
          "\\bibitem{ref1} First entry.",
          "\\bibitem{ref2} Second entry.",
          "\\bibitem{ref1} Duplicate entry.",
          "\\end{thebibliography}",
        ].join("\n"),
      );
      const duplicate = runCitationChecks(doc, defaultSettings).find((d) =>
        d.message.includes("Duplicate"),
      );
      const expectedLine =
        doc.split("\n").findIndex((line) => line.includes("Duplicate entry")) + 1;

      expect(duplicate).toBeDefined();
      expect(duplicate?.line).toBe(expectedLine);
    });

    it("detects similar citation keys", () => {
      const doc = makeDoc("\\cite{kingma2014adam}. \\cite{kingma2015adam}.");
      const result = runCitationChecks(doc, defaultSettings);
      expect(
        result.some(
          (d) => d.message.includes("duplicate") || d.message.includes("similar"),
        ),
      ).toBe(true);
    });

    it("skips when disabled", () => {
      const doc = makeDoc("\\cite{ref1}. \\cite{ref1}.");
      const result = runCitationChecks(doc, {
        ...defaultSettings,
        detectDuplicateReferences: false,
      });
      expect(result.some((d) => d.message.includes("duplicate"))).toBe(false);
    });
  });

  describe("Broken links", () => {
    it("detects URL without scheme", () => {
      const doc = makeDoc("\\href{example.com}{link}");
      const result = runCitationChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("missing scheme"))).toBe(true);
    });

    it("detects URL with spaces", () => {
      const doc = makeDoc("\\href{https://example.com/path with spaces}{link}");
      const result = runCitationChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("spaces"))).toBe(true);
    });

    it("passes valid URLs", () => {
      const doc = makeDoc("\\href{https://example.com}{link}");
      const result = runCitationChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("missing scheme"))).toBe(false);
    });

    it("detects URL without scheme in url command", () => {
      const doc = makeDoc("\\url{example.com}");
      const result = runCitationChecks(doc, defaultSettings);
      expect(
        result.some(
          (d) =>
            d.message.includes("missing scheme") || d.message.includes("no scheme"),
        ),
      ).toBe(true);
    });

    it("detects bare DOI in text", () => {
      const doc = makeDoc("See 10.1234/abcd1234 for details.");
      const result = runCitationChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("Bare DOI"))).toBe(true);
    });

    it("skips when disabled", () => {
      const doc = makeDoc("\\href{bad-url}{link}");
      const result = runCitationChecks(doc, {
        ...defaultSettings,
        detectBrokenLinks: false,
      });
      expect(result.some((d) => d.message.includes("URL"))).toBe(false);
    });
  });

  describe("Citation key suggestions", () => {
    it("suggests citations for claim sentences", () => {
      const doc = makeDoc(
        "As demonstrated in previous work, this approach works well.",
      );
      const result = runCitationChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("may need a citation"))).toBe(true);
    });

    it("skips sentences already with citations", () => {
      const doc = makeDoc("As demonstrated in \\cite{ref1}, this approach works well.");
      const result = runCitationChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("may need a citation"))).toBe(false);
    });

    it("skips when disabled", () => {
      const doc = makeDoc("As shown in previous work.");
      const result = runCitationChecks(doc, {
        ...defaultSettings,
        suggestCitationKeys: false,
      });
      expect(result.some((d) => d.message.includes("may need"))).toBe(false);
    });
  });

  describe("Old citations", () => {
    it("warns about old citations (pre-2020)", () => {
      const doc = makeDoc(
        "\\begin{thebibliography}\\bibitem{oldref} Author, 1999.\\end{thebibliography}",
      );
      const result = runCitationChecks(doc, defaultSettings);
      expect(
        result.some(
          (d) => d.message.includes("Old citation") || d.message.includes("old"),
        ),
      ).toBe(true);
    });

    it("passes recent citations", () => {
      const doc = makeDoc(
        "\\begin{thebibliography}\\bibitem{newref} Author, 2025.\\end{thebibliography}",
      );
      const result = runCitationChecks(doc, defaultSettings);
      expect(
        result.some(
          (d) =>
            d.message.includes("Old citation") ||
            d.message.includes("old") ||
            d.message.includes("predates"),
        ),
      ).toBe(false);
    });

    it("skips when disabled", () => {
      const doc = makeDoc(
        "\\begin{thebibliography}\\bibitem{old} Author, 1980.\\end{thebibliography}",
      );
      const result = runCitationChecks(doc, {
        ...defaultSettings,
        warnOldCitations: false,
      });
      expect(result.some((d) => d.message.includes("Old citation"))).toBe(false);
    });

    it("summarizes with the newest citation year even when it is not last", () => {
      const doc = makeDoc(
        [
          "\\begin{thebibliography}{9}",
          "\\bibitem{newer} Author, 2015.",
          "\\bibitem{older} Author, 2001.",
          "\\end{thebibliography}",
        ].join("\n"),
      );
      const summary = runCitationChecks(doc, defaultSettings).find((d) =>
        d.message.startsWith("All citations are from"),
      );

      expect(summary).toBeDefined();
      expect(summary?.message).toContain("2015");
    });
  });

  describe("Edge cases", () => {
    it("handles empty bibliography", () => {
      const doc = makeDoc("Hello.");
      const result = runCitationChecks(doc, defaultSettings);
      expect(Array.isArray(result)).toBe(true);
    });

    it("handles very large content", () => {
      const doc = makeDoc(Array(5000).fill("word").join(" ") + " \\cite{ref1} ");
      const result = runCitationChecks(doc, defaultSettings);
      expect(Array.isArray(result)).toBe(true);
    });

    it("handles multiple citation commands", () => {
      const doc = makeDoc("\\cite{ref1,ref2,ref3} and \\citep{ref4}.");
      const result = runCitationChecks(doc, defaultSettings);
      expect(Array.isArray(result)).toBe(true);
    });

    it("handles document with no content issues", () => {
      const doc = makeDoc("Simple text without claims.");
      const result = runCitationChecks(doc, defaultSettings);
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
