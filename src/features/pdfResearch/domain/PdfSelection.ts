import type { PdfAnchor, PdfRect } from "./PdfAnchor";

export interface PdfTextRange {
  pageNumber: number;
  start: number;
  end: number;
}

export interface PdfSelection {
  id: string;
  documentId: string;
  pageNumber: number;
  text: string;
  ranges: PdfTextRange[];
  boundingRects: PdfRect[];
  anchor: PdfAnchor;
  contextBefore?: string;
  contextAfter?: string;
  section?: DocumentSection;
  createdAt: number;
}

export interface PdfAreaSelection {
  id: string;
  documentId: string;
  pageNumber: number;
  normalizedRect: PdfRect;
  createdAt: number;
}

export interface DocumentSection {
  id: string;
  title: string;
  level: number;
  pageNumber?: number;
}
