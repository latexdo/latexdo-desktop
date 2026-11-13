/*
 * Where the other people are in the open file: their cursor, read from Yjs
 * awareness, turned into a line and column. Each person is marked with their
 * emoji in the gutter and with their color on the scrollbar, so you can see
 * where they are even when their cursor is off screen, and jump there.
 */

import * as Y from "yjs";
import type * as monaco from "monaco-editor";
import type { Awareness } from "y-protocols/awareness";

export interface RemoteCursorPosition {
  /** The Yjs awareness client number (y-monaco's class names use it). */
  clientID: number;
  /** The LatexDo client id, as presence lists it; empty from older apps. */
  clientId: string;
  name: string;
  emoji: string;
  color: string;
  /** Offset of their cursor in the text. */
  index: number;
}

interface AwarenessUser {
  name?: unknown;
  emoji?: unknown;
  color?: unknown;
  clientId?: unknown;
}

function relativePosition(value: unknown): Y.RelativePosition | null {
  if (!value || typeof value !== "object") return null;
  try {
    // Remote states arrive as JSON; local ones are already positions.
    return value instanceof Y.RelativePosition
      ? value
      : Y.createRelativePositionFromJSON(value);
  } catch {
    return null;
  }
}

/** Everyone else's cursor in this text, in a stable order. */
export function remoteCursorPositions(
  awareness: Awareness,
  doc: Y.Doc,
  text: Y.Text,
): RemoteCursorPosition[] {
  const cursors: RemoteCursorPosition[] = [];
  awareness.getStates().forEach((state, clientID) => {
    if (clientID === doc.clientID) return;
    const { user, selection } = state as {
      user?: AwarenessUser;
      selection?: { head?: unknown };
    };
    if (!user || !selection) return;
    const head = relativePosition(selection.head);
    if (!head) return;
    const absolute = Y.createAbsolutePositionFromRelativePosition(head, doc);
    if (!absolute || absolute.type !== text) return;
    cursors.push({
      clientID,
      clientId: typeof user.clientId === "string" ? user.clientId : "",
      name: typeof user.name === "string" ? user.name : "",
      emoji: typeof user.emoji === "string" ? user.emoji : "",
      color: typeof user.color === "string" ? user.color : "",
      index: absolute.index,
    });
  });
  return cursors.sort((a, b) => a.clientID - b.clientID);
}

/** Monaco's enum values, so this works with a type-only Monaco import. */
const overviewRulerFull = 7;
const minimapInline = 1;
const glyphLaneRight = 3;

function markdownText(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, "\\$&");
}

/**
 * One gutter emoji per line (several people on a line share it), and a mark
 * in each person's color on the scrollbar and minimap.
 */
export function remoteCursorDecorations(
  model: { getPositionAt(offset: number): { lineNumber: number } },
  cursors: readonly RemoteCursorPosition[],
): monaco.editor.IModelDeltaDecoration[] {
  const byLine = new Map<number, RemoteCursorPosition[]>();
  for (const cursor of cursors) {
    const { lineNumber } = model.getPositionAt(cursor.index);
    const people = byLine.get(lineNumber) ?? [];
    people.push(cursor);
    byLine.set(lineNumber, people);
  }
  const decorations: monaco.editor.IModelDeltaDecoration[] = [];
  for (const [lineNumber, people] of byLine) {
    const range = {
      startLineNumber: lineNumber,
      startColumn: 1,
      endLineNumber: lineNumber,
      endColumn: 1,
    };
    const first = people[0]!;
    decorations.push({
      range,
      options: {
        isWholeLine: true,
        glyphMarginClassName: `yRemoteGlyph yRemoteGlyph-${Math.trunc(first.clientID)}${
          people.length > 1 ? " yRemoteGlyphMany" : ""
        }`,
        glyphMargin: { position: glyphLaneRight },
        glyphMarginHoverMessage: people.map((person) => ({
          value: `${person.emoji} **${markdownText(person.name || "Guest")}** is here`,
        })),
      },
    });
    for (const person of people) {
      decorations.push({
        range,
        options: {
          overviewRuler: { color: person.color, position: overviewRulerFull },
          minimap: { color: person.color, position: minimapInline },
        },
      });
    }
  }
  return decorations;
}

/** Scrolls to a person's cursor; false when they are not in this file. */
export function revealRemoteCursor(
  editor: monaco.editor.IStandaloneCodeEditor,
  cursors: readonly RemoteCursorPosition[],
  clientId: string,
): boolean {
  const model = editor.getModel();
  const cursor = clientId
    ? cursors.find((item) => item.clientId === clientId)
    : undefined;
  if (!model || !cursor) return false;
  const position = model.getPositionAt(cursor.index);
  // ScrollType.Smooth is 0.
  editor.revealPositionInCenterIfOutsideViewport(position, 0);
  return true;
}
