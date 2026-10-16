import type { DiffBeforeMount, DiffOnMount } from "@monaco-editor/react";
import { Binary, ExternalLink, GitCompareArrows, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, type ReactNode } from "react";
import type { editor as MonacoEditor, IDisposable } from "monaco-editor";
import type { GitBlameLine, GitDiffSession, GitRevisionRef } from "../types";
import { fileNameForDisplay, pathForDisplay } from "../pathDisplay";

const MonacoDiffEditor = lazy(() =>
  import("./MonacoEditor").then((module) => ({
    default: module.MonacoDiffEditor,
  })),
);

export interface GitDiffWorkbenchProps {
  session: GitDiffSession;
  theme: string;
  fontSize: number;
  blameLines?: GitBlameLine[];
  beforeMount?: DiffBeforeMount;
  onMount?: DiffOnMount;
  onClose?: () => void;
  onOpenFile?: (relativePath: string) => void;
  toolbarActions?: ReactNode;
  className?: string;
  options?: MonacoEditor.IDiffEditorConstructionOptions;
}

interface GitRevisionHeadingProps {
  side: "original" | "modified";
  label: string;
  hash?: string;
  author?: string;
  date?: string;
}

function baseName(filePath: string): string {
  return fileNameForDisplay(filePath);
}

function relativeDate(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;

  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const absoluteSeconds = Math.abs(seconds);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 365 * 24 * 60 * 60],
    ["month", 30 * 24 * 60 * 60],
    ["week", 7 * 24 * 60 * 60],
    ["day", 24 * 60 * 60],
    ["hour", 60 * 60],
    ["minute", 60],
  ];
  const [unit, divisor] = units.find(
    ([, candidate]) => absoluteSeconds >= candidate,
  ) ?? ["second", 1];

  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
    Math.round(seconds / divisor),
    unit,
  );
}

function encodeGitPath(filePath: string): string {
  return filePath
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

export function createGitModelUri(relativePath: string, revisionKey: string): string {
  return `git://latexdo/${encodeGitPath(relativePath)}?revision=${encodeURIComponent(
    revisionKey,
  )}`;
}

function revisionModelKey(
  revision: GitRevisionRef,
  label: string,
  sessionId: string,
): string {
  switch (revision.kind) {
    case "commit":
      return /^[0-9a-f]{7,64}$/i.test(revision.hash)
        ? `commit:${revision.hash}`
        : `commit:${revision.hash}:${sessionId}`;
    case "empty":
      return "empty";
    case "index":
    case "working-tree":
      return `${revision.kind}:${sessionId}`;
    default:
      return `${label}:${sessionId}`;
  }
}

export function gitDiffTabLabel(session: GitDiffSession): string {
  const originalFile = baseName(session.oldPath ?? session.relativePath);
  const modifiedFile = baseName(session.relativePath);
  return `${originalFile} (${session.originalLabel}) \u2194 ${modifiedFile} (${session.modifiedLabel})`;
}

export function GitRevisionHeading({
  side,
  label,
  hash,
  author,
  date,
}: GitRevisionHeadingProps) {
  return (
    <div className={`git-revision-heading ${side}`} aria-label={`${side} revision`}>
      <strong className="git-revision-label">{label}</strong>
      {hash && hash !== label ? (
        <code className="git-revision-hash">{hash}</code>
      ) : null}
      <span className="git-revision-meta git-revision-attribution">
        {author ? <span>{author}</span> : null}
        {author && date ? <span aria-hidden="true"> · </span> : null}
        {date ? (
          <time dateTime={date} title={date}>
            {relativeDate(date)}
          </time>
        ) : null}
      </span>
    </div>
  );
}

function isChangedModifiedLine(
  line: number,
  lineChanges: readonly MonacoEditor.ILineChange[],
): boolean {
  return lineChanges.some((change) => {
    if (change.modifiedEndLineNumber === 0) return false;
    return (
      line >= change.modifiedStartLineNumber && line <= change.modifiedEndLineNumber
    );
  });
}

export function GitDiffWorkbench({
  session,
  theme,
  fontSize,
  blameLines = [],
  beforeMount,
  onMount,
  onClose,
  onOpenFile,
  toolbarActions,
  className,
  options,
}: GitDiffWorkbenchProps) {
  const diffEditorRef = useRef<MonacoEditor.IStandaloneDiffEditor | null>(null);
  const diffUpdateDisposableRef = useRef<IDisposable | null>(null);
  const blameDecorationsRef = useRef<MonacoEditor.IEditorDecorationsCollection | null>(
    null,
  );
  const blameLinesRef = useRef(blameLines);
  blameLinesRef.current = blameLines;
  const unrenderable = Boolean(session.binary || session.tooLarge);

  const applyBlameDecorations = useCallback(
    (diffEditor: MonacoEditor.IStandaloneDiffEditor) => {
      const modifiedEditor = diffEditor.getModifiedEditor();
      const model = modifiedEditor.getModel();
      const lineChanges = diffEditor.getLineChanges();
      if (!model || lineChanges === null) {
        blameDecorationsRef.current?.clear();
        return;
      }

      const lineCount = model.getLineCount();
      const seenLines = new Set<number>();
      const decorations: MonacoEditor.IModelDeltaDecoration[] = [];
      for (const line of blameLinesRef.current) {
        if (
          line.line < 1 ||
          line.line > lineCount ||
          seenLines.has(line.line) ||
          isChangedModifiedLine(line.line, lineChanges)
        ) {
          continue;
        }
        seenLines.add(line.line);
        const summary = line.summary.replace(/\s+/g, " ").trim();
        decorations.push({
          range: {
            startLineNumber: line.line,
            startColumn: 1,
            endLineNumber: line.line,
            endColumn: 1,
          },
          options: {
            isWholeLine: true,
            after: {
              content: `  ${line.author}, ${relativeDate(line.authorTime)} · ${summary}`,
              inlineClassName: "git-blame-inline",
            },
          },
        });
      }

      if (!blameDecorationsRef.current) {
        blameDecorationsRef.current =
          modifiedEditor.createDecorationsCollection(decorations);
      } else {
        blameDecorationsRef.current.set(decorations);
      }
    },
    [],
  );

  const handleDiffEditorMount = useCallback<DiffOnMount>(
    (editor, monacoInstance) => {
      diffUpdateDisposableRef.current?.dispose();
      blameDecorationsRef.current?.clear();
      blameDecorationsRef.current = null;
      diffEditorRef.current = editor;
      diffUpdateDisposableRef.current = editor.onDidUpdateDiff(() => {
        applyBlameDecorations(editor);
      });
      applyBlameDecorations(editor);
      onMount?.(editor, monacoInstance);
    },
    [applyBlameDecorations, onMount],
  );

  useEffect(() => {
    if (unrenderable) {
      diffUpdateDisposableRef.current?.dispose();
      diffUpdateDisposableRef.current = null;
      blameDecorationsRef.current?.clear();
      blameDecorationsRef.current = null;
      diffEditorRef.current = null;
      return;
    }
    const editor = diffEditorRef.current;
    if (editor) applyBlameDecorations(editor);
  }, [applyBlameDecorations, blameLines, session.id, unrenderable]);

  useEffect(
    () => () => {
      diffUpdateDisposableRef.current?.dispose();
      diffUpdateDisposableRef.current = null;
      blameDecorationsRef.current?.clear();
      blameDecorationsRef.current = null;
      diffEditorRef.current = null;
    },
    [],
  );

  const originalPath = session.oldPath ?? session.relativePath;
  const originalModelPath = createGitModelUri(
    originalPath,
    revisionModelKey(session.originalRef, session.originalLabel, session.id),
  );
  const modifiedModelPath = createGitModelUri(
    session.relativePath,
    revisionModelKey(session.modifiedRef, session.modifiedLabel, session.id),
  );
  const fallbackMessage =
    session.message ||
    (session.binary
      ? "Binary files differ"
      : "This diff is too large to render safely.");

  return (
    <div
      className={["git-diff-workbench", className].filter(Boolean).join(" ")}
      data-session-id={session.id}
    >
      <div className="git-diff-toolbar">
        <div
          className="git-diff-title git-diff-toolbar-title"
          title={gitDiffTabLabel(session)}
        >
          <GitCompareArrows size={14} aria-hidden="true" />
          <span>{gitDiffTabLabel(session)}</span>
        </div>
        <div className="git-diff-toolbar-actions">
          {toolbarActions}
          {onOpenFile ? (
            <button
              type="button"
              className="git-diff-toolbar-button"
              onClick={() => onOpenFile(session.relativePath)}
              title="Open working-tree file"
              aria-label={`Open ${pathForDisplay(session.relativePath)}`}
            >
              <ExternalLink size={14} />
            </button>
          ) : null}
          {onClose ? (
            <button
              type="button"
              className="git-diff-toolbar-button"
              onClick={onClose}
              title="Close diff"
              aria-label="Close diff"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="git-diff-revision-headings">
        <GitRevisionHeading
          side="original"
          label={session.originalLabel}
          hash={session.originalShortHash}
          author={session.originalAuthor}
          date={session.originalDate}
        />
        <GitRevisionHeading
          side="modified"
          label={session.modifiedLabel}
          hash={session.modifiedShortHash}
          author={session.modifiedAuthor}
          date={session.modifiedDate}
        />
      </div>

      <div className="git-diff-editor">
        {unrenderable ? (
          <div className="git-diff-binary-state git-diff-unrenderable" role="status">
            <Binary size={22} aria-hidden="true" />
            <strong>{fallbackMessage}</strong>
            <span>{pathForDisplay(session.relativePath)}</span>
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="git-diff-loading" role="status">
                Loading diff editor...
              </div>
            }
          >
            <MonacoDiffEditor
              key={session.id}
              original={session.originalContent}
              modified={session.modifiedContent}
              originalModelPath={originalModelPath}
              modifiedModelPath={modifiedModelPath}
              language={session.language}
              theme={theme}
              beforeMount={beforeMount}
              onMount={handleDiffEditorMount}
              options={{
                ...options,
                readOnly: true,
                originalEditable: false,
                renderSideBySide: true,
                useInlineViewWhenSpaceIsLimited: false,
                automaticLayout: true,
                scrollBeyondLastLine: false,
                fontFamily:
                  "'SFMono-Regular', 'Cascadia Code', 'Fira Code', Menlo, monospace",
                fontSize,
                lineHeight: 22,
                minimap: { enabled: false },
                renderOverviewRuler: true,
                overviewRulerBorder: false,
                renderIndicators: true,
                renderMarginRevertIcon: false,
                diffCodeLens: true,
                ignoreTrimWhitespace: false,
                renderWhitespace: "selection",
                enableSplitViewResizing: true,
                splitViewDefaultRatio: 0.5,
                maxComputationTime: 5_000,
                maxFileSize: 20,
                originalAriaLabel: `${session.originalLabel}: ${originalPath}`,
                modifiedAriaLabel: `${session.modifiedLabel}: ${pathForDisplay(
                  session.relativePath,
                )}`,
              }}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
