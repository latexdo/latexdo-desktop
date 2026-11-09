import type { GitDiffSession, GitRevisionRef } from "../../types";

type CompileEngine = Parameters<Window["latexdo"]["compile"]>[0]["engine"];
import type { PdfCompareChoice, PdfDiffSides, PdfDiffSource } from "./pdfDiffStore";

export interface PdfRevisionContext {
  projectId: string;
  rootFile: string;
  engine: CompileEngine;
  /** The PDF from the last successful compile of the working tree. */
  currentPdf: Uint8Array | null;
}

type RevisionApi = Pick<
  Window["latexdo"],
  "compileGitRevisionPdf" | "readGitRevisionPdf"
>;

export class RevisionCompileError extends Error {
  constructor(
    message: string,
    readonly output: string,
  ) {
    super(message);
    this.name = "RevisionCompileError";
  }
}

function detailFor(parts: Array<string | undefined>): string | undefined {
  const text = parts.filter(Boolean).join(" · ");
  return text || undefined;
}

export function isPdfPath(relativePath: string): boolean {
  return /\.pdf$/i.test(relativePath);
}

/** Compiles (or reuses) the PDF of the project at a Git revision. */
export async function compiledPdfForRevision(
  api: RevisionApi,
  context: PdfRevisionContext,
  ref: GitRevisionRef,
  label: string,
  detail?: string,
): Promise<PdfDiffSource> {
  if (ref.kind === "empty") {
    return { label, detail, data: null, emptyMessage: "This version has no PDF." };
  }
  if (ref.kind === "working-tree") {
    if (!context.currentPdf) {
      throw new Error("Compile the project first to compare the working tree's PDF.");
    }
    return { label, detail, data: context.currentPdf };
  }
  const result = await api.compileGitRevisionPdf(
    {
      projectId: context.projectId,
      rootFile: context.rootFile,
      engine: context.engine,
    },
    ref,
  );
  if (!result.ok || !result.pdf) {
    throw new RevisionCompileError(
      `${label}: ${result.error ?? "the revision did not compile."}`,
      result.output,
    );
  }
  return { label, detail, data: new Uint8Array(result.pdf) };
}

async function resolveChoice(
  api: RevisionApi,
  context: PdfRevisionContext,
  choice: PdfCompareChoice,
): Promise<PdfDiffSource> {
  switch (choice.kind) {
    case "current":
      return compiledPdfForRevision(
        api,
        context,
        { kind: "working-tree" },
        "Current PDF",
      );
    case "file":
      return { label: choice.name, detail: "PDF file", data: choice.data };
    case "revision":
      return compiledPdfForRevision(
        api,
        context,
        choice.ref,
        choice.label,
        choice.ref.kind === "commit"
          ? "Compiled from Git"
          : "Compiled from staged files",
      );
  }
}

export function choiceLabel(choice: PdfCompareChoice): string {
  switch (choice.kind) {
    case "current":
      return "Current PDF";
    case "file":
      return choice.name;
    case "revision":
      return choice.label;
  }
}

export async function resolveChoices(
  api: RevisionApi,
  context: PdfRevisionContext,
  original: PdfCompareChoice,
  modified: PdfCompareChoice,
): Promise<PdfDiffSides> {
  // One revision at a time: two LaTeX builds at once only compete for the CPU.
  const originalSource = await resolveChoice(api, context, original);
  const modifiedSource = await resolveChoice(api, context, modified);
  return { original: originalSource, modified: modifiedSource };
}

/** The two sides of a Git diff of a PDF file tracked in the repository. */
export async function trackedPdfSides(
  api: RevisionApi,
  projectId: string,
  session: GitDiffSession,
): Promise<PdfDiffSides> {
  const read = async (
    relativePath: string,
    ref: GitRevisionRef,
    label: string,
    detail: string | undefined,
  ): Promise<PdfDiffSource> => {
    const bytes =
      ref.kind === "empty"
        ? null
        : await api.readGitRevisionPdf(projectId, relativePath, ref);
    return bytes
      ? { label, detail, data: new Uint8Array(bytes) }
      : {
          label,
          detail,
          data: null,
          emptyMessage: "The PDF does not exist in this version.",
        };
  };
  const original = await read(
    session.oldPath ?? session.relativePath,
    session.originalRef,
    session.originalLabel,
    detailFor([session.originalShortHash, session.originalAuthor]),
  );
  const modified = await read(
    session.relativePath,
    session.modifiedRef,
    session.modifiedLabel,
    detailFor([session.modifiedShortHash, session.modifiedAuthor]),
  );
  return { original, modified };
}

/** The compiled PDFs of the two revisions a source-file diff compares. */
export async function compiledPdfSidesForSession(
  api: RevisionApi,
  context: PdfRevisionContext,
  session: GitDiffSession,
): Promise<PdfDiffSides> {
  const original = await compiledPdfForRevision(
    api,
    context,
    session.originalRef,
    session.originalLabel,
    detailFor([session.originalShortHash, session.originalAuthor]),
  );
  const modified = await compiledPdfForRevision(
    api,
    context,
    session.modifiedRef,
    session.modifiedLabel,
    detailFor([session.modifiedShortHash, session.modifiedAuthor]),
  );
  return { original, modified };
}
