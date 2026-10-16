export type LatexListEnvironment = "itemize" | "enumerate" | "description";

export interface LatexListEnterEdit {
  startOffset: number;
  endOffset: number;
  text: string;
  cursorOffset: number;
  action: "continue" | "close";
  environment: LatexListEnvironment;
}

interface OpenListEnvironment {
  environment: LatexListEnvironment;
  beginOffset: number;
  indent: string;
}

const listEnvironmentPattern = /\\(begin|end)\s*\{(itemize|enumerate|description)\}/g;

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function maskComments(text: string): string {
  const chars = text.split("");
  let inComment = false;

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    if (char === "\n" || char === "\r") {
      inComment = false;
      continue;
    }
    if (inComment) {
      chars[index] = " ";
      continue;
    }
    if (char === "%" && !isEscaped(text, index)) {
      inComment = true;
      chars[index] = " ";
    }
  }

  return chars.join("");
}

function lineStartOffset(text: string, offset: number): number {
  return text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
}

function lineEndOffset(text: string, offset: number): number {
  const end = text.indexOf("\n", offset);
  return end === -1 ? text.length : end;
}

function includeFollowingLineBreak(text: string, offset: number): number {
  if (text[offset] === "\r" && text[offset + 1] === "\n") return offset + 2;
  if (text[offset] === "\r" || text[offset] === "\n") return offset + 1;
  return offset;
}

function lineIndentAtOffset(text: string, offset: number): string {
  const start = lineStartOffset(text, offset);
  return text.slice(start, lineEndOffset(text, start)).match(/^\s*/)?.[0] ?? "";
}

function nearestOpenList(text: string, offset: number): OpenListEnvironment | null {
  const safeOffset = Math.min(Math.max(0, offset), text.length);
  const masked = maskComments(text.slice(0, safeOffset));
  const stack: OpenListEnvironment[] = [];

  for (const match of masked.matchAll(listEnvironmentPattern)) {
    const command = match[1];
    const environment = match[2] as LatexListEnvironment;
    const matchOffset = match.index ?? 0;

    if (command === "begin") {
      stack.push({
        environment,
        beginOffset: matchOffset,
        indent: lineIndentAtOffset(text, matchOffset),
      });
      continue;
    }

    let matchingIndex = -1;
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      if (stack[index].environment === environment) {
        matchingIndex = index;
        break;
      }
    }
    if (matchingIndex !== -1) {
      stack.splice(matchingIndex, 1);
    }
  }

  return stack.length ? stack[stack.length - 1] : null;
}

function previousItemIndent(
  text: string,
  beginOffset: number,
  cursorOffset: number,
): string | null {
  const lines = text.slice(beginOffset, cursorOffset).split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = lines[index].match(/^(\s*)\\item\b/);
    if (match) return match[1];
  }
  return null;
}

function nextNonEmptyLine(
  text: string,
  offset: number,
): {
  start: number;
  end: number;
  text: string;
} | null {
  let cursor = includeFollowingLineBreak(text, lineEndOffset(text, offset));

  while (cursor < text.length) {
    const start = cursor;
    const end = lineEndOffset(text, start);
    const line = text.slice(start, end);
    if (line.trim()) {
      return { start, end, text: line };
    }
    cursor = includeFollowingLineBreak(text, end);
  }

  return null;
}

function matchingEndEnvironmentLine(
  line: string,
  environment: LatexListEnvironment,
): boolean {
  return new RegExp(`^\\s*\\\\end\\s*\\{${environment}\\}\\s*(?:%.*)?$`).test(line);
}

function emptyItemLine(line: string): RegExpMatchArray | null {
  return line.match(/^(\s*)\\item(?:\s*\[[^\]]*\])?\s*(?:%.*)?$/);
}

export function getLatexListEnterEdit(
  text: string,
  cursorOffset: number,
): LatexListEnterEdit | null {
  const safeOffset = Math.min(Math.max(0, cursorOffset), text.length);
  const openList = nearestOpenList(text, safeOffset);
  if (!openList) return null;

  const currentLineStart = lineStartOffset(text, safeOffset);
  const currentLineEnd = lineEndOffset(text, safeOffset);
  const currentLine = text.slice(currentLineStart, currentLineEnd);
  const cursorColumn = safeOffset - currentLineStart;
  const lineBeforeCursor = currentLine.slice(0, cursorColumn);
  const lineAfterCursor = currentLine.slice(cursorColumn);
  const currentItemMatch = currentLine.match(/^(\s*)\\item\b/);
  const currentLineIndent = currentLine.match(/^\s*/)?.[0] ?? "";

  if (
    emptyItemLine(currentLine) &&
    lineBeforeCursor.trim() &&
    !lineAfterCursor.trim()
  ) {
    const nextLine = nextNonEmptyLine(text, currentLineEnd);
    const closeLine = `${openList.indent}\\end{${openList.environment}}`;

    if (nextLine && matchingEndEnvironmentLine(nextLine.text, openList.environment)) {
      return {
        startOffset: currentLineStart,
        endOffset: nextLine.end,
        text: closeLine,
        cursorOffset: closeLine.length,
        action: "close",
        environment: openList.environment,
      };
    }

    return {
      startOffset: currentLineStart,
      endOffset: currentLineEnd,
      text: closeLine,
      cursorOffset: closeLine.length,
      action: "close",
      environment: openList.environment,
    };
  }

  if (!currentLine.trim()) {
    const itemIndent =
      currentLineIndent ||
      previousItemIndent(text, openList.beginOffset, safeOffset) ||
      `${openList.indent}\t`;
    const textToInsert = `${itemIndent}\\item `;

    return {
      startOffset: currentLineStart,
      endOffset: currentLineEnd,
      text: textToInsert,
      cursorOffset: textToInsert.length,
      action: "continue",
      environment: openList.environment,
    };
  }

  const itemIndent =
    currentItemMatch?.[1] ??
    previousItemIndent(text, openList.beginOffset, safeOffset) ??
    `${openList.indent}\t`;
  const textToInsert = `\n${itemIndent}\\item `;

  return {
    startOffset: safeOffset,
    endOffset: safeOffset,
    text: textToInsert,
    cursorOffset: textToInsert.length,
    action: "continue",
    environment: openList.environment,
  };
}
