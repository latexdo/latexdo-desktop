import type { PdfAnchor } from "./PdfAnchor";

export type PdfAnnotationType =
  | "highlight"
  | "underline"
  | "strikeout"
  | "note"
  | "area"
  | "ink";

export type AnnotationColor = "yellow" | "green" | "blue" | "pink" | "orange";

export interface PdfAnnotation {
  id: string;
  documentId: string;
  userId: string;
  type: PdfAnnotationType;
  pageNumber: number;
  anchor: PdfAnchor;
  color?: AnnotationColor;
  comment?: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}
