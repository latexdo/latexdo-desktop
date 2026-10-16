import {
  CONTEXT_AFTER_CHARS,
  CONTEXT_BEFORE_CHARS,
  MAX_CONTEXT_CHARS,
  MAX_LEARNED_NEW_TEXT,
  MAX_LEARNED_OLD_TEXT,
  createNextEditId,
  type EditOrigin,
  type NormalizedEdit,
  type SupportedNextEditLanguage,
} from "./nextEditTypes";

export interface ModelContentChangeLike {
  readonly rangeOffset: number;
  readonly rangeLength: number;
  readonly text: string;
}

export interface ModelContentChangedEventLike {
  readonly changes: readonly ModelContentChangeLike[];
  readonly isUndoing?: boolean;
  readonly isRedoing?: boolean;
  readonly isFlush?: boolean;
  readonly isEolChange?: boolean;
}

export interface NormalizeEditOptions {
  documentKey: string;
  revisionBefore: number;
  revisionAfter: number;
  beforeText: string;
  afterText: string;
  event: ModelContentChangedEventLike;
  origin: EditOrigin;
  cursorOffsetAfter?: number;
  timestamp?: number;
  isComposing?: boolean;
}

export interface LearnableEditOptions {
  language?: SupportedNextEditLanguage | string;
  isComposing?: boolean;
}

const supportedLanguages = new Set<string>(["latex", "bibtex", "text", "plaintext"]);

export function originForContentChange(
  event: ModelContentChangedEventLike,
  explicitOrigin: EditOrigin | null,
): EditOrigin {
  if (explicitOrigin) return explicitOrigin;
  if (event.isUndoing) return "undo";
  if (event.isRedoing) return "redo";
  return "user";
}

export function normalizeContentChangeEvent({
  documentKey,
  revisionBefore,
  revisionAfter,
  beforeText,
  afterText,
  event,
  origin,
  cursorOffsetAfter,
  timestamp = Date.now(),
  isComposing = false,
}: NormalizeEditOptions): NormalizedEdit[] {
  if (
    isComposing ||
    event.isFlush ||
    event.isEolChange ||
    event.changes.length === 0 ||
    beforeText === afterText
  ) {
    return [];
  }

  return [...event.changes]
    .filter((change) => isUsableChange(change, beforeText))
    .sort((a, b) => a.rangeOffset - b.rangeOffset)
    .map((change) => {
      const startOffsetBefore = change.rangeOffset;
      const endOffsetBefore = change.rangeOffset + change.rangeLength;
      const oldText = beforeText.slice(startOffsetBefore, endOffsetBefore);
      return {
        id: createNextEditId("edit"),
        documentKey,
        revisionBefore,
        revisionAfter,
        origin,
        startOffsetBefore,
        endOffsetBefore,
        oldText,
        newText: change.text,
        beforeContext: boundedBeforeContext(beforeText, startOffsetBefore),
        afterContext: boundedAfterContext(beforeText, endOffsetBefore),
        cursorOffsetAfter: cursorOffsetAfter ?? startOffsetBefore + change.text.length,
        timestamp,
      };
    })
    .filter((edit) => edit.oldText !== edit.newText);
}

export function isLearnableEdit(
  edit: NormalizedEdit,
  options: LearnableEditOptions = {},
): boolean {
  if (edit.origin !== "user") return false;
  if (options.isComposing) return false;
  if (options.language && !supportedLanguages.has(options.language)) return false;
  if (edit.oldText === edit.newText) return false;
  if (edit.oldText.length > MAX_LEARNED_OLD_TEXT) return false;
  if (edit.newText.length > MAX_LEARNED_NEW_TEXT) return false;
  if (edit.beforeContext.length + edit.afterContext.length > MAX_CONTEXT_CHARS) {
    return false;
  }
  if (isLikelyWholeDocumentEdit(edit)) return false;
  return true;
}

function isUsableChange(change: ModelContentChangeLike, beforeText: string): boolean {
  if (!Number.isInteger(change.rangeOffset) || !Number.isInteger(change.rangeLength)) {
    return false;
  }
  if (change.rangeOffset < 0 || change.rangeLength < 0) return false;
  if (change.rangeOffset + change.rangeLength > beforeText.length) return false;
  return true;
}

function boundedBeforeContext(text: string, offset: number): string {
  return text.slice(Math.max(0, offset - CONTEXT_BEFORE_CHARS), offset);
}

function boundedAfterContext(text: string, offset: number): string {
  return text.slice(offset, Math.min(text.length, offset + CONTEXT_AFTER_CHARS));
}

function isLikelyWholeDocumentEdit(edit: NormalizedEdit): boolean {
  return (
    edit.startOffsetBefore === 0 &&
    edit.beforeContext.length === 0 &&
    edit.oldText.length > 0 &&
    edit.afterContext.length === 0 &&
    (edit.oldText.length > 256 || edit.newText.length > 256)
  );
}
