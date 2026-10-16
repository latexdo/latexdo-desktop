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
      setLocalStateField: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
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
        setLocalStateField: vi.fn(),
        destroy: vi.fn(),
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
});
