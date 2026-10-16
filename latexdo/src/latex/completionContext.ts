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

export function getLatexCompletionContext(
  lineText: string,
  cursorColumn: number,
): LatexCompletionContext {
  const beforeCursor = lineText.slice(0, cursorColumn - 1);
  const commandPattern = /\\([A-Za-z]+)\{([^{}]*)$/;
  const match = beforeCursor.match(commandPattern);
  if (!match) return null;
  const command = match[1];
  const currentText = match[2] ?? "";
  const commandStartIndex = beforeCursor.lastIndexOf(`\\${command}{`);
  const rangeStartColumn = commandStartIndex + command.length + 3;
  const rangeEndColumn = cursorColumn;
  if (citationCommands.includes(command)) {
    return {
      type: "citation",
      command,
      currentText,
      rangeStartColumn,
      rangeEndColumn,
    };
  }
  if (referenceCommands.includes(command)) {
    return {
      type: "reference",
      command,
      currentText,
      rangeStartColumn,
      rangeEndColumn,
    };
  }
  return null;
}
