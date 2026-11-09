import { ArrowLeftRight, LoaderCircle, RotateCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { GitCommitEntry } from "../types";
import {
  closePdfDiff,
  openPdfDiff,
  usePdfDiffRequest,
  type PdfCompareChoice,
  type PdfDiffRequest,
  type PdfDiffSides,
} from "../features/pdfDiff/pdfDiffStore";
import {
  RevisionCompileError,
  choiceLabel,
  resolveChoices,
  type PdfRevisionContext,
} from "../features/pdfDiff/revisionSources";
import { PdfDiffView } from "./PdfDiffView";

export interface PdfDiffHostProps {
  /** Null when no local project is open; Git choices are then hidden. */
  context: PdfRevisionContext | null;
}

type CompareRequest = Extract<PdfDiffRequest, { kind: "compare" }>;

function CompareRunner({ request }: { request: CompareRequest }) {
  const [sides, setSides] = useState<PdfDiffSides | null>(null);
  const [failure, setFailure] = useState<{ message: string; output?: string } | null>(
    null,
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setSides(null);
    setFailure(null);
    request
      .load(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setSides(result);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setFailure({
          message:
            error instanceof Error ? error.message : "Could not prepare the PDFs.",
          output: error instanceof RevisionCompileError ? error.output : undefined,
        });
      });
    return () => controller.abort();
  }, [attempt, request]);

  if (sides) {
    return (
      <PdfDiffView
        title={request.title}
        original={sides.original}
        modified={sides.modified}
        onClose={closePdfDiff}
        onSwap={() => setSides({ original: sides.modified, modified: sides.original })}
      />
    );
  }

  return (
    <div className="pdf-diff-view" aria-label={request.title}>
      <div className="pdf-diff-toolbar">
        <div className="pdf-diff-title">
          <ArrowLeftRight size={14} aria-hidden="true" />
          <span>{request.title}</span>
        </div>
        <div className="pdf-diff-actions">
          <button
            type="button"
            onClick={closePdfDiff}
            title="Close"
            aria-label="Close comparison"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      {failure ? (
        <div className="pdf-diff-state is-error" role="alert">
          <strong>{failure.message}</strong>
          {failure.output ? (
            <details className="pdf-diff-log">
              <summary>Compiler output</summary>
              <pre>{failure.output.slice(-20_000)}</pre>
            </details>
          ) : null}
          <button
            type="button"
            className="pdf-diff-retry"
            onClick={() => setAttempt((value) => value + 1)}
          >
            <RotateCw size={14} /> Try again
          </button>
        </div>
      ) : (
        <div className="pdf-diff-state" role="status">
          <LoaderCircle size={18} className="spin" aria-hidden="true" />
          <span>{request.loadingMessage ?? "Preparing the PDFs…"}</span>
        </div>
      )}
    </div>
  );
}

type ChoiceValue = "current" | "index" | "file" | `commit:${string}`;

function choiceValue(choice: PdfCompareChoice | undefined): ChoiceValue | "" {
  if (!choice) return "";
  if (choice.kind === "current") return "current";
  if (choice.kind === "file") return "file";
  return choice.ref.kind === "index" ? "index" : `commit:${choice.ref.hash}`;
}

function commitLabel(commit: GitCommitEntry): string {
  const subject =
    commit.subject.length > 60 ? `${commit.subject.slice(0, 59)}…` : commit.subject;
  return `${commit.shortHash} · ${subject}`;
}

interface SidePickerProps {
  id: string;
  label: string;
  choice: PdfCompareChoice | undefined;
  commits: GitCommitEntry[];
  hasCurrentPdf: boolean;
  gitAvailable: boolean;
  onChange: (choice: PdfCompareChoice | undefined) => void;
}

function SidePicker({
  id,
  label,
  choice,
  commits,
  hasCurrentPdf,
  gitAvailable,
  onChange,
}: SidePickerProps) {
  const [picking, setPicking] = useState(false);
  const handleChange = async (value: string) => {
    if (value === "current") {
      onChange({ kind: "current" });
    } else if (value === "index") {
      onChange({ kind: "revision", ref: { kind: "index" }, label: "Staged changes" });
    } else if (value.startsWith("commit:")) {
      const hash = value.slice("commit:".length);
      const commit = commits.find((entry) => entry.hash === hash);
      onChange({
        kind: "revision",
        ref: { kind: "commit", hash },
        label: commit ? commit.shortHash : hash.slice(0, 7),
      });
    } else if (value === "file") {
      setPicking(true);
      try {
        const picked = await window.latexdo.pickPdfForComparison();
        if (picked)
          onChange({
            kind: "file",
            name: picked.name,
            data: new Uint8Array(picked.data),
          });
      } finally {
        setPicking(false);
      }
    }
  };

  return (
    <label className="pdf-compare-side" htmlFor={id}>
      <span className="pdf-compare-side-label">{label}</span>
      <select
        id={id}
        value={choiceValue(choice)}
        disabled={picking}
        onChange={(event) => void handleChange(event.target.value)}
      >
        <option value="" disabled>
          Choose a version…
        </option>
        <option value="current" disabled={!hasCurrentPdf}>
          Current PDF{hasCurrentPdf ? "" : " (compile first)"}
        </option>
        {gitAvailable ? (
          <option value="index">Staged changes (Git index)</option>
        ) : null}
        {commits.length ? (
          <optgroup label="Commits">
            {commits.map((commit) => (
              <option key={commit.hash} value={`commit:${commit.hash}`}>
                {commitLabel(commit)}
                {commit.isHead ? " (HEAD)" : ""}
              </option>
            ))}
          </optgroup>
        ) : null}
        <option value="file">
          {choice?.kind === "file" ? `File: ${choice.name}` : "PDF file on disk…"}
        </option>
      </select>
    </label>
  );
}

function ComparePicker({
  request,
  context,
}: {
  request: Extract<PdfDiffRequest, { kind: "picker" }>;
  context: PdfRevisionContext | null;
}) {
  const [commits, setCommits] = useState<GitCommitEntry[]>([]);
  const [gitAvailable, setGitAvailable] = useState(false);
  const [original, setOriginal] = useState<PdfCompareChoice | undefined>(
    request.original,
  );
  const [modified, setModified] = useState<PdfCompareChoice | undefined>(
    request.modified ?? (context?.currentPdf ? { kind: "current" } : undefined),
  );
  const projectId = context?.projectId ?? null;

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    window.latexdo
      .getGitHistory(projectId)
      .then((history) => {
        if (cancelled) return;
        const list = history.commits.slice(0, 200);
        setCommits(list);
        setGitAvailable(list.length > 0);
        // Default to the last commit: "what changed since I committed?"
        setOriginal(
          (current) =>
            current ??
            (list[0]
              ? {
                  kind: "revision",
                  ref: { kind: "commit", hash: list[0].hash },
                  label: list[0].shortHash,
                }
              : undefined),
        );
      })
      .catch(() => {
        if (!cancelled) setGitAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const compare = () => {
    if (!original || !modified) return;
    const needsContext = [original, modified].some((choice) => choice.kind !== "file");
    if (needsContext && !context) return;
    const title = `${choiceLabel(original)} ↔ ${choiceLabel(modified)}`;
    const compiles = [original, modified].some((choice) => choice.kind === "revision");
    openPdfDiff({
      kind: "compare",
      title,
      loadingMessage: compiles
        ? "Compiling the selected revisions… The first build of a commit can take a minute; later comparisons reuse it."
        : undefined,
      load: async () => {
        if (original.kind === "file" && modified.kind === "file") {
          return {
            original: { label: original.name, detail: "PDF file", data: original.data },
            modified: { label: modified.name, detail: "PDF file", data: modified.data },
          };
        }
        return resolveChoices(window.latexdo, context!, original, modified);
      },
    });
  };

  const ready =
    Boolean(original && modified) &&
    (context !== null || (original?.kind === "file" && modified?.kind === "file"));

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closePdfDiff();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") closePdfDiff();
      }}
    >
      <section
        className="modal-panel pdf-compare-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-compare-title"
      >
        <header className="modal-header">
          <h2 id="pdf-compare-title">Compare PDF Versions</h2>
          <button
            type="button"
            onClick={closePdfDiff}
            aria-label="Close"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </header>
        <div className="pdf-compare-body">
          <p className="pdf-compare-help">
            See what changed between two versions of the paper, like a Git diff of the
            PDF. Commits are compiled in a separate folder; your files are not touched.
          </p>
          <SidePicker
            id="pdf-compare-original"
            label="Older"
            choice={original}
            commits={commits}
            hasCurrentPdf={Boolean(context?.currentPdf)}
            gitAvailable={gitAvailable}
            onChange={setOriginal}
          />
          <button
            type="button"
            className="pdf-compare-swap"
            onClick={() => {
              setOriginal(modified);
              setModified(original);
            }}
            title="Swap"
            aria-label="Swap older and newer"
          >
            <ArrowLeftRight size={14} />
          </button>
          <SidePicker
            id="pdf-compare-modified"
            label="Newer"
            choice={modified}
            commits={commits}
            hasCurrentPdf={Boolean(context?.currentPdf)}
            gitAvailable={gitAvailable}
            onChange={setModified}
          />
        </div>
        <footer className="pdf-compare-footer">
          <button type="button" className="dialog-cancel" onClick={closePdfDiff}>
            Cancel
          </button>
          <button
            type="button"
            className="dialog-submit"
            disabled={!ready}
            onClick={compare}
          >
            Compare
          </button>
        </footer>
      </section>
    </div>
  );
}

/**
 * Shows the PDF comparison requested anywhere in the app (menu, PDF toolbar,
 * Git diff) over the workspace.
 */
export function PdfDiffHost({ context }: PdfDiffHostProps) {
  const request = usePdfDiffRequest();
  const close = useCallback(() => closePdfDiff(), []);

  // A comparison belongs to the project it was opened for.
  const projectId = context?.projectId ?? null;
  useEffect(() => close, [close, projectId]);

  if (!request) return null;
  if (request.kind === "picker") {
    return <ComparePicker request={request} context={context} />;
  }
  return (
    <div
      className="pdf-diff-host"
      role="dialog"
      aria-modal="true"
      aria-label={request.title}
    >
      <CompareRunner request={request} />
    </div>
  );
}
