import { describe, expect, it, vi } from "vitest";
import {
  buildSentenceCompletionMessages,
  cleanSentenceCompletion,
  unfinishedSentence,
} from "./sentenceCompletion";
import { registerSentenceCompletion } from "./registerSentenceCompletion";

describe("unfinishedSentence", () => {
  it("offers a completion at the end of an unfinished prose sentence", () => {
    expect(unfinishedSentence("Our results show that the proposed method ", "")).toBe(
      "Our results show that the proposed method",
    );
  });

  it.each([
    ["a finished sentence", "Our results show that it works.", ""],
    ["text after the caret", "Our results show that the", " method works."],
    ["a comment", "% Our results show that the", ""],
    ["inline math", "We define $f(x) = x + ", ""],
    ["an equation environment", "\\begin{equation}\n  a + b equals the sum", ""],
    ["a command name", "Our results show that \\emph", ""],
    ["a citation key", "As shown before \\cite{smith", ""],
    ["a heading", "\\section{Results and the main", ""],
    ["too few words", "We show", ""],
  ])("stays quiet in %s", (_case, before, after) => {
    expect(unfinishedSentence(before, after)).toBeNull();
  });

  it("does not treat an abbreviation as the end of a sentence", () => {
    expect(unfinishedSentence("Prior systems, e.g.", "")).toBeNull();
    expect(
      unfinishedSentence("Many prior systems such as those of Smith et al.", ""),
    ).not.toBeNull();
  });

  it("ignores math that closed earlier in the paragraph", () => {
    expect(
      unfinishedSentence("For $x > 0$ the function grows and ", ""),
    ).not.toBeNull();
  });
});

describe("cleanSentenceCompletion", () => {
  const before = "Our results show that the proposed method ";

  it("keeps exactly one finished sentence", () => {
    expect(
      cleanSentenceCompletion(
        "outperforms all baselines on every benchmark. It also runs faster.",
        before,
      ),
    ).toBe("outperforms all baselines on every benchmark.");
  });

  it("does not stop at abbreviations inside the sentence", () => {
    expect(
      cleanSentenceCompletion(
        "matches prior work, e.g. the system of Smith et al. in 2024.",
        before,
      ),
    ).toBe("matches prior work, e.g. the system of Smith et al. in 2024.");
  });

  it("strips quotes, labels and an echoed prefix", () => {
    expect(
      cleanSentenceCompletion(
        'Continuation: "the proposed method reduces error by 12%."',
        before,
      ),
    ).toBe("reduces error by 12%.");
  });

  it("rejects replies that never finish the sentence", () => {
    expect(cleanSentenceCompletion("reduces the error on", before)).toBeNull();
    expect(cleanSentenceCompletion("   ", before)).toBeNull();
  });

  it("adds the missing space after a comma", () => {
    expect(cleanSentenceCompletion("which is faster.", "It scales well,")).toBe(
      " which is faster.",
    );
  });
});

describe("buildSentenceCompletionMessages", () => {
  it("asks for a single finished sentence and sends recent text only", () => {
    const messages = buildSentenceCompletionMessages(`${"x".repeat(5000)} tail`);
    expect(messages[0].content).toMatch(/one complete, well-formed sentence/);
    expect(messages[1].content).toContain("tail");
    expect(messages[1].content.length).toBeLessThan(2_300);
  });
});

describe("registerSentenceCompletion", () => {
  function setup(reply: string | null, text: string) {
    let provider: any;
    const monaco: any = {
      Range: class {
        constructor(
          public startLineNumber: number,
          public startColumn: number,
          public endLineNumber: number,
          public endColumn: number,
        ) {}
      },
      languages: {
        registerInlineCompletionsProvider: vi.fn((_language: string, value: any) => {
          provider = value;
          return { dispose: vi.fn() };
        }),
      },
    };
    const client = { complete: vi.fn().mockResolvedValue(reply) };
    registerSentenceCompletion({ monaco, getClient: () => client, delayMs: 0 });
    const lines = text.split("\n");
    const model = {
      getLineContent: (line: number) => lines[line - 1],
      getOffsetAt: () => text.length,
      getValue: () => text,
      isDisposed: () => false,
    };
    const position = { lineNumber: lines.length, column: lines.at(-1)!.length + 1 };
    const token = { isCancellationRequested: false, onCancellationRequested: vi.fn() };
    return { provider, client, model, position, token };
  }

  it("returns ghost text that finishes the sentence at the caret", async () => {
    const { provider, model, position, token } = setup(
      "outperforms every baseline.",
      "Our results show that the proposed method ",
    );
    const result = await provider.provideInlineCompletions(model, position, {}, token);
    expect(result.items).toEqual([
      expect.objectContaining({
        insertText: "outperforms every baseline.",
        range: expect.objectContaining({ startColumn: position.column }),
      }),
    ]);
  });

  it("does not call the model outside prose", async () => {
    const { provider, client, model, position, token } = setup(
      "x.",
      "We define $f(x) = ",
    );
    expect(
      (await provider.provideInlineCompletions(model, position, {}, token)).items,
    ).toEqual([]);
    expect(client.complete).not.toHaveBeenCalled();
  });
});
