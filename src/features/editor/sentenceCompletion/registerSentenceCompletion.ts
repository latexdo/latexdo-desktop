// Monaco wiring for full-sentence ghost text: an inline completions provider,
// so Monaco renders grey text right after the caret with its own Tab-to-accept
// hint, and Escape or typing dismisses it.

import type * as Monaco from "monaco-editor";
import type { NextEditModelClient } from "../nextEdit/nextEditModelClient";
import {
  buildSentenceCompletionMessages,
  cleanSentenceCompletion,
  sentenceCompletionContextChars,
  unfinishedSentence,
} from "./sentenceCompletion";

/** Pause in typing before asking the model. */
export const sentenceCompletionDelayMs = 450;

export interface SentenceCompletionOptions {
  monaco: typeof Monaco;
  /** Null while completion is off or the AI is not ready. */
  getClient: () => NextEditModelClient | null;
  delayMs?: number;
}

function wait(ms: number, token: Monaco.CancellationToken): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(!token.isCancellationRequested), ms);
    token.onCancellationRequested(() => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

let requestCounter = 0;

export function registerSentenceCompletion({
  monaco,
  getClient,
  delayMs = sentenceCompletionDelayMs,
}: SentenceCompletionOptions): Monaco.IDisposable {
  return monaco.languages.registerInlineCompletionsProvider("latex", {
    async provideInlineCompletions(model, position, _context, token) {
      const client = getClient();
      if (!client) return { items: [] };
      const lineText = model.getLineContent(position.lineNumber);
      const lineAfter = lineText.slice(position.column - 1);
      const offset = model.getOffsetAt(position);
      const textBefore = model
        .getValue()
        .slice(Math.max(0, offset - sentenceCompletionContextChars), offset);
      if (!unfinishedSentence(textBefore, lineAfter)) return { items: [] };
      if (!(await wait(delayMs, token))) return { items: [] };

      const controller = new AbortController();
      token.onCancellationRequested(() => controller.abort());
      const reply = await client.complete(
        {
          requestId: `sentence-completion-${++requestCounter}`,
          messages: buildSentenceCompletionMessages(textBefore),
        },
        controller.signal,
      );
      if (!reply || token.isCancellationRequested || model.isDisposed()) {
        return { items: [] };
      }
      const insertText = cleanSentenceCompletion(reply, textBefore);
      if (!insertText) return { items: [] };
      return {
        items: [
          {
            insertText,
            range: new monaco.Range(
              position.lineNumber,
              position.column,
              position.lineNumber,
              position.column,
            ),
          },
        ],
      };
    },
    freeInlineCompletions() {},
  });
}
