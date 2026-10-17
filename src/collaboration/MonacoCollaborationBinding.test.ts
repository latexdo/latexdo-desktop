import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { EditorMutationOrigin } from "./editProvenance";
import { MonacoCollaborationBinding } from "./MonacoCollaborationBinding";
import type { CollaborationClientOptions } from "./collaborationTypes";

const mocks = vi.hoisted(() => ({
  lastClient: null as null | {
    doc: Y.Doc;
    text: Y.Text;
    awareness: {
      clientID: number;
      states: Map<number, unknown>;
      listeners: Array<() => void>;
      setLocalStateField: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
      on: (event: string, listener: () => void) => void;
      off: ReturnType<typeof vi.fn>;
      getStates: () => Map<number, unknown>;
    };
    destroy: ReturnType<typeof vi.fn>;
  },
  lastMonacoBinding: null as unknown,
}));

vi.mock("./CollaborationClient", async () => {
  const Yjs = await import("yjs");
  return {
    CollaborationClient: class {
      doc = new Yjs.Doc();
      text = this.doc.getText("content");
      awareness = {
        clientID: 1,
        states: new Map<number, unknown>(),
        listeners: [] as Array<() => void>,
        setLocalStateField: vi.fn(),
        destroy: vi.fn(),
        on(_event: string, listener: () => void) {
          this.listeners.push(listener);
        },
        off: vi.fn(),
        getStates() {
          return this.states;
        },
      };
      destroy = vi.fn();

      constructor(options: CollaborationClientOptions) {
        mocks.lastClient = this;
        queueMicrotask(() => options.onSynced?.());
      }
    },
  };
});

vi.mock("y-monaco", () => ({
  MonacoBinding: class {
    constructor() {
      mocks.lastMonacoBinding = this;
    }

    destroy = vi.fn();
  },
}));

function fakeEditor() {
  return {
    getModel: () => ({
      getValue: () => "",
      getOffsetAt: () => 0,
    }),
    getSelection: () => null,
    onDidChangeCursorSelection: () => ({ dispose: vi.fn() }),
  };
}

describe("MonacoCollaborationBinding provenance", () => {
  it("reports local y-monaco transactions as local user-origin text transactions", async () => {
    const origin = new EditorMutationOrigin();
    const seen: Array<{ kind: string; stackOrigin: string | null }> = [];
    const binding = new MonacoCollaborationBinding({
      editor: fakeEditor() as never,
      mutationOrigin: origin,
      projectId: "project",
      relativePath: "main.tex",
      shareToken: "token",
      apiBaseUrl: "http://localhost",
      clientName: "Alice",
      color: "#123456",
      onTextTransaction: (event) => {
        seen.push({ kind: event.kind, stackOrigin: origin.current() });
      },
    });
    await Promise.resolve();

    mocks.lastClient?.doc.transact(() => {
      mocks.lastClient?.text.insert(0, "foo");
    }, mocks.lastMonacoBinding);

    expect(seen).toContainEqual({ kind: "local", stackOrigin: "user" });
    binding.destroy();
  });

  it("reports applied remote updates as remote-origin text transactions", async () => {
    const origin = new EditorMutationOrigin();
    const seen: Array<{ kind: string; stackOrigin: string | null }> = [];
    const binding = new MonacoCollaborationBinding({
      editor: fakeEditor() as never,
      mutationOrigin: origin,
      projectId: "project",
      relativePath: "main.tex",
      shareToken: "token",
      apiBaseUrl: "http://localhost",
      clientName: "Bob",
      color: "#123456",
      onTextTransaction: (event) => {
        seen.push({ kind: event.kind, stackOrigin: origin.current() });
      },
    });
    await Promise.resolve();

    const remoteDoc = new Y.Doc();
    remoteDoc.getText("content").insert(0, "foo");
    Y.applyUpdate(
      mocks.lastClient?.doc ?? new Y.Doc(),
      Y.encodeStateAsUpdate(remoteDoc),
      "remote-provider",
    );

    expect(seen).toContainEqual({ kind: "remote", stackOrigin: "remote" });
    binding.destroy();
  });

  it("labels other people's cursors with their emoji, name and color", async () => {
    const binding = new MonacoCollaborationBinding({
      editor: fakeEditor() as never,
      projectId: "project",
      relativePath: "main.tex",
      shareToken: "token",
      apiBaseUrl: "http://localhost",
      clientName: "Alice",
      color: "#123456",
      emoji: "🦊",
    });
    await Promise.resolve();
    const awareness = mocks.lastClient!.awareness;
    awareness.states.set(1, { user: { name: "Alice", color: "#123456", emoji: "🦊" } });
    awareness.states.set(9, { user: { name: "Bob", color: "#1d7a56", emoji: "🐼" } });
    awareness.listeners.forEach((listener) => listener());

    const style = document.head.querySelector<HTMLStyleElement>(
      "style[data-latexdo-remote-cursors]",
    )!;
    expect(style.textContent).toContain(
      '.yRemoteSelectionHead-9::after { content: "🐼 Bob"',
    );
    // Your own cursor is not labelled.
    expect(style.textContent).not.toContain("Alice");
    binding.destroy();
    expect(
      document.head.querySelector("style[data-latexdo-remote-cursors]"),
    ).toBeNull();
  });
});
