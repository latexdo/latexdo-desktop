// Cursor-preserving text insertion.
//
// Pure helpers (no DOM) so the tricky text math is unit-tested for empty
// fields, beginning/middle/end cursors, selected ranges, multiline text,
// Unicode, and LaTeX. The insertion context is captured when recording STARTS
// and applied only when the surrounding content is unchanged; otherwise the
// transcript is inserted at the user's current cursor instead of blindly
// replacing unrelated text.

export interface TextInsertionContext {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface InsertionResult {
  value: string;
  /** Final cursor position after the inserted transcript. */
  cursor: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Letters/numbers (Unicode-aware) — a word char that could "glue" to the script. */
function isWordChar(char: string): boolean {
  return /[\p{L}\p{N}]/u.test(char);
}

function isWhitespace(char: string): boolean {
  return /\s/.test(char);
}

/**
 * Decide whether the transcript needs a glue space against the surrounding
 * text. Never removes whitespace the transcript already carries; only adds a
 * space when a word boundary would otherwise be lost (dictation text rarely
 * ships with trailing spaces).
 */
function smartSpacing(
  before: string,
  transcript: string,
  after: string,
): { leading: boolean; trailing: boolean } {
  const tStart = transcript[0] ?? "";
  const tEnd = transcript[transcript.length - 1] ?? "";
  const leading =
    before.length > 0 &&
    isWordChar(before[before.length - 1]) &&
    isWordChar(tStart) &&
    !isWhitespace(tStart);
  const trailing =
    after.length > 0 && isWordChar(after[0]) && isWordChar(tEnd) && !isWhitespace(tEnd);
  return { leading, trailing };
}

/**
 * Insert `transcript` at the captured context, replacing any selected range.
 * Before: `Hello |world` + "beautiful" → `Hello beautiful world`, cursor at 15.
 * Before: `Hello [old] world` + "new" → `Hello new world`, cursor at 10.
 */
export function insertAtContext(
  context: TextInsertionContext,
  transcript: string,
): InsertionResult {
  return spliceAt(
    context.value,
    context.selectionStart,
    context.selectionEnd,
    transcript,
  );
}

/** True when the captured context still matches the current content. */
export function contextUnchanged(
  context: TextInsertionContext,
  currentValue: string,
): boolean {
  return context.value === currentValue;
}

/** Insert at the user's current cursor (fallback when content changed). */
export function insertAtCurrentCursor(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  transcript: string,
): InsertionResult {
  return spliceAt(value, selectionStart, selectionEnd, transcript);
}

function spliceAt(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  transcript: string,
): InsertionResult {
  const length = value.length;
  const start = clamp(selectionStart, 0, length);
  const end = clamp(selectionEnd, start, length);
  const before = value.slice(0, start);
  const after = value.slice(end);
  const { leading, trailing } = smartSpacing(before, transcript, after);
  const text = `${before}${leading ? " " : ""}${transcript}${trailing ? " " : ""}${after}`;
  return { value: text, cursor: start + (leading ? 1 : 0) + transcript.length };
}
