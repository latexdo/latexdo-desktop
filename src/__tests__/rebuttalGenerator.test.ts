import { describe, expect, it } from "vitest";
import {
  generateRebuttalLetter,
  isUneditedRebuttalLetter,
  manuscriptTitleFromSource,
  nextRebuttalLetterName,
} from "../rebuttalGenerator";
import type { RebuttalItem } from "../types";

function item(overrides: Partial<RebuttalItem>): RebuttalItem {
  return {
    id: Math.random().toString(36),
    reviewerComment: "",
    authorComment: "",
    modificationMade: "",
    ...overrides,
  };
}

describe("generateRebuttalLetter", () => {
  it("groups comments by reviewer and numbers them within each reviewer", () => {
    const tex = generateRebuttalLetter([
      item({ reviewer: "Reviewer 1", reviewerComment: "First of R1." }),
      item({ reviewer: "Reviewer 2", reviewerComment: "First of R2." }),
      item({ reviewer: "Reviewer 1", reviewerComment: "Second of R1." }),
    ]);

    expect(tex.match(/\\section\*\{Reviewer 1\}/g)).toHaveLength(1);
    expect(tex.match(/\\section\*\{Reviewer 2\}/g)).toHaveLength(1);
    const order = [
      "Reviewer 1}",
      "Comment 1.1",
      "First of R1.",
      "Comment 1.2",
      "Second of R1.",
      "Reviewer 2}",
      "Comment 2.1",
      "First of R2.",
    ];
    const positions = order.map((text) => tex.indexOf(text));
    expect(positions.every((position) => position > -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("puts comments without a reviewer under Reviewer 1", () => {
    const tex = generateRebuttalLetter([item({ reviewerComment: "Clarify." })]);
    expect(tex).toContain("\\section*{Reviewer 1}");
    expect(tex).toContain("\\subsection*{Comment 1.1}");
  });

  it("uses this paper's title and never another project's details", () => {
    const tex = generateRebuttalLetter([item({ reviewerComment: "Clarify." })], {
      manuscriptTitle: "Efficient Retrieval for Long Documents",
    });
    expect(tex).toContain("{\\large Efficient Retrieval for Long Documents}");
    expect(tex).not.toContain("COLA-D");
    expect(tex).not.toContain("Pharo");
    expect(tex).not.toContain("diff.tex");
  });

  it("marks what is still to write instead of inventing text", () => {
    const tex = generateRebuttalLetter([item({ reviewerComment: "Clarify." })]);
    expect(tex).toContain("\\fillin{Title of the manuscript}");
    expect(tex).toContain("\\fillin{Write your response to this comment.}");
    expect(tex).toContain("\\fillin{Summarize the main changes");
    expect(tex).not.toContain("Thank you for this comment.");
    expect(tex).not.toContain("No manuscript text recorded");
  });

  it("writes the reviewer comment, the response, and the change in order", () => {
    const tex = generateRebuttalLetter([
      item({
        reviewerComment: "Please clarify the claim.",
        authorComment: "We clarified the claim.",
        originalText: "The old claim.",
        revisedText: "The revised claim.",
      }),
    ]);
    const comment = tex.indexOf("Please clarify the claim.");
    const response = tex.indexOf("\\response We clarified the claim.");
    const before = tex.indexOf("\\beforechange{The old claim.}");
    const after = tex.indexOf("\\afterchange{The revised claim.}");
    expect(comment).toBeGreaterThan(-1);
    expect(response).toBeGreaterThan(comment);
    expect(before).toBeGreaterThan(response);
    expect(after).toBeGreaterThan(before);
  });

  it("leaves the change out when no manuscript text was given", () => {
    const tex = generateRebuttalLetter([
      item({ reviewerComment: "A question.", authorComment: "An answer." }),
    ]);
    expect(tex).not.toContain("\\begin{manuscriptchange}");
  });

  it("turns an older unified diff into before and after text", () => {
    const tex = generateRebuttalLetter([
      item({
        reviewerComment: "Fix it.",
        revisedText: "--- a\n+++ b\n@@ -1 +1 @@\n- old sentence\n+ new sentence",
      }),
    ]);
    expect(tex).toContain("\\beforechange{old sentence}");
    expect(tex).toContain("\\afterchange{new sentence}");
    expect(tex).not.toContain("@@");
  });

  it("escapes LaTeX special characters in what people typed", () => {
    const tex = generateRebuttalLetter([
      item({ reviewerComment: "Use 50% & $5 for x_1.", authorComment: "Done #1." }),
    ]);
    expect(tex).toContain("Use 50\\% \\& \\$5 for x\\_1.");
    expect(tex).toContain("\\response Done \\#1.");
  });
});

describe("isUneditedRebuttalLetter", () => {
  it("recognizes a letter nobody changed, and notices any edit", () => {
    const tex = generateRebuttalLetter([item({ reviewerComment: "Clarify." })]);
    expect(isUneditedRebuttalLetter(tex)).toBe(true);
    expect(isUneditedRebuttalLetter(tex.replace("Clarify.", "Clarify more."))).toBe(
      false,
    );
    expect(isUneditedRebuttalLetter("\\documentclass{article}")).toBe(false);
  });
});

describe("manuscriptTitleFromSource", () => {
  it("reads the title, without \\thanks or line breaks", () => {
    expect(
      manuscriptTitleFromSource(
        "\\title{Efficient \\emph{Retrieval}\\\\ for Long Documents\\thanks{Funded.}}",
      ),
    ).toBe("Efficient \\emph{Retrieval} for Long Documents");
    expect(manuscriptTitleFromSource("\\title[Short]{Full Title}")).toBe("Full Title");
    expect(manuscriptTitleFromSource("\\section{Intro}")).toBeNull();
  });
});

describe("nextRebuttalLetterName", () => {
  it("finds a free name for a copy", () => {
    const taken = new Set(["rebuttal-letter-2.tex"]);
    expect(nextRebuttalLetterName((name) => taken.has(name))).toBe(
      "rebuttal-letter-3.tex",
    );
  });
});
