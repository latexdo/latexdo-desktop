export interface ReviewRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

function offsetOf(content: string, line: number, column: number): number | null {
  if (line < 1 || column < 1) return null;
  const lines = content.split("\n");
  if (line > lines.length) return null;
  let offset = 0;
  for (let index = 0; index < line - 1; index += 1) {
    offset += lines[index].length + 1;
  }
  return offset + Math.min(column - 1, lines[line - 1].length);
}

function positionOf(content: string, offset: number): { line: number; column: number } {
  const before = content.slice(0, offset);
  const line = before.split("\n").length;
  return { line, column: offset - (before.lastIndexOf("\n") + 1) + 1 };
}

/**
 * Where a reviewed passage is now. The stored line and column go stale as soon
 * as text above the passage changes, so the passage is found again by its text,
 * taking the occurrence closest to where it used to be. Null when it is gone.
 */
export function locateReviewSelection(
  content: string,
  selection: ReviewRange & { text: string },
): ReviewRange | null {
  const { text } = selection;
  if (!text) return null;
  const recorded = offsetOf(content, selection.startLine, selection.startColumn);
  if (recorded !== null && content.startsWith(text, recorded)) {
    return {
      startLine: selection.startLine,
      startColumn: selection.startColumn,
      endLine: selection.endLine,
      endColumn: selection.endColumn,
    };
  }

  const target = recorded ?? 0;
  let best = -1;
  for (
    let found = content.indexOf(text);
    found !== -1;
    found = content.indexOf(text, found + 1)
  ) {
    if (best === -1 || Math.abs(found - target) < Math.abs(best - target)) {
      best = found;
    }
  }
  if (best === -1) return null;

  const start = positionOf(content, best);
  const end = positionOf(content, best + text.length);
  return {
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
  };
}
