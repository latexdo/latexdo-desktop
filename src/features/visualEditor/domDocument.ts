import {
  abstractSource,
  headingCommands,
  headingSource,
  islandKinds,
  listSource,
  parseDocument,
  type DocBlock,
  type HeadingCommand,
  type ListEnvironment,
  type ListNode,
} from "./documentModel";
import {
  escapeHtml,
  escapeLatexText,
  latexInlineToHtml,
  serializeInlineChildren,
  type InlineRenderOptions,
} from "./inlineLatex";

/**
 * The editable page: blocks rendered into one contentEditable element, and
 * that element read back as LaTeX. Elements made from the source remember
 * the block they came from; while their HTML is unchanged the original source
 * is written back exactly.
 */

interface ElementMeta {
  block: DocBlock;
  html: string;
}

const elementMeta = new WeakMap<Element, ElementMeta>();
const headingMeta = new WeakMap<
  Element,
  { star: boolean; label: string; command: HeadingCommand }
>();
const listMeta = new WeakMap<
  Element,
  { environment: ListEnvironment; options: string; indent: string }
>();
const itemLabels = new WeakMap<Element, string>();

/** Separator for blocks the writer creates: a blank line, as LaTeX expects. */
export const newBlockSeparator = "\n\n";

const headingTags: Record<HeadingCommand, string> = {
  chapter: "H1",
  section: "H2",
  subsection: "H3",
  subsubsection: "H4",
  paragraph: "H5",
};
const tagHeadings: Record<string, HeadingCommand> = {
  H1: "chapter",
  H2: "section",
  H3: "subsection",
  H4: "subsubsection",
  H5: "paragraph",
  H6: "paragraph",
};

export function headingTag(command: HeadingCommand): string {
  return headingTags[command];
}

export function headingCommandForTag(tag: string): HeadingCommand | null {
  return tagHeadings[tag.toUpperCase()] ?? null;
}

export function createIsland(kind: string, source: string): HTMLElement {
  const element = document.createElement("div");
  element.className = `vl-island vl-island-${kind}`;
  element.dataset.kind = kind;
  element.dataset.source = source;
  element.contentEditable = "false";
  return element;
}

export function islandHtml(kind: string, source: string): string {
  return `<div class="vl-island vl-island-${kind}" data-kind="${kind}" data-source="${escapeHtml(
    source,
  )}" contenteditable="false"></div>`;
}

function inlineRoundTrips(latex: string, options: InlineRenderOptions): string | null {
  const probe = document.createElement("p");
  const html = latexInlineToHtml(latex, options);
  probe.innerHTML = html;
  return serializeInlineChildren(probe) === latex ? html : null;
}

function buildList(list: ListNode, options: InlineRenderOptions): HTMLElement | null {
  const element = document.createElement(
    list.environment === "enumerate" ? "ol" : "ul",
  );
  if (list.environment === "description") element.className = "vl-description";
  listMeta.set(element, {
    environment: list.environment,
    options: list.options,
    indent: list.indent,
  });
  for (const item of list.items) {
    const html = inlineRoundTrips(item.content, options);
    if (html === null) return null;
    const li = document.createElement("li");
    li.innerHTML = html;
    if (item.label !== undefined) {
      itemLabels.set(li, item.label);
      li.dataset.term = item.label;
    }
    for (const child of item.children) {
      const nested = buildList(child, options);
      if (!nested) return null;
      li.append(nested);
    }
    element.append(li);
  }
  return element;
}

/** The element for one block: editable text, or an island for objects. */
export function renderBlock(
  block: DocBlock,
  options: InlineRenderOptions,
): HTMLElement {
  const data = block.data;
  let element: HTMLElement | null = null;
  if (data.kind === "paragraph") {
    const html = inlineRoundTrips(data.text, options);
    if (html !== null) {
      element = document.createElement("p");
      element.innerHTML = html;
    }
  } else if (data.kind === "heading") {
    const html = inlineRoundTrips(data.text, options);
    if (html !== null) {
      element = document.createElement(headingTags[data.command]);
      element.innerHTML = html;
      headingMeta.set(element, {
        star: data.star,
        label: data.label,
        command: data.command,
      });
      if (data.star) element.dataset.unnumbered = "true";
    }
  } else if (data.kind === "list") {
    element = buildList(data.list, options);
  } else if (data.kind === "abstract") {
    const paragraphs = data.paragraphs.map((text) => inlineRoundTrips(text, options));
    if (paragraphs.every((html) => html !== null)) {
      element = document.createElement("section");
      element.className = "vl-abstract";
      element.innerHTML = paragraphs.map((html) => `<p>${html}</p>`).join("");
    }
  }
  if (!element) {
    const kind = islandKinds.has(data.kind) ? data.kind : "code";
    element = createIsland(data.kind === "command" ? `command` : kind, block.source);
    if (data.kind === "command") element.dataset.command = data.command;
  }
  elementMeta.set(element, { block, html: element.innerHTML });
  return element;
}

export function renderBlocksInto(
  root: HTMLElement,
  blocks: readonly DocBlock[],
  options: InlineRenderOptions,
): void {
  root.replaceChildren(...blocks.map((block) => renderBlock(block, options)));
  if (!root.firstChild) root.append(emptyParagraph());
}

export function emptyParagraph(): HTMLElement {
  const paragraph = document.createElement("p");
  paragraph.append(document.createElement("br"));
  return paragraph;
}

function isBlockElement(node: Node): node is HTMLElement {
  return (
    node instanceof HTMLElement &&
    (/^(P|DIV|H[1-6]|UL|OL|SECTION|BLOCKQUOTE|PRE|TABLE)$/.test(node.tagName) ||
      node.classList.contains("vl-island"))
  );
}

function domToList(element: HTMLElement): ListNode {
  const meta = listMeta.get(element);
  const ordered = element.tagName === "OL";
  const environment: ListEnvironment = ordered
    ? "enumerate"
    : meta?.environment === "description"
      ? "description"
      : "itemize";
  const list: ListNode = {
    environment,
    options: meta && meta.environment === environment ? meta.options : "",
    indent: meta?.indent ?? "",
    items: [],
  };
  for (const child of Array.from(element.children)) {
    if (child.tagName === "UL" || child.tagName === "OL") {
      // A list indented directly inside a list (Tab in some browsers).
      const previous = list.items[list.items.length - 1];
      const nested = domToList(child as HTMLElement);
      if (previous) previous.children.push(nested);
      else list.items.push({ content: "", children: [nested] });
      continue;
    }
    if (child.tagName !== "LI") continue;
    const inline = Array.from(child.childNodes).filter(
      (node) =>
        !(
          node instanceof HTMLElement &&
          (node.tagName === "UL" || node.tagName === "OL")
        ),
    );
    const content = inline
      .map((node) => {
        const holder = document.createElement("span");
        holder.append(node.cloneNode(true));
        return serializeInlineChildren(holder);
      })
      .join("")
      .trim();
    const children = Array.from(child.children)
      .filter((node) => node.tagName === "UL" || node.tagName === "OL")
      .map((node) => domToList(node as HTMLElement));
    list.items.push({ content, label: itemLabels.get(child), children });
  }
  if (!list.items.length) list.items.push({ content: "", children: [] });
  return list;
}

interface Piece {
  sep: string;
  source: string;
}

function serializeElement(element: HTMLElement): Piece[] {
  const meta = elementMeta.get(element);
  const sep = meta?.block.sep ?? newBlockSeparator;
  if (element.classList.contains("vl-island")) {
    const source = element.dataset.source ?? "";
    return source.trim() ? [{ sep, source }] : [];
  }
  if (meta && element.innerHTML === meta.html)
    return [{ sep, source: meta.block.source }];

  const tag = element.tagName;
  const heading = headingCommandForTag(tag);
  if (heading) {
    const text = serializeInlineChildren(element).trim();
    if (!text) return [];
    const info = headingMeta.get(element);
    // \chapter only where the document has chapters; otherwise H1 is a section.
    const command = info && headingTags[info.command] === tag ? info.command : heading;
    return [
      {
        sep,
        source: headingSource({
          kind: "heading",
          command,
          star: info?.star ?? false,
          text,
          label: info?.label ?? "",
        }),
      },
    ];
  }
  if (tag === "UL" || tag === "OL") {
    const list = domToList(element);
    return [{ sep, source: listSource(list) }];
  }
  if (tag === "SECTION" && element.classList.contains("vl-abstract")) {
    const paragraphs = Array.from(element.children)
      .map((child) => serializeInlineChildren(child).trim())
      .filter(Boolean);
    return [{ sep, source: abstractSource(paragraphs.length ? paragraphs : [""]) }];
  }
  // Containers the browser or a paste created: read their blocks in order.
  if (Array.from(element.childNodes).some(isBlockElement)) {
    const pieces = serializeNodes(Array.from(element.childNodes));
    if (pieces.length && meta) pieces[0] = { ...pieces[0], sep };
    return pieces;
  }
  const text = serializeInlineChildren(element).trim();
  return text ? [{ sep, source: text }] : [];
}

function serializeNodes(nodes: readonly Node[]): Piece[] {
  const pieces: Piece[] = [];
  let inline: Node[] = [];
  const flushInline = () => {
    const holder = document.createElement("span");
    for (const node of inline) holder.append(node.cloneNode(true));
    const text = serializeInlineChildren(holder).trim();
    if (text) pieces.push({ sep: newBlockSeparator, source: text });
    inline = [];
  };
  for (const node of nodes) {
    if (isBlockElement(node)) {
      flushInline();
      pieces.push(...serializeElement(node));
    } else if (!(node instanceof HTMLElement && node.tagName === "BR")) {
      inline.push(node);
    }
  }
  flushInline();
  return pieces;
}

/** The body's LaTeX: every block with the whitespace before it. */
export function serializeRoot(root: HTMLElement): string {
  return serializeNodes(Array.from(root.childNodes))
    .map((piece) => piece.sep + piece.source)
    .join("");
}

/**
 * Gives the element that replaces another (a style change) the original's
 * spacing, and a heading's label and number style. Its text is still read
 * from the page.
 */
export function transferBlockMeta(from: Element, to: Element): void {
  const meta = elementMeta.get(from);
  if (meta) elementMeta.set(to, { block: meta.block, html: "\u0000changed" });
  const info = headingMeta.get(from);
  const command = headingCommandForTag(to.tagName);
  if (info && command) headingMeta.set(to, { ...info, command });
}

// ---------- paste ----------

const allowedInline = new Set([
  "STRONG",
  "B",
  "EM",
  "I",
  "U",
  "SUP",
  "SUB",
  "CODE",
  "A",
  "BR",
]);
const droppedElements = new Set([
  "STYLE",
  "SCRIPT",
  "META",
  "TITLE",
  "LINK",
  "HEAD",
  "XML",
  "TEMPLATE",
  "NOSCRIPT",
]);

function safeHref(value: string | null): string | null {
  return value && /^(https?:|mailto:)/i.test(value.trim()) ? value.trim() : null;
}

function sanitizeInline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent ?? "");
  if (!(node instanceof HTMLElement)) return "";
  if (droppedElements.has(node.tagName) || node.tagName.includes(":")) {
    // Word's <o:p> and similar carry no text worth keeping.
    return node.tagName.includes(":")
      ? Array.from(node.childNodes).map(sanitizeInline).join("")
      : "";
  }
  if (node.classList.contains("vl-token") && node.dataset.latex !== undefined) {
    // A token copied from this editor keeps its LaTeX.
    return `<span class="${escapeHtml(node.className)}" data-latex="${escapeHtml(
      node.dataset.latex,
    )}" contenteditable="false" title="${escapeHtml(node.title)}">${node.innerHTML}</span>`;
  }
  const inner = Array.from(node.childNodes).map(sanitizeInline).join("");
  if (allowedInline.has(node.tagName)) {
    if (node.tagName === "BR") return "<br>";
    if (node.tagName === "A") {
      const href = safeHref(node.getAttribute("href"));
      return href ? `<a href="${escapeHtml(href)}">${inner}</a>` : inner;
    }
    const tag = node.tagName.toLowerCase();
    return inner ? `<${tag}>${inner}</${tag}>` : "";
  }
  const style = node.style;
  let wrapped = inner;
  if (style?.fontWeight === "bold" || Number(style?.fontWeight) >= 600)
    wrapped = `<b>${wrapped}</b>`;
  if (style?.fontStyle === "italic") wrapped = `<i>${wrapped}</i>`;
  if (/underline/.test(style?.textDecoration ?? "")) wrapped = `<u>${wrapped}</u>`;
  return inner ? wrapped : "";
}

function cellLatex(cell: Element): string {
  const holder = document.createElement("span");
  holder.innerHTML = Array.from(cell.childNodes).map(sanitizeInline).join("");
  return serializeInlineChildren(holder).replace(/\s+/g, " ").trim();
}

/** A pasted HTML table as a LaTeX table. */
export function htmlTableToLatex(table: HTMLTableElement): string {
  const rows = Array.from(table.rows).map((row) =>
    Array.from(row.cells).map(cellLatex),
  );
  const columns = Math.max(1, ...rows.map((row) => row.length));
  const lines = rows.map(
    (row) =>
      `    ${Array.from({ length: columns }, (_, index) => row[index] ?? "").join(" & ")} \\\\`,
  );
  // A rule under the first row reads as a header, when there is more than one.
  if (lines.length > 1) lines.splice(1, 0, "    \\hline");
  return [
    "\\begin{table}[ht]",
    "  \\centering",
    `  \\begin{tabular}{${"l".repeat(columns)}}`,
    "    \\hline",
    ...lines,
    "    \\hline",
    "  \\end{tabular}",
    "  \\caption{}",
    "\\end{table}",
  ].join("\n");
}

const headingTagFor: Record<string, string> = {
  H1: "h2",
  H2: "h3",
  H3: "h4",
  H4: "h5",
  H5: "h5",
  H6: "h5",
};

function sanitizeBlocks(nodes: readonly Node[], out: string[]): void {
  let inline = "";
  const flush = () => {
    if (inline.trim()) out.push(`<p>${inline.trim()}</p>`);
    inline = "";
  };
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) {
      inline += sanitizeInline(node);
      continue;
    }
    if (droppedElements.has(node.tagName)) continue;
    if (node.classList.contains("vl-island") && node.dataset.source !== undefined) {
      flush();
      out.push(islandHtml(node.dataset.kind ?? "code", node.dataset.source));
      continue;
    }
    if (node.tagName === "TABLE") {
      flush();
      out.push(islandHtml("table", htmlTableToLatex(node as HTMLTableElement)));
      continue;
    }
    if (headingTagFor[node.tagName]) {
      flush();
      const text = Array.from(node.childNodes).map(sanitizeInline).join("").trim();
      const tag = headingTagFor[node.tagName];
      if (text) out.push(`<${tag}>${text}</${tag}>`);
      continue;
    }
    if (node.tagName === "UL" || node.tagName === "OL") {
      flush();
      out.push(sanitizeList(node));
      continue;
    }
    if (
      /^(P|DIV|SECTION|ARTICLE|BLOCKQUOTE|PRE|LI|MAIN|HEADER|FOOTER|BODY)$/.test(
        node.tagName,
      )
    ) {
      flush();
      if (
        Array.from(node.children).some(
          (child) => isBlockElement(child) || child.tagName === "LI",
        )
      ) {
        sanitizeBlocks(Array.from(node.childNodes), out);
      } else {
        const text = Array.from(node.childNodes).map(sanitizeInline).join("").trim();
        if (text) out.push(`<p>${text}</p>`);
      }
      continue;
    }
    inline += sanitizeInline(node);
  }
  flush();
}

function sanitizeList(list: HTMLElement): string {
  const tag = list.tagName === "OL" ? "ol" : "ul";
  const items = Array.from(list.children)
    .filter((child) => child.tagName === "LI")
    .map((item) => {
      const inline = Array.from(item.childNodes)
        .filter(
          (node) => !(node instanceof HTMLElement && /^(UL|OL)$/.test(node.tagName)),
        )
        .map(sanitizeInline)
        .join("")
        .trim();
      const nested = Array.from(item.children)
        .filter((child) => /^(UL|OL)$/.test(child.tagName))
        .map((child) => sanitizeList(child as HTMLElement))
        .join("");
      return `<li>${inline}${nested}</li>`;
    });
  return `<${tag}>${items.join("") || "<li></li>"}</${tag}>`;
}

export interface PastePlan {
  html: string;
  /** True when the paste is text for the current paragraph (no new blocks). */
  inline: boolean;
}

/** Text that is LaTeX source rather than prose. */
export function looksLikeLatex(text: string): boolean {
  return /\\(?:[a-zA-Z]+\s*[{[]|begin\{|section|item\b|textbf|emph|cite|ref)|\$[^$\n]+\$/.test(
    text,
  );
}

/**
 * What to insert for a paste: formatting, paragraphs, headings, lists and
 * tables from Word or the web are kept; LaTeX source is shown as it renders.
 */
export function planPaste(
  html: string,
  text: string,
  options: InlineRenderOptions,
): PastePlan {
  if (html.trim()) {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const out: string[] = [];
    sanitizeBlocks(Array.from(parsed.body.childNodes), out);
    if (out.length === 1 && out[0].startsWith("<p>")) {
      return { html: out[0].slice(3, -4), inline: true };
    }
    if (out.length) return { html: out.join(""), inline: false };
  }
  if (!text) return { html: "", inline: true };
  if (looksLikeLatex(text)) {
    const blocks = parseDocument(text).blocks;
    if (blocks.length === 1 && blocks[0].data.kind === "paragraph") {
      return { html: latexInlineToHtml(blocks[0].data.text, options), inline: true };
    }
    const holder = document.createElement("div");
    renderBlocksInto(holder, blocks, options);
    return { html: holder.innerHTML, inline: false };
  }
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (paragraphs.length <= 1) {
    return { html: escapeHtml(paragraphs[0] ?? text), inline: true };
  }
  return {
    html: paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join(""),
    inline: false,
  };
}

function blockText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement) || node.classList.contains("vl-island")) return "";
  const inner = Array.from(node.childNodes).map(blockText).join("");
  // Separate blocks (list items, paragraphs) so their words do not run together.
  return /^(P|DIV|LI|UL|OL|H[1-6]|SECTION)$/.test(node.tagName) ? ` ${inner} ` : inner;
}

/** Words on the page, outside objects, for the status bar. */
export function countWords(root: HTMLElement): number {
  return blockText(root)
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

export { escapeLatexText, headingCommands };
