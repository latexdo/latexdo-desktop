import { lineColumnAtOffset } from "../project/projectUtils";

export const MAX_PROOFREAD_CHARS = 20_000;

export function findProofreadingChunkRange(
  content: string,
  targetOffset: number,
  maxChars = MAX_PROOFREAD_CHARS,
): { start: number; end: number; truncated: boolean } {
  if (content.length <= maxChars) {
    return { start: 0, end: content.length, truncated: false };
  }

  const safeTarget = Math.max(0, Math.min(content.length, targetOffset));
  let start = Math.max(0, safeTarget - Math.floor(maxChars / 2));
  let end = Math.min(content.length, start + maxChars);
  start = Math.max(0, end - maxChars);

  const earliestStart = Math.max(0, end - maxChars);
  const paragraphStart = content.lastIndexOf("\n\n", safeTarget);
  if (paragraphStart >= earliestStart) {
    start = paragraphStart + 2;
  }

  const latestEnd = Math.min(content.length, start + maxChars);
  const paragraphEnd = content.indexOf("\n\n", safeTarget);
  if (paragraphEnd !== -1 && paragraphEnd > start && paragraphEnd <= latestEnd) {
    end = paragraphEnd;
  } else {
    const newlineEnd = content.lastIndexOf("\n", latestEnd);
    if (newlineEnd > safeTarget && newlineEnd > start) {
      end = newlineEnd + 1;
    } else {
      end = latestEnd;
    }
  }

  while (start < end && /\s/.test(content[start]!)) start += 1;
  while (end > start && /\s/.test(content[end - 1]!)) end -= 1;

  if (start >= end) {
    start = Math.max(0, Math.min(safeTarget, content.length - maxChars));
    end = Math.min(content.length, start + maxChars);
  }

  return { start, end, truncated: true };
}

export function buildProofreadingRequest(
  content: string,
  targetOffset: number,
): {
  content: string;
  options?: {
    baseLine: number;
    baseColumn: number;
    originalTextLength: number;
    truncated: boolean;
  };
} {
  const range = findProofreadingChunkRange(content, targetOffset);
  if (!range.truncated) {
    return { content };
  }

  const base = lineColumnAtOffset(content, range.start);
  return {
    content: content.slice(range.start, range.end),
    options: {
      baseLine: base.line,
      baseColumn: base.column,
      originalTextLength: content.length,
      truncated: true,
    },
  };
}

export function uniqueWords(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function supportsProofreading(name: string): boolean {
  const extension = name.split(".").pop()?.toLowerCase();
  return extension === "tex" || extension === "md" || extension === "txt";
}
