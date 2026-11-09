import { matchBrace, readCommand } from "./latexSyntax";

/**
 * Inline LaTeX ⇄ editable HTML for the visual editor.
 *
 * Formatting the writer can change (bold, italic, underline, code, super- and
 * subscript, links) becomes ordinary editable elements, so it behaves like a
 * word processor. Everything else (citations, references, math, footnotes,
 * unknown commands, comments) becomes an atomic token that carries its exact
 * LaTeX in `data-latex` and is written back unchanged.
 */

const nbsp = String.fromCharCode(0xa0);
const zeroWidth = new RegExp(
  `[${[0x200b, 0x200c, 0x200d, 0xfeff].map((code) => String.fromCharCode(code)).join("")}]`,
  "g",
);

export interface InlineRenderOptions {
  /** Renders TeX math to an image URL; null shows the TeX as text. */
  renderMath?: (tex: string, display: boolean) => string | null;
}

interface FormatSpec {
  tag: string;
  className?: string;
}

/** Commands shown as editable formatting, and the element used for each. */
export const formatCommands: Record<string, FormatSpec> = {
  textbf: { tag: "strong" },
  textit: { tag: "em" },
  emph: { tag: "em" },
  underline: { tag: "u" },
  texttt: { tag: "code" },
  textsuperscript: { tag: "sup" },
  textsubscript: { tag: "sub" },
  textsc: { tag: "span", className: "vl-smallcaps" },
};

const citeCommands = new Set([
  "cite",
  "citep",
  "citet",
  "citealp",
  "citealt",
  "citeauthor",
  "citeyear",
  "parencite",
  "textcite",
  "autocite",
  "footcite",
  "nocite",
]);
const refCommands = new Set([
  "ref",
  "eqref",
  "pageref",
  "autoref",
  "cref",
  "Cref",
  "nameref",
]);
const logos: Record<string, string> = {
  LaTeX: "LaTeX",
  TeX: "TeX",
  LaTeXe: "LaTeX2ε",
  today: "Today",
  ldots: "…",
  dots: "…",
};
const textSymbols: Record<string, string> = {
  textbackslash: "\\",
  textasciitilde: "~",
  textasciicircum: "^",
  textbar: "|",
  textless: "<",
  textgreater: ">",
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function token(kind: string, label: string, latex: string, title = latex): string {
  return `<span class="vl-token vl-token-${kind}" data-latex="${escapeHtml(
    latex,
  )}" contenteditable="false" title="${escapeHtml(title)}">${escapeHtml(label)}</span>`;
}

/** Readable text of a LaTeX argument, for a token's label. */
export function plainText(latex: string): string {
  return latex
    .replace(/\\[A-Za-z@]+\*?/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function mathToken(
  latex: string,
  tex: string,
  display: boolean,
  options: InlineRenderOptions,
): string {
  const image = options.renderMath?.(tex, display) ?? null;
  const attributes = `class="vl-token vl-token-math${display ? " is-display" : ""}" data-latex="${escapeHtml(
    latex,
  )}" data-tex="${escapeHtml(tex)}" contenteditable="false" title="${escapeHtml(tex)}"`;
  return image
    ? `<span ${attributes}><img alt="${escapeHtml(tex)}" src="${escapeHtml(image)}" draggable="false"></span>`
    : `<span ${attributes}>${escapeHtml(tex)}</span>`;
}

/** End of a `$…$` (or `$$…$$`) starting at `start`, or -1. */
function mathEnd(text: string, start: number, delimiter: string): number {
  for (let index = start + delimiter.length; index < text.length; index += 1) {
    if (text[index] === "\\") {
      index += 1;
      continue;
    }
    if (text.startsWith(delimiter, index)) {
      // A single $ must not be the start of $$.
      if (delimiter === "$" && text[index + 1] === "$") return -1;
      return index;
    }
  }
  return -1;
}

export function latexInlineToHtml(
  text: string,
  options: InlineRenderOptions = {},
): string {
  let html = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index];

    if (char === "\\") {
      const next = text[index + 1] ?? "";
      if ("%&#_${}".includes(next) && next) {
        html += escapeHtml(next);
        index += 2;
        continue;
      }
      if (next === "\\") {
        const after = text.slice(index + 2).match(/^\*?(?:\[[^\]]*\])?/)?.[0] ?? "";
        const latex = text.slice(index, index + 2 + after.length);
        html += token("linebreak", "↵", latex, "Line break");
        index += latex.length;
        continue;
      }
      if (next === "(" || next === "[") {
        const closer = next === "(" ? "\\)" : "\\]";
        const end = text.indexOf(closer, index + 2);
        if (end !== -1) {
          const latex = text.slice(index, end + 2);
          html += mathToken(latex, text.slice(index + 2, end), next === "[", options);
          index = end + 2;
          continue;
        }
      }
      if (!/[A-Za-z@]/.test(next)) {
        // Control symbols: \, \; \  \@ \- \/ and friends.
        const latex = text.slice(index, index + 2);
        html += token("symbol", next.trim() ? latex : "␣", latex, "Spacing");
        index += latex.length;
        continue;
      }

      const command = readCommand(text, index);
      if (!command) {
        // An argument never closes: keep the rest exactly as written.
        const latex = text.slice(index);
        html += token("command", plainText(latex) || "LaTeX", latex);
        index = text.length;
        continue;
      }
      const latex = text.slice(index, command.end);
      const { name, args, options: optionalArgs } = command;

      const format = formatCommands[name];
      if (format && args.length === 1 && !command.star && !optionalArgs.length) {
        const className = format.className ? ` class="${format.className}"` : "";
        html += `<${format.tag}${className} data-cmd="${name}">${latexInlineToHtml(
          args[0],
          options,
        )}</${format.tag}>`;
        index = command.end;
        continue;
      }
      if (name === "href" && args.length === 2 && !optionalArgs.length) {
        html += `<a data-cmd="href" href="${escapeHtml(args[0])}">${latexInlineToHtml(
          args[1],
          options,
        )}</a>`;
        index = command.end;
        continue;
      }
      if (name in textSymbols && args.length <= 1 && !args[0]) {
        // \textbackslash or \textbackslash{}: shown as the character itself.
        html += token("symbol", textSymbols[name], latex, latex);
        index = command.end;
        continue;
      }
      if (citeCommands.has(name)) {
        const keys = (args[args.length - 1] ?? "")
          .split(",")
          .map((key) => key.trim())
          .filter(Boolean)
          .join(", ");
        html += token("citation", keys ? `[${keys}]` : "[citation]", latex);
      } else if (refCommands.has(name)) {
        html += token("reference", args[0] ? `#${args[0]}` : "reference", latex);
      } else if (name === "label") {
        html += token("label", args[0] ? `label ${args[0]}` : "label", latex);
      } else if (name === "url") {
        html += token("link", args[0] || "link", latex);
      } else if (name === "footnote") {
        html += token(
          "footnote",
          "note",
          latex,
          plainText(args[0] ?? "") || "Footnote",
        );
      } else if (name in logos && !args.length) {
        html += token("logo", logos[name], latex);
      } else {
        const label = args.length ? plainText(args[args.length - 1]) : "";
        html += token("command", label || `\\${name}`, latex);
      }
      index = command.end;
      continue;
    }

    if (char === "$") {
      const delimiter = text[index + 1] === "$" ? "$$" : "$";
      const end = mathEnd(text, index, delimiter);
      if (end !== -1) {
        const latex = text.slice(index, end + delimiter.length);
        html += mathToken(
          latex,
          text.slice(index + delimiter.length, end),
          delimiter === "$$",
          options,
        );
        index = end + delimiter.length;
        continue;
      }
      // An unmatched $ is kept exactly, not turned into a literal dollar.
      html += token("symbol", "$", "$", "Unmatched $");
      index += 1;
      continue;
    }

    if (char === "%") {
      const newline = text.indexOf("\n", index);
      const end = newline === -1 ? text.length : newline;
      const latex = text.slice(index, end);
      html += token("comment", "%", latex, latex.slice(1).trim() || "Comment");
      index = end;
      continue;
    }

    if (char === "{") {
      const end = matchBrace(text, index);
      const latex = end === -1 ? text.slice(index) : text.slice(index, end + 1);
      html += token("group", plainText(latex) || "{}", latex);
      index += latex.length;
      continue;
    }

    if (char === "~") {
      // A tie from the source stays a tie; spaces the browser types as
      // non-breaking are written back as ordinary spaces.
      html += `<span class="vl-token vl-token-tie" data-latex="~" contenteditable="false" title="Non-breaking space">${nbsp}</span>`;
      index += 1;
      continue;
    }

    html += escapeHtml(char);
    index += 1;
  }
  return html;
}

/** Plain text typed by the writer, escaped so LaTeX prints it as written. */
export function escapeLatexText(value: string): string {
  return value
    .replace(zeroWidth, "")
    .replace(/[\\{}$%&#_~^]/g, (match) => {
      switch (match) {
        case "\\":
          return "\\textbackslash{}";
        case "~":
          return "\\textasciitilde{}";
        case "^":
          return "\\textasciicircum{}";
        default:
          return `\\${match}`;
      }
    })
    .split(nbsp)
    .join(" ");
}

const tagCommands: Record<string, string> = {
  STRONG: "textbf",
  B: "textbf",
  EM: "textit",
  I: "textit",
  U: "underline",
  CODE: "texttt",
  TT: "texttt",
  KBD: "texttt",
  SUP: "textsuperscript",
  SUB: "textsubscript",
};

function wrap(command: string, inner: string): string {
  return inner ? `\\${command}{${inner}}` : "";
}

/** Commands implied by inline styles (what browsers produce in some edits). */
function styleCommands(element: HTMLElement): string[] {
  const style = element.style;
  if (!style) return [];
  const commands: string[] = [];
  if (style.fontWeight === "bold" || Number(style.fontWeight) >= 600)
    commands.push("textbf");
  if (style.fontStyle === "italic") commands.push("textit");
  if (
    /underline/.test(style.textDecoration ?? "") ||
    /underline/.test(style.textDecorationLine ?? "")
  ) {
    commands.push("underline");
  }
  if (style.verticalAlign === "super") commands.push("textsuperscript");
  if (style.verticalAlign === "sub") commands.push("textsubscript");
  return commands;
}

/** True when `node` is a <br> the browser keeps only to hold an empty line open. */
function isPlaceholderBreak(node: Node): boolean {
  let next = node.nextSibling;
  while (next) {
    if (next.nodeType !== Node.TEXT_NODE || (next.textContent ?? "").trim())
      return false;
    next = next.nextSibling;
  }
  return true;
}

export function serializeInlineNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeLatexText(node.textContent ?? "");
  if (!(node instanceof HTMLElement)) return "";
  const latex = node.dataset.latex;
  if (latex !== undefined) return latex;
  if (node.tagName === "BR") return isPlaceholderBreak(node) ? "" : "\\\\\n";
  if (node.tagName === "IMG" || node.tagName === "SCRIPT" || node.tagName === "STYLE") {
    return "";
  }
  const inner = serializeInlineChildren(node);
  if (node.tagName === "DIV" || node.tagName === "P") {
    // A line the browser wrapped in its own element inside a paragraph.
    return node.previousSibling ? `\n${inner}` : inner;
  }
  if (node.tagName === "A") {
    const href = node.getAttribute("href") ?? "";
    return href ? `\\href{${href}}{${inner}}` : inner;
  }
  const declared = node.dataset.cmd;
  if (declared && declared !== "href" && formatCommands[declared]) {
    return wrap(declared, inner);
  }
  const fromTag = tagCommands[node.tagName];
  if (fromTag) return wrap(fromTag, inner);
  return styleCommands(node).reduceRight((text, command) => wrap(command, text), inner);
}

export function serializeInlineChildren(root: Node): string {
  return Array.from(root.childNodes).map(serializeInlineNode).join("");
}
