import * as monaco from "monaco-editor";
import type { LatexIndex } from "../latex/latexIndex";
import { getLatexCompletionContext } from "../latex/completionContext";

export function registerLatexCompletions(getIndex: () => LatexIndex) {
  return monaco.languages.registerCompletionItemProvider("latex", {
    triggerCharacters: ["{", ",", ":"],
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
      if (context.type === "citation") {
        return {
          suggestions: index.citations.map((entry) => ({
            label: entry.key,
            kind: monaco.languages.CompletionItemKind.Reference,
            insertText: entry.key,
            range,
            detail: [
              entry.type ? entry.type.toUpperCase() : "Citation",
              entry.author,
              entry.year,
            ]
              .filter(Boolean)
              .join(" · "),
            documentation: {
              value: [
                entry.title ? `**${entry.title}**` : undefined,
                entry.journal ? `Journal: ${entry.journal}` : undefined,
                entry.booktitle ? `Booktitle: ${entry.booktitle}` : undefined,
                entry.publisher ? `Publisher: ${entry.publisher}` : undefined,
                entry.url ? `URL: ${entry.url}` : undefined,
                "",
                `Source: \`${entry.sourceFile}\``,
              ]
                .filter(Boolean)
                .join("\n\n"),
            },
          })),
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
