import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertTriangle, Check, Copy, Plus, Search, Trash2, X } from "lucide-react";
import type { NotedSymbol } from "../types";
import { analyzeNotation } from "../checks/notationManager";
import { SYMBOL_PALETTE } from "./mathSymbolPalette";

interface NotationManagerProps {
  content: string;
  onInsertCode?: (code: string) => void;
}

interface NotationEntry {
  symbol: string;
  description: string;
}

interface EquationTemplate {
  label: string;
  code: string;
  desc: string;
  preview: ReactNode;
  previewKind?:
    | "inline"
    | "equation"
    | "align"
    | "cases"
    | "matrix"
    | "fraction"
    | "definition";
}

function equationPreview(value: string, number?: string): ReactNode {
  return (
    <span className="notation-preview-equation">
      <span>{value}</span>
      {number ? <span className="notation-preview-number">{number}</span> : null}
    </span>
  );
}

function alignPreview(): ReactNode {
  return (
    <span className="notation-preview-align">
      <span>
        <em>a</em>
        <strong>=</strong>
        <em>b</em>
      </span>
      <span>
        <strong>=</strong>
        <em>c</em>
      </span>
    </span>
  );
}

function casesPreview(): ReactNode {
  return (
    <span className="notation-preview-cases">
      <span className="notation-preview-cases-left">f(x) =</span>
      <span className="notation-preview-cases-brace">{`{`}</span>
      <span className="notation-preview-cases-rows">
        <span>
          <strong>0</strong>
          <em>x &lt; 0</em>
        </span>
        <span>
          <strong>1</strong>
          <em>{"x ≥ 0"}</em>
        </span>
      </span>
    </span>
  );
}

function matrixPreview(): ReactNode {
  return (
    <span className="notation-preview-matrix">
      <span>a</span>
      <span>b</span>
      <span>c</span>
      <span>d</span>
    </span>
  );
}

function fractionPreview(): ReactNode {
  return (
    <span className="notation-preview-fraction">
      <span>a</span>
      <span>b</span>
    </span>
  );
}

function operatorPreview(
  symbol: string,
  upper: string,
  lower: string,
  body: string,
): ReactNode {
  return (
    <span className="notation-preview-operator">
      <span className="notation-preview-limits">
        <span>{upper}</span>
        <strong>{symbol}</strong>
        <span>{lower}</span>
      </span>
      <span>{body}</span>
    </span>
  );
}

type NotationTab = "templates" | "symbols" | "custom";

type DetectedFilter = "all" | "undefined" | "conflicts" | "defined";

const NOTATION_TABS: Array<{ id: NotationTab; label: string }> = [
  { id: "templates", label: "Templates" },
  { id: "symbols", label: "Symbols" },
  { id: "custom", label: "Custom" },
];

const EQUATION_TEMPLATES: EquationTemplate[] = [
  {
    label: "Inline",
    code: "$x$",
    desc: "Inline math",
    preview: <span className="notation-preview-inline">x</span>,
    previewKind: "inline",
  },
  {
    label: "Display",
    code: "\\[\n  x = y\n\\]",
    desc: "Unnumbered display math",
    preview: equationPreview("x = y"),
    previewKind: "equation",
  },
  {
    label: "Equation",
    code: "\\begin{equation}\n  \\label{eq:label}\n  x = y\n\\end{equation}",
    desc: "Numbered equation",
    preview: equationPreview("x = y", "(1)"),
    previewKind: "equation",
  },
  {
    label: "Align",
    code: "\\begin{align}\n  a &= b \\\\\n    &= c\n\\end{align}",
    desc: "Aligned multi-line equations",
    preview: alignPreview(),
    previewKind: "align",
  },
  {
    label: "Cases",
    code:
      "\\begin{equation}\n" +
      "  f(x) = \\begin{cases}\n" +
      "    0, & x < 0 \\\\\n" +
      "    1, & x \\ge 0\n" +
      "  \\end{cases}\n" +
      "\\end{equation}",
    desc: "Piecewise definition",
    preview: casesPreview(),
    previewKind: "cases",
  },
  {
    label: "Matrix",
    code: "\\begin{bmatrix}\n  a & b \\\\\n  c & d\n\\end{bmatrix}",
    desc: "Bracketed matrix",
    preview: matrixPreview(),
    previewKind: "matrix",
  },
  {
    label: "Fraction",
    code: "\\frac{a}{b}",
    desc: "Fraction",
    preview: fractionPreview(),
    previewKind: "fraction",
  },
  {
    label: "Sum",
    code: "\\sum_{i=1}^{n} x_i",
    desc: "Summation",
    preview: operatorPreview("Σ", "n", "i=1", "x_i"),
    previewKind: "equation",
  },
  {
    label: "Integral",
    code: "\\int_{a}^{b} f(x)\\,dx",
    desc: "Definite integral",
    preview: operatorPreview("∫", "b", "a", "f(x) dx"),
    previewKind: "equation",
  },
  {
    label: "Norm",
    code: "\\left\\lVert x \\right\\rVert_2",
    desc: "Vector norm",
    preview: (
      <span className="notation-preview-expression">
        ||x||<sub>2</sub>
      </span>
    ),
    previewKind: "equation",
  },
  {
    label: "Expectation",
    code: "\\mathbb{E}\\left[X\\right]",
    desc: "Expected value",
    preview: <span className="notation-preview-expression">E[X]</span>,
    previewKind: "equation",
  },
  {
    label: "Definition",
    code: "\\newcommand{\\mySymbol}{x}",
    desc: "Reusable notation command",
    preview: <span className="notation-preview-definition">{"\\mySymbol := x"}</span>,
    previewKind: "definition",
  },
];

function definitionFor(symbol: string): string {
  return `\\newcommand{\\${symbol.replace(/^\\/, "")}}{${symbol}}`;
}

export function NotationManager({ content, onInsertCode }: NotationManagerProps) {
  const [customEntries, setCustomEntries] = useState<NotationEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [detectedQuery, setDetectedQuery] = useState("");
  const [detectedFilter, setDetectedFilter] = useState<DetectedFilter>("all");
  const [activeTab, setActiveTab] = useState<NotationTab>("templates");
  const [newSymbol, setNewSymbol] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const analysis = useMemo(() => analyzeNotation(content), [content]);
  const counts = useMemo(
    () => ({
      all: analysis.length,
      undefined: analysis.filter((sym) => !sym.defined).length,
      conflicts: analysis.filter((sym) => sym.similarSymbols.length > 0).length,
      defined: analysis.filter((sym) => sym.defined).length,
    }),
    [analysis],
  );

  const visibleSymbols = useMemo(() => {
    const q = detectedQuery.trim().toLowerCase();
    return analysis.filter((sym) => {
      if (detectedFilter === "undefined" && sym.defined) return false;
      if (detectedFilter === "defined" && !sym.defined) return false;
      if (detectedFilter === "conflicts" && sym.similarSymbols.length === 0)
        return false;
      if (!q) return true;
      return (
        sym.symbol.toLowerCase().includes(q) ||
        sym.firstUseSection.toLowerCase().includes(q)
      );
    });
  }, [analysis, detectedFilter, detectedQuery]);

  const filteredPalette = useMemo(() => {
    if (!searchQuery) return SYMBOL_PALETTE;
    const q = searchQuery.toLowerCase();
    return SYMBOL_PALETTE.filter(
      (s) =>
        s.search.includes(q) ||
        s.latex.toLowerCase().includes(q) ||
        s.display.toLowerCase().includes(q),
    );
  }, [searchQuery]);

  const flash = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  }, []);

  const handleCopy = useCallback(
    async (text: string) => {
      await navigator.clipboard.writeText(text);
      flash(`Copied ${text.length > 32 ? `${text.slice(0, 32)}…` : text}`);
    },
    [flash],
  );

  const handleInsert = useCallback(
    (code: string, label: string) => {
      if (!onInsertCode) {
        void handleCopy(code);
        return;
      }
      onInsertCode(code);
      flash(`Inserted ${label}`);
    },
    [onInsertCode, handleCopy, flash],
  );

  const handleAddCustomEntry = useCallback(() => {
    const symbol = newSymbol.trim();
    if (!symbol) return;
    setCustomEntries((prev) => [
      ...prev,
      { symbol, description: newDescription.trim() },
    ]);
    setNewSymbol("");
    setNewDescription("");
  }, [newSymbol, newDescription]);

  const filters: Array<{ id: DetectedFilter; label: string }> = [
    { id: "all", label: "All" },
    { id: "undefined", label: "Undefined" },
    { id: "conflicts", label: "Conflicts" },
    { id: "defined", label: "Defined" },
  ];

  return (
    <div className="notation-manager-root">
      <section
        className="notation-manager-detected-area"
        aria-label="Detected notation"
      >
        <header className="notation-manager-pane-header">
          <div className="notation-manager-pane-title">
            <h2>Detected Notation</h2>
          </div>
          <div className="notation-manager-filter-row">
            <div
              className="notation-manager-filters"
              role="tablist"
              aria-label="Filter symbols"
            >
              {filters.map((filter) => (
                <button
                  key={filter.id}
                  role="tab"
                  aria-selected={detectedFilter === filter.id}
                  className={`notation-manager-filter ${filter.id} ${
                    detectedFilter === filter.id ? "active" : ""
                  }`}
                  onClick={() => setDetectedFilter(filter.id)}
                  disabled={filter.id !== "all" && counts[filter.id] === 0}
                >
                  {filter.label}
                  <span className="notation-manager-filter-count">
                    {counts[filter.id]}
                  </span>
                </button>
              ))}
            </div>
            <div className="notation-manager-search compact">
              <Search size={13} />
              <input
                type="text"
                placeholder="Filter by symbol or section"
                value={detectedQuery}
                onChange={(e) => setDetectedQuery(e.target.value)}
              />
              {detectedQuery && (
                <button onClick={() => setDetectedQuery("")} title="Clear filter">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        </header>

        {analysis.length === 0 ? (
          <div className="notation-manager-empty">
            <strong>No notation detected</strong>
            <span>Math symbols used in the active document will appear here.</span>
          </div>
        ) : visibleSymbols.length === 0 ? (
          <div className="notation-manager-empty">
            <span>No symbols match this filter.</span>
          </div>
        ) : (
          <ul className="notation-manager-detected">
            {visibleSymbols.map((sym: NotedSymbol) => (
              <li
                key={sym.symbol}
                className={`notation-manager-detected-item ${sym.defined ? "defined" : "undefined"}`}
              >
                <code className="notation-manager-detected-symbol" title={sym.symbol}>
                  {sym.symbol}
                </code>
                <div className="notation-manager-detected-info">
                  <div className="notation-manager-detected-location">
                    <span>Line {sym.firstUseLine}</span>
                    <span className="notation-manager-detected-section">
                      {sym.firstUseSection}
                    </span>
                  </div>
                  {sym.similarSymbols.length > 0 && (
                    <div className="notation-manager-detected-conflict">
                      <AlertTriangle size={11} />
                      Similar to{" "}
                      {sym.similarSymbols.map((other) => (
                        <code key={other}>{other}</code>
                      ))}
                    </div>
                  )}
                </div>
                <span
                  className="notation-manager-detected-count"
                  title="Uses in document"
                >
                  {sym.usageCount}×
                </span>
                <span
                  className={`notation-manager-detected-badge ${
                    sym.defined ? "defined" : "undefined"
                  }`}
                >
                  {sym.defined ? "Defined" : "Undefined"}
                </span>
                <div className="notation-manager-detected-actions">
                  <button
                    className="notation-manager-icon-btn"
                    onClick={() => void handleCopy(sym.symbol)}
                    title={`Copy ${sym.symbol}`}
                    aria-label={`Copy ${sym.symbol}`}
                  >
                    <Copy size={13} />
                  </button>
                  {!sym.defined && (
                    <button
                      className="notation-manager-def-btn"
                      onClick={() =>
                        handleInsert(definitionFor(sym.symbol), sym.symbol)
                      }
                      title={`Insert ${definitionFor(sym.symbol)}`}
                    >
                      Define
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="notation-manager-tools-area" aria-label="Notation tools">
        <div className="notation-manager-tabs" role="tablist">
          {NOTATION_TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? "active" : ""}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "templates" ? (
          <div className="notation-manager-body">
            <p className="notation-manager-hint">
              {onInsertCode
                ? "Click a block to insert it at the cursor."
                : "Click a block to copy its LaTeX."}
            </p>
            <div className="notation-manager-templates">
              {EQUATION_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.label}
                  className="notation-manager-template-btn"
                  onClick={() => handleInsert(tpl.code, tpl.label)}
                  title={tpl.desc}
                >
                  <span
                    className={`notation-manager-template-preview ${tpl.previewKind ?? "equation"}`}
                    aria-label={`${tpl.label} output preview`}
                  >
                    {tpl.preview}
                  </span>
                  <span className="notation-manager-template-text">
                    <span className="notation-manager-template-label">{tpl.label}</span>
                    <span className="notation-manager-template-desc">{tpl.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {activeTab === "symbols" ? (
          <div className="notation-manager-body">
            <div className="notation-manager-search">
              <Search size={13} />
              <input
                type="text"
                placeholder="Search symbols (e.g. arrow, alpha, subset)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
              <span className="notation-manager-search-count">
                {filteredPalette.length}
              </span>
            </div>
            {filteredPalette.length > 0 ? (
              <div className="notation-manager-palette">
                {filteredPalette.map((sym) => (
                  <button
                    key={sym.latex}
                    className="notation-manager-symbol-btn"
                    onClick={() => void handleCopy(sym.latex)}
                    title={`${sym.latex} — Click to copy`}
                  >
                    <span className="notation-manager-symbol-display">
                      {sym.display}
                    </span>
                    <span className="notation-manager-symbol-latex">{sym.latex}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="notation-manager-empty">
                <span>No symbols match “{searchQuery}”.</span>
              </div>
            )}
          </div>
        ) : null}

        {activeTab === "custom" ? (
          <div className="notation-manager-body">
            <form
              className="notation-manager-custom-form"
              onSubmit={(e) => {
                e.preventDefault();
                handleAddCustomEntry();
              }}
            >
              <input
                type="text"
                placeholder="\lambda"
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value)}
                className="notation-manager-custom-input symbol"
                aria-label="Symbol"
              />
              <input
                type="text"
                placeholder="Description (e.g., regularization weight)"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className="notation-manager-custom-input"
                aria-label="Description"
              />
              <button
                type="submit"
                className="notation-manager-custom-add"
                disabled={!newSymbol.trim()}
              >
                <Plus size={13} /> Add
              </button>
            </form>
            {customEntries.length > 0 ? (
              <div className="notation-manager-custom-list">
                {customEntries.map((entry, i) => (
                  <div key={i} className="notation-manager-custom-item">
                    <code className="notation-manager-custom-symbol">
                      {entry.symbol}
                    </code>
                    <span className="notation-manager-custom-desc">
                      {entry.description || <em>No description</em>}
                    </span>
                    <button
                      className="notation-manager-icon-btn"
                      onClick={() => void handleCopy(definitionFor(entry.symbol))}
                      title="Copy \newcommand definition"
                    >
                      <Copy size={13} />
                    </button>
                  </div>
                ))}
                <button
                  className="notation-manager-clear-btn"
                  onClick={() => setCustomEntries([])}
                >
                  <Trash2 size={12} /> Clear all
                </button>
              </div>
            ) : (
              <div className="notation-manager-empty">
                <strong>No custom notation yet</strong>
                <span>
                  Keep track of the symbols your paper uses and copy their definitions.
                </span>
              </div>
            )}
          </div>
        ) : null}

        {toast && (
          <div className="notation-manager-toast" role="status">
            <Check size={13} /> {toast}
          </div>
        )}
      </section>
    </div>
  );
}
