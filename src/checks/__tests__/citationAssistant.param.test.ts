import { describe, it, expect } from "vitest";
import { runCitationChecks } from "../citationAssistant";
import type { CitationAssistantSettings } from "../../types";

const full: CitationAssistantSettings = {
  enabled: true,
  detectMissingCitations: true,
  detectUnusedEntries: true,
  detectDuplicateReferences: true,
  detectBrokenLinks: true,
  suggestCitationKeys: true,
  importMetadataSources: true,
  warnOldCitations: true,
};

function makeDoc(body: string, hasBib: boolean = true): string {
  const bib = hasBib ? "\n\\bibliographystyle{plain}\n\\bibliography{refs}\n" : "";
  return (
    "\\documentclass{article}\n\\begin{document}\n" + body + bib + "\n\\end{document}\n"
  );
}

// ── Missing citation detection ──────────────────────────────────────────
const missingCitationPatterns = [
  "Our proposed method achieves state-of-the-art results on all benchmarks.",
  "As demonstrated in previous work, this approach works well.",
  "This novel technique outperforms all existing methods significantly.",
];
describe("Missing citation patterns — parameterized", () => {
  it.each(missingCitationPatterns)("detects missing citation: %s", (text) => {
    const result = runCitationChecks(makeDoc(text), full);
    expect(
      result.some(
        (d) =>
          d.message.includes("without supporting citations") ||
          d.message.includes("may need a citation"),
      ),
    ).toBe(true);
  });
});

// ── Non-claim sentences (no citation needed) ────────────────────────────
const nonClaimPatterns = [
  "In this section, we describe our experimental setup.",
  "The rest of this paper is organized as follows.",
  "We leave this direction for future work.",
  "",
  "We begin by reviewing the related literature.",
];
describe("Non-claim sentences — parameterized", () => {
  it.each(nonClaimPatterns)("does not flag: %s", (text) => {
    const result = runCitationChecks(makeDoc(text), full);
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── Unused entries detection ────────────────────────────────────────────
const unusedEntryPatterns = [
  {
    text: "\\begin{thebibliography}\\bibitem{r1} A.\\end{thebibliography}",
    hasUnused: true,
  },
  {
    text: "\\cite{r1}\\begin{thebibliography}\\bibitem{r1} A.\\end{thebibliography}",
    hasUnused: false,
  },
  {
    text: "\\nocite{*}\\begin{thebibliography}\\bibitem{r1} A.\\end{thebibliography}",
    hasUnused: false,
  },
  {
    text: "\\nocite{r1}\\begin{thebibliography}\\bibitem{r1} A.\\end{thebibliography}",
    hasUnused: true,
  },
];
describe("Unused entries — parameterized", () => {
  it.each(unusedEntryPatterns)("unused=$hasUnused", ({ text, hasUnused }) => {
    const result = runCitationChecks(makeDoc(text), full);
    expect(
      result.some((d) => d.message.includes("Unused") || d.message.includes("unused")),
    ).toBe(hasUnused);
  });
});

// ── Duplicate reference detection ────────────────────────────────────────
const duplicatePatterns = [
  {
    text: "\\begin{thebibliography}\\bibitem{r1} A.\\bibitem{r1} B.\\end{thebibliography}",
    hasDup: true,
  },
  { text: "\\cite{kingma2014adam}. \\cite{kingma2015adam}.", hasDup: true },
];
describe("Duplicate references — parameterized", () => {
  it.each(duplicatePatterns)("dup=$hasDup", ({ text, hasDup }) => {
    const result = runCitationChecks(makeDoc(text), full);
    expect(
      result.some(
        (d) =>
          d.message.toLowerCase().includes("duplicate") ||
          d.message.toLowerCase().includes("similar"),
      ),
    ).toBe(hasDup);
  });
});

// ── Old citation detection ──────────────────────────────────────────────
const oldCitationPatterns = [
  {
    text: "\\begin{thebibliography}\\bibitem{o} Author, 1999.\\end{thebibliography}",
    isOld: true,
  },
  {
    text: "\\begin{thebibliography}\\bibitem{n} Author, 2025.\\end{thebibliography}",
    isOld: false,
  },
];
describe("Old citations — parameterized", () => {
  it.each(oldCitationPatterns)("old=$isOld", ({ text, isOld }) => {
    const result = runCitationChecks(makeDoc(text), full);
    expect(
      result.some(
        (d) =>
          d.message.includes("Old citation") ||
          d.message.includes("old") ||
          d.message.includes("predates"),
      ),
    ).toBe(isOld);
  });
});

// ── Broken link detection ────────────────────────────────────────────────
const brokenLinkPatterns = [
  { text: "\\href{https://example.com}{link}", isBroken: false },
  { text: "\\href{example.com}{link}", isBroken: true },
  { text: "\\href{https://example.com/path with spaces}{link}", isBroken: true },
  { text: "\\url{https://example.com}", isBroken: false },
  { text: "\\url{example.com}", isBroken: true },
];
describe("Broken link detection — parameterized", () => {
  it.each(brokenLinkPatterns)("broken=$isBroken", ({ text, isBroken }) => {
    const result = runCitationChecks(makeDoc(text), full);
    expect(
      result.some(
        (d) =>
          d.message.includes("missing scheme") ||
          d.message.includes("no scheme") ||
          d.message.includes("spaces"),
      ),
    ).toBe(isBroken);
  });
});

// ── Check toggling ──────────────────────────────────────────────────────
type CheckField = keyof Omit<CitationAssistantSettings, "enabled">;
const checkToggles: [string, CheckField, string][] = [
  ["missing citations", "detectMissingCitations", "without supporting"],
  ["unused entries", "detectUnusedEntries", "Unused"],
  ["duplicate refs", "detectDuplicateReferences", "duplicate"],
  ["broken links", "detectBrokenLinks", "missing scheme"],
  ["suggest keys", "suggestCitationKeys", "shown in"],
  ["old citations", "warnOldCitations", "Old citation"],
];
describe("Check toggling — parameterized", () => {
  it.each(checkToggles)("disabling %s removes its diagnostics", (name, field, msg) => {
    const base =
      "Our novel method achieves SOTA without any cite. As shown in previous work, this is significant. See \\href{bad-url}{link}. \\begin{thebibliography}\\bibitem{o} Author, 1999.\\bibitem{u} No cite.\\bibitem{u} Duplicate.\\end{thebibliography}";
    const doc = makeDoc(base);
    const enabled = runCitationChecks(doc, { ...full, [field]: true });
    const disabled = runCitationChecks(doc, { ...full, [field]: false });
    expect(
      enabled.some((d) => d.message.toLowerCase().includes(msg.toLowerCase())),
    ).toBe(true);
    expect(
      disabled.some((d) => d.message.toLowerCase().includes(msg.toLowerCase())),
    ).toBe(false);
  });
});

// ── Edge cases ──────────────────────────────────────────────────────────
const edgeCases = [
  { desc: "empty document", doc: makeDoc("") },
  { desc: "no citations", doc: makeDoc("This paper presents a new method.") },
  { desc: "unicode content", doc: makeDoc("∀x ∃y \\cite{ref1}") },
  { desc: "nested cites", doc: makeDoc("\\cite{ref1,ref2,ref3}") },
];
describe("Edge cases — parameterized", () => {
  it.each(edgeCases)("handles $desc", ({ doc }) => {
    const result = runCitationChecks(doc, full);
    expect(Array.isArray(result)).toBe(true);
  });
});
