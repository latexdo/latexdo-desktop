export interface PdfProcessingState {
  status: "idle" | "rendering" | "extracting" | "indexed" | "needs-ocr" | "failed";
  progress?: number;
  message?: string;
}

export interface ResearchDocument {
  id: string;
  projectId?: string;
  name: string;
  source: {
    type: "uploaded" | "project-file" | "remote";
    fileId: string;
    relativePath?: string;
  };
  metadata: {
    title?: string;
    authors?: string[];
    year?: number;
    doi?: string;
  };
  processing: PdfProcessingState;
  permissions: {
    canAnnotate: boolean;
    canExport: boolean;
  };
}

export function researchDocumentId(
  projectId: string | undefined,
  fileId: string,
): string {
  return `pdf:${projectId ?? "local"}:${fileId}`;
}
