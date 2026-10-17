import React from "react";
import {
  ArrowRight,
  BookOpen,
  ChartColumn,
  FileText,
  ListChecks,
  PenLine,
  Puzzle,
  Workflow,
} from "lucide-react";
import type {
  ExtensionCategory,
  LatexDoExtensionManifest,
  LatexDoExtensionSnippet,
} from "../extensions";

/*
 * What an extension does, shown rather than told: an animated preview built
 * from the extension's own contents (its template, its snippets, the tool it
 * adds), so every extension has one without hosting any image.
 */

const categoryIcons: Record<ExtensionCategory, typeof Puzzle> = {
  writing: PenLine,
  checking: ListChecks,
  bibliography: BookOpen,
  graphics: ChartColumn,
  templates: FileText,
  workflow: Workflow,
};

/** The colored tile shown beside an extension in the list. */
export function ExtensionIcon({
  extension,
  size = 20,
}: {
  extension: LatexDoExtensionManifest;
  size?: number;
}) {
  const Icon = categoryIcons[extension.category] ?? Puzzle;
  return (
    <span
      className={`extension-icon extension-icon-${extension.category}`}
      aria-hidden="true"
    >
      <Icon size={size} />
    </span>
  );
}

export interface TemplateLayout {
  title: string;
  shape: "paper" | "poster" | "slides" | "cv";
  twoColumn: boolean;
  sections: string[];
  hasAbstract: boolean;
  hasTable: boolean;
  hasFigure: boolean;
  hasReferences: boolean;
}

function stripLatex(text: string): string {
  return text
    .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?/g, "")
    .replace(/[{}~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Reads a template's .tex source for what its first page looks like. */
export function templateLayout(mainTex: string): TemplateLayout {
  const documentClass = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/.exec(
    mainTex,
  );
  const options = documentClass?.[1] ?? "";
  const className = documentClass?.[2] ?? "";
  const shape: TemplateLayout["shape"] = /beamer/.test(className)
    ? "slides"
    : /poster|a0poster|tikzposter|baposter/.test(className + options)
      ? "poster"
      : /moderncv|\bcv\b|resume/i.test(className + mainTex.slice(0, 600))
        ? "cv"
        : "paper";
  const twoColumn =
    /twocolumn|conference|sigconf|IEEEtran|acmart/.test(options + className) ||
    /\\twocolumn\b/.test(mainTex);
  const title = stripLatex(
    /\\title\s*(?:\[[^\]]*\])?\s*\{([^\n]*)\}/.exec(mainTex)?.[1] ?? "",
  );
  const sections = [...mainTex.matchAll(/\\(?:section|cvsection)\*?\{([^}]*)\}/g)]
    .map((match) => stripLatex(match[1]!))
    .filter(Boolean)
    .slice(0, 5);
  return {
    title: title || "Untitled",
    shape,
    twoColumn,
    sections,
    hasAbstract: /\\begin\{abstract\}/.test(mainTex),
    hasTable: /\\begin\{(table|tabular)/.test(mainTex),
    hasFigure: /\\begin\{figure|\\includegraphics|tikzpicture/.test(mainTex),
    hasReferences: /\\bibliography\{|\\printbibliography|thebibliography/.test(mainTex),
  };
}

/** A snippet's text as it appears once inserted: placeholders filled in. */
export function snippetPreviewText(insertText: string): string {
  return insertText
    .replace(/\$\{\d+:((?:\\.|[^}\\])*)\}/g, "$1")
    .replace(/\$\{\d+\}|\$\d+/g, "")
    .replace(/\\([}$\\])/g, "$1");
}

function Lines({ count, delay = 0 }: { count: number; delay?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <span
          key={index}
          className="xp-line"
          style={
            {
              "--xp-delay": `${delay + index * 0.12}s`,
              width: `${index === count - 1 ? 62 : 88 + ((index * 7) % 12)}%`,
            } as React.CSSProperties
          }
        />
      ))}
    </>
  );
}

function TemplatePreview({ mainTex }: { mainTex: string }) {
  const layout = templateLayout(mainTex);
  const sections = layout.sections.length
    ? layout.sections
    : ["Introduction", "Method"];
  const column = (offset: number, names: string[]) => (
    <div className="xp-column">
      {names.map((name, index) => (
        <div key={name + index} className="xp-section">
          <strong
            style={{ "--xp-delay": `${offset + index * 0.5}s` } as React.CSSProperties}
          >
            {name}
          </strong>
          <Lines count={3} delay={offset + index * 0.5 + 0.1} />
        </div>
      ))}
      {layout.hasTable && offset > 0 ? (
        <div
          className="xp-table"
          style={{ "--xp-delay": "2.2s" } as React.CSSProperties}
        >
          {Array.from({ length: 9 }, (_, index) => (
            <span key={index} />
          ))}
        </div>
      ) : null}
      {layout.hasFigure && offset === 0 ? (
        <div
          className="xp-figure"
          style={{ "--xp-delay": "1.8s" } as React.CSSProperties}
        >
          <span />
          <span />
          <span />
        </div>
      ) : null}
    </div>
  );
  const half = Math.ceil(sections.length / 2);
  return (
    <div className={`xp-page xp-page-${layout.shape}`} aria-hidden="true">
      <div className="xp-title">{layout.title}</div>
      <div className="xp-authors">
        <span />
        <span />
      </div>
      {layout.hasAbstract ? (
        <div className="xp-abstract">
          <em>Abstract</em>
          <Lines count={2} delay={0.3} />
        </div>
      ) : null}
      <div
        className={`xp-body ${layout.twoColumn || layout.shape === "poster" ? "two" : ""}`}
      >
        {layout.twoColumn || layout.shape === "poster"
          ? [column(0, sections.slice(0, half)), column(1, sections.slice(half))]
          : column(0, sections)}
      </div>
      {layout.hasReferences ? (
        <div className="xp-references">
          <em>References</em>
          <Lines count={2} delay={2.6} />
        </div>
      ) : null}
    </div>
  );
}

/** Types each snippet's trigger, then shows what it expands to. */
function SnippetPreview({
  snippets,
}: {
  snippets: readonly LatexDoExtensionSnippet[];
}) {
  const [index, setIndex] = React.useState(0);
  React.useEffect(() => {
    if (snippets.length < 2) return;
    const timer = window.setInterval(
      () => setIndex((value) => (value + 1) % snippets.length),
      4200,
    );
    return () => window.clearInterval(timer);
  }, [snippets.length]);
  const snippet = snippets[index]!;
  const expanded = snippetPreviewText(snippet.insertText).split("\n").slice(0, 9);
  return (
    <div className="xp-editor" aria-hidden="true">
      <div className="xp-editor-bar">
        <span />
        <span />
        <span />
        <em>main.tex</em>
      </div>
      <div className="xp-editor-body" key={snippet.label}>
        <div className="xp-trigger">
          <code
            className="xp-typed"
            style={{ "--xp-chars": snippet.label.length } as React.CSSProperties}
          >
            {snippet.label}
          </code>
          <kbd>Tab</kbd>
        </div>
        <pre className="xp-expanded">
          {expanded.map((line, lineIndex) => (
            <span
              key={lineIndex}
              style={
                { "--xp-delay": `${1.1 + lineIndex * 0.12}s` } as React.CSSProperties
              }
            >
              {line || " "}
            </span>
          ))}
        </pre>
      </div>
      {snippets.length > 1 ? (
        <div className="xp-dots">
          {snippets.map((item, dotIndex) => (
            <span key={item.label} className={dotIndex === index ? "on" : ""} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A diagram on the left becomes TikZ code on the right. */
function ConverterPreview() {
  const code = [
    "\\begin{tikzpicture}",
    "  \\node[box] (a) {Input};",
    "  \\node[box, right=of a] (b) {Model};",
    "  \\node[box, right=of b] (c) {Output};",
    "  \\draw[->] (a) -- (b);",
    "  \\draw[->] (b) -- (c);",
    "\\end{tikzpicture}",
  ];
  return (
    <div className="xp-convert" aria-hidden="true">
      <div className="xp-diagram">
        <span className="xp-node">Input</span>
        <span className="xp-edge" />
        <span className="xp-node">Model</span>
        <span className="xp-edge" />
        <span className="xp-node">Output</span>
      </div>
      <ArrowRight className="xp-convert-arrow" size={22} />
      <pre className="xp-code">
        {code.map((line, index) => (
          <span
            key={index}
            style={{ "--xp-delay": `${0.8 + index * 0.18}s` } as React.CSSProperties}
          >
            {line}
          </span>
        ))}
      </pre>
    </div>
  );
}

function ChecksPreview({ labels }: { labels: string[] }) {
  return (
    <ul className="xp-checks" aria-hidden="true">
      {labels.slice(0, 6).map((label, index) => (
        <li
          key={label}
          style={{ "--xp-delay": `${0.3 + index * 0.35}s` } as React.CSSProperties}
        >
          <span className="xp-tick">✓</span>
          {label}
        </li>
      ))}
    </ul>
  );
}

function flagLabel(flag: string): string {
  return flag
    .replace(/Enabled$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (first) => first.toUpperCase());
}

/** The animated preview at the top of an extension's page. */
export function ExtensionPreview({
  extension,
}: {
  extension: LatexDoExtensionManifest;
}) {
  const { templates, snippets, featureFlags } = extension.contributes;
  const flags = Object.keys(featureFlags ?? {});
  let content: React.ReactNode;
  let caption: string;
  if (templates?.length) {
    content = <TemplatePreview mainTex={templates[0]!.mainTex} />;
    caption = `The first page of “${templates[0]!.name}”`;
  } else if (featureFlags?.tikzConverterEnabled) {
    content = <ConverterPreview />;
    caption = "A diagram becomes editable TikZ code";
  } else if (snippets?.length) {
    content = <SnippetPreview snippets={snippets} />;
    caption = "Type a shortcut, press Tab, get the code";
  } else if (flags.length) {
    content = <ChecksPreview labels={flags.map(flagLabel)} />;
    caption = "What it checks in your paper";
  } else {
    return null;
  }
  return (
    <figure className="extension-preview" aria-label={`Preview: ${caption}`}>
      <div className="extension-preview-stage">{content}</div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
