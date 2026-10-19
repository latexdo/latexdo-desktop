import { describe, expect, it, vi } from "vitest";
import {
  buildInlineCompletionMessages,
  cleanInlineCompletion,
  cursorMarker,
  inlineCompletionContext,
  shouldOfferInlineCompletion,
} from "./inlineCompletion";
import { InlineCompletionCache } from "./inlineCompletionCache";
import {
  registerInlineCompletion,
  registerInlineCompletionKeys,
} from "./registerInlineCompletion";

const prose = "Our experiments on three benchmarks show that the proposed method ";

function at(text: string, marker = "|") {
  const offset = text.indexOf(marker);
  return inlineCompletionContext(text.replace(marker, ""), offset);
}

describe("shouldOfferInlineCompletion", () => {
  it("offers ghost text at the end of a line and before closing characters", () => {
    expect(shouldOfferInlineCompletion(at(`${prose}|`), false)).toBe(true);
    expect(shouldOfferInlineCompletion(at(`See \\emph{${prose}|}.`), false)).toBe(true);
    expect(shouldOfferInlineCompletion(at(`${prose}|\n\nNext paragraph.`), false)).toBe(
      true,
    );
  });

  it("offers ghost text in math and on a new line, like Copilot", () => {
    expect(
      shouldOfferInlineCompletion(at("We minimise the loss $\\mathcal{L} = |$"), false),
    ).toBe(true);
    expect(
      shouldOfferInlineCompletion(
        at("\\begin{itemize}\n  \\item First point\n  |"),
        false,
      ),
    ).toBe(true);
  });

  it.each([
    ["words after the cursor", `${prose}|works well.`],
    ["a comment", `% ${prose}|`],
    ["a command name", `${prose}\\emph|`],
    ["a citation key", `As shown before \\cite{smi|`],
    ["a label", `\\label{sec:res|`],
    ["almost nothing written", "We |"],
  ])("stays quiet for %s", (_case, text) => {
    expect(shouldOfferInlineCompletion(at(text), false)).toBe(false);
  });

  it("answers Alt+\\ in more places, but never over written text", () => {
    expect(shouldOfferInlineCompletion(at(`% ${prose}|`), true)).toBe(true);
    expect(shouldOfferInlineCompletion(at("We |"), true)).toBe(true);
    expect(shouldOfferInlineCompletion(at(`${prose}|works well.`), true)).toBe(false);
  });
});

describe("buildInlineCompletionMessages", () => {
  it("sends the text on both sides of the cursor", () => {
    const messages = buildInlineCompletionMessages(
      at(`${prose}|\n\nThe next paragraph.`),
      "main.tex",
    );
    expect(messages[1].content).toContain("main.tex");
    expect(messages[1].content).toContain(
      `method ${cursorMarker}\n\nThe next paragraph.`,
    );
  });
});

describe("cleanInlineCompletion", () => {
  const context = at(`${prose}|`);

  it("keeps a partial sentence, as Copilot does", () => {
    expect(cleanInlineCompletion("outperforms every baseline", context)).toBe(
      "outperforms every baseline",
    );
  });

  it("ends prose with its sentence", () => {
    expect(
      cleanInlineCompletion(
        "outperforms every baseline. We also study its cost.",
        context,
      ),
    ).toBe("outperforms every baseline.");
    expect(cleanInlineCompletion("works, e.g. on CIFAR. Then more.", context)).toBe(
      "works, e.g. on CIFAR.",
    );
  });

  it("removes fences, labels and text the model echoed", () => {
    expect(
      cleanInlineCompletion("```latex\nCompletion: outperforms them\n```", context),
    ).toBe("outperforms them");
    expect(
      cleanInlineCompletion("show that the proposed method outperforms them", context),
    ).toBe("outperforms them");
  });

  it("keeps a few lines of structure and stops at the paragraph end", () => {
    const list = at("\\begin{itemize}\n  \\item Fast inference\n  |");
    expect(
      cleanInlineCompletion(
        "\\item Small memory footprint\n\\end{itemize}\n\nA new paragraph.",
        list,
      ),
    ).toBe("\\item Small memory footprint\n\\end{itemize}");
  });

  it("does not repeat the closing characters after the cursor", () => {
    const inside = at(`See \\emph{${prose}|}.`);
    expect(cleanInlineCompletion("outperforms them}.", inside)).toBe(
      "outperforms them",
    );
    expect(cleanInlineCompletion("first line\nsecond line", inside)).toBe("first line");
  });

  it("drops a space the author already typed and empty replies", () => {
    expect(cleanInlineCompletion("  works", context)).toBe("works");
    expect(cleanInlineCompletion("  \n ", context)).toBeNull();
  });
});

describe("InlineCompletionCache", () => {
  it("keeps the rest of a suggestion while the author types it", () => {
    const cache = new InlineCompletionCache();
    cache.set("the method ", "", "outperforms them.");
    expect(cache.get("the method ", "")).toBe("outperforms them.");
    expect(cache.get("the method out", "")).toBe("performs them.");
    expect(cache.get("the method outx", "")).toBeNull();
    expect(cache.get("the method outperforms them.", "")).toBeNull();
  });

  it("brings the suggestion back after deleting letters", () => {
    const cache = new InlineCompletionCache();
    cache.set("the method out", "", "performs them.");
    expect(cache.get("the method o", "")).toBe("utperforms them.");
  });

  it("forgets entries for other text after the cursor and old entries", () => {
    const cache = new InlineCompletionCache(2);
    cache.set("a", "", "1");
    cache.set("b", "", "2");
    cache.set("c", "", "3");
    expect(cache.get("a", "")).toBeNull();
    expect(cache.get("b", "}")).toBeNull();
  });
});

describe("registerInlineCompletion", () => {
  function setup(reply: string | null) {
    let provider: {
      provideInlineCompletions: (...args: unknown[]) => Promise<{ items: unknown[] }>;
    } | null = null;
    const monaco = {
      languages: {
        InlineCompletionTriggerKind: { Automatic: 0, Explicit: 1 },
        registerInlineCompletionsProvider: (
          _language: string,
          value: typeof provider,
        ) => {
          provider = value;
          return { dispose: () => undefined };
        },
      },
      Range: class {
        constructor(
          public startLineNumber: number,
          public startColumn: number,
          public endLineNumber: number,
          public endColumn: number,
        ) {}
      },
    };
    const client = { complete: vi.fn().mockResolvedValue(reply) };
    registerInlineCompletion({
      monaco: monaco as never,
      getClient: () => client,
      delayMs: 0,
    });
    const text = prose;
    const model = {
      getValue: () => text,
      getOffsetAt: () => text.length,
      isDisposed: () => false,
      uri: { path: "/project/main.tex" },
    };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: () => undefined,
    };
    const request = (kind = 0) =>
      provider!.provideInlineCompletions(
        model,
        { lineNumber: 1, column: text.length + 1 },
        { triggerKind: kind },
        token,
      );
    return { client, request };
  }

  it("shows the cleaned reply as ghost text and reuses it without asking again", async () => {
    const { client, request } = setup("outperforms them. And more.");
    expect((await request()).items).toEqual([
      expect.objectContaining({ insertText: "outperforms them." }),
    ]);
    expect((await request()).items).toEqual([
      expect.objectContaining({ insertText: "outperforms them." }),
    ]);
    expect(client.complete).toHaveBeenCalledTimes(1);
  });

  it("shows nothing when the model has nothing useful", async () => {
    const { request } = setup(null);
    expect((await request(1)).items).toEqual([]);
  });
});

describe("registerInlineCompletion edge cases", () => {
  type Provider = {
    provideInlineCompletions: (...args: unknown[]) => Promise<{ items: unknown[] }>;
    freeInlineCompletions: () => void;
  };

  function harness(options: {
    client?: { complete: ReturnType<typeof vi.fn> } | null;
    text?: string;
    disposed?: boolean;
    path?: string;
    delayMs?: number;
  }) {
    let provider: Provider | null = null;
    const monaco = {
      languages: {
        InlineCompletionTriggerKind: { Automatic: 0, Explicit: 1 },
        registerInlineCompletionsProvider: (_language: string, value: Provider) => {
          provider = value;
          return { dispose: () => undefined };
        },
      },
      Range: class {
        constructor(
          public startLineNumber: number,
          public startColumn: number,
          public endLineNumber: number,
          public endColumn: number,
        ) {}
      },
    };
    const client = options.client === undefined ? null : options.client;
    registerInlineCompletion({
      monaco: monaco as never,
      getClient: () => client as never,
      delayMs: options.delayMs ?? 0,
    });
    const text = options.text ?? prose;
    const model = {
      getValue: () => text,
      getOffsetAt: () => text.length,
      isDisposed: () => options.disposed ?? false,
      uri: { path: options.path ?? "/project/main.tex" },
    };
    const cancelHandlers: Array<() => void> = [];
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: (handler: () => void) => {
        cancelHandlers.push(handler);
      },
    };
    const cancel = () => {
      token.isCancellationRequested = true;
      cancelHandlers.forEach((handler) => handler());
    };
    const request = (kind = 0) =>
      provider!.provideInlineCompletions(
        model,
        { lineNumber: 1, column: text.length + 1 },
        { triggerKind: kind },
        token,
      );
    return { provider: provider!, request, cancel, token };
  }

  it("offers nothing without a ready AI client", async () => {
    const { request, provider } = harness({ client: null });
    expect((await request(1)).items).toEqual([]);
    expect(provider.freeInlineCompletions()).toBeUndefined();
  });

  it("offers nothing where ghost text does not belong", async () => {
    const client = { complete: vi.fn() };
    const { request } = harness({ client, text: "   " });
    expect((await request(1)).items).toEqual([]);
    expect(client.complete).not.toHaveBeenCalled();
  });

  it("drops the request when typing resumes during the pause", async () => {
    vi.useFakeTimers();
    try {
      const client = { complete: vi.fn() };
      const { request, cancel } = harness({ client, delayMs: 300 });
      const pending = request();
      cancel();
      expect((await pending).items).toEqual([]);
      expect(client.complete).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts the model call when the request is cancelled mid-flight", async () => {
    let signal: AbortSignal | undefined;
    let finish: (value: string) => void = () => undefined;
    const client = {
      complete: vi.fn((_request: unknown, abort: AbortSignal) => {
        signal = abort;
        return new Promise<string>((resolve) => {
          finish = resolve;
        });
      }),
    };
    const { request, cancel } = harness({ client, path: "" });
    const pending = request(1);
    await vi.waitFor(() => expect(client.complete).toHaveBeenCalled());
    cancel();
    expect(signal?.aborted).toBe(true);
    finish("outperforms them.");
    expect((await pending).items).toEqual([]);
  });

  it("ignores replies for a closed file or with nothing left after cleaning", async () => {
    const disposedClient = { complete: vi.fn().mockResolvedValue("outperforms them.") };
    expect((await harness({ client: disposedClient, disposed: true }).request(1)).items).toEqual(
      [],
    );
    const emptyClient = { complete: vi.fn().mockResolvedValue("   ") };
    expect((await harness({ client: emptyClient }).request(1)).items).toEqual([]);
  });

  it("registers the accept-word and trigger keys", () => {
    const actions: Array<{ id: string; keybindings: number[]; run: () => void }> = [];
    const editor = {
      addAction: vi.fn((action: (typeof actions)[number]) => {
        actions.push(action);
        return { dispose: vi.fn() };
      }),
      trigger: vi.fn(),
    };
    const monaco = {
      KeyMod: { CtrlCmd: 2048, Alt: 512 },
      KeyCode: { RightArrow: 17, Backslash: 93 },
    };
    const disposables = registerInlineCompletionKeys(editor as never, monaco as never);
    expect(disposables).toHaveLength(2);
    expect(actions.map((action) => action.keybindings[0])).toEqual([2048 | 17, 512 | 93]);
    actions[0].run();
    actions[1].run();
    expect(editor.trigger).toHaveBeenNthCalledWith(
      1,
      "keyboard",
      "editor.action.inlineSuggest.acceptNextWord",
      {},
    );
    expect(editor.trigger).toHaveBeenNthCalledWith(
      2,
      "keyboard",
      "editor.action.inlineSuggest.trigger",
      {},
    );
  });
});
