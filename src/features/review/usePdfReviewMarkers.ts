import { useEffect, useState } from "react";
import type { PdfReviewMarker } from "../../PdfPreview";
import { locateReviewSelection } from "./reviewAnchor";
import type { ReviewChat } from "../../types";

/** Recompute positions from SyncTeX for each PDF build, never persist PDF coordinates. */
export function usePdfReviewMarkers(
  projectId: string | null,
  pdfPath: string,
  pdfData: Uint8Array | null,
  chats: ReviewChat[],
) {
  const [result, setResult] = useState<{
    data: Uint8Array | null;
    markers: PdfReviewMarker[];
  }>({ data: null, markers: [] });
  useEffect(() => {
    let cancelled = false;
    if (!projectId || !pdfPath || !pdfData || !window.latexdo.forwardSyncTex) {
      setResult({ data: pdfData, markers: [] });
      return;
    }
    void (async () => {
      const markers: PdfReviewMarker[] = [];
      const sources = new Map<string, string>();
      // Keep SyncTeX subprocesses bounded, even with a large review history.
      for (const chat of chats) {
        if (cancelled) return;
        if (chat.kind === "paper") continue;
        try {
          let content = sources.get(chat.filePath);
          if (content === undefined) {
            content = await window.latexdo.readFile(projectId, chat.filePath);
            sources.set(chat.filePath, content);
          }
          const selection = locateReviewSelection(content, chat.selection);
          if (!selection || cancelled) continue;
          const location = await window.latexdo.forwardSyncTex(
            projectId,
            pdfPath,
            chat.filePath,
            selection.startLine,
            selection.startColumn,
          );
          if (location && Number.isFinite(location.x) && Number.isFinite(location.y)) {
            markers.push({
              id: chat.id,
              pageNumber: location.page,
              x: location.x,
              y: Math.max(0, location.y - location.height / 2),
              title:
                chat.comments[0]?.text ||
                `Review: ${chat.selection.text.slice(0, 100)}`,
            });
          }
        } catch {
          // A thread can belong to an excluded file, or the build may lack SyncTeX.
        }
      }
      if (!cancelled) setResult({ data: pdfData, markers });
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, pdfPath, pdfData, chats]);
  return result.data === pdfData ? result.markers : [];
}
