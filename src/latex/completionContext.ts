export type LatexCompletionContext =
  | {
      type: "citation";
      command: string;
      currentText: string;
      rangeStartColumn: number;
      rangeEndColumn: number;
    }
  | {
      type: "reference";
      command: string;
      currentText: string;
      rangeStartColumn: number;
      rangeEndColumn: number;
    }
  | null;

export interface LatexCommandCompletionRange {
  currentText: string;
  rangeStartColumn: number;
  rangeEndColumn: number;
}

const citationCommands = [
  "cite",
  "citep",
  "citet",
  "citealp",
  "parencite",
  "textcite",
  "autocite",
  "footcite",
];
const referenceCommands = ["ref", "eqref", "autoref", "cref", "Cref", "pageref"];

export function getLatexCommandCompletionRange(
  lineText: string,
  cursorColumn: number,
): LatexCommandCompletionRange | null {
  const beforeCursor = lineText.slice(0, cursorColumn - 1);
  const match = beforeCursor.match(/\\[A-Za-z]*$/);
  if (!match) return null;

  return {
    currentText: match[0].slice(1),
    rangeStartColumn: beforeCursor.length - match[0].length + 1,
    rangeEndColumn: cursorColumn,
  };
}

export function getLatexCompletionContext(
  lineText: string,
  cursorColumn: number,
): LatexCompletionContext {
  const beforeCursor = lineText.slice(0, cursorColumn - 1);
  const commandPattern = /\\([A-Za-z]+)\*?(?:\[[^\]]*\])*\{([^{}]*)$/;
  const match = beforeCursor.match(commandPattern);
  if (!match) return null;
  const command = match[1];
  const argumentText = match[2] ?? "";
  const argumentStartColumn = cursorColumn - argumentText.length;
  const rangeEndColumn = cursorColumn;
  if (citationCommands.includes(command)) {
    const delimiterIndex = argumentText.lastIndexOf(",");
    let tokenStartIndex = delimiterIndex + 1;
    while (argumentText[tokenStartIndex] === " ") {
      tokenStartIndex += 1;
    }

    return {
      type: "citation",
      command,
      currentText: argumentText.slice(tokenStartIndex),
      rangeStartColumn: argumentStartColumn + tokenStartIndex,
      rangeEndColumn,
    };
  }
  if (referenceCommands.includes(command)) {
    return {
      type: "reference",
      command,
      currentText: argumentText,
      rangeStartColumn: argumentStartColumn,
      rangeEndColumn,
    };
  }
  return null;
}
