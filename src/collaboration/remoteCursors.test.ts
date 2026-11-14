import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import {
  remoteCursorDecorations,
  remoteCursorPositions,
  revealRemoteCursor,
} from "./remoteCursors";

function setup() {
  const doc = new Y.Doc();
  const text = doc.getText("content");
  text.insert(0, "first line\nsecond line\nthird line");
  const awareness = new Awareness(doc);
  return { doc, text, awareness };
}

/** A remote person, as their state arrives over the wire (plain JSON). */
function addRemote(
  awareness: Awareness,
  text: Y.Text,
  clientID: number,
  user: Record<string, unknown>,
  index: number,
) {
  const head = JSON.parse(
    JSON.stringify(Y.createRelativePositionFromTypeIndex(text, index)),
  );
  awareness.states.set(clientID, { user, selection: { anchor: head, head } });
}

const model = (content: string) => ({
  getPositionAt(offset: number) {
    const before = content.slice(0, offset).split("\n");
    return { lineNumber: before.length, column: before.at(-1)!.length + 1 };
  },
});

describe("remote cursors", () => {
  it("finds where each other person is, skipping this client", () => {
    const { doc, text, awareness } = setup();
    awareness.setLocalStateField("selection", {
      head: Y.createRelativePositionFromTypeIndex(text, 0),
    });
    addRemote(
      awareness,
      text,
      90,
      { name: "Ada", emoji: "🦊", color: "#2f6fdb", clientId: "client-ada" },
      13,
    );
    addRemote(awareness, text, 91, { name: "Old app" }, 2);
    awareness.states.set(92, { user: { name: "No cursor" } });

    const cursors = remoteCursorPositions(awareness, doc, text);
    expect(cursors).toEqual([
      {
        clientID: 90,
        clientId: "client-ada",
        name: "Ada",
        emoji: "🦊",
        color: "#2f6fdb",
        index: 13,
      },
      { clientID: 91, clientId: "", name: "Old app", emoji: "", color: "", index: 2 },
    ]);
  });

  it("marks each line once in the gutter and each person on the scrollbar", () => {
    const content = "first line\nsecond line\nthird line";
    const decorations = remoteCursorDecorations(model(content), [
      {
        clientID: 1,
        clientId: "a",
        name: "Ada",
        emoji: "🦊",
        color: "#111111",
        index: 12,
      },
      {
        clientID: 2,
        clientId: "b",
        name: "Bo",
        emoji: "🐼",
        color: "#222222",
        index: 14,
      },
      { clientID: 3, clientId: "c", name: "", emoji: "🐨", color: "#333333", index: 0 },
    ]);
    const glyphs = decorations.filter((item) => item.options.glyphMarginClassName);
    expect(glyphs.map((item) => item.range.startLineNumber).sort()).toEqual([1, 2]);
    const shared = glyphs.find((item) => item.range.startLineNumber === 2)!;
    expect(shared.options.glyphMarginClassName).toBe(
      "yRemoteGlyph yRemoteGlyph-1 yRemoteGlyphMany",
    );
    expect(shared.options.glyphMarginHoverMessage).toEqual([
      { value: "🦊 **Ada** is here" },
      { value: "🐼 **Bo** is here" },
    ]);
    const marks = decorations.filter((item) => item.options.overviewRuler);
    expect(marks.map((item) => item.options.overviewRuler!.color).sort()).toEqual([
      "#111111",
      "#222222",
      "#333333",
    ]);
  });

  it("jumps to a person who is in the file, and says when they are not", () => {
    const content = "first line\nsecond line";
    const editor = {
      getModel: () => model(content),
      revealPositionInCenterIfOutsideViewport: vi.fn(),
    };
    const cursors = [
      {
        clientID: 1,
        clientId: "a",
        name: "Ada",
        emoji: "🦊",
        color: "#111",
        index: 15,
      },
    ];
    expect(revealRemoteCursor(editor as never, cursors, "a")).toBe(true);
    expect(editor.revealPositionInCenterIfOutsideViewport).toHaveBeenCalledWith(
      { lineNumber: 2, column: 5 },
      0,
    );
    expect(revealRemoteCursor(editor as never, cursors, "b")).toBe(false);
    expect(revealRemoteCursor(editor as never, cursors, "")).toBe(false);
  });
});
