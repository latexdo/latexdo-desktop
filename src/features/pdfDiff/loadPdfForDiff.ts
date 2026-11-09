import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  joinHyphenatedWords,
  stripPageFurniture,
  wordsFromTextItems,
  type PdfDiffWord,
  type PdfTextItemLike,
} from "./pdfTextDiff";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface LoadedDiffPdf {
  document: PDFDocumentProxy;
  words: PdfDiffWord[];
  /** Page sizes at scale 1, in CSS pixels. */
  pageSizes: Array<{ width: number; height: number }>;
}

export async function loadPdfForDiff(
  data: Uint8Array,
  signal?: AbortSignal,
): Promise<LoadedDiffPdf> {
  // pdf.js transfers the buffer to its worker; keep the caller's copy intact.
  const task = getDocument({ data: data.slice() });
  signal?.addEventListener("abort", () => void task.destroy(), { once: true });
  const document = await task.promise;
  const words: PdfDiffWord[] = [];
  const pageSizes: LoadedDiffPdf["pageSizes"] = [];
  let line = 0;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    pageSizes.push({ width: viewport.width, height: viewport.height });
    const content = await page.getTextContent();
    const items = content.items.filter(
      (item): item is PdfTextItemLike & typeof item => "str" in item,
    );
    const result = wordsFromTextItems(items, viewport, pageNumber, line);
    line = result.nextLine;
    words.push(...result.words);
  }
  return {
    document,
    words: joinHyphenatedWords(stripPageFurniture(words)),
    pageSizes,
  };
}
