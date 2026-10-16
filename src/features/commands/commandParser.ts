import type { CommandResult } from "./commandTypes";

export interface TokenizeSuccess {
  ok: true;
  tokens: string[];
}

export interface TokenizeFailure {
  ok: false;
  message: string;
}

export type TokenizeResult = TokenizeSuccess | TokenizeFailure;

export type ParsedLatexDoInput =
  | { kind: "external" }
  | { kind: "latexdo"; tokens: string[]; args: string[] }
  | { kind: "error"; result: CommandResult };

function isWhitespace(character: string): boolean {
  return /\s/.test(character);
}

export function tokenizeCommandLine(input: string): TokenizeResult {
  const tokens: string[] = [];
  let token = "";
  let tokenStarted = false;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  const finishToken = () => {
    if (!tokenStarted) return;
    tokens.push(token);
    token = "";
    tokenStarted = false;
  };

  for (const character of input.trimEnd()) {
    if (escaped) {
      token += character;
      tokenStarted = true;
      escaped = false;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      tokenStarted = true;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        token += character;
      }
      tokenStarted = true;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      tokenStarted = true;
      continue;
    }

    if (isWhitespace(character)) {
      finishToken();
      continue;
    }

    token += character;
    tokenStarted = true;
  }

  if (escaped) {
    token += "\\";
  }

  if (quote) {
    return {
      ok: false,
      message: `Unterminated ${quote === '"' ? "double" : "single"} quote.`,
    };
  }

  finishToken();
  return { ok: true, tokens };
}

export function parseLatexDoInput(input: string): ParsedLatexDoInput {
  const tokenized = tokenizeCommandLine(input);
  if (!tokenized.ok) {
    return {
      kind: "error",
      result: { ok: false, message: tokenized.message },
    };
  }

  const [program, ...args] = tokenized.tokens;
  if (!program || program.toLowerCase() !== "latexdo") {
    return { kind: "external" };
  }

  return { kind: "latexdo", tokens: tokenized.tokens, args };
}

export function isLatexDoCommandLine(input: string): boolean {
  const trimmed = input.trimStart().toLowerCase();
  return trimmed === "latexdo" || trimmed.startsWith("latexdo ");
}

export function isPotentialLatexDoCommandPrefix(input: string): boolean {
  const trimmed = input.trimStart().toLowerCase();
  return (
    trimmed === "" || "latexdo".startsWith(trimmed) || trimmed.startsWith("latexdo ")
  );
}
