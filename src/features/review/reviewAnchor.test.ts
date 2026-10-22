import { describe, expect, it } from "vitest";
import { locateReviewSelection } from "./reviewAnchor";

const selection = {
  startLine: 2,
  startColumn: 5,
  endLine: 2,
  endColumn: 10,
  text: "claim",
};

describe("locateReviewSelection", () => {
  it("keeps the recorded range while the passage has not moved", () => {
    expect(locateReviewSelection("Intro\nThe claim holds.", selection)).toEqual({
      startLine: 2,
      startColumn: 5,
      endLine: 2,
      endColumn: 10,
    });
  });

  it("follows the passage when lines are added above it", () => {
    expect(
      locateReviewSelection("Intro\nNew line\nAnother\nThe claim holds.", selection),
    ).toEqual({ startLine: 4, startColumn: 5, endLine: 4, endColumn: 10 });
  });

  it("picks the occurrence closest to the original place", () => {
    const content = "claim one\nfiller\nfiller\nour claim two\nfiller\nlast claim";
    expect(
      locateReviewSelection(content, { ...selection, startLine: 4, startColumn: 1 }),
    ).toEqual({ startLine: 4, startColumn: 5, endLine: 4, endColumn: 10 });
  });

  it("spans lines for a multi-line passage", () => {
    expect(
      locateReviewSelection("x\ny\nfirst\nsecond", {
        ...selection,
        text: "first\nsec",
      }),
    ).toEqual({ startLine: 3, startColumn: 1, endLine: 4, endColumn: 4 });
  });

  it("reports a passage that was rewritten", () => {
    expect(locateReviewSelection("Nothing left.", selection)).toBeNull();
  });

  it("gives up on an empty passage", () => {
    expect(
      locateReviewSelection("some claim here", { ...selection, text: "" }),
    ).toBeNull();
  });

  it("searches from the start when the recorded position is invalid", () => {
    const content = "a claim\nanother claim";
    expect(
      locateReviewSelection(content, { ...selection, startLine: 0, startColumn: 0 }),
    ).toEqual({ startLine: 1, startColumn: 3, endLine: 1, endColumn: 8 });
    expect(
      locateReviewSelection(content, { ...selection, startLine: 9, startColumn: 1 }),
    ).toEqual({ startLine: 1, startColumn: 3, endLine: 1, endColumn: 8 });
  });
});
