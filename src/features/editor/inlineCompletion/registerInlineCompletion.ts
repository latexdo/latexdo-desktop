// Monaco wiring for Copilot-style ghost text: an inline completions provider,
// so Monaco renders the grey text and its hover toolbar, Tab accepts it,
// Cmd/Ctrl+Right accepts one word, Escape dismisses it and Alt+\ asks for one
// right away.

import type * as Monaco from "monaco-editor";
import type { NextEditModelClient } from "../nextEdit/nextEditModelClient";
import {
  buildInlineCompletionMessages,
  cleanInlineCompletion,
  inlineCompletionContext,
  shouldOfferInlineCompletion,
} from "./inlineCompletion";
import { InlineCompletionCache } from "./inlineCompletionCache";

/** Pause in typing before asking the model. */
export const inlineCompletionDelayMs = 300;

export interface InlineCompletionOptions {
  monaco: typeof Monaco;
  /** Null while ghost text is off or the AI is not ready. */
  getClient: () => NextEditModelClient | null;
  delayMs?: number;
  cache?: InlineCompletionCache;
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

export function registerInlineCompletion({
  monaco,
  getClient,
  delayMs = inlineCompletionDelayMs,
  cache = new InlineCompletionCache(),
}: InlineCompletionOptions): Monaco.IDisposable {
  return monaco.languages.registerInlineCompletionsProvider("latex", {
    async provideInlineCompletions(model, position, context, token) {
      const client = getClient();
      if (!client) return { items: [] };
      const explicit =
        context.triggerKind === monaco.languages.InlineCompletionTriggerKind.Explicit;
      const completionContext = inlineCompletionContext(
        model.getValue(),
        model.getOffsetAt(position),
      );
      if (!shouldOfferInlineCompletion(completionContext, explicit)) {
        return { items: [] };
      }
      const range = new monaco.Range(
        position.lineNumber,
        position.column,
        position.lineNumber,
        position.column,
      );

      const cached = cache.get(completionContext.prefix, completionContext.lineSuffix);
      if (cached) return { items: [{ insertText: cached, range }] };

      if (!explicit && !(await wait(delayMs, token))) return { items: [] };

      const controller = new AbortController();
      token.onCancellationRequested(() => controller.abort());
      const fileName = model.uri.path.split("/").pop() ?? "";
      const reply = await client.complete(
        {
          requestId: `inline-completion-${++requestCounter}`,
          messages: buildInlineCompletionMessages(completionContext, fileName),
        },
        controller.signal,
      );
      if (!reply || token.isCancellationRequested || model.isDisposed()) {
        return { items: [] };
      }
      const insertText = cleanInlineCompletion(reply, completionContext);
      if (!insertText) return { items: [] };
      cache.set(completionContext.prefix, completionContext.lineSuffix, insertText);
      return { items: [{ insertText, range }] };
    },
    freeInlineCompletions() {},
  });
}

/** Copilot's extra keys: accept one word and ask for a suggestion now. */
export function registerInlineCompletionKeys(
  editor: Monaco.editor.IStandaloneCodeEditor,
  monaco: typeof Monaco,
): Monaco.IDisposable[] {
  return [
    editor.addAction({
      id: "latexdo.inlineSuggest.acceptNextWord",
      label: "Accept Next Word of Inline Suggestion",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.RightArrow],
      precondition: "editorTextFocus && inlineSuggestionVisible",
      run: () =>
        editor.trigger("keyboard", "editor.action.inlineSuggest.acceptNextWord", {}),
    }),
    editor.addAction({
      id: "latexdo.inlineSuggest.trigger",
      label: "Trigger Inline Suggestion",
      keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.Backslash],
      precondition: "editorTextFocus && !editorReadonly",
      run: () => editor.trigger("keyboard", "editor.action.inlineSuggest.trigger", {}),
    }),
  ];
}
