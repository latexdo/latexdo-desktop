import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAnnotationFromSelection,
  deletePdfAnnotation,
  loadPdfAnnotations,
  pdfAnnotationStorageKey,
  savePdfAnnotation,
} from "./AnnotationStore";
import type { PdfSelection } from "../domain/PdfSelection";

const selection: PdfSelection = {
  id: "sel-1",
  documentId: "pdf:project:paper.pdf",
  pageNumber: 30,
  text: "the posterior distribution converges weakly",
  ranges: [{ pageNumber: 30, start: 10, end: 52 }],
  boundingRects: [{ x: 0.2, y: 0.3, width: 0.4, height: 0.03 }],
  anchor: {
    pageNumber: 30,
    quote: {
      exact: "the posterior distribution converges weakly",
      prefix: "therefore",
      suffix: "under the conditions",
    },
    textPosition: { start: 10, end: 52 },
    geometry: [{ x: 0.2, y: 0.3, width: 0.4, height: 0.03 }],
  },
  createdAt: 1,
};

describe("AnnotationStore", () => {
  beforeEach(() => {
    window.localStorage.removeItem(pdfAnnotationStorageKey);
    vi.spyOn(Date, "now").mockReturnValue(1234);
  });

  it("persists PDF annotations separately from the PDF binary", () => {
    const annotation = createAnnotationFromSelection(selection, {
      type: "highlight",
      color: "yellow",
    });

    savePdfAnnotation(annotation);

    expect(loadPdfAnnotations(selection.documentId)).toEqual([annotation]);
  });

  it("can delete a saved annotation", () => {
    const annotation = savePdfAnnotation(
      createAnnotationFromSelection(selection, { type: "note", comment: "Check this" }),
    );

    deletePdfAnnotation(selection.documentId, annotation.id);

    expect(loadPdfAnnotations(selection.documentId)).toEqual([]);
  });

  it("defaults the user and color by annotation type", () => {
    const note = createAnnotationFromSelection(selection, { type: "note" });
    expect(note).toMatchObject({ userId: "local-user", color: "blue", type: "note" });
    expect(createAnnotationFromSelection(selection, { type: "highlight" }).color).toBe(
      "yellow",
    );
  });

  it("orders annotations by page, then creation time", () => {
    const base = createAnnotationFromSelection(selection, { type: "note" });
    savePdfAnnotation({ ...base, id: "late", pageNumber: 2, createdAt: 5 });
    savePdfAnnotation({ ...base, id: "early", pageNumber: 2, createdAt: 1 });
    savePdfAnnotation({ ...base, id: "first-page", pageNumber: 1, createdAt: 9 });
    expect(loadPdfAnnotations(selection.documentId).map((item) => item.id)).toEqual([
      "first-page",
      "early",
      "late",
    ]);
  });

  it("deletes from a document with no annotations without failing", () => {
    deletePdfAnnotation("pdf:none", "missing");
    expect(loadPdfAnnotations("pdf:none")).toEqual([]);
  });

  it.each([
    ["corrupt JSON", "{not json"],
    ["a wrong version", JSON.stringify({ version: 2, annotations: {} })],
    ["missing annotations", JSON.stringify({ version: 1 })],
    ["null", "null"],
  ])("starts empty from %s", (_label, raw) => {
    window.localStorage.setItem(pdfAnnotationStorageKey, raw);
    expect(loadPdfAnnotations(selection.documentId)).toEqual([]);
  });
});

