import * as monaco from "monaco-editor";
import type { LatexIndex } from "./latexIndex";
import { getLatexCompletionContext } from "./completionContext";
import {
  citationCompletionDetail,
  citationCompletionFilterText,
  citationCompletionLabelDetail,
  citationCompletionMarkdown,
  citationCompletionSortText,
  citationCompletionTriggerCharacters,
  citationCompletionUsageDescription,
  rankedCitationCompletions,
} from "./citationCompletion";

export function registerLatexCompletions(getIndex: () => LatexIndex) {
  return monaco.languages.registerCompletionItemProvider("latex", {
    triggerCharacters: citationCompletionTriggerCharacters,
    provideCompletionItems(model, position) {
      const lineText = model.getLineContent(position.lineNumber);
      const context = getLatexCompletionContext(lineText, position.column);
      if (!context) {
        return { suggestions: [] };
      }
      const index = getIndex();
      const range = new monaco.Range(
        position.lineNumber,
        context.rangeStartColumn,
        position.lineNumber,
        context.rangeEndColumn,
      );
      const replacementRange = { insert: range, replace: range };
      if (context.type === "citation") {
        const citedKeys = new Set(index.citedKeys ?? []);
        return {
          suggestions: rankedCitationCompletions(
            index.citations,
            context.currentText,
          ).map((entry) => ({
            label: {
              label: entry.key,
              detail: citationCompletionLabelDetail(entry),
              description: citationCompletionUsageDescription(entry, { citedKeys }),
            },
            kind: monaco.languages.CompletionItemKind.Reference,
            insertText: entry.key,
            range: replacementRange,
            detail: citationCompletionDetail(entry, { citedKeys }),
            filterText: citationCompletionFilterText(entry, context.currentText),
            sortText: citationCompletionSortText(entry, context.currentText),
            documentation: {
              value: citationCompletionMarkdown(entry, { citedKeys }),
            },
          })),
          incomplete: true,
        };
      }
      return {
        suggestions: index.labels.map((label) => ({
          label: label.key,
          kind: monaco.languages.CompletionItemKind.Reference,
          insertText: label.key,
          range,
          detail: [label.kind, label.sourceFile, `line ${label.line}`].join(" · "),
          documentation: {
            value: [
              label.caption ? `**Caption:** ${label.caption}` : undefined,
              label.title ? `**Section:** ${label.title}` : undefined,
              "",
              `Source: \`${label.sourceFile}:${label.line}\``,
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        })),
      };
    },
  });
}
