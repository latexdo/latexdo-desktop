// The Problems panel: every finding — compiler, writing, and paper checks —
// in one list grouped by file, VS Code style. A row is one line; clicking it
// jumps to the source and shows the explanation and any one-click fixes.

import React from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleX,
} from "lucide-react";
import type { Diagnostic, DiagnosticFix } from "../types";
import { diagnosticHeadline } from "../features/editor/diagnostics";
import { pathForDisplay } from "../pathDisplay";

interface ProblemsPanelProps {
  diagnostics: Diagnostic[];
  rootFile: string;
  onOpen(diagnostic: Diagnostic): void;
  onApplyFix(diagnostic: Diagnostic, fix: DiagnosticFix): void;
  onApplyReplacement(diagnostic: Diagnostic): void;
}

export function diagnosticCategory(diagnostic: Diagnostic): string {
  if (diagnostic.category) return diagnostic.category;
  switch (diagnostic.source) {
    case "proofread":
      return "Writing";
    case "citation-assistant":
      return "Citations";
    case "structure-assistant":
      return "Structure";
    case "pdf-compliance":
      return "Submission";
    default:
      return "LaTeX";
  }
}

/** The one line a row shows: plain words, no "LaTeX warning" boilerplate. */
export function diagnosticSummary(diagnostic: Diagnostic): string {
  if (diagnosticCategory(diagnostic) !== "LaTeX") return diagnostic.message;
  const headline = diagnosticHeadline(diagnostic);
  return headline === "LaTeX warning" || headline === "LaTeX error"
    ? diagnostic.message
    : headline;
}

/** Display parts of a file path, decoded like the project tree (%20 → space). */
function splitPath(path: string): { name: string; dir: string } {
  const display = pathForDisplay(path);
  const index = display.lastIndexOf("/");
  return index < 0
    ? { name: display, dir: "" }
    : { name: display.slice(index + 1), dir: display.slice(0, index) };
}

type SeverityFilter = "all" | "error" | "warning";

export const ProblemsPanel: React.FC<ProblemsPanelProps> = ({
  diagnostics,
  rootFile,
  onOpen,
  onApplyFix,
  onApplyReplacement,
}) => {
  const [query, setQuery] = React.useState("");
  const [severity, setSeverity] = React.useState<SeverityFilter>("all");
  const [category, setCategory] = React.useState("all");
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());
  const [selected, setSelected] = React.useState<string | null>(null);

  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.length - errors;
  const categories = React.useMemo(
    () => [...new Set(diagnostics.map(diagnosticCategory))].sort(),
    [diagnostics],
  );

  const groups = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    const byFile = new Map<string, Diagnostic[]>();
    for (const diagnostic of diagnostics) {
      if (severity !== "all" && diagnostic.severity !== severity) continue;
      if (category !== "all" && diagnosticCategory(diagnostic) !== category) continue;
      const file = diagnostic.file || rootFile;
      if (
        needle &&
        !`${diagnostic.message} ${diagnostic.detail ?? ""} ${file}`
          .toLowerCase()
          .includes(needle)
      ) {
        continue;
      }
      const list = byFile.get(file) ?? [];
      list.push(diagnostic);
      byFile.set(file, list);
    }
    for (const list of byFile.values()) {
      // The root cause leads; then errors, then by position.
      list.sort(
        (a, b) =>
          Number(Boolean(b.isPrimary)) - Number(Boolean(a.isPrimary)) ||
          Number(b.severity === "error") - Number(a.severity === "error") ||
          a.line - b.line ||
          a.column - b.column,
      );
    }
    return [...byFile.entries()].sort(([a, listA], [b, listB]) => {
      const errorsA = listA.some((d) => d.severity === "error");
      const errorsB = listB.some((d) => d.severity === "error");
      if (errorsA !== errorsB) return errorsA ? -1 : 1;
      if (a === rootFile) return -1;
      if (b === rootFile) return 1;
      return a.localeCompare(b);
    });
  }, [diagnostics, query, severity, category, rootFile]);

  if (!diagnostics.length) {
    return (
      <div className="panel-empty">
        <CircleCheck size={16} />
        No problems found
      </div>
    );
  }

  const toggleFile = (file: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });

  return (
    <div className="problems">
      <div className="problems-toolbar">
        <input
          type="search"
          className="problems-filter"
          placeholder="Filter"
          aria-label="Filter problems"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="problems-severity" role="group" aria-label="Severity">
          <button
            type="button"
            className={severity === "error" ? "active" : ""}
            aria-pressed={severity === "error"}
            onClick={() => setSeverity((s) => (s === "error" ? "all" : "error"))}
          >
            <CircleX size={13} className="error-icon" />
            {errors}
          </button>
          <button
            type="button"
            className={severity === "warning" ? "active" : ""}
            aria-pressed={severity === "warning"}
            onClick={() => setSeverity((s) => (s === "warning" ? "all" : "warning"))}
          >
            <CircleAlert size={13} className="warning-icon" />
            {warnings}
          </button>
        </div>
        {categories.length > 1 ? (
          <select
            className="problems-category"
            aria-label="Check"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="all">All checks</option>
            {categories.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <div className="problems-list" role="tree" aria-label="Problems">
        {groups.length === 0 ? (
          <div className="problems-none">No problems match this filter.</div>
        ) : null}
        {groups.map(([file, items]) => {
          const open = !collapsed.has(file);
          const { name, dir } = splitPath(file);
          return (
            <div key={file} role="group">
              <button
                type="button"
                className="problems-file"
                role="treeitem"
                aria-expanded={open}
                onClick={() => toggleFile(file)}
              >
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="problems-file-name">{name}</span>
                {dir ? <span className="problems-file-dir">{dir}</span> : null}
                <span className="problems-file-count">{items.length}</span>
              </button>
              {open
                ? items.map((diagnostic, index) => {
                    const key = `${file}:${diagnostic.line}:${diagnostic.column}:${index}:${diagnostic.message}`;
                    const isSelected = selected === key;
                    const fixes = diagnostic.fixes ?? [];
                    const replacement = diagnostic.replacements?.[0];
                    const summary = diagnosticSummary(diagnostic);
                    const showMessage =
                      summary !== diagnostic.message &&
                      diagnosticCategory(diagnostic) === "LaTeX";
                    return (
                      <div
                        key={key}
                        className={`problems-item ${isSelected ? "selected" : ""}`}
                      >
                        <button
                          type="button"
                          className="problems-row"
                          role="treeitem"
                          aria-selected={isSelected}
                          title={`${summary} (${file}:${diagnostic.line})`}
                          onClick={() => {
                            setSelected(isSelected ? null : key);
                            onOpen(diagnostic);
                          }}
                        >
                          {diagnostic.severity === "error" ? (
                            <CircleX size={14} className="error-icon" />
                          ) : (
                            <CircleAlert size={14} className="warning-icon" />
                          )}
                          <span className="problems-message">{summary}</span>
                          {diagnostic.isPrimary ? (
                            <span className="problems-tag root">Root cause</span>
                          ) : null}
                          <span className="problems-source">
                            {diagnosticCategory(diagnostic)}
                          </span>
                          <span className="problems-position">
                            Ln {diagnostic.line}, Col {Math.max(1, diagnostic.column)}
                          </span>
                        </button>
                        {isSelected ? (
                          <div className="problems-detail">
                            {showMessage ? (
                              <code className="problems-raw">{diagnostic.message}</code>
                            ) : null}
                            {diagnostic.detail ? <p>{diagnostic.detail}</p> : null}
                            {diagnostic.reportedLine &&
                            diagnostic.reportedLine !== diagnostic.line ? (
                              <p className="problems-note">
                                LaTeX stopped at line {diagnostic.reportedLine}; the
                                cause is here.
                              </p>
                            ) : null}
                            {diagnostic.compilerExcerpt ? (
                              <pre className="problems-excerpt">
                                {diagnostic.compilerExcerpt}
                              </pre>
                            ) : null}
                            {diagnostic.suggestion ? (
                              <p className="problems-suggestion">
                                {diagnostic.suggestion}
                              </p>
                            ) : null}
                            {replacement || fixes.length ? (
                              <div className="problems-actions">
                                {fixes.map((fix) => (
                                  <button
                                    type="button"
                                    className="sidebar-mini-action primary"
                                    key={`${fix.line}-${fix.column}-${fix.title}`}
                                    onClick={() => onApplyFix(diagnostic, fix)}
                                  >
                                    {fix.title}
                                  </button>
                                ))}
                                {replacement !== undefined ? (
                                  <button
                                    type="button"
                                    className="sidebar-mini-action primary"
                                    onClick={() => onApplyReplacement(diagnostic)}
                                  >
                                    Replace with “{replacement}”
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};
