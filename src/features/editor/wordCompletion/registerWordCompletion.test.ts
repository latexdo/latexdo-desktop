import { describe, expect, it, vi } from "vitest";
import * as monaco from "monaco-editor";
import { registerWordCompletion } from "./registerWordCompletion";
import { sortDictionary } from "./wordCompletion";

function setup(enabled = true, others: string[] = []) {
  const register = vi.spyOn(monaco.languages, "registerCompletionItemProvider");
  const disposable = registerWordCompletion({
    monaco,
    isEnabled: () => enabled,
    getOtherDocuments: () => others,
    loadDictionary: async () =>
      sortDictionary([
        { word: "result", key: "result", tier: 0 },
        { word: "research", key: "research", tier: 1 },
      ]),
  });
  const provider = register.mock.calls[0][1] as monaco.languages.CompletionItemProvider;
  const languages = register.mock.calls.map(([language]) => language);
  register.mockRestore();
  return { provider, disposable, languages };
}

async function complete(
  provider: monaco.languages.CompletionItemProvider,
  text: string,
  column = text.length + 1,
) {
  const model = monaco.editor.createModel(text, "latex");
  const list = await provider.provideCompletionItems(
    model,
    new monaco.Position(1, column),
    { triggerKind: monaco.languages.CompletionTriggerKind.Invoke },
    new monaco.CancellationTokenSource().token,
  );
  model.dispose();
  return list;
}

describe("registerWordCompletion", () => {
  it("serves prose languages and can be disposed", () => {
    const { disposable, languages } = setup();
    expect(languages).toEqual(["latex", "markdown", "plaintext"]);
    disposable.dispose();
  });

  it("suggests project words, then dictionary words, in that order", async () => {
    const { provider, disposable } = setup(true, ["resilience resilience"]);
    const list = await complete(provider, "the resolution is good. The res");
    expect(list?.suggestions.map((item) => item.label)).toEqual([
      "resilience",
      "resolution",
      "result",
      "research",
    ]);
    expect(list?.suggestions[0]).toMatchObject({
      detail: "Word in this project",
      sortText: "0000",
    });
    expect(list?.suggestions[2].detail).toBe("English word");
    expect(list?.incomplete).toBe(true);
    disposable.dispose();
  });

  it("replaces the whole word when the cursor is inside it", async () => {
    const { provider, disposable } = setup();
    const list = await complete(provider, "resxyz", 4);
    const range = list?.suggestions[0].range as {
      insert: monaco.IRange;
      replace: monaco.IRange;
    };
    expect(range.insert.endColumn).toBe(4);
    expect(range.replace.endColumn).toBe(7);
    disposable.dispose();
  });

  it("stays quiet when off, in commands, and for one letter", async () => {
    const off = setup(false);
    expect((await complete(off.provider, "res"))?.suggestions).toEqual([]);
    off.disposable.dispose();
    const { provider, disposable } = setup();
    expect((await complete(provider, String.raw`\cite{res`))?.suggestions).toEqual([]);
    expect((await complete(provider, "r"))?.suggestions).toEqual([]);
    disposable.dispose();
  });
});
