import { describe, expect, it } from "vitest";
import { generateRebuttalLetter } from "../rebuttalGenerator";
import type { RebuttalGeneratorSettings, RebuttalItem } from "../types";

const settings: RebuttalGeneratorSettings = {
  manuscriptId: "D-1",
  manuscriptTitle: "A Test Manuscript",
  fontSize: "11pt",
  paperSize: "a4paper",
  fontFamily: "newpx",
  includeDiff: true,
  diffOldFile: "old.tex",
  diffNewFile: "new.tex",
  diffOutput: "diff.tex",
  summaryText: "Summary.",
  useOnehalfSpacing: false,
  colorPrimary: "1E1E1E",
  colorAccent: "D9D9D9",
};

describe("generateRebuttalLetter", () => {
  it("renders text, reviewer comment, author answer, and diff in order", () => {
    const item: RebuttalItem = {
      id: "1",
      originalText: "The old claim.",
      revisedText: "The revised claim.",
      reviewerComment: "Please clarify the claim.",
      authorComment: "We clarified the claim.",
      modificationMade: "The revised claim.",
    };

    const tex = generateRebuttalLetter([item], settings);
    const textIndex = tex.indexOf("\\begin{OriginalText}");
    const reviewerIndex = tex.indexOf("\\begin{ReviewerComment}");
    const answerIndex = tex.indexOf("\\begin{AuthorResponse}");
    const diffIndex = tex.indexOf("\\begin{ManuscriptChangeDiff}");

    expect(textIndex).toBeGreaterThan(-1);
    expect(reviewerIndex).toBeGreaterThan(textIndex);
    expect(answerIndex).toBeGreaterThan(reviewerIndex);
    expect(diffIndex).toBeGreaterThan(answerIndex);
    expect(tex).toContain("- The old claim.");
    expect(tex).toContain("+ The revised claim.");
  });

  it("emits valid environment parameters in the ReviewCard header", () => {
    const tex = generateRebuttalLetter([], settings);

    // ##1 inside \newenvironment expands to a literal "#" and makes pdflatex
    // fail with "You can't use `macro parameter character #'".
    expect(tex).toContain("{\\color{white}\\bfseries #1 \\hfill #2}");
    expect(tex).not.toContain("##1");
  });

  it("escapes LaTeX special characters in user-provided text", () => {
    const item: RebuttalItem = {
      id: "1",
      originalText: "Accuracy is 90% on data_set_A.",
      revisedText: "Accuracy is 95% on data_set_A & data_set_B.",
      reviewerComment: "What about $x_i$ and ref #12?",
      authorComment: "We added ~5 baselines and a \\newcommand table.",
      modificationMade: "Accuracy is 95% on data_set_A & data_set_B.",
    };

    const tex = generateRebuttalLetter([item], {
      ...settings,
      manuscriptTitle: "neural_nets & robustness #1",
    });

    expect(tex).toContain("neural\\_nets \\& robustness \\#1");
    expect(tex).toContain("Accuracy is 90\\% on data\\_set\\_A.");
    expect(tex).toContain("What about \\$x\\_i\\$ and ref \\#12?");
    expect(tex).toContain(
      "We added \\textasciitilde{}5 baselines and a \\textbackslash{}newcommand table.",
    );
  });

  it("quotes filenames in the latexdiff command instead of LaTeX-escaping them", async () => {
    const { latexdiffCommand } = await import("../rebuttalGenerator");
    const command = latexdiffCommand({
      ...settings,
      diffOldFile: "old_version.tex",
      diffNewFile: "new_version.tex",
      diffOutput: "diff_out.tex",
    });

    expect(command).toBe(
      'latexdiff "old_version.tex" "new_version.tex" > "diff_out.tex"',
    );
  });

  it("preserves a pasted unified diff as the changes block", () => {
    const item: RebuttalItem = {
      id: "1",
      reviewerComment: "Please update this.",
      authorComment: "Updated.",
      modificationMade:
        "--- Original\n+++ Revised\n@@ Manuscript change @@\n- old\n+ new",
    };

    const tex = generateRebuttalLetter([item], settings);

    expect(tex).toContain(
      "--- Original\n+++ Revised\n@@ Manuscript change @@\n- old\n+ new",
    );
  });
});
