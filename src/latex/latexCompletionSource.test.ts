import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";
import type { LatexIndex } from "./latexIndex";
import { latexCompletionSource } from "./latexCompletionSource";

function contextAt(doc: string, marker = "|") {
  const pos = doc.indexOf(marker);
  const text = doc.replace(marker, "");
  return new CompletionContext(EditorState.create({ doc: text }), pos, true);
}

const index: LatexIndex = {
  citations: [
    {
      key: "knuth84",
      type: "book",
      title: "The TeXbook",
      author: "Knuth",
      year: "1984",
      sourceFile: "refs.bib",
    },
    {
      key: "lamport94",
      type: "book",
      title: "LaTeX",
      author: "Lamport",
      year: "1994",
      sourceFile: "refs.bib",
    },
  ],
  citedKeys: ["knuth84"],
  labels: [
    {
      key: "fig:one",
      kind: "figure",
      caption: "First",
      line: 3,
      sourceFile: "main.tex",
    },
    {
      key: "sec:intro",
      kind: "section",
      title: "Intro",
      line: 1,
      sourceFile: "intro.tex",
    },
    { key: "eq:bare", kind: "equation", line: 9, sourceFile: "main.tex" },
  ],
};

describe("latexCompletionSource", () => {
  it("returns null outside citation/reference arguments without reading the index", () => {
    const getIndex = vi.fn(() => index);
    expect(latexCompletionSource(getIndex)(contextAt("plain text|"))).toBeNull();
    expect(getIndex).not.toHaveBeenCalled();
  });

  it("offers ranked citation keys with the argument as range start", () => {
    const result = latexCompletionSource(() => index)(
      contextAt("first line\nSee \\cite{lam|"),
    );
    expect(result).not.toBeNull();
    const doc = "first line\nSee \\cite{lam";
    expect(result!.from).toBe(doc.indexOf("lam"));
    expect(result!.filter).toBe(false);
    const labels = result!.options.map((o) => o.label);
    expect(labels[0]).toBe("lamport94");
    const opt = result!.options[0];
    expect("apply" in opt ? opt.apply : undefined).toBe("lamport94");
    expect(opt.type).toBe("reference");
    expect(typeof opt.detail).toBe("string");
  });

  it("tolerates a missing citedKeys list", () => {
    const result = latexCompletionSource(() => ({
      ...index,
      citedKeys: undefined as unknown as string[],
    }))(contextAt("\\citep{|"));
    expect(result!.options.map((o) => o.label).sort()).toEqual([
      "knuth84",
      "lamport94",
    ]);
  });

  it("offers labels for references with kind/source detail and joined info", () => {
    const result = latexCompletionSource(() => index)(contextAt("as in \\ref{fi|}"));
    expect(result!.from).toBe("as in \\ref{".length);
    expect(result!.options).toEqual([
      {
        label: "fig:one",
        type: "reference",
        detail: "figure · main.tex:3",
        info: "First",
      },
      {
        label: "sec:intro",
        type: "reference",
        detail: "section · intro.tex:1",
        info: "Intro",
      },
      {
        label: "eq:bare",
        type: "reference",
        detail: "equation · main.tex:9",
        info: "",
      },
    ]);
  });
});
