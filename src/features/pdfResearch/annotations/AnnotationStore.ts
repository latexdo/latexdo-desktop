import type { PdfAnnotation } from "../domain/PdfAnnotation";
import type { PdfSelection } from "../domain/PdfSelection";

export const pdfAnnotationStorageKey = "latexdo.pdfResearch.annotations.v1";

interface PdfAnnotationStoreShape {
  version: 1;
  annotations: Record<string, PdfAnnotation[]>;
}

function emptyStore(): PdfAnnotationStoreShape {
  return {
    version: 1,
    annotations: {},
  };
}

function loadStore(): PdfAnnotationStoreShape {
  try {
    const raw = JSON.parse(
      window.localStorage.getItem(pdfAnnotationStorageKey) ?? "null",
    ) as Partial<PdfAnnotationStoreShape> | null;
    if (!raw || raw.version !== 1 || typeof raw.annotations !== "object") {
      return emptyStore();
    }
    return {
      version: 1,
      annotations: raw.annotations ?? {},
    };
  } catch {
    return emptyStore();
  }
}

function saveStore(store: PdfAnnotationStoreShape): void {
  window.localStorage.setItem(pdfAnnotationStorageKey, JSON.stringify(store));
}

export function loadPdfAnnotations(documentId: string): PdfAnnotation[] {
  return [...(loadStore().annotations[documentId] ?? [])].sort(
    (left, right) =>
      left.pageNumber - right.pageNumber || left.createdAt - right.createdAt,
  );
}

export function savePdfAnnotation(annotation: PdfAnnotation): PdfAnnotation {
  const store = loadStore();
  const existing = store.annotations[annotation.documentId] ?? [];
  store.annotations[annotation.documentId] = [
    ...existing.filter((item) => item.id !== annotation.id),
    annotation,
  ];
  saveStore(store);
  return annotation;
}

export function deletePdfAnnotation(documentId: string, annotationId: string): void {
  const store = loadStore();
  store.annotations[documentId] = (store.annotations[documentId] ?? []).filter(
    (annotation) => annotation.id !== annotationId,
  );
  saveStore(store);
}

export function createAnnotationFromSelection(
  selection: PdfSelection,
  options: {
    type: "highlight" | "note";
    userId?: string;
    comment?: string;
    color?: PdfAnnotation["color"];
    tags?: string[];
  },
): PdfAnnotation {
  const now = Date.now();
  return {
    id: `ann_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    documentId: selection.documentId,
    userId: options.userId ?? "local-user",
    type: options.type,
    pageNumber: selection.pageNumber,
    anchor: selection.anchor,
    color: options.color ?? (options.type === "note" ? "blue" : "yellow"),
    comment: options.comment,
    tags: options.tags,
    createdAt: now,
    updatedAt: now,
  };
}
