import { describe, expect, it } from "vitest";
import type { ReviewChat } from "../../types";
import { normalizeRebuttalItem, removeLegacyReviewPlaceholders } from "./reviewState";

function chat(
  id: string,
  comments: Array<{ author: string; text: string }>,
): ReviewChat {
  return {
    id,
    filePath: "main.tex",
    selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 2, text: "x" },
    comments: comments.map((c, i) => ({
      id: `${id}-${i}`,
      ...c,
    })) as ReviewChat["comments"],
  };
}

describe("removeLegacyReviewPlaceholders", () => {
  it("drops only reviewer-authored placeholder comments", () => {
    const untouched = chat("a", [{ author: "Reviewer", text: "Real comment" }]);
    const legacy = chat("b", [
      { author: "Reviewer", text: "  Add your comment here...  " },
      { author: "Author", text: "Add your comment here..." },
      { author: "Reviewer", text: "Keep me" },
    ]);
    const result = removeLegacyReviewPlaceholders([untouched, legacy]);
    expect(result.changed).toBe(true);
    expect(result.chats[0]).toBe(untouched);
    expect(result.chats[1]).not.toBe(legacy);
    expect(result.chats[1].comments.map((c) => [c.author, c.text])).toEqual([
      ["Author", "Add your comment here..."],
      ["Reviewer", "Keep me"],
    ]);
  });

  it("reports no change and keeps references when nothing is legacy", () => {
    const chats = [chat("a", [{ author: "Reviewer", text: "Fine" }]), chat("b", [])];
    const result = removeLegacyReviewPlaceholders(chats);
    expect(result.changed).toBe(false);
    expect(result.chats[0]).toBe(chats[0]);
    expect(result.chats[1]).toBe(chats[1]);
  });
});

describe("normalizeRebuttalItem", () => {
  const base = {
    id: "r",
    reviewerComment: "c",
    authorComment: "a",
    modificationMade: "m",
  };
  it("coerces insertedInTex to a boolean", () => {
    expect(normalizeRebuttalItem(base).insertedInTex).toBe(false);
    expect(normalizeRebuttalItem({ ...base, insertedInTex: true }).insertedInTex).toBe(
      true,
    );
    expect(normalizeRebuttalItem({ ...base, reviewer: "R2" })).toEqual({
      ...base,
      reviewer: "R2",
      insertedInTex: false,
    });
  });
});
