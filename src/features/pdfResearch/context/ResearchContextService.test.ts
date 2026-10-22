import { describe, expect, it } from "vitest";
import {
  buildResearchPrompt,
  resolvePdfSelectionContext,
} from "./ResearchContextService";
import type { PdfSelection } from "../domain/PdfSelection";
import type { ResearchDocument } from "../domain/ResearchDocument";

describe("ResearchContextService", () => {
  const document: ResearchDocument = {
    id: "pdf:project:paper.pdf",
    name: "paper.pdf",
    source: { type: "project-file", fileId: "paper.pdf" },
    metadata: { title: "Smith 2025" },
    processing: { status: "indexed" },
    permissions: { canAnnotate: true, canExport: true },
  };

  const selection: PdfSelection = {
    id: "sel-1",
    documentId: document.id,
    pageNumber: 30,
    text: "posterior distribution converges weakly",
    ranges: [{ pageNumber: 30, start: 4, end: 43 }],
    boundingRects: [{ x: 0.1, y: 0.2, width: 0.5, height: 0.04 }],
    anchor: {
      pageNumber: 30,
      quote: { exact: "posterior distribution converges weakly" },
      textPosition: { start: 4, end: 43 },
      geometry: [{ x: 0.1, y: 0.2, width: 0.5, height: 0.04 }],
    },
    contextBefore: "Theorem 2 states the regularity assumptions.",
    contextAfter: "This justifies the estimator.",
    createdAt: 1,
  };

  it("turns a PDF selection into anchored research context", () => {
    const context = resolvePdfSelectionContext(document, selection);

    expect(context.primarySource.pageNumber).toBe(30);
    expect(context.primarySource.textQuote).toContain("posterior distribution");
    expect(context.relatedEvidence[0].anchor.documentId).toBe(document.id);
  });

  it("builds prompts that preserve the reader-mode boundary", () => {
    const prompt = buildResearchPrompt(
      resolvePdfSelectionContext(document, selection),
      "explain",
      "Why?",
    );

    expect(prompt).toContain("external PDF");
    expect(prompt).toContain("Do not rewrite or modify the paper");
    expect(prompt).toContain("SOURCE_1");
    expect(prompt).toContain("Page: 30");
  });

  it("falls back to the selection id, file name and quote when details are missing", () => {
    const bare: PdfSelection = {
      ...selection,
      anchor: { ...selection.anchor, quote: { exact: "" } },
      contextBefore: undefined,
      contextAfter: undefined,
      section: undefined,
    };
    const context = resolvePdfSelectionContext({ ...document, metadata: {} }, bare);
    expect(context.primarySource.anchorId).toBe("sel-1");
    expect(context.relatedEvidence[0].id).toBe("evidence:sel-1");
    expect(context.surroundingText).toBe(selection.text);

    const summary = buildResearchPrompt(
      { ...context, selectedText: undefined, surroundingText: "" },
      "summarize",
    );
    expect(summary).toContain("Summarize the selected passage");
    expect(summary).toContain("PDF: paper.pdf");
    expect(summary).toContain(`"""${selection.text}"""`);
    expect(summary).not.toContain("Section:");
    expect(summary).not.toContain("Nearby context");
    expect(summary).not.toContain("User question");

    const ask = buildResearchPrompt(context, "ask");
    expect(ask).toContain("Answer the user's question");
    expect(ask).toContain("Nearby context");
  });

  it("names the section and truncates long anchor quotes", () => {
    const section = { id: "s2", title: "Main results" } as PdfSelection["section"];
    const long = "x".repeat(50);
    const context = resolvePdfSelectionContext(document, {
      ...selection,
      section,
      anchor: { ...selection.anchor, quote: { exact: long } },
    });
    expect(context.primarySource.anchorId).toBe(`${document.id}:p30:${"x".repeat(32)}`);
    expect(context.primarySource.sectionId).toBe("s2");
    expect(buildResearchPrompt(context, "explain")).toContain("Section: Main results");
  });
});
