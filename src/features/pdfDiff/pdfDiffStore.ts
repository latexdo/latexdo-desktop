import { useSyncExternalStore } from "react";
import type { GitRevisionRef } from "../../types";

/** One side of a comparison: a PDF, or nothing when the version has none. */
export interface PdfDiffSource {
  label: string;
  /** Hash, author, date: shown under the label. */
  detail?: string;
  data: Uint8Array | null;
  /** Why `data` is null, shown in place of the pages. */
  emptyMessage?: string;
}

export interface PdfDiffSides {
  original: PdfDiffSource;
  modified: PdfDiffSource;
}

/** What the user can pick for each side in the compare dialog. */
export type PdfCompareChoice =
  | { kind: "current" }
  | {
      kind: "revision";
      ref: Extract<GitRevisionRef, { kind: "commit" | "index" }>;
      label: string;
    }
  | { kind: "file"; name: string; data: Uint8Array };

export type PdfDiffRequest =
  | {
      kind: "picker";
      original?: PdfCompareChoice;
      modified?: PdfCompareChoice;
    }
  | {
      kind: "compare";
      title: string;
      /** Shown while `load` runs, for example while old revisions compile. */
      loadingMessage?: string;
      load: (signal: AbortSignal) => Promise<PdfDiffSides>;
    };

type Listener = () => void;

let current: PdfDiffRequest | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Opens the PDF comparison view over the workspace. */
export function openPdfDiff(request: PdfDiffRequest): void {
  current = request;
  emit();
}

export function closePdfDiff(): void {
  if (!current) return;
  current = null;
  emit();
}

export function getPdfDiffRequest(): PdfDiffRequest | null {
  return current;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePdfDiffRequest(): PdfDiffRequest | null {
  return useSyncExternalStore(subscribe, getPdfDiffRequest, getPdfDiffRequest);
}
