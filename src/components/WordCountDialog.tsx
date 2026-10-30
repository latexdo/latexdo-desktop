import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { LatexWordCount } from "../latex/wordCount";

interface Props {
  open: boolean;
  fileName: string;
  counts: LatexWordCount;
  projectFiles: { path: string; words: number }[];
  projectLoading: boolean;
  offset: number | null;
  abstractLimit: number;
  onClose: () => void;
  onNavigate: (line: number, column: number) => void;
}
export function WordCountDialog({
  open,
  fileName,
  counts,
  projectFiles,
  projectLoading,
  offset,
  abstractLimit,
  onClose,
  onNavigate,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const current =
    offset === null
      ? null
      : [...counts.sections]
          .reverse()
          .find((section) => section.start <= offset && offset < section.end);
  useEffect(() => {
    if (open) {
      ref.current?.showModal();
      ref.current
        ?.querySelector<HTMLElement>('[data-current="true"]')
        ?.scrollIntoView?.({ block: "nearest" });
    } else if (ref.current?.open) ref.current.close();
  }, [open, offset, fileName]);
  const hasAbstract = counts.sections.some((section) => section.kind === "abstract");
  return (
    <dialog
      ref={ref}
      className="word-count-dialog"
      aria-labelledby="word-count-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <div>
          <h2 id="word-count-title">Word count</h2>
          <p>{fileName} · Updates as you write</p>
        </div>
        <button
          type="button"
          className="small-icon"
          aria-label="Close word count"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      <div className="word-count-scroll">
        <div className="word-count-summary">
          <div>
            <span>Current file total</span>
            <strong>{counts.total.toLocaleString()}</strong>
          </div>
          <div>
            <span>Abstract</span>
            <strong>{hasAbstract ? counts.abstract.toLocaleString() : "—"}</strong>
            {hasAbstract ? (
              <small>
                {abstractLimit} word target
                {counts.abstract > abstractLimit
                  ? ` · ${counts.abstract - abstractLimit} over`
                  : ""}
              </small>
            ) : (
              <small>No abstract in this file</small>
            )}
          </div>
        </div>
        <h3>Document breakdown</h3>
        <p className="word-count-hint">
          Choose a heading to jump to it. Parent counts include their subsections.
        </p>
        <div className="word-count-sections">
          {counts.sections.map((section) => (
            <button
              key={section.id}
              type="button"
              className="word-count-section"
              aria-label={`${section.kind} · line ${section.line} ${section.title} ${section.words.toLocaleString()} words`}
              data-current={current?.id === section.id}
              onClick={() => {
                onClose();
                onNavigate(section.line, section.column);
              }}
            >
              <span style={{ paddingLeft: Math.min(section.level, 5) * 10 }}>
                <small>
                  {section.kind} · line {section.line}
                </small>
                <span>{section.title}</span>
              </span>
              <strong>
                {section.words.toLocaleString()} <small>words</small>
              </strong>
            </button>
          ))}
          {!counts.sections.length ? (
            <p>
              No abstract or section headings yet. All prose is included in the total.
            </p>
          ) : null}
        </div>
        {projectFiles.length > 1 ? (
          <details className="word-count-explanation">
            <summary>
              Project TeX source:{" "}
              {projectFiles.reduce((sum, file) => sum + file.words, 0).toLocaleString()}{" "}
              words{projectLoading ? " · updating…" : ""}
            </summary>
            <p>
              Each indexed .tex file is counted once, including unsaved edits and any
              unused drafts. This is a source total, not an expanded compilation.
            </p>
            <ul>
              {projectFiles.map((file) => (
                <li key={file.path}>
                  <span>{file.path}</span>
                  <strong>{file.words.toLocaleString()}</strong>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <details className="word-count-explanation" open>
          <summary>How counting works</summary>
          <p>
            Counts visible source text, including headings, captions, footnotes, and
            table text. Hyphenated words and words with apostrophes count as one;
            numbers count too.
          </p>
          <p>
            Excludes the preamble, comments, command names, citation and reference keys,
            file paths, mathematics, code blocks, and bibliography entries. Formatting
            commands keep their text.
          </p>
          <p>
            The total counts each word once. Section counts include nested subsections,
            so adding every row would double-count words. Abstract counts include only
            the abstract text.
          </p>
          <p>
            This is a source estimate. Custom macros, generated text, and included files
            are not expanded into the current file’s sections.
          </p>
        </details>
      </div>
    </dialog>
  );
}
