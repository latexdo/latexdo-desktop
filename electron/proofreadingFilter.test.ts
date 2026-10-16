import { describe, expect, it } from "vitest";
import {
  customDictionarySet,
  isCustomDictionaryMatch,
  isProofreadingNoise,
} from "./proofreadingFilter.js";

describe("isProofreadingNoise", () => {
  it("drops whitespace rules, which LaTeX makes meaningless", () => {
    const text = "Hello  world";
    expect(isProofreadingNoise(text, text, 5, 2, "WHITESPACE_RULE")).toBe(true);
  });

  it("drops matches that cover blanked-out LaTeX markup", () => {
    const source = "%% a comment\nThe the cat.";
    const sanitized = "            \nThe the cat.";
    expect(isProofreadingNoise(source, sanitized, 0, 4, "SOME_RULE")).toBe(true);
    expect(isProofreadingNoise(source, sanitized, 10, 6, "SOME_RULE")).toBe(true);
  });

  it("keeps real prose suggestions", () => {
    const source = "%% a comment\nThe the cat.";
    const sanitized = "            \nThe the cat.";
    expect(
      isProofreadingNoise(source, sanitized, 13, 7, "ENGLISH_WORD_REPEAT_RULE"),
    ).toBe(false);
  });
});

describe("isCustomDictionaryMatch", () => {
  const words = customDictionarySet(["LatexDo", " tikzcd "]);

  it("drops spelling matches on dictionary words, ignoring case", () => {
    expect(
      isCustomDictionaryMatch("latexdo", "MORFOLOGIK_RULE_EN_US", undefined, words),
    ).toBe(true);
    expect(isCustomDictionaryMatch("TikzCD", "HUNSPELL_RULE", undefined, words)).toBe(
      true,
    );
    expect(isCustomDictionaryMatch("LatexDo", "SOME_RULE", "misspelling", words)).toBe(
      true,
    );
  });

  it("keeps grammar matches and words not in the dictionary", () => {
    expect(
      isCustomDictionaryMatch(
        "LatexDo",
        "UPPERCASE_SENTENCE_START",
        "typographical",
        words,
      ),
    ).toBe(false);
    expect(
      isCustomDictionaryMatch(
        "Overleaf",
        "MORFOLOGIK_RULE_EN_US",
        "misspelling",
        words,
      ),
    ).toBe(false);
    expect(
      isCustomDictionaryMatch(
        "LatexDo",
        "MORFOLOGIK_RULE_EN_US",
        "misspelling",
        new Set(),
      ),
    ).toBe(false);
  });
});
