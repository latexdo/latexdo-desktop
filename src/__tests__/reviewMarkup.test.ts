import { describe, expect, it } from "vitest";
import {
  acceptLatexDoTrackedChanges,
  escapeLatexText,
  normalizeLatexDoReviewMarkup,
  rejectLatexDoTrackedChanges,
  removeInsertedReviewMarkup,
  summarizeLatexDoTrackedChanges,
  usesLatexDoReviewMacros,
  usesLatexDoTrackedChanges,
} from "../reviewMarkup";

describe("review markup", () => {
  it("cleans old reviewercomment wrappers with citations and trailing punctuation", () => {
    const source =
      "\\reviewercomment{Code completion helps developers~\\cite{Wang23a, Izdai24a}}{Please clarify this claim.}.";

    expect(normalizeLatexDoReviewMarkup(source)).toBe(
      "Code completion helps developers~\\cite{Wang23a, Izdai24a}.\n" +
        "\\latexdoreviewercomment{Please clarify this claim.}\n",
    );
  });

  it("detects old and new LatexDo review commands", () => {
    expect(usesLatexDoReviewMacros("\\reviewercomment{text}{comment}")).toBe(true);
    expect(usesLatexDoReviewMacros("\\latexdoreviewercomment{comment}")).toBe(true);
    expect(usesLatexDoReviewMacros("\\latexdoinsert{new text}")).toBe(true);
    expect(usesLatexDoReviewMacros("plain text")).toBe(false);
  });

  it("detects and summarizes LatexDo tracked changes", () => {
    const source =
      "A \\latexdoinsert{new} B \\latexdodelete{old} C \\latexdochange{weak}{strong}.";

    expect(usesLatexDoTrackedChanges(source)).toBe(true);
    expect(usesLatexDoTrackedChanges("plain text")).toBe(false);
    expect(summarizeLatexDoTrackedChanges(source)).toEqual({
      insertions: 1,
      deletions: 1,
      replacements: 1,
    });
  });

  it("accepts tracked changes while preserving nested LaTeX arguments", () => {
    const source =
      "This \\latexdoinsert{new \\textbf{claim}} and " +
      "\\latexdodelete{old claim} plus \\latexdochange{less}{more \\emph{precise}}.";

    expect(acceptLatexDoTrackedChanges(source)).toBe(
      "This new \\textbf{claim} and  plus more \\emph{precise}.",
    );
  });

  it("rejects tracked changes back to the previous text", () => {
    const source =
      "This \\latexdoinsert{new claim} and " +
      "\\latexdodelete{old claim} plus \\latexdochange{less}{more}.";

    expect(rejectLatexDoTrackedChanges(source)).toBe("This  and old claim plus less.");
  });

  it("keeps malformed tracked-change commands untouched", () => {
    const source = "Broken \\latexdochange{old} command";

    expect(acceptLatexDoTrackedChanges(source)).toBe(source);
    expect(rejectLatexDoTrackedChanges(source)).toBe(source);
  });

  it("escapes every LaTeX special character in plain review text", () => {
    expect(escapeLatexText("90% on data_set_A & ref #12 costs $5")).toBe(
      "90\\% on data\\_set\\_A \\& ref \\#12 costs \\$5",
    );
    expect(escapeLatexText("~x^2 {braces} \\cmd")).toBe(
      "\\textasciitilde{}x\\textasciicircum{}2 \\{braces\\} \\textbackslash{}cmd",
    );
  });

  it("does not double-escape already produced output", () => {
    // Single pass over the input: the backslash introduced by escaping is not
    // itself re-escaped.
    expect(escapeLatexText("&")).toBe("\\&");
    expect(escapeLatexText("\\&")).toBe("\\textbackslash{}\\&");
  });

  it("removes inserted review wrappers while keeping the reviewed text", () => {
    const source =
      "Before \\reviewercomment{Important \\cite{Li21b}}{\\textbf{Reviewer:} Clarify.} after.";

    expect(removeInsertedReviewMarkup(source, "Important \\cite{Li21b}")).toEqual({
      content: "Before Important \\cite{Li21b} after.",
      removed: true,
    });
  });

  it("removes normalized reviewer comment blocks after the reviewed text", () => {
    const source =
      "Before Important claim\n" +
      "\\latexdoreviewercomment{\\textbf{Reviewer:} Clarify.}\n" +
      " after.";

    expect(removeInsertedReviewMarkup(source, "Important claim", 7)).toEqual({
      content: "Before Important claim after.",
      removed: true,
    });
  });

  it("keeps punctuation when removing normalized reviewer comment blocks", () => {
    const source =
      "Before Important claim.\n" +
      "\\latexdoreviewercomment{\\textbf{Reviewer:} Clarify.}\n" +
      " After.";

    expect(removeInsertedReviewMarkup(source, "Important claim", 7)).toEqual({
      content: "Before Important claim. After.",
      removed: true,
    });
  });
});
