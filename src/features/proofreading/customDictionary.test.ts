import { afterEach, describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../ai/aiSystemPrompt";
import { buildReformulationMessages } from "../ai/selectionAi";
import {
  customDictionaryPromptSection,
  getCustomDictionaryWords,
  setCustomDictionaryWords,
} from "./customDictionary";

const snapshot = {
  filePath: "main.tex",
  text: "We use LatexDo.",
  range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 16 },
  documentVersionId: 1,
};

describe("custom dictionary", () => {
  afterEach(() => setCustomDictionaryWords([]));

  it("says nothing when the dictionary is empty", () => {
    expect(customDictionaryPromptSection([])).toBe("");
    expect(buildReformulationMessages(snapshot)[0].content).not.toContain(
      "custom dictionary",
    );
  });

  it("tells the agent and rewrites about the user's words", () => {
    setCustomDictionaryWords(["LatexDo", "tikzcd"]);
    expect(getCustomDictionaryWords()).toEqual(["LatexDo", "tikzcd"]);
    expect(buildReformulationMessages(snapshot)[0].content).toContain(
      "LatexDo, tikzcd",
    );
    const prompt = buildSystemPrompt({
      userName: "",
      projectName: "paper",
      activeFilePath: null,
      hasSelection: false,
      providerSupportsNativeTools: true,
      customWords: getCustomDictionaryWords(),
    });
    expect(prompt).toContain(
      "custom dictionary lists words they spell on purpose: LatexDo, tikzcd",
    );
  });

  it("forgets removed words", () => {
    setCustomDictionaryWords(["LatexDo"]);
    setCustomDictionaryWords([]);
    expect(buildReformulationMessages(snapshot)[0].content).not.toContain("LatexDo,");
  });
});
