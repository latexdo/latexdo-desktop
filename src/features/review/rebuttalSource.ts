import { escapeLatexText } from "../../reviewMarkup";
import type { RebuttalItem } from "../../types";

function revisedTextOf(item: RebuttalItem): string {
  return item.revisedText ?? item.modificationMade ?? "";
}

/** The `\rebuttal{...}` block an item is written as in the TeX source. */
export function rebuttalMacro(item: RebuttalItem): string {
  return `\\rebuttal{${item.originalText ?? ""}}{${escapeLatexText(
    item.reviewerComment,
  )}}{${escapeLatexText(item.authorComment)}}{${revisedTextOf(item)}}`;
}

// Blocks inserted before comments were escaped were written verbatim.
function legacyRebuttalMacro(item: RebuttalItem): string {
  return `\\rebuttal{${item.originalText ?? ""}}{${item.reviewerComment}}{${
    item.authorComment
  }}{${revisedTextOf(item)}}`;
}

function replaceBlock(
  content: string,
  item: RebuttalItem,
  replacement: string,
): string | null {
  for (const block of [rebuttalMacro(item), legacyRebuttalMacro(item)]) {
    const start = content.indexOf(block);
    if (start !== -1) {
      return (
        content.slice(0, start) + replacement + content.slice(start + block.length)
      );
    }
  }
  return null;
}

/** Rewrites an item's block after a sidebar edit. Null when the block is gone. */
export function updateRebuttalMacro(
  content: string,
  previous: RebuttalItem,
  next: RebuttalItem,
): string | null {
  return replaceBlock(content, previous, rebuttalMacro(next));
}

/** Drops an item's block and keeps the revised text. Null when the block is gone. */
export function removeRebuttalMacro(
  content: string,
  item: RebuttalItem,
): string | null {
  return replaceBlock(content, item, revisedTextOf(item));
}

let idCounter = 0;

/** Ids for review threads, comments and rebuttal items; unique within one tick. */
export function createReviewId(): string {
  idCounter += 1;
  return `${Date.now().toString(36)}-${idCounter.toString(36)}`;
}
