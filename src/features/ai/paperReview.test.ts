import { describe, expect, it } from "vitest";
import { expandSlashCommand } from "./aiMentions";
import {
  buildPaperReviewPrompt,
  describeLanguage,
  paperReviewDisplayText,
  type PaperReviewContext,
} from "./paperReview";

const fullAccess = {
  chatHistory: true,
  currentEditor: true,
  projectFiles: true,
  bibliography: true,
  researcherProfile: true,
};

function context(overrides: Partial<PaperReviewContext> = {}): PaperReviewContext {
  return {
    projectName: "oracle-gap",
    rootFile: "main.tex",
    engine: "pdflatex",
    activeFilePath: "sections/method.tex",
    access: fullAccess,
    proofreading: { enabled: true, language: "en-GB", motherTongue: "fr", picky: true },
    spellCheckLanguages: ["en-GB"],
    lastBuild: null,
    ...overrides,
  };
}

describe("paper review prompt", () => {
  it("carries the author's settings into the review", () => {
    const prompt = buildPaperReviewPrompt(context());

    expect(prompt).toContain(
      'Project "oracle-gap", root file `main.tex`, built with pdflatex',
    );
    expect(prompt).toContain("British English (en-GB)");
    expect(prompt).toContain("native language is French (fr)");
    expect(prompt).toContain("typical of French speakers");
    expect(prompt).toContain("picky checking");
    expect(prompt).toContain("`sections/method.tex` open. Review the whole paper");
    expect(prompt).toContain("has not been built in this session yet");
  });

  it("works through the whole project with the agent's real tools, without editing", () => {
    const prompt = buildPaperReviewPrompt(context());

    expect(prompt).toContain("Call list_files, then read the root file");
    expect(prompt).toContain("\\input, \\include, \\subfile or \\import, recursively");
    expect(prompt).toContain("Call compile");
    for (const kind of [
      "structure",
      "citations",
      "conference",
      "reproducibility",
      "acronyms",
      "notation",
      "pdf-compliance",
    ]) {
      expect(prompt).toContain(kind);
    }
    expect(prompt).toContain("Do not edit any file during the review");
    expect(prompt).toContain("### Major issues");
    expect(prompt).toContain("### Revision checklist");
    expect(prompt).toContain("Never invent content");
  });

  it("reviews only the open file when project file access is off", () => {
    const prompt = buildPaperReviewPrompt(
      context({ access: { ...fullAccess, projectFiles: false, bibliography: false } }),
    );

    expect(prompt).toContain("call get_active_document and review only the open file");
    expect(prompt).not.toContain("Call list_files");
    expect(prompt).toContain("do not call recommend_citations");
  });

  it("reports the last build and checks earlier reviews and the author's notes", () => {
    const prompt = buildPaperReviewPrompt(
      context({
        lastBuild: {
          ok: false,
          errors: ["main.tex:12 Undefined control sequence"],
          warningCount: 3,
        },
        previousReviews: [
          {
            reviewer: "Reviewer 2",
            comment: "The baselines are outdated.",
            response: "We added two baselines.",
          },
        ],
        annotations: [
          {
            filePath: "main.tex",
            excerpt: "We prove convergence",
            comments: ["Is this only for convex losses?"],
          },
        ],
        researchSpaceFolders: [
          { name: "paper", kind: "paper" },
          { name: "refs", kind: "bibliography" },
        ],
        hasResearcherProfile: true,
        focus: "the experiments",
      }),
    );

    expect(prompt).toContain(
      'failed with 1 error(s), for example: "main.tex:12 Undefined control sequence"',
    );
    expect(prompt).toContain("Reviewer 2: The baselines are outdated.");
    expect(prompt).toContain("Author's response: We added two baselines.");
    expect(prompt).toContain("### Previous reviews");
    expect(prompt).toContain(
      'main.tex, at "We prove convergence": Is this only for convex losses?',
    );
    expect(prompt).toContain('"paper" (paper), "refs" (bibliography)');
    expect(prompt).toContain("researcher profile");
    expect(prompt).toContain("focus on: the experiments");
    expect(paperReviewDisplayText({ focus: "the experiments" })).toBe(
      "Review this paper: the experiments",
    );
  });

  it("leaves out what the author has not set", () => {
    const prompt = buildPaperReviewPrompt(
      context({
        proofreading: {
          enabled: false,
          language: "auto",
          motherTongue: "",
          picky: false,
        },
        spellCheckLanguages: [],
        hasResearcherProfile: false,
      }),
    );

    expect(prompt).toContain("No writing language is fixed in Settings");
    expect(prompt).not.toContain("native language");
    expect(prompt).not.toContain("picky");
    expect(prompt).not.toContain("researcher profile");
    expect(prompt).not.toContain("Previous reviews");
  });

  it("is available as the \\review chat command", () => {
    const expanded = expandSlashCommand("\\review focus on related work");
    expect(expanded).toContain("Review this paper as an expert peer reviewer");
    expect(expanded).toContain("The open project. Find the root file");
    expect(expanded).not.toContain("has not been built");
    expect(expanded).toContain("Additional instructions: focus on related work");
  });

  it("names languages and keeps unknown codes", () => {
    expect(describeLanguage("en-US")).toBe("American English (en-US)");
    expect(describeLanguage("auto")).toBe("");
    expect(describeLanguage("xx-unknown")).toBe("xx-unknown");
  });
});
