import { normalizeRelativePath } from "../features/project/projectUtils";
import type { OpenDocument } from "../types";

export interface WrittenDocument {
  /** The editor content the write was prepared from. */
  from: string;
  /** What actually reached disk (may differ, e.g. normalized review markup). */
  written: string;
}

/**
 * Records finished writes. Saving is asynchronous, so the person may have kept
 * typing while it ran: those newer edits were not written and must stay dirty
 * and in place, or a close would discard them as already saved.
 */
export function markDocumentsSaved(
  documents: OpenDocument[],
  writes: ReadonlyMap<string, WrittenDocument>,
): OpenDocument[] {
  return documents.map((document) => {
    const write = writes.get(normalizeRelativePath(document.relativePath));
    if (!write) return document;
    if (document.content === write.from) {
      return { ...document, content: write.written, savedContent: write.written };
    }
    return { ...document, savedContent: write.written };
  });
}
