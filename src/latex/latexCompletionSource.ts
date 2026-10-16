import type { CompletionContext } from "@codemirror/autocomplete";
import type { LatexIndex } from "./latexIndex";
import { getLatexCompletionContext } from "./completionContext";
import {
  citationCompletionDetail,
  citationCompletionInfo,
  rankedCitationCompletions,
} from "./citationCompletion";

export function latexCompletionSource(getIndex: () => LatexIndex) {
  return (context: CompletionContext) => {
    const line = context.state.doc.lineAt(context.pos);
    const column = context.pos - line.from + 1;
    const latexContext = getLatexCompletionContext(line.text, column);
    if (!latexContext) return null;
    const index = getIndex();
    if (latexContext.type === "citation") {
      const citedKeys = new Set(index.citedKeys ?? []);
      return {
        from: line.from + latexContext.rangeStartColumn - 1,
        options: rankedCitationCompletions(
          index.citations,
          latexContext.currentText,
        ).map((entry) => ({
          label: entry.key,
          apply: entry.key,
          type: "reference",
          detail: citationCompletionDetail(entry, { citedKeys }),
          info: citationCompletionInfo(entry, { citedKeys }),
        })),
        filter: false,
      };
    }
    return {
      from: line.from + latexContext.rangeStartColumn - 1,
      options: index.labels.map((label) => ({
        label: label.key,
        type: "reference",
        detail: `${label.kind} · ${label.sourceFile}:${label.line}`,
        info: [label.caption, label.title].filter(Boolean).join("\n"),
      })),
    };
  };
}
