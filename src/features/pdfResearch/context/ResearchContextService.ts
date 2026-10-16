import type { PdfSourceAnchor } from "../domain/PdfAnchor";
import type { PdfSelection } from "../domain/PdfSelection";
import type { ResearchContext, ResearchEvidence } from "../domain/ResearchEvidence";
import type { ResearchDocument } from "../domain/ResearchDocument";

export function resolvePdfSelectionContext(
  document: ResearchDocument,
  selection: PdfSelection,
): ResearchContext {
  const anchor: PdfSourceAnchor = {
    documentId: document.id,
    pageNumber: selection.pageNumber,
    textQuote: selection.text,
    anchorId: selection.anchor.quote.exact
      ? `${document.id}:p${selection.pageNumber}:${selection.anchor.quote.exact.slice(
          0,
          32,
        )}`
      : selection.id,
    boundingRects: selection.boundingRects,
    sectionId: selection.section?.id,
  };
  const evidence: ResearchEvidence = {
    id: `evidence:${anchor.anchorId}`,
    documentId: document.id,
    pageNumber: selection.pageNumber,
    label: `p.${selection.pageNumber}`,
    text: selection.text,
    anchor,
    section: selection.section,
  };
  return {
    document: {
      id: document.id,
      name: document.name,
      ...document.metadata,
    },
    primarySource: anchor,
    selectedText: selection.text,
    surroundingText: [selection.contextBefore, selection.text, selection.contextAfter]
      .filter(Boolean)
      .join("\n"),
    section: selection.section,
    relatedEvidence: [evidence],
  };
}

export function buildResearchPrompt(
  context: ResearchContext,
  task: "ask" | "explain" | "summarize",
  userQuestion?: string,
): string {
  const taskInstruction =
    task === "explain"
      ? "Explain the selected passage clearly for a researcher. Separate intuition, technical meaning, and why it matters in this paper."
      : task === "summarize"
        ? "Summarize the selected passage and preserve what the paper actually says."
        : "Answer the user's question about the selected passage.";
  return [
    "You are LatexDo Research Assistant in Reader Mode.",
    "The user is reading an external PDF. Do not rewrite or modify the paper.",
    taskInstruction,
    "",
    `PDF: ${context.document.title || context.document.name}`,
    `Page: ${context.primarySource.pageNumber}`,
    context.section ? `Section: ${context.section.title}` : "",
    "",
    "Selected source passage:",
    `"""${context.selectedText ?? context.primarySource.textQuote}"""`,
    context.surroundingText
      ? `\nNearby context:\n"""${context.surroundingText}"""`
      : "",
    "",
    "Use the selected passage as SOURCE_1. Refer to evidence as SOURCE_1 instead of inventing page numbers.",
    userQuestion ? `User question: ${userQuestion}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
