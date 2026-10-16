export function wordColumn(
  lineContent: string,
  word: string | undefined,
  preferredColumn: number,
): { column: number; length: number } {
  if (!word) {
    return { column: Math.max(1, preferredColumn), length: 0 };
  }

  const matches: number[] = [];
  let index = lineContent.indexOf(word);
  while (index >= 0) {
    matches.push(index);
    index = lineContent.indexOf(word, index + word.length);
  }
  if (!matches.length) {
    return { column: Math.max(1, preferredColumn), length: 0 };
  }

  const preferredIndex = Math.max(0, preferredColumn - 1);
  const nearest = matches.reduce((best, candidate) =>
    Math.abs(candidate - preferredIndex) < Math.abs(best - preferredIndex)
      ? candidate
      : best,
  );
  return { column: nearest + 1, length: word.length };
}

export interface VisibleEditorRange {
  startLineNumber: number;
  endLineNumber: number;
}

export function visibleEditorLineForSync(
  ranges: readonly VisibleEditorRange[],
  cursorLine: number | null | undefined,
): number | null {
  const range = ranges.find(
    (candidate) =>
      cursorLine !== null &&
      cursorLine !== undefined &&
      cursorLine >= candidate.startLineNumber &&
      cursorLine <= candidate.endLineNumber,
  );
  if (range && cursorLine !== null && cursorLine !== undefined) {
    return Math.max(1, Math.floor(cursorLine));
  }

  const targetRange = range ?? ranges[0];
  if (!targetRange) {
    return null;
  }

  return Math.max(
    1,
    Math.round((targetRange.startLineNumber + targetRange.endLineNumber) / 2),
  );
}

export interface PdfClientRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface VisiblePdfPageRect extends PdfClientRectLike {
  page: number;
}

export interface VisiblePdfPoint {
  page: number;
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function visiblePdfPointForSync(
  container: PdfClientRectLike,
  pages: readonly VisiblePdfPageRect[],
  scale: number,
): VisiblePdfPoint | null {
  if (!pages.length || scale <= 0) {
    return null;
  }

  const containerCenterX = container.left + container.width / 2;
  const containerCenterY = container.top + container.height / 2;
  const containerBottom = container.top + container.height;
  const visiblePages = pages.filter((page) => {
    const pageBottom = page.top + page.height;
    return pageBottom >= container.top && page.top <= containerBottom;
  });
  const candidates = visiblePages.length ? visiblePages : pages;
  const page = candidates.reduce((best, candidate) => {
    const bestCenter = best.top + best.height / 2;
    const candidateCenter = candidate.top + candidate.height / 2;
    return Math.abs(candidateCenter - containerCenterY) <
      Math.abs(bestCenter - containerCenterY)
      ? candidate
      : best;
  });

  return {
    page: page.page,
    x: clamp(containerCenterX - page.left, 0, page.width) / scale,
    y: clamp(containerCenterY - page.top, 0, page.height) / scale,
  };
}
