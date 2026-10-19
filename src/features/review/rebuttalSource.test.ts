import { describe, expect, it } from "vitest";
import type { RebuttalItem } from "../../types";
import {
  createReviewId,
  rebuttalMacro,
  removeRebuttalMacro,
  updateRebuttalMacro,
} from "./rebuttalSource";

const item: RebuttalItem = {
  id: "1",
  originalText: "Old claim.",
  revisedText: "New claim.",
  reviewerComment: "",
  authorComment: "",
  modificationMade: "New claim.",
  insertedInTex: true,
};

describe("rebuttalSource", () => {
  it("writes a block with no placeholder text and escaped comments", () => {
    expect(rebuttalMacro(item)).toBe("\\rebuttal{Old claim.}{}{}{New claim.}");
    expect(
      rebuttalMacro({ ...item, reviewerComment: "50% of R&D", authorComment: "a_b" }),
    ).toBe("\\rebuttal{Old claim.}{50\\% of R\\&D}{a\\_b}{New claim.}");
  });

  it("rewrites the block in the source when the item changes", () => {
    const content = `Intro. ${rebuttalMacro(item)} Outro.`;
    const next = { ...item, authorComment: "Fixed in Section 3." };
    expect(updateRebuttalMacro(content, item, next)).toBe(
      "Intro. \\rebuttal{Old claim.}{}{}{New claim.} Outro.".replace(
        "{}{}",
        "{}{Fixed in Section 3.}",
      ),
    );
  });

  it("still finds blocks written before comments were escaped", () => {
    const legacy = { ...item, reviewerComment: "Reviewer comment here..." };
    const content = "\\rebuttal{Old claim.}{Reviewer comment here...}{}{New claim.}";
    expect(
      updateRebuttalMacro(content, legacy, { ...legacy, reviewerComment: "" }),
    ).toBe("\\rebuttal{Old claim.}{}{}{New claim.}");
  });

  it("reports a block the author edited by hand instead of guessing", () => {
    expect(updateRebuttalMacro("Nothing here.", item, item)).toBeNull();
    expect(removeRebuttalMacro("Nothing here.", item)).toBeNull();
  });

  it("removes the block and keeps the revised text", () => {
    expect(removeRebuttalMacro(`A ${rebuttalMacro(item)} B`, item)).toBe(
      "A New claim. B",
    );
  });

  it("creates distinct ids within the same millisecond", () => {
    expect(createReviewId()).not.toBe(createReviewId());
  });

  it("falls back to the modification and empty fields when parts are missing", () => {
    const sparse: RebuttalItem = {
      ...item,
      originalText: undefined,
      revisedText: undefined,
      modificationMade: "Changed.",
    };
    expect(rebuttalMacro(sparse)).toBe("\\rebuttal{}{}{}{Changed.}");
    const bare: RebuttalItem = { ...sparse, modificationMade: undefined };
    expect(rebuttalMacro(bare)).toBe("\\rebuttal{}{}{}{}");
    expect(removeRebuttalMacro(`X ${rebuttalMacro(bare)} Y`, bare)).toBe("X  Y");
  });

  it("removes a legacy unescaped block with missing optional fields", () => {
    const legacy: RebuttalItem = {
      ...item,
      originalText: undefined,
      revisedText: undefined,
      modificationMade: undefined,
      reviewerComment: "50% done",
    };
    expect(removeRebuttalMacro("A \\rebuttal{}{50% done}{}{} B", legacy)).toBe("A  B");
  });
});
