// Chat-input helpers for the AI sidebar: `@` file mentions and `\` quick
// commands. Pure functions so the popup UI (AiSidebar) and the send pipeline
// (useAiAgent) share one implementation and everything is unit-testable.

export interface MentionTrigger {
  kind: "file" | "command";
  /** Text typed after the trigger character, up to the caret. */
  query: string;
  /** Index of the trigger character (`@` or `\`) in the input. */
  start: number;
  /** Caret index (exclusive end of the query). */
  end: number;
}

export interface SlashCommand {
  /** Command name, typed as \name. */
  name: string;
  /** One-line description shown in the popup. */
  hint: string;
  /** Instruction sent to the model in place of the raw command token. */
  prompt: string;
}

export const slashCommands: SlashCommand[] = [
  {
    name: "fix",
    hint: "Compile and fix every error",
    prompt:
      "Compile the project and fix every compile error you find, then re-compile to verify the build is clean.",
  },
  {
    name: "summarize",
    hint: "Summarize the open document",
    prompt: "Read the active document and summarize what it says, section by section.",
  },
  {
    name: "outline",
    hint: "Outline the whole project",
    prompt:
      "List the project files, read the main .tex files, and give an outline of the whole project's structure and content.",
  },
  {
    name: "rewrite",
    hint: "Rewrite the selection",
    prompt:
      "Rewrite the currently selected text to be clearer and more concise, preserving meaning, LaTeX validity, and the document's style.",
  },
  {
    name: "proofread",
    hint: "Proofread the open document",
    prompt:
      "Proofread the active document for grammar, clarity, and LaTeX issues, and apply the fixes.",
  },
  {
    name: "cite",
    hint: "Suggest citations for the selection",
    prompt:
      "Recommend citations from the project bibliography for the currently selected passage and insert the best \\cite keys.",
  },
  {
    name: "check",
    hint: "Run the built-in checkers",
    prompt:
      "Run the built-in checkers (structure, citations, acronyms, notation) and report the findings with suggested fixes.",
  },
];

const filePattern = /^[\w./-]*$/;
const commandPattern = /^[a-zA-Z-]*$/;

/**
 * Find an open `@file` or `\command` token ending at the caret, if any.
 * The trigger must start a word so LaTeX typed mid-sentence (`a\cite{x}`)
 * or emails (`a@b`) don't pop the picker.
 */
export function detectTrigger(text: string, caret: number): MentionTrigger | null {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const start = Math.max(before.lastIndexOf("@"), before.lastIndexOf("\\"));
  if (start === -1) return null;
  if (start > 0 && !/[\s([{]/.test(text[start - 1])) return null;
  const kind = text[start] === "@" ? "file" : "command";
  const query = before.slice(start + 1);
  if (!(kind === "file" ? filePattern : commandPattern).test(query)) return null;
  return { kind, query, start, end: before.length };
}

function baseName(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

/** Rank project files against the query typed after `@`. */
export function filterFileSuggestions(
  files: string[],
  query: string,
  limit = 8,
): string[] {
  const q = query.toLowerCase();
  const scored: { path: string; score: number }[] = [];
  for (const path of files) {
    const lower = path.toLowerCase();
    const base = baseName(lower);
    let score: number;
    if (!q) score = 1;
    else if (base.startsWith(q)) score = 3;
    else if (base.includes(q)) score = 2;
    else if (lower.includes(q)) score = 1;
    else continue;
    scored.push({ path, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((s) => s.path);
}

/** Commands whose name starts with the query typed after `\`. */
export function filterCommandSuggestions(query: string): SlashCommand[] {
  const q = query.toLowerCase();
  return slashCommands.filter((c) => c.name.startsWith(q));
}

/**
 * Resolve every `@token` in the message against the known project files.
 * A token matches on exact path, path suffix (`@intro.tex` →
 * `sections/intro.tex`), or unique basename prefix.
 */
export function extractFileMentions(text: string, files: string[]): string[] {
  const resolved: string[] = [];
  for (const match of text.matchAll(/(?:^|[\s([{])@([\w./-]+)/g)) {
    const token = match[1].replace(/[.,;:]+$/, "");
    if (!token) continue;
    const lower = token.toLowerCase();
    const hit =
      files.find((f) => f.toLowerCase() === lower) ??
      files.find((f) => f.toLowerCase().endsWith(`/${lower}`)) ??
      files.find((f) => baseName(f.toLowerCase()).startsWith(lower));
    if (hit && !resolved.includes(hit)) resolved.push(hit);
  }
  return resolved;
}

/**
 * If the message starts with a known `\command`, replace the token with the
 * command's full instruction; the rest of the message rides along as extra
 * guidance. Unknown commands and LaTeX like `\cite{key}` pass through as-is.
 */
export function expandSlashCommand(text: string): string {
  const trimmed = text.trim();
  const match = /^\\([a-zA-Z-]+)(?=\s|$)/.exec(trimmed);
  if (!match) return text;
  const command = slashCommands.find((c) => c.name === match[1].toLowerCase());
  if (!command) return text;
  const rest = trimmed.slice(match[0].length).trim();
  return rest
    ? `${command.prompt}\n\nAdditional instructions: ${rest}`
    : command.prompt;
}

const maxAttachedFiles = 6;
const maxAttachedChars = 20000;

/**
 * Read each `@`-mentioned file and append its contents to the model-facing
 * message so even providers that never call tools see the referenced context.
 */
export async function attachMentionedFiles(
  text: string,
  mentions: string[],
  readFile: (path: string) => Promise<string>,
): Promise<string> {
  if (mentions.length === 0) return text;
  const blocks: string[] = [];
  for (const path of mentions.slice(0, maxAttachedFiles)) {
    try {
      const content = await readFile(path);
      const clipped =
        content.length > maxAttachedChars
          ? `${content.slice(0, maxAttachedChars)}\n… (truncated; read_file for the rest)`
          : content;
      blocks.push(`[Attached file: ${path}]\n${clipped}`);
    } catch (error) {
      blocks.push(
        `[Attached file: ${path}] (could not read: ${
          error instanceof Error ? error.message : String(error)
        })`,
      );
    }
  }
  return `${text}\n\n${blocks.join("\n\n")}`;
}
