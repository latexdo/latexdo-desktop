import type * as Monaco from "monaco-editor";
import { loadEnglishDictionary } from "./englishDictionary";
import {
  countDocumentWords,
  isProseWordContext,
  MIN_PREFIX_LENGTH,
  rankWordCompletions,
  type DictionaryWord,
} from "./wordCompletion";

export interface WordCompletionOptions {
  monaco: typeof Monaco;
  /** Read on every request, so the setting applies without a reload. */
  isEnabled: () => boolean;
  /** Text of the project's other open documents. */
  getOtherDocuments: () => string[];
  loadDictionary?: () => Promise<DictionaryWord[]>;
}

/** Languages that get word completion instead of Monaco's word list. */
export const proseLanguages = new Set(["latex", "markdown", "plaintext"]);

/**
 * Completes words in prose from the project's own vocabulary and a common
 * English dictionary. Never inside commands, key arguments or inline math,
 * which the LaTeX providers handle.
 */
export function registerWordCompletion({
  monaco,
  isEnabled,
  getOtherDocuments,
  loadDictionary = loadEnglishDictionary,
}: WordCompletionOptions): Monaco.IDisposable {
  let dictionary: DictionaryWord[] = [];
  let dictionaryPromise: Promise<DictionaryWord[]> | null = null;
  // Counting every word on each keystroke is wasteful; recount on change.
  let cached: {
    model: Monaco.editor.ITextModel;
    version: number;
    words: Map<string, number>;
  } | null = null;

  const documentWords = (model: Monaco.editor.ITextModel) => {
    const version = model.getVersionId();
    if (cached?.model !== model || cached.version !== version) {
      const words = countDocumentWords(model.getValue());
      for (const text of getOtherDocuments()) countDocumentWords(text, words);
      cached = { model, version, words };
    }
    return cached.words;
  };

  const provider: Monaco.languages.CompletionItemProvider = {
    async provideCompletionItems(model, position, _context, token) {
      if (!isEnabled()) return { suggestions: [] };
      const version = model.getVersionId();
      dictionaryPromise ??= loadDictionary().catch(() => {
        dictionaryPromise = null;
        return [];
      });
      dictionary = await dictionaryPromise;
      if (
        !isEnabled() ||
        token.isCancellationRequested ||
        model.isDisposed() ||
        model.getVersionId() !== version
      )
        return { suggestions: [] };
      const word = model.getWordUntilPosition(position);
      if (word.word.length < MIN_PREFIX_LENGTH) return { suggestions: [] };
      const line = model.getLineContent(position.lineNumber);
      if (!isProseWordContext(line, position.column)) return { suggestions: [] };

      const counts = new Map(documentWords(model));
      // The half-typed word itself is not a suggestion.
      const typedCount = counts.get(word.word);
      if (typedCount !== undefined) {
        if (typedCount > 1) counts.set(word.word, typedCount - 1);
        else counts.delete(word.word);
      }
      const wordEnd = model.getWordAtPosition(position)?.endColumn ?? position.column;
      // Replace the entire word even with Monaco's default insert mode.
      const range = new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        wordEnd,
      );
      const suggestions = rankWordCompletions(word.word, counts, dictionary).map(
        (suggestion, index): Monaco.languages.CompletionItem => ({
          label: suggestion.word,
          kind: monaco.languages.CompletionItemKind.Text,
          insertText: suggestion.word,
          filterText: suggestion.word,
          // Keep this ranking; Monaco would otherwise re-sort by label.
          sortText: String(index).padStart(4, "0"),
          detail:
            suggestion.source === "document" ? "Word in this project" : "English word",
          range,
        }),
      );
      // Ranking and case depend on the full typed word, so ask again as it grows.
      return { suggestions, incomplete: true };
    },
  };

  const disposables = [...proseLanguages].map((language) =>
    monaco.languages.registerCompletionItemProvider(language, provider),
  );
  return { dispose: () => disposables.forEach((disposable) => disposable.dispose()) };
}
