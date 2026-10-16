import { describe, it, expect } from "vitest";
import { runStructureChecks } from "../structureAssistant";
import type { StructureAssistantSettings } from "../../types";

const full: StructureAssistantSettings = {
  enabled: true,
  checkAbstractStructure: true,
  checkIntroductionStructure: true,
  checkRelatedWorkLength: true,
  checkMethodReproducibility: true,
  checkResultsDiscussion: true,
  checkConclusionClaims: true,
};

function body(content: string): string {
  return (
    "\\documentclass{article}\n\\begin{document}\n" + content + "\n\\end{document}\n"
  );
}

// ── Abstract presence variants ───────────────────────────────────────────
const abstractVariants = [
  { content: "\\begin{abstract}This is a test.\\end{abstract}", hasAbstract: true },
  { content: "", hasAbstract: false },
  { content: "\\section{Introduction}Hello.", hasAbstract: false },
  { content: "\\begin{abstract}Short.\\end{abstract}", hasAbstract: true },
];
describe("Abstract detection — parameterized", () => {
  it.each(abstractVariants)(
    "content=$content → has=$hasAbstract",
    ({ content, hasAbstract }) => {
      const result = runStructureChecks(body(content), full);
      expect(result.some((d) => d.message.includes("Abstract not found"))).toBe(
        !hasAbstract,
      );
    },
  );
});

// ── Introduction detection ─────────────────────────────────────────────
const introVariants = [
  {
    content: "\\section{Introduction}Hello.\\section{Background}More.",
    hasIntro: true,
  },
  { content: "", hasIntro: false },
];
describe("Introduction detection — parameterized", () => {
  it.each(introVariants)(
    "content=$content → hasIntro=$hasIntro",
    ({ content, hasIntro }) => {
      const result = runStructureChecks(body(content), full);
      expect(
        result.some((d) => d.message.includes("Introduction section not found")),
      ).toBe(!hasIntro);
    },
  );
});

// ── Conclusion detection ─────────────────────────────────────────────────
const conclusionVariants = [
  { content: "\\section{Conclusion}Summary.", hasConclusion: true },
  {
    content: "\\section{Conclusion}Summary.\\section*{Acknowledgments}",
    hasConclusion: true,
  },
  { content: "\\section{Results}Data.", hasConclusion: false },
  { content: "\\section{Discussion}Implications.", hasConclusion: false },
];
describe("Conclusion detection — parameterized", () => {
  it.each(conclusionVariants)(
    "$content → hasConclusion=$hasConclusion",
    ({ content, hasConclusion }) => {
      const result = runStructureChecks(body(content), full);
      const conclusionIssues = result.filter((d) =>
        d.message.includes("Conclusion section not found"),
      );
      if (hasConclusion) {
        expect(conclusionIssues).toHaveLength(0);
      } else {
        expect(conclusionIssues.length).toBeGreaterThanOrEqual(1);
      }
    },
  );
});

// ── Check toggling ──────────────────────────────────────────────────────
type CheckField = keyof Omit<StructureAssistantSettings, "enabled">;
const checkToggles: [string, CheckField, string][] = [
  ["abstract", "checkAbstractStructure", "Abstract not found"],
  ["introduction", "checkIntroductionStructure", "Introduction section not found"],
  ["related work", "checkRelatedWorkLength", "Related Work section is too brief"],
  ["method", "checkMethodReproducibility", "Method section missing"],
  ["conclusion", "checkConclusionClaims", "Conclusion section not found"],
];
describe("Check toggling — parameterized", () => {
  it.each(checkToggles)("disabling %s removes its diagnostics", (name, field, msg) => {
    const doc = body(
      "\\section{Related Work}Brief.\\section{Method}Our neural network is improved by fine-tuning with gradient descent.\\section{Results}Data.",
    );
    const enabled = runStructureChecks(doc, { ...full, [field]: true });
    const disabled = runStructureChecks(doc, { ...full, [field]: false });
    expect(enabled.some((d) => d.message.includes(msg))).toBe(true);
    expect(disabled.some((d) => d.message.includes(msg))).toBe(false);
  });
});

// ── Edge cases ──────────────────────────────────────────────────────────
const edgeCases = [
  { desc: "empty document", doc: body("") },
  { desc: "no sections", doc: body("Just plain text without any sections.") },
  { desc: "unicode content", doc: body("\\section{∀ntroduction}∃xample.") },
  {
    desc: "many sections",
    doc: body(
      Array(20)
        .fill(null)
        .map((_, i) => `\\section{Section ${i}}Content.`)
        .join("\n"),
    ),
  },
  {
    desc: "nested sections",
    doc: body("\\section{Main}\\subsection{Sub}\\subsubsection{Subsub}Content."),
  },
];
describe("Edge cases — parameterized", () => {
  it.each(edgeCases)("handles $desc", ({ doc }) => {
    const result = runStructureChecks(doc, full);
    expect(Array.isArray(result)).toBe(true);
  });
});
