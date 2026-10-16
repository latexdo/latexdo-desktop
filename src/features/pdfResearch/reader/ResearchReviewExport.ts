import type { PdfAnnotation } from "../domain/PdfAnnotation";
import type { ResearchDocument } from "../domain/ResearchDocument";

function reviewFileStem(value: string): string {
  return (
    value
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "paper"
  );
}

export function pdfReviewFileName(document: ResearchDocument): string {
  return `${reviewFileStem(document.metadata.title || document.name)}-review.txt`;
}

export function buildPdfReviewText(
  document: ResearchDocument,
  annotations: PdfAnnotation[],
  generatedAt = new Date(),
): string {
  const title = document.metadata.title || document.name;
  const sortedAnnotations = [...annotations].sort(
    (left, right) =>
      left.pageNumber - right.pageNumber || left.createdAt - right.createdAt,
  );
  const notes = sortedAnnotations.filter((annotation) => annotation.type === "note");
  const highlights = sortedAnnotations.filter(
    (annotation) => annotation.type === "highlight",
  );
  const lines = [
    "LatexDo PDF Review",
    "",
    `Paper: ${title}`,
    `File: ${document.source.relativePath || document.name}`,
    `Generated: ${generatedAt.toISOString()}`,
    "AI used: No. This file contains only saved Reader Mode annotations.",
    "",
    `Notes: ${notes.length}`,
    `Highlights: ${highlights.length}`,
  ];

  if (sortedAnnotations.length === 0) {
    lines.push("", "No annotations were saved for this paper.");
    return lines.join("\n");
  }

  lines.push("", "Review Items");
  sortedAnnotations.forEach((annotation, index) => {
    const label = annotation.type === "note" ? "Note" : "Highlight";
    lines.push(
      "",
      `${index + 1}. ${label} - p.${annotation.pageNumber}`,
      "Source:",
      `"${annotation.anchor.quote.exact}"`,
    );
    if (annotation.comment?.trim()) {
      lines.push("", "Your note:", annotation.comment.trim());
    }
  });

  return lines.join("\n");
}

export function downloadTextFile(fileName: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  window.document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
}
