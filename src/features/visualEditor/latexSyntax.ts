/**
 * Small, dependency-free readers for LaTeX source: matching braces and
 * reading a command with its arguments. They never throw; on unbalanced
 * input they report -1 so callers can keep the text as raw source.
 */

/** Index of the `}` that closes the `{` at `open`, or -1. */
export function matchBrace(text: string, open: number, close = "}"): number {
  const opener = text[open];
  if (opener !== "{" && opener !== "[") return -1;
  const closer = opener === "{" ? "}" : close === "}" ? "]" : close;
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "%" && opener === "{") {
      // A comment runs to the end of the line, braces included.
      const newline = text.indexOf("\n", index);
      if (newline === -1) return -1;
      index = newline;
      continue;
    }
    if (opener === "[") {
      if (char === "{") {
        const inner = matchBrace(text, index);
        if (inner === -1) return -1;
        index = inner;
        continue;
      }
      if (char === "[") depth += 1;
      else if (char === "]") {
        depth -= 1;
        if (depth === 0) return index;
      }
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === closer) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

export interface LatexCommand {
  name: string;
  star: boolean;
  /** Optional arguments, without brackets. */
  options: string[];
  /** Mandatory arguments, without braces. */
  args: string[];
  /** Index just after the command and its arguments. */
  end: number;
}

/**
 * Reads `\name*[opt]{arg}{arg}` at `start` (which must be a backslash).
 * `argCount` limits how many `{}` groups are read; by default every group
 * that follows immediately is taken.
 */
export function readCommand(
  text: string,
  start: number,
  argCount = Infinity,
): LatexCommand | null {
  if (text[start] !== "\\") return null;
  const nameMatch = /^[A-Za-z@]+/.exec(text.slice(start + 1));
  if (!nameMatch) return null;
  let index = start + 1 + nameMatch[0].length;
  let star = false;
  if (text[index] === "*") {
    star = true;
    index += 1;
  }
  const options: string[] = [];
  const args: string[] = [];
  while (index < text.length) {
    const char = text[index];
    if (char === "[" && args.length === 0) {
      const end = matchBrace(text, index);
      if (end === -1) break;
      options.push(text.slice(index + 1, end));
      index = end + 1;
      continue;
    }
    if (char === "{" && args.length < argCount) {
      const end = matchBrace(text, index);
      if (end === -1) return null;
      args.push(text.slice(index + 1, end));
      index = end + 1;
      continue;
    }
    break;
  }
  return { name: nameMatch[0], star, options, args, end: index };
}

/** Finds `\name{` (first occurrence at or after `from`) and its argument range. */
export function findCommandArgument(
  text: string,
  name: string,
  from = 0,
): { start: number; argStart: number; argEnd: number; end: number } | null {
  const pattern = new RegExp(`\\\\${name}\\*?\\s*(?:\\[[^\\]]*\\])?\\s*\\{`, "g");
  pattern.lastIndex = from;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    // Skip an escaped backslash (\\name is a line break followed by text).
    if (match.index > 0 && text[match.index - 1] === "\\") continue;
    const open = match.index + match[0].length - 1;
    const close = matchBrace(text, open);
    if (close === -1) return null;
    return { start: match.index, argStart: open + 1, argEnd: close, end: close + 1 };
  }
  return null;
}

/** Counts \begin{name} and \end{name} to find the line closing an environment. */
export function findEnvironmentEnd(
  lines: readonly string[],
  startIndex: number,
  name: string,
): number {
  const escaped = name.replace(/[*]/g, "\\*");
  const begin = new RegExp(`\\\\begin\\{${escaped}\\}`, "g");
  const end = new RegExp(`\\\\end\\{${escaped}\\}`, "g");
  let depth = 0;
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = stripComment(lines[index] ?? "");
    depth += (line.match(begin) ?? []).length;
    depth -= (line.match(end) ?? []).length;
    if (depth <= 0) return index;
  }
  return -1;
}

/** The line without its comment (an unescaped % and what follows). */
export function stripComment(line: string): string {
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === "\\") {
      index += 1;
      continue;
    }
    if (line[index] === "%") return line.slice(0, index);
  }
  return line;
}
