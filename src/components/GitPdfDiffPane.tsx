import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { GitDiffSession } from "../types";
import type { PdfDiffSides } from "../features/pdfDiff/pdfDiffStore";
import { trackedPdfSides } from "../features/pdfDiff/revisionSources";
import { gitDiffTabLabel } from "./GitDiffWorkbench";
import { PdfDiffView } from "./PdfDiffView";

export interface GitPdfDiffPaneProps {
  projectId: string;
  session: GitDiffSession;
  onClose?: () => void;
}

/**
 * The Git diff of a PDF tracked in the repository: instead of "Binary files
 * differ", both versions side by side with their changes highlighted.
 */
export function GitPdfDiffPane({ projectId, session, onClose }: GitPdfDiffPaneProps) {
  const [sides, setSides] = useState<PdfDiffSides | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSides(null);
    setError(null);
    trackedPdfSides(window.latexdo, projectId, session)
      .then((result) => {
        if (!cancelled) setSides(result);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not read the PDF versions.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, session]);

  if (sides) {
    return (
      <PdfDiffView
        title={gitDiffTabLabel(session)}
        original={sides.original}
        modified={sides.modified}
        onClose={onClose}
      />
    );
  }
  return (
    <div className="pdf-diff-view">
      <div
        className={`pdf-diff-state ${error ? "is-error" : ""}`}
        role={error ? "alert" : "status"}
      >
        {error ? (
          error
        ) : (
          <>
            <LoaderCircle size={18} className="spin" aria-hidden="true" />
            <span>Reading both versions of the PDF…</span>
          </>
        )}
      </div>
    </div>
  );
}
