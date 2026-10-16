const latexDoReviewCommandPattern =
  /\\(?:reviewercomment|latexdoreviewercomment|rebuttal|latexdoinsert|latexdodelete|latexdochange)\s*\{/;

const trackedChangeCommandPattern =
  /\\(?:latexdoinsert|latexdodelete|latexdochange)\s*\{/;

export interface TrackedChangeSummary {
  insertions: number;
  deletions: number;
  replacements: number;
}

export function escapeLatexText(value: string): string {
  return value.replace(/[\\&%#$_{}~^]/g, (character) => {
    switch (character) {
      case "\\":
        return "\\textbackslash{}";
      case "~":
        return "\\textasciitilde{}";
      case "^":
        return "\\textasciicircum{}";
      default:
        return `\\${character}`;
    }
  });
}

interface BraceArgument {
  value: string;
  endIndex: number;
}

export interface RemoveInsertedReviewMarkupResult {
  content: string;
  removed: boolean;
}

function skipWhitespace(content: string, index: number): number {
  let cursor = index;
  while (cursor < content.length && /\s/.test(content[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function readBraceArgument(content: string, startIndex: number): BraceArgument | null {
  if (content[startIndex] !== "{") {
    return null;
  }

  let depth = 0;
  let escaped = false;
  let value = "";

  for (let index = startIndex; index < content.length; index += 1) {
    const character = content[index];

    if (escaped) {
      if (depth >= 1) {
        value += character;
      }
      escaped = false;
      continue;
    }

    if (character === "\\") {
      if (depth >= 1) {
        value += character;
      }
      escaped = true;
      continue;
    }

    if (character === "{") {
      if (depth >= 1) {
        value += character;
      }
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return { value, endIndex: index + 1 };
      }
      if (depth < 0) {
        return null;
      }
      value += character;
      continue;
    }

    if (depth >= 1) {
      value += character;
    }
  }

  return null;
}

function splitTrailingPunctuation(
  content: string,
  index: number,
): {
  punctuation: string;
  nextIndex: number;
} {
  const whitespaceEnd = skipWhitespace(content, index);
  const nextCharacter = content[whitespaceEnd] ?? "";
  if (/^[.,;:!?]$/.test(nextCharacter)) {
    return {
      punctuation: content.slice(index, whitespaceEnd) + nextCharacter,
      nextIndex: whitespaceEnd + 1,
    };
  }
  return { punctuation: "", nextIndex: index };
}

export function usesLatexDoReviewMacros(content: string): boolean {
  return latexDoReviewCommandPattern.test(content);
}

export function usesLatexDoTrackedChanges(content: string): boolean {
  return trackedChangeCommandPattern.test(content);
}

function replaceTrackedChanges(content: string, mode: "accept" | "reject"): string {
  let output = "";
  let cursor = 0;

  while (cursor < content.length) {
    const commandMatch = /\\(?:latexdoinsert|latexdodelete|latexdochange)\s*\{/.exec(
      content.slice(cursor),
    );
    if (!commandMatch || commandMatch.index === undefined) {
      output += content.slice(cursor);
      break;
    }

    const commandIndex = cursor + commandMatch.index;
    const command = commandMatch[0].startsWith("\\latexdoinsert")
      ? "\\latexdoinsert"
      : commandMatch[0].startsWith("\\latexdodelete")
        ? "\\latexdodelete"
        : "\\latexdochange";
    const firstArgumentStart = skipWhitespace(content, commandIndex + command.length);
    const firstArgument = readBraceArgument(content, firstArgumentStart);

    if (!firstArgument) {
      output += content.slice(cursor, commandIndex + command.length);
      cursor = commandIndex + command.length;
      continue;
    }

    output += content.slice(cursor, commandIndex);

    if (command === "\\latexdoinsert") {
      output += mode === "accept" ? firstArgument.value : "";
      cursor = firstArgument.endIndex;
      continue;
    }

    if (command === "\\latexdodelete") {
      output += mode === "accept" ? "" : firstArgument.value;
      cursor = firstArgument.endIndex;
      continue;
    }

    const secondArgumentStart = skipWhitespace(content, firstArgument.endIndex);
    const secondArgument = readBraceArgument(content, secondArgumentStart);
    if (!secondArgument) {
      output += content.slice(commandIndex, firstArgument.endIndex);
      cursor = firstArgument.endIndex;
      continue;
    }

    output += mode === "accept" ? secondArgument.value : firstArgument.value;
    cursor = secondArgument.endIndex;
  }

  return output;
}

export function acceptLatexDoTrackedChanges(content: string): string {
  return replaceTrackedChanges(content, "accept");
}

export function rejectLatexDoTrackedChanges(content: string): string {
  return replaceTrackedChanges(content, "reject");
}

export function summarizeLatexDoTrackedChanges(content: string): TrackedChangeSummary {
  const summary: TrackedChangeSummary = {
    insertions: 0,
    deletions: 0,
    replacements: 0,
  };
  let cursor = 0;

  while (cursor < content.length) {
    const commandMatch = /\\(?:latexdoinsert|latexdodelete|latexdochange)\s*\{/.exec(
      content.slice(cursor),
    );
    if (!commandMatch || commandMatch.index === undefined) {
      break;
    }

    const commandIndex = cursor + commandMatch.index;
    const command = commandMatch[0].startsWith("\\latexdoinsert")
      ? "\\latexdoinsert"
      : commandMatch[0].startsWith("\\latexdodelete")
        ? "\\latexdodelete"
        : "\\latexdochange";
    const firstArgumentStart = skipWhitespace(content, commandIndex + command.length);
    const firstArgument = readBraceArgument(content, firstArgumentStart);
    if (!firstArgument) {
      cursor = commandIndex + command.length;
      continue;
    }

    if (command === "\\latexdoinsert") {
      summary.insertions += 1;
      cursor = firstArgument.endIndex;
      continue;
    }

    if (command === "\\latexdodelete") {
      summary.deletions += 1;
      cursor = firstArgument.endIndex;
      continue;
    }

    const secondArgumentStart = skipWhitespace(content, firstArgument.endIndex);
    const secondArgument = readBraceArgument(content, secondArgumentStart);
    if (!secondArgument) {
      cursor = firstArgument.endIndex;
      continue;
    }
    summary.replacements += 1;
    cursor = secondArgument.endIndex;
  }

  return summary;
}

export function normalizeLatexDoReviewMarkup(content: string): string {
  const command = "\\reviewercomment";
  let output = "";
  let cursor = 0;

  while (cursor < content.length) {
    const commandIndex = content.indexOf(command, cursor);
    if (commandIndex === -1) {
      output += content.slice(cursor);
      break;
    }

    const firstArgumentStart = skipWhitespace(content, commandIndex + command.length);
    const textArgument = readBraceArgument(content, firstArgumentStart);
    if (!textArgument) {
      output += content.slice(cursor, commandIndex + command.length);
      cursor = commandIndex + command.length;
      continue;
    }

    const secondArgumentStart = skipWhitespace(content, textArgument.endIndex);
    const commentArgument = readBraceArgument(content, secondArgumentStart);
    if (!commentArgument) {
      output += content.slice(cursor, commandIndex + command.length);
      cursor = commandIndex + command.length;
      continue;
    }

    const trailing = splitTrailingPunctuation(content, commentArgument.endIndex);
    output += content.slice(cursor, commandIndex);
    output += `${textArgument.value}${trailing.punctuation}\n`;
    output += `\\latexdoreviewercomment{${commentArgument.value}}\n`;
    cursor = trailing.nextIndex;
  }

  return output;
}

function startsWithCommandAt(content: string, command: string, index: number): boolean {
  return content.slice(index, index + command.length) === command;
}

function stripOneInsertedLineBreak(content: string, index: number): string {
  if (content.startsWith("\r\n", index)) {
    return content.slice(index + 2);
  }
  if (content.startsWith("\n", index)) {
    return content.slice(index + 1);
  }
  return content.slice(index);
}

function removeReviewerCommentWrapperAt(
  content: string,
  commandIndex: number,
  selectionText: string,
): RemoveInsertedReviewMarkupResult | null {
  const command = "\\reviewercomment";
  if (!startsWithCommandAt(content, command, commandIndex)) {
    return null;
  }

  const firstArgumentStart = skipWhitespace(content, commandIndex + command.length);
  const textArgument = readBraceArgument(content, firstArgumentStart);
  if (!textArgument || textArgument.value !== selectionText) {
    return null;
  }

  const secondArgumentStart = skipWhitespace(content, textArgument.endIndex);
  const commentArgument = readBraceArgument(content, secondArgumentStart);
  if (!commentArgument) {
    return null;
  }

  return {
    content:
      content.slice(0, commandIndex) +
      textArgument.value +
      content.slice(commentArgument.endIndex),
    removed: true,
  };
}

function removeReviewerCommentBlockAfterSelectionAt(
  content: string,
  selectionStart: number,
  selectionText: string,
): RemoveInsertedReviewMarkupResult | null {
  const command = "\\latexdoreviewercomment";
  const selectionEnd = selectionStart + selectionText.length;
  if (content.slice(selectionStart, selectionEnd) !== selectionText) {
    return null;
  }

  const trailing = splitTrailingPunctuation(content, selectionEnd);
  const preservedEnd = trailing.punctuation ? trailing.nextIndex : selectionEnd;
  const commandIndex = skipWhitespace(content, preservedEnd);
  if (!startsWithCommandAt(content, command, commandIndex)) {
    return null;
  }

  const firstArgumentStart = skipWhitespace(content, commandIndex + command.length);
  const commentArgument = readBraceArgument(content, firstArgumentStart);
  if (!commentArgument) {
    return null;
  }

  return {
    content:
      content.slice(0, preservedEnd) +
      stripOneInsertedLineBreak(content, commentArgument.endIndex),
    removed: true,
  };
}

export function removeInsertedReviewMarkup(
  content: string,
  selectionText: string,
  preferredStartIndex?: number,
): RemoveInsertedReviewMarkupResult {
  if (!selectionText) {
    return { content, removed: false };
  }

  const preferredIndexes =
    typeof preferredStartIndex === "number" && preferredStartIndex >= 0
      ? [preferredStartIndex]
      : [];

  for (const index of preferredIndexes) {
    const wrapperResult = removeReviewerCommentWrapperAt(content, index, selectionText);
    if (wrapperResult) {
      return wrapperResult;
    }

    const blockResult = removeReviewerCommentBlockAfterSelectionAt(
      content,
      index,
      selectionText,
    );
    if (blockResult) {
      return blockResult;
    }
  }

  let wrapperCursor = 0;
  while (wrapperCursor < content.length) {
    const commandIndex = content.indexOf("\\reviewercomment", wrapperCursor);
    if (commandIndex === -1) {
      break;
    }

    const result = removeReviewerCommentWrapperAt(content, commandIndex, selectionText);
    if (result) {
      return result;
    }
    wrapperCursor = commandIndex + "\\reviewercomment".length;
  }

  let selectionCursor = 0;
  while (selectionCursor < content.length) {
    const selectionStart = content.indexOf(selectionText, selectionCursor);
    if (selectionStart === -1) {
      break;
    }

    const result = removeReviewerCommentBlockAfterSelectionAt(
      content,
      selectionStart,
      selectionText,
    );
    if (result) {
      return result;
    }
    selectionCursor = selectionStart + Math.max(1, selectionText.length);
  }

  return { content, removed: false };
}
