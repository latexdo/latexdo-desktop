export interface PdfRect {
  /** Normalized page-space x coordinate, 0..1. */
  x: number;
  /** Normalized page-space y coordinate, 0..1. */
  y: number;
  /** Normalized page-space width, 0..1. */
  width: number;
  /** Normalized page-space height, 0..1. */
  height: number;
}

export interface PdfAnchor {
  pageNumber: number;
  quote: {
    exact: string;
    prefix?: string;
    suffix?: string;
  };
  textPosition?: {
    start: number;
    end: number;
  };
  geometry: PdfRect[];
}

export interface PdfSourceAnchor {
  documentId: string;
  pageNumber: number;
  textQuote: string;
  anchorId: string;
  boundingRects: PdfRect[];
  sectionId?: string;
}
