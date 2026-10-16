import { describe, expect, it } from "vitest";
import { cleanCommitMessage, commitMessagePrompt } from "./commitMessageAi";

describe("commit message suggestions", () => {
  it("keeps only the message from a model reply", () => {
    expect(cleanCommitMessage('```\nCommit message: "Fix the intro."\n```')).toBe(
      "Fix the intro",
    );
    expect(cleanCommitMessage("Add results table\n\nExplains the new numbers.")).toBe(
      "Add results table\n\nExplains the new numbers.",
    );
  });

  it("cuts very large diffs", () => {
    const prompt = commitMessagePrompt("x".repeat(20_000));
    expect(prompt.length).toBeLessThan(13_000);
    expect(prompt).toContain("diff truncated");
  });
});
