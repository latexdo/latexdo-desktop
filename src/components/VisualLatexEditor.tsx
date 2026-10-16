import { useEffect, useLayoutEffect, useRef, useState } from "react";

type HeadingCommand = "section" | "subsection" | "subsubsection" | "paragraph";
type ListEnvironment = "itemize" | "enumerate";
type MathEnvironment =
  | "equation"
  | "equation*"
  | "align"
  | "align*"
  | "gather"
  | "gather*";

export type VisualLatexBlock =
  | { type: "blank" }
  | { type: "hidden"; text: string }
  | {
      type: "heading";
      command: HeadingCommand;
      level: 1 | 2 | 3 | 4;
      starred: boolean;
      text: string;
      label: string;
    }
  | { type: "paragraph"; text: string }
  | { type: "list"; environment: ListEnvironment; items: string[] }
  | { type: "math"; environment: MathEnvironment | "display"; text: string }
  | { type: "raw"; text: string };

interface VisualLatexEditorProps {
  content: string;
  readOnly?: boolean;
  onChange: (content: string) => void;
}

const headingLevels: Record<HeadingCommand, 1 | 2 | 3 | 4> = {
  section: 1,
  subsection: 2,
  subsubsection: 3,
  paragraph: 4,
};

const listBeginPattern = /^\\begin\{(itemize|enumerate)\}\s*$/;
const mathBeginPattern = /^\\begin\{(equation\*?|align\*?|gather\*?)\}\s*$/;

export function parseLatexToVisualBlocks(content: string): VisualLatexBlock[] {
  const normalized = content.replace(/\r\n?/g, "\n");
  if (!normalized) {
    return [{ type: "paragraph", text: "" }];
  }

  const lines = normalized.split("\n");
  const blocks: VisualLatexBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      blocks.push({ type: "blank" });
      index += 1;
      continue;
    }

    const heading = parseHeadingLine(trimmed);
    if (heading) {
      blocks.push(heading);
      index += 1;
      continue;
    }

    const listMatch = trimmed.match(listBeginPattern);
    if (listMatch) {
      const { block, nextIndex } = parseListBlock(
        lines,
        index,
        listMatch[1] as ListEnvironment,
      );
      blocks.push(block);
      index = nextIndex;
      continue;
    }

    const mathMatch = trimmed.match(mathBeginPattern);
    if (mathMatch) {
      const { block, nextIndex } = parseMathEnvironment(
        lines,
        index,
        mathMatch[1] as MathEnvironment,
      );
      blocks.push(block);
      index = nextIndex;
      continue;
    }

    if (trimmed === "\\[") {
      const { block, nextIndex } = parseDisplayMathBlock(lines, index);
      blocks.push(block);
      index = nextIndex;
      continue;
    }

    if (isHiddenLatexLine(trimmed)) {
      const rawLines: string[] = [line];
      index += 1;
      while (
        index < lines.length &&
        lines[index]?.trim() &&
        isHiddenLatexLine(lines[index]!.trim()) &&
        !parseHeadingLine(lines[index]!.trim()) &&
        !listBeginPattern.test(lines[index]!.trim()) &&
        !mathBeginPattern.test(lines[index]!.trim())
      ) {
        rawLines.push(lines[index] ?? "");
        index += 1;
      }
      blocks.push({ type: "hidden", text: rawLines.join("\n") });
      continue;
    }

    const paragraphLines: string[] = [line];
    index += 1;
    while (index < lines.length) {
      const nextLine = lines[index] ?? "";
      const nextTrimmed = nextLine.trim();
      if (
        !nextTrimmed ||
        parseHeadingLine(nextTrimmed) ||
        listBeginPattern.test(nextTrimmed) ||
        mathBeginPattern.test(nextTrimmed) ||
        nextTrimmed === "\\[" ||
        isHiddenLatexLine(nextTrimmed)
      ) {
        break;
      }
      paragraphLines.push(nextLine);
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join("\n") });
  }

  return blocks;
}

export function serializeVisualLatexBlocks(
  blocks: readonly VisualLatexBlock[],
): string {
  return blocks.flatMap(blockToLines).join("\n");
}

export function VisualLatexEditor({
  content,
  readOnly = false,
  onChange,
}: VisualLatexEditorProps) {
  const [blocks, setBlocks] = useState(() => parseLatexToVisualBlocks(content));
  const serializedRef = useRef(content.replace(/\r\n?/g, "\n"));

  useEffect(() => {
    const normalized = content.replace(/\r\n?/g, "\n");
    if (normalized === serializedRef.current) {
      return;
    }
    serializedRef.current = normalized;
    setBlocks(parseLatexToVisualBlocks(normalized));
  }, [content]);

  const commitBlocks = (nextBlocks: VisualLatexBlock[]) => {
    const nextContent = serializeVisualLatexBlocks(nextBlocks);
    serializedRef.current = nextContent;
    setBlocks(nextBlocks);
    onChange(nextContent);
  };

  const updateBlock = (blockIndex: number, patch: Partial<VisualLatexBlock>) => {
    commitBlocks(
      blocks.map((block, index) =>
        index === blockIndex ? ({ ...block, ...patch } as VisualLatexBlock) : block,
      ),
    );
  };

  const updateListItem = (blockIndex: number, itemIndex: number, value: string) => {
    commitBlocks(
      blocks.map((block, index) => {
        if (index !== blockIndex || block.type !== "list") {
          return block;
        }
        const items = block.items.map((item, nextItemIndex) =>
          nextItemIndex === itemIndex ? value : item,
        );
        return { ...block, items };
      }),
    );
  };

  return (
    <div className="visual-latex-editor" aria-label="Visual LaTeX editor">
      <div className="visual-latex-page">
        {blocks.map((block, index) => {
          if (block.type === "hidden") {
            return null;
          }

          if (block.type === "blank") {
            return <div key={`blank-${index}`} className="visual-latex-spacer" />;
          }

          if (block.type === "heading") {
            return (
              <div key={`heading-${index}`} className="visual-latex-heading-row">
                <input
                  className={`visual-latex-heading level-${block.level}`}
                  aria-label={`${block.command} title`}
                  value={block.text}
                  readOnly={readOnly}
                  onChange={(event) =>
                    updateBlock(index, { text: event.currentTarget.value })
                  }
                />
                {block.label ? (
                  <span className="visual-latex-label">{block.label}</span>
                ) : null}
              </div>
            );
          }

          if (block.type === "paragraph") {
            return (
              <VisualInlineEditor
                key={`paragraph-${index}`}
                className="visual-latex-paragraph"
                aria-label="Paragraph"
                value={block.text}
                readOnly={readOnly}
                onChange={(value) => updateBlock(index, { text: value })}
              />
            );
          }

          if (block.type === "list") {
            const ListTag = block.environment === "enumerate" ? "ol" : "ul";
            return (
              <ListTag key={`list-${index}`} className="visual-latex-list">
                {block.items.map((item, itemIndex) => (
                  <li key={`${index}-${itemIndex}`}>
                    <VisualInlineEditor
                      className="visual-latex-list-item"
                      aria-label="List item"
                      value={item}
                      readOnly={readOnly}
                      onChange={(value) => updateListItem(index, itemIndex, value)}
                    />
                  </li>
                ))}
              </ListTag>
            );
          }

          if (block.type === "math") {
            return (
              <textarea
                key={`math-${index}`}
                className="visual-latex-math"
                aria-label="Equation"
                value={block.text}
                readOnly={readOnly}
                rows={Math.max(2, textareaRows(block.text))}
                onChange={(event) =>
                  updateBlock(index, { text: event.currentTarget.value })
                }
              />
            );
          }

          return (
            <div
              key={`raw-${index}`}
              className="visual-latex-preserved"
              aria-label="Advanced LaTeX preserved in source"
            >
              <span aria-hidden="true">OK</span>
              <span>Advanced LaTeX preserved in source</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VisualInlineEditor({
  className,
  value,
  readOnly,
  onChange,
  "aria-label": ariaLabel,
}: {
  className: string;
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
  "aria-label": string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.dataset.source === value) {
      return;
    }
    editor.innerHTML = latexInlineToHtml(value);
    editor.dataset.source = value;
  }, [value]);

  return (
    <div
      ref={editorRef}
      className={className}
      aria-label={ariaLabel}
      role="textbox"
      contentEditable={!readOnly}
      suppressContentEditableWarning
      onInput={(event) => {
        const nextValue = serializeInlineDom(event.currentTarget);
        event.currentTarget.dataset.source = nextValue;
        onChange(nextValue);
      }}
      onPaste={(event) => {
        event.preventDefault();
        const text = event.clipboardData.getData("text/plain");
        insertPlainTextAtSelection(text);
      }}
    />
  );
}

function parseHeadingLine(line: string): VisualLatexBlock | null {
  const match = line.match(
    /^\\(section|subsection|subsubsection|paragraph)(\*)?\{([^{}]*)\}(?:\s*\\label\{([^}]*)\})?\s*$/,
  );
  if (!match) {
    return null;
  }
  const command = match[1] as HeadingCommand;
  return {
    type: "heading",
    command,
    level: headingLevels[command],
    starred: Boolean(match[2]),
    text: match[3] ?? "",
    label: match[4] ?? "",
  };
}

function parseListBlock(
  lines: readonly string[],
  startIndex: number,
  environment: ListEnvironment,
): { block: VisualLatexBlock; nextIndex: number } {
  const items: string[] = [];
  let currentItem: string[] | null = null;
  let index = startIndex + 1;

  for (; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (trimmed === `\\end{${environment}}`) {
      if (currentItem) {
        items.push(currentItem.join("\n"));
      }
      return {
        block: { type: "list", environment, items: items.length ? items : [""] },
        nextIndex: index + 1,
      };
    }

    const itemMatch = line.match(/^\s*\\item(?:\s+(.*))?$/);
    if (itemMatch) {
      if (currentItem) {
        items.push(currentItem.join("\n"));
      }
      currentItem = [itemMatch[1] ?? ""];
      continue;
    }

    if (currentItem) {
      currentItem.push(line.replace(/^\s{0,4}/, ""));
    }
  }

  return {
    block: { type: "raw", text: lines.slice(startIndex).join("\n") },
    nextIndex: lines.length,
  };
}

function parseMathEnvironment(
  lines: readonly string[],
  startIndex: number,
  environment: MathEnvironment,
): { block: VisualLatexBlock; nextIndex: number } {
  const content: string[] = [];
  let index = startIndex + 1;
  for (; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === `\\end{${environment}}`) {
      return {
        block: { type: "math", environment, text: content.join("\n") },
        nextIndex: index + 1,
      };
    }
    content.push(line);
  }
  return {
    block: { type: "raw", text: lines.slice(startIndex).join("\n") },
    nextIndex: lines.length,
  };
}

function parseDisplayMathBlock(
  lines: readonly string[],
  startIndex: number,
): { block: VisualLatexBlock; nextIndex: number } {
  const content: string[] = [];
  let index = startIndex + 1;
  for (; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "\\]") {
      return {
        block: { type: "math", environment: "display", text: content.join("\n") },
        nextIndex: index + 1,
      };
    }
    content.push(line);
  }
  return {
    block: { type: "raw", text: lines.slice(startIndex).join("\n") },
    nextIndex: lines.length,
  };
}

function isHiddenLatexLine(line: string): boolean {
  if (line.startsWith("%")) {
    return true;
  }
  return /^\\(documentclass|usepackage|begin|end|title|author|date|maketitle|bibliography|bibliographystyle|input|include|label|newcommand|renewcommand|def)\b/.test(
    line,
  );
}

function blockToLines(block: VisualLatexBlock): string[] {
  if (block.type === "blank") {
    return [""];
  }
  if (block.type === "hidden") {
    return block.text.split("\n");
  }
  if (block.type === "heading") {
    return [
      `\\${block.command}${block.starred ? "*" : ""}{${block.text}}${
        block.label ? `\\label{${block.label}}` : ""
      }`,
    ];
  }
  if (block.type === "paragraph" || block.type === "raw") {
    return block.text.split("\n");
  }
  if (block.type === "list") {
    return [
      `\\begin{${block.environment}}`,
      ...block.items.flatMap((item) => {
        const [firstLine = "", ...rest] = item.split("\n");
        return [`  \\item ${firstLine}`, ...rest.map((line) => `  ${line}`)];
      }),
      `\\end{${block.environment}}`,
    ];
  }
  if (block.environment === "display") {
    return ["\\[", ...block.text.split("\n"), "\\]"];
  }
  return [
    `\\begin{${block.environment}}`,
    ...block.text.split("\n"),
    `\\end{${block.environment}}`,
  ];
}

function textareaRows(value: string): number {
  return Math.max(1, value.split("\n").length);
}

const citationInlinePattern =
  /^\\(?:cite|citep|citet|citealp|parencite|textcite|autocite|footcite)\*?(?:\[[^\]]*\])*\{([^}]*)\}/;
const referenceInlinePattern = /^\\(?:ref|eqref|pageref)\{([^}]*)\}/;
const labelInlinePattern = /^\\label\{([^}]*)\}/;
const hrefInlinePattern = /^\\href\{([^}]*)\}\{([^}]*)\}/;
const urlInlinePattern = /^\\url\{([^}]*)\}/;
const formattedInlinePattern =
  /^\\(textbf|textit|emph|texttt|textsuperscript|textsubscript)\{([^}]*)\}/;

function latexInlineToHtml(value: string): string {
  let html = "";
  let index = 0;
  while (index < value.length) {
    const rest = value.slice(index);

    if (rest.startsWith("{\\LaTeX}") || rest.startsWith("\\LaTeX{}")) {
      const latex = rest.startsWith("{\\LaTeX}") ? "{\\LaTeX}" : "\\LaTeX{}";
      html += tokenHtml("latex", "LaTeX", latex);
      index += latex.length;
      continue;
    }

    if (rest.startsWith("\\LaTeX")) {
      html += tokenHtml("latex", "LaTeX", "\\LaTeX");
      index += "\\LaTeX".length;
      continue;
    }

    const math = rest.match(/^\$([^$\n]+)\$/);
    if (math) {
      html += tokenHtml("math", math[1] ?? "", math[0]);
      index += math[0].length;
      continue;
    }

    const cite = rest.match(citationInlinePattern);
    if (cite) {
      const keys = (cite[1] ?? "")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean)
        .join(", ");
      html += tokenHtml("citation", keys ? `[${keys}]` : "[citation]", cite[0]);
      index += cite[0].length;
      continue;
    }

    const ref = rest.match(referenceInlinePattern);
    if (ref) {
      html += tokenHtml("reference", ref[1] ? `#${ref[1]}` : "reference", ref[0]);
      index += ref[0].length;
      continue;
    }

    const label = rest.match(labelInlinePattern);
    if (label) {
      html += tokenHtml("label", label[1] ? `label ${label[1]}` : "label", label[0]);
      index += label[0].length;
      continue;
    }

    const href = rest.match(hrefInlinePattern);
    if (href) {
      html += tokenHtml("link", href[2] || href[1] || "link", href[0]);
      index += href[0].length;
      continue;
    }

    const url = rest.match(urlInlinePattern);
    if (url) {
      html += tokenHtml("link", url[1] || "link", url[0]);
      index += url[0].length;
      continue;
    }

    const formatted = rest.match(formattedInlinePattern);
    if (formatted) {
      const command = formatted[1] ?? "";
      const text = formatted[2] ?? "";
      const tag =
        command === "textbf"
          ? "strong"
          : command === "textit" || command === "emph"
            ? "em"
            : command === "textsuperscript"
              ? "sup"
              : command === "textsubscript"
                ? "sub"
                : "code";
      html += `<${tag} class="visual-latex-inline-format" data-latex="${escapeAttribute(
        formatted[0],
      )}" contenteditable="false">${escapeHtml(text)}</${tag}>`;
      index += formatted[0].length;
      continue;
    }

    const escaped = rest.match(/^\\([%&#_$])/);
    if (escaped) {
      html += escapeHtml(escaped[1] ?? "");
      index += escaped[0].length;
      continue;
    }

    const char = value[index] ?? "";
    html += escapeHtml(char === "~" ? " " : char);
    index += 1;
  }
  return html;
}

function tokenHtml(kind: string, label: string, latex: string): string {
  return `<span class="visual-latex-token token-${kind}" data-latex="${escapeAttribute(
    latex,
  )}" contenteditable="false">${escapeHtml(label)}</span>`;
}

function serializeInlineDom(root: HTMLElement): string {
  return Array.from(root.childNodes).map(serializeInlineNode).join("");
}

function serializeInlineNode(node: ChildNode): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeLatexText(node.textContent ?? "");
  }
  if (!(node instanceof HTMLElement)) {
    return "";
  }
  const latex = node.dataset.latex;
  if (latex) {
    return latex;
  }
  if (node.tagName === "BR") {
    return "\n";
  }
  if (node.tagName === "DIV" || node.tagName === "P") {
    const content = Array.from(node.childNodes).map(serializeInlineNode).join("");
    return content ? `\n${content}` : "\n";
  }
  return Array.from(node.childNodes).map(serializeInlineNode).join("");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function escapeLatexText(value: string): string {
  return value.replace(/[\\%&#_$]/g, (match) => {
    switch (match) {
      case "\\":
        return "\\textbackslash{}";
      case "%":
      case "&":
      case "#":
      case "_":
      case "$":
        return `\\${match}`;
      default:
        return match;
    }
  });
}

function insertPlainTextAtSelection(text: string): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }
  selection.deleteFromDocument();
  selection.getRangeAt(0).insertNode(document.createTextNode(text));
  selection.collapseToEnd();
}
