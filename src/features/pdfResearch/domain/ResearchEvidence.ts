import type { PdfSourceAnchor } from "./PdfAnchor";
import type { DocumentSection } from "./PdfSelection";
import type { ResearchDocument } from "./ResearchDocument";

export interface ResearchEvidence {
  id: string;
  documentId: string;
  pageNumber: number;
  label: string;
  text: string;
  anchor: PdfSourceAnchor;
  section?: DocumentSection;
}

export interface ResearchContext {
  document: ResearchDocument["metadata"] & {
    id: string;
    name: string;
  };
  primarySource: PdfSourceAnchor;
  selectedText?: string;
  surroundingText?: string;
  section?: DocumentSection;
  relatedEvidence: ResearchEvidence[];
}

export interface ResearchAnswer {
  markdown: string;
  citations: {
    marker: string;
    evidenceId: string;
  }[];
}
