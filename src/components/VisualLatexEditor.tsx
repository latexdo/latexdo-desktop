import {
  Bold,
  BookMarked,
  Code,
  FileText,
  Hash,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Redo2,
  RemoveFormatting,
  SeparatorHorizontal,
  Sigma,
  SquareFunction,
  StickyNote,
  Subscript,
  Superscript,
  Table2,
  Underline,
  Undo2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { mathPreviewDataUri } from "../latex/mathPreview";
import { blockTemplates, parseDocument } from "../features/visualEditor/documentModel";
import {
  countWords,
  createIsland,
  headingCommandForTag,
  planPaste,
  renderBlock,
  renderBlocksInto,
  serializeRoot,
  transferBlockMeta,
} from "../features/visualEditor/domDocument";
import {
  escapeHtml,
  escapeLatexText,
  mathToken,
  type InlineRenderOptions,
} from "../features/visualEditor/inlineLatex";
import {
  islandComponents,
  type IslandContext,
  type LoadedImage,
} from "./visualEditor/VisualIslands";

export type { LoadedImage };

export interface VisualLatexEditorProps {
  content: string;
  readOnly?: boolean;
  onChange: (content: string) => void;
  /** Loads an \includegraphics path for display. */
  loadImage?: (path: string) => Promise<LoadedImage | null>;
  /** Copies dropped or chosen image files into the project; returns their paths. */
  importImages?: (files: File[]) => Promise<string[]>;
  /** LaTeX for a file dragged from the project tree (an image becomes a figure). */
  latexForProjectFile?: (draggedPath: string) => string | null;
  /** LaTeX for a new figure showing the image at `path`. */
  figureSource?: (path: string) => string;
}

interface IslandEntry {
  element: HTMLElement;
  key: string;
  kind: string;
}

type PromptKind = "link" | "citation" | "reference" | "footnote" | "inlineMath";

const promptSettings: Record<PromptKind, { label: string; placeholder: string }> = {
  link: { label: "Link address", placeholder: "https://…" },
  citation: { label: "Citation key", placeholder: "knuth1984, lamport1994" },
  reference: { label: "Label to refer to", placeholder: "sec:intro" },
  footnote: { label: "Footnote text", placeholder: "Text of the footnote" },
  inlineMath: { label: "Math (TeX)", placeholder: "E = mc^2" },
};

type StyleValue = "P" | "H1" | "H2" | "H3" | "H4" | "H5";

const styleOptions: Array<{ value: StyleValue; label: string; chapters?: boolean }> = [
  { value: "P", label: "Normal" },
  { value: "H1", label: "Chapter", chapters: true },
  { value: "H2", label: "Heading 1" },
  { value: "H3", label: "Heading 2" },
  { value: "H4", label: "Heading 3" },
  { value: "H5", label: "Heading 4" },
];

/** Word-processor shortcuts handled here so each press toggles exactly once. */
const shortcutCommands: Record<string, string> = {
  b: "bold",
  i: "italic",
  u: "underline",
};

const blockCommands = new Set([
  "insertUnorderedList",
  "insertOrderedList",
  "formatBlock",
  "indent",
  "outdent",
]);

const islandKeys = new WeakMap<Element, string>();
const autoEdit = new WeakSet<Element>();
let islandCounter = 0;

function islandKey(element: Element): string {
  let key = islandKeys.get(element);
  if (!key) {
    key = `island-${(islandCounter += 1)}`;
    islandKeys.set(element, key);
  }
  return key;
}

interface Caret {
  /** Index of the top-level block holding the caret. */
  block: number;
  /** Characters of text before the caret in that block. */
  offset: number;
}

interface HistoryEntry {
  content: string;
  caret: Caret | null;
}

/** How long typing keeps going into the same undo step. */
const typingGroupMs = 1000;
const historyLimit = 300;

function captureCaret(root: HTMLElement): Caret | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.endContainer)) return null;
  let node: Node | null = range.endContainer;
  while (node && node.parentNode !== root) node = node.parentNode;
  if (!node) return null;
  const before = document.createRange();
  before.setStart(node, 0);
  before.setEnd(range.endContainer, range.endOffset);
  return {
    block: Array.prototype.indexOf.call(root.childNodes, node),
    offset: before.toString().length,
  };
}

function placeCaret(node: Node, offset: number): void {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function restoreCaret(root: HTMLElement, caret: Caret | null): void {
  const block =
    root.childNodes[Math.min(caret?.block ?? 0, root.childNodes.length - 1)];
  if (!block) return;
  root.focus({ preventScroll: true });
  if (block instanceof HTMLElement && block.classList.contains("vl-island")) return;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let remaining = caret?.offset ?? 0;
  let last: Text | null = null;
  for (
    let node = walker.nextNode() as Text | null;
    node;
    node = walker.nextNode() as Text | null
  ) {
    last = node;
    if (remaining <= node.data.length) {
      placeCaret(node, remaining);
      return;
    }
    remaining -= node.data.length;
  }
  if (last) placeCaret(last, last.data.length);
  else placeCaret(block, 0);
}

const defaultFigureSource = (path: string) =>
  [
    "\\begin{figure}[ht]",
    "  \\centering",
    `  \\includegraphics[width=0.8\\linewidth]{${path}}`,
    "  \\caption{}",
    "\\end{figure}",
  ].join("\n");

function isImageFile(file: File): boolean {
  return (
    file.type.startsWith("image/") ||
    /\.(png|jpe?g|gif|svg|pdf|eps|webp)$/i.test(file.name)
  );
}

export function VisualLatexEditor({
  content,
  readOnly = false,
  onChange,
  loadImage,
  importImages,
  latexForProjectFile,
  figureSource = defaultFigureSource,
}: VisualLatexEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef(parseDocument(content));
  const serializedRef = useRef(content.replace(/\r\n?/g, "\n"));
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [islands, setIslands] = useState<IslandEntry[]>([]);
  const [islandSources, setIslandSources] = useState<Map<string, string>>(new Map());
  const [head, setHeadState] = useState(documentRef.current.head);
  const [words, setWords] = useState(0);
  const [style, setStyle] = useState<StyleValue | "">("P");
  const [formats, setFormats] = useState<Record<string, boolean>>({});
  const [prompt, setPrompt] = useState<{ kind: PromptKind; value: string } | null>(
    null,
  );
  const savedRange = useRef<Range | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [handle, setHandle] = useState<{ top: number; height: number } | null>(null);
  const hoveredBlock = useRef<HTMLElement | null>(null);
  const draggedBlock = useRef<HTMLElement | null>(null);
  const [dropLine, setDropLine] = useState<number | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const history = useRef<{
    entries: HistoryEntry[];
    index: number;
    lastTyping: number;
    lastGroup: string;
  }>({
    entries: [{ content: serializedRef.current, caret: null }],
    index: 0,
    lastTyping: 0,
    lastGroup: "",
  });

  const renderMath = useCallback(
    (tex: string, display: boolean) => mathPreviewDataUri(tex, display, "#1f1f1f"),
    [],
  );
  const renderOptions = useMemo<InlineRenderOptions>(
    () => ({ renderMath }),
    [renderMath],
  );
  const hasChapters =
    /\\documentclass(?:\[[^\]]*\])?\{(?:book|report|memoir|scrbook|scrreprt)\}/.test(
      head,
    );

  // ---------- reading the page back ----------

  /** Records a new state for undo: typing in bursts, other edits one by one. */
  const record = useCallback(
    (content: string, kind: "typing" | "action", group = "") => {
      const state = history.current;
      const caret = rootRef.current ? captureCaret(rootRef.current) : null;
      const now = Date.now();
      const continuesTyping =
        kind === "typing" &&
        state.index > 0 &&
        state.index === state.entries.length - 1 &&
        now - state.lastTyping < typingGroupMs &&
        group === state.lastGroup;
      if (continuesTyping) {
        state.entries[state.index] = { content, caret };
      } else {
        state.entries.splice(state.index + 1);
        state.entries.push({ content, caret });
        if (state.entries.length > historyLimit) state.entries.shift();
        state.index = state.entries.length - 1;
      }
      state.lastTyping = kind === "typing" ? now : 0;
      state.lastGroup = group;
    },
    [],
  );

  const commit = useCallback(
    (kind: "typing" | "action" = "action", group = "") => {
      const root = rootRef.current;
      if (!root) return;
      const current = documentRef.current;
      const next = current.head + serializeRoot(root) + current.trailing + current.tail;
      setWords(countWords(root));
      if (next === serializedRef.current) return;
      serializedRef.current = next;
      // Typing groups into one undo step only while it stays in one place.
      record(next, kind, group || `block:${captureCaret(root)?.block ?? -1}`);
      onChangeRef.current(next);
    },
    [record],
  );

  const scanIslands = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const found = Array.from(root.querySelectorAll<HTMLElement>(".vl-island"));
    setIslands((current) => {
      const next = found.map((element) => {
        const known = islandKeys.has(element);
        const key = islandKey(element);
        // An element restored by undo may still hold an old rendering.
        if (!known || !current.some((entry) => entry.key === key))
          element.replaceChildren();
        return { element, key, kind: element.dataset.kind ?? "code" };
      });
      const same =
        next.length === current.length &&
        next.every((entry, index) => entry.key === current[index].key);
      return same ? current : next;
    });
    setIslandSources((current) => {
      let changed = false;
      const next = new Map<string, string>();
      for (const element of found) {
        const key = islandKey(element);
        const source = element.dataset.source ?? "";
        next.set(key, source);
        if (current.get(key) !== source) changed = true;
      }
      return changed || next.size !== current.size ? next : current;
    });
  }, []);

  // ---------- drawing the page from the source ----------

  const renderFromSource = useCallback(
    (source: string) => {
      const root = rootRef.current;
      if (!root) return;
      const parsed = parseDocument(source);
      documentRef.current = parsed;
      setHeadState(parsed.head);
      renderBlocksInto(root, parsed.blocks, renderOptions);
      setWords(countWords(root));
      scanIslands();
    },
    [renderOptions, scanIslands],
  );

  useLayoutEffect(() => {
    renderFromSource(serializedRef.current);
    // Drawn once here; later source changes are handled below.
  }, [renderFromSource]);

  useEffect(() => {
    const normalized = content.replace(/\r\n?/g, "\n");
    if (normalized === serializedRef.current) return;
    serializedRef.current = normalized;
    renderFromSource(normalized);
    // A change from outside (the code view, a reload) can be undone here too.
    record(normalized, "action");
  }, [content, record, renderFromSource]);

  const travel = useCallback(
    (step: -1 | 1) => {
      const state = history.current;
      const target = state.index + step;
      if (readOnly || target < 0 || target >= state.entries.length) return;
      state.index = target;
      state.lastTyping = 0;
      const entry = state.entries[target];
      serializedRef.current = entry.content;
      renderFromSource(entry.content);
      if (rootRef.current) restoreCaret(rootRef.current, entry.caret);
      onChangeRef.current(entry.content);
    },
    [readOnly, renderFromSource],
  );

  // Undo and redo are the editor's own, whatever triggers them (keys, the
  // Edit menu, the ribbon): the browser's undo cannot see object edits.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const redo = (key === "z" && event.shiftKey) || (key === "y" && !event.shiftKey);
      if (key !== "z" && !redo) return;
      event.preventDefault();
      event.stopPropagation();
      travel(redo ? 1 : -1);
    };
    const onBeforeInput = (event: InputEvent) => {
      if (event.inputType !== "historyUndo" && event.inputType !== "historyRedo")
        return;
      event.preventDefault();
      travel(event.inputType === "historyRedo" ? 1 : -1);
    };
    editor.addEventListener("keydown", onKeyDown, true);
    editor.addEventListener("beforeinput", onBeforeInput, true);
    return () => {
      editor.removeEventListener("keydown", onKeyDown, true);
      editor.removeEventListener("beforeinput", onBeforeInput, true);
    };
  }, [travel]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => scanIslands());
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [scanIslands]);

  const setHead = useCallback(
    (nextHead: string) => {
      documentRef.current = { ...documentRef.current, head: nextHead };
      setHeadState(nextHead);
      commit();
    },
    [commit],
  );

  // ---------- selection and ribbon state ----------

  const currentBlock = useCallback((): HTMLElement | null => {
    const root = rootRef.current;
    const selection = window.getSelection();
    if (!root || !selection?.rangeCount) return null;
    let node: Node | null = selection.getRangeAt(0).startContainer;
    if (!root.contains(node)) return null;
    while (node && node.parentNode !== root) node = node.parentNode;
    return node instanceof HTMLElement ? node : null;
  }, []);

  const refreshRibbon = useCallback(() => {
    const block = currentBlock();
    if (!block) return;
    const tag = block.tagName;
    setStyle(headingCommandForTag(tag) ? (tag as StyleValue) : tag === "P" ? "P" : "");
    const state = (command: string) => {
      try {
        return document.queryCommandState(command);
      } catch {
        return false;
      }
    };
    setFormats({
      bold: state("bold"),
      italic: state("italic"),
      underline: state("underline"),
      superscript: state("superscript"),
      subscript: state("subscript"),
      unorderedList: block.tagName === "UL",
      orderedList: block.tagName === "OL",
    });
  }, [currentBlock]);

  useEffect(() => {
    const listener = () => refreshRibbon();
    document.addEventListener("selectionchange", listener);
    return () => document.removeEventListener("selectionchange", listener);
  }, [refreshRibbon]);

  const focusEditor = () => {
    const root = rootRef.current;
    if (!root) return;
    const selection = window.getSelection();
    const inPage = Boolean(
      selection?.rangeCount && root.contains(selection.anchorNode),
    );
    // A selection saved before a menu or prompt took focus is used once.
    if (!inPage && savedRange.current && selection) {
      root.focus({ preventScroll: true });
      selection.removeAllRanges();
      selection.addRange(savedRange.current);
    } else if (!inPage) {
      root.focus();
    }
    savedRange.current = null;
  };

  /**
   * Inserts HTML at the caret without the browser's insertHTML, which
   * misplaces non-editable chips. Blocks split the paragraph like a paste in
   * a word processor.
   */
  const insertHtmlAtCaret = (html: string, inline: boolean) => {
    const root = rootRef.current;
    if (!root || readOnly || !html) return;
    focusEditor();
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer)) return;
    range.deleteContents();
    const template = document.createElement("template");
    template.innerHTML = html;
    const fragment = template.content;

    if (inline) {
      const last = fragment.lastChild;
      range.insertNode(fragment);
      if (last) {
        range.setStartAfter(last);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      scanIslands();
      commit();
      return;
    }

    const pasted = Array.from(fragment.childNodes).filter(
      (node) => !(node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()),
    ) as HTMLElement[];
    let block: Node | null = range.startContainer;
    while (block && block.parentNode !== root) block = block.parentNode;
    let caretTarget: Node | null;
    let caretOffset = 0;

    if (
      block instanceof HTMLElement &&
      (block.tagName === "P" || /^H[1-6]$/.test(block.tagName))
    ) {
      // Split the paragraph at the caret.
      const tail = document.createRange();
      tail.setStart(range.startContainer, range.startOffset);
      tail.setEnd(block, block.childNodes.length);
      const after = block.cloneNode(false) as HTMLElement;
      after.append(tail.extractContents());
      // The first pasted paragraph continues the current one…
      const first = pasted[0];
      if (first?.tagName === "P") {
        block.append(...Array.from(first.childNodes));
        pasted.shift();
      }
      let anchor: Node = block;
      for (const element of pasted) {
        anchor.parentNode!.insertBefore(element, anchor.nextSibling);
        anchor = element;
      }
      // …and the last one carries the text that followed the caret.
      const last = pasted[pasted.length - 1];
      const keepsTail =
        (after.textContent ?? "").length > 0 || after.querySelector(".vl-token");
      if (last?.tagName === "P") {
        caretTarget = last;
        caretOffset = last.childNodes.length;
        if (keepsTail) last.append(...Array.from(after.childNodes));
      } else if (keepsTail) {
        anchor.parentNode!.insertBefore(after, anchor.nextSibling);
        caretTarget = after;
      } else {
        caretTarget = last ?? block;
        caretOffset = caretTarget.childNodes.length;
      }
    } else {
      const reference = block ? block.nextSibling : null;
      for (const element of pasted) root.insertBefore(element, reference);
      caretTarget = pasted[pasted.length - 1] ?? null;
      caretOffset = caretTarget?.childNodes.length ?? 0;
    }
    if (
      caretTarget &&
      !(
        caretTarget instanceof HTMLElement &&
        caretTarget.classList.contains("vl-island")
      )
    ) {
      placeCaret(caretTarget, Math.min(caretOffset, caretTarget.childNodes.length));
    }
    scanIslands();
    commit();
  };

  const exec = (command: string, value?: string) => {
    if (readOnly) return;
    focusEditor();
    const root = rootRef.current;
    const selection = window.getSelection();
    // Block commands (lists, styles, indent) can move a collapsed caret to
    // the start of the line; keep it where the writer left it.
    const caret =
      root && blockCommands.has(command) && selection?.isCollapsed
        ? captureCaret(root)
        : null;
    try {
      document.execCommand(command, false, value);
    } catch {
      // Unsupported commands simply do nothing.
    }
    if (root && caret) restoreCaret(root, caret);
    commit();
    refreshRibbon();
  };

  /** Inserts a new block after the one with the caret (or at the end). */
  const insertBlock = (element: HTMLElement) => {
    const root = rootRef.current;
    if (!root || readOnly) return;
    const block = currentBlock();
    if (block && block.nextSibling) root.insertBefore(element, block.nextSibling);
    else if (block) block.after(element);
    else root.append(element);
    // Keep a paragraph after an object so there is always somewhere to type.
    if (!element.nextElementSibling) {
      const paragraph = document.createElement("p");
      paragraph.append(document.createElement("br"));
      element.after(paragraph);
    }
    scanIslands();
    commit();
  };

  const insertIsland = (kind: string, source: string, edit = false) => {
    const element = createIsland(kind, source);
    if (edit) autoEdit.add(element);
    insertBlock(element);
  };

  const insertLatexBlocks = (latex: string, before: HTMLElement | null) => {
    const root = rootRef.current;
    if (!root) return;
    const blocks = parseDocument(latex).blocks;
    for (const block of blocks) {
      const element = renderBlock({ ...block, sep: "\n\n" }, renderOptions);
      root.insertBefore(element, before);
    }
    scanIslands();
    commit();
  };

  const setBlockStyle = (value: StyleValue) => {
    const block = currentBlock();
    if (!block || readOnly) return;
    if (block.tagName === "UL" || block.tagName === "OL") {
      exec(block.tagName === "UL" ? "insertUnorderedList" : "insertOrderedList");
    }
    const before = currentBlock();
    exec("formatBlock", value.toLowerCase());
    const after = currentBlock();
    if (before && after && before !== after) transferBlockMeta(before, after);
    commit();
  };

  const toggleCode = () => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || readOnly) return;
    const range = selection.getRangeAt(0);
    const container =
      range.commonAncestorContainer instanceof HTMLElement
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
    const code = container?.closest("code");
    if (code && rootRef.current?.contains(code)) {
      code.replaceWith(...Array.from(code.childNodes));
      commit();
      return;
    }
    if (range.collapsed) return;
    const holder = document.createElement("div");
    holder.append(range.cloneContents());
    insertHtmlAtCaret(`<code>${holder.innerHTML}</code>`, true);
  };

  const openPrompt = (kind: PromptKind) => {
    if (readOnly) return;
    const selection = window.getSelection();
    savedRange.current =
      selection?.rangeCount && rootRef.current?.contains(selection.anchorNode)
        ? selection.getRangeAt(0).cloneRange()
        : null;
    setPrompt({ kind, value: "" });
  };

  const submitPrompt = () => {
    if (!prompt) return;
    const value = prompt.value.trim();
    setPrompt(null);
    if (!value) return;
    const token = (latex: string, label: string, kind: string) =>
      `<span class="vl-token vl-token-${kind}" data-latex="${escapeHtml(latex)}" contenteditable="false" title="${escapeHtml(latex)}">${escapeHtml(label)}</span>&nbsp;`;
    switch (prompt.kind) {
      case "link": {
        const selected = savedRange.current && !savedRange.current.collapsed;
        if (selected) exec("createLink", value);
        else
          insertHtmlAtCaret(
            `<a href="${escapeHtml(value)}">${escapeHtml(value)}</a>&nbsp;`,
            true,
          );
        break;
      }
      case "citation":
        insertHtmlAtCaret(token(`\\cite{${value}}`, `[${value}]`, "citation"), true);
        break;
      case "reference":
        insertHtmlAtCaret(token(`\\ref{${value}}`, `#${value}`, "reference"), true);
        break;
      case "footnote":
        insertHtmlAtCaret(
          token(`\\footnote{${escapeLatexText(value)}}`, "note", "footnote"),
          true,
        );
        break;
      case "inlineMath":
        insertHtmlAtCaret(
          `${mathToken(`$${value}$`, value, false, renderOptions)}&nbsp;`,
          true,
        );
        break;
    }
    savedRange.current = null;
  };

  // ---------- editing behaviour ----------

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const inIsland = (target: EventTarget | null) =>
      target instanceof Node &&
      (target instanceof Element ? target : target.parentElement)?.closest(
        ".vl-island",
      ) !== null;

    const onInput = (event: Event) => {
      if (inIsland(event.target)) return;
      if (!root.firstChild) {
        const paragraph = document.createElement("p");
        paragraph.append(document.createElement("br"));
        root.append(paragraph);
      }
      commit("typing");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (inIsland(event.target)) return;
      const mod = event.metaKey || event.ctrlKey;
      if (event.key === "Tab") {
        event.preventDefault();
        const block = currentBlock();
        if (block && (block.tagName === "UL" || block.tagName === "OL")) {
          exec(event.shiftKey ? "outdent" : "indent");
        }
        return;
      }
      const key = event.key.toLowerCase();
      if (mod && !event.shiftKey && !event.altKey && key in shortcutCommands) {
        event.preventDefault();
        exec(shortcutCommands[key]);
        return;
      }
      if (mod && !event.shiftKey && key === "k") {
        event.preventDefault();
        openPrompt("link");
      }
    };
    const onPaste = (event: ClipboardEvent) => {
      if (inIsland(event.target) || readOnly) return;
      event.preventDefault();
      const plan = planPaste(
        event.clipboardData?.getData("text/html") ?? "",
        event.clipboardData?.getData("text/plain") ?? "",
        renderOptions,
      );
      insertHtmlAtCaret(plan.html, plan.inline);
    };
    const onClick = (event: MouseEvent) => {
      // Links are edited here, not followed.
      if ((event.target as Element | null)?.closest?.("a")) event.preventDefault();
    };
    root.addEventListener("input", onInput);
    root.addEventListener("keydown", onKeyDown);
    root.addEventListener("paste", onPaste);
    root.addEventListener("click", onClick);
    return () => {
      root.removeEventListener("input", onInput);
      root.removeEventListener("keydown", onKeyDown);
      root.removeEventListener("paste", onPaste);
      root.removeEventListener("click", onClick);
    };
    // exec and openPrompt read only refs and stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commit, currentBlock, readOnly, renderOptions, scanIslands]);

  useEffect(() => {
    try {
      document.execCommand("defaultParagraphSeparator", false, "p");
    } catch {
      // Not every engine supports it; Chromium does.
    }
  }, []);

  // ---------- drag and drop ----------

  const topLevelAt = (
    clientY: number,
  ): { block: HTMLElement; after: boolean } | null => {
    const root = rootRef.current;
    if (!root) return null;
    const children = Array.from(root.children) as HTMLElement[];
    for (const child of children) {
      const rect = child.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return { block: child, after: false };
      if (clientY <= rect.bottom) return { block: child, after: true };
    }
    const last = children[children.length - 1];
    return last ? { block: last, after: true } : null;
  };

  const showDropLine = (clientY: number) => {
    const target = topLevelAt(clientY);
    const page = pageRef.current;
    if (!target || !page) return setDropLine(null);
    const rect = target.block.getBoundingClientRect();
    const pageRect = page.getBoundingClientRect();
    setDropLine(
      (target.after ? rect.bottom : rect.top) - pageRect.top + page.scrollTop,
    );
  };

  const dropAt = (clientY: number): HTMLElement | null => {
    const target = topLevelAt(clientY);
    if (!target) return null;
    return target.after
      ? (target.block.nextElementSibling as HTMLElement | null)
      : target.block;
  };

  const handleDragOver = (event: React.DragEvent) => {
    if (readOnly) return;
    const types = Array.from(event.dataTransfer.types);
    const ours =
      draggedBlock.current ||
      types.includes("Files") ||
      (latexForProjectFile &&
        types.includes("text/plain") &&
        !types.includes("text/html"));
    if (!ours) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = draggedBlock.current ? "move" : "copy";
    showDropLine(event.clientY);
  };

  const handleDrop = async (event: React.DragEvent) => {
    setDropLine(null);
    if (readOnly) return;
    const root = rootRef.current;
    if (!root) return;
    const before = dropAt(event.clientY);
    const moving = draggedBlock.current;
    if (moving) {
      event.preventDefault();
      draggedBlock.current = null;
      if (before !== moving) root.insertBefore(moving, before);
      commit();
      return;
    }
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length) {
      event.preventDefault();
      const images = files.filter(isImageFile);
      if (!images.length || !importImages) return;
      const paths = await importImages(images);
      insertLatexBlocks(paths.map(figureSource).join("\n\n"), before);
      return;
    }
    const dragged = event.dataTransfer.getData("text/plain");
    const latex = dragged && latexForProjectFile?.(dragged);
    if (latex) {
      event.preventDefault();
      insertLatexBlocks(latex, before);
    }
  };

  const trackHandle = (event: React.MouseEvent) => {
    if (readOnly) return;
    const root = rootRef.current;
    const page = pageRef.current;
    if (!root || !page) return;
    let node = event.target as Node | null;
    while (node && node.parentNode !== root) node = node.parentNode;
    if (!(node instanceof HTMLElement) || node === hoveredBlock.current) return;
    hoveredBlock.current = node;
    const rect = node.getBoundingClientRect();
    const pageRect = page.getBoundingClientRect();
    setHandle({ top: rect.top - pageRect.top + page.scrollTop, height: rect.height });
  };

  // ---------- islands ----------

  const islandContext: IslandContext = {
    readOnly,
    renderOptions,
    renderMath,
    loadImage,
    importImages,
    head,
    setHead,
  };

  const updateIsland = (element: HTMLElement, source: string) => {
    element.dataset.source = source;
    setIslandSources((current) => new Map(current).set(islandKey(element), source));
    commit("typing", `island:${islandKey(element)}`);
  };

  const removeIsland = (element: HTMLElement) => {
    element.remove();
    scanIslands();
    commit();
  };

  const formatButton = (
    command: string,
    label: string,
    icon: React.ReactNode,
    shortcut?: string,
  ) => (
    <button
      type="button"
      className={formats[command] ? "is-active" : undefined}
      aria-pressed={Boolean(formats[command])}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      disabled={readOnly}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => exec(command)}
    >
      {icon}
    </button>
  );

  const ribbonButton = (
    label: string,
    icon: React.ReactNode,
    action: () => void,
    active = false,
  ) => (
    <button
      type="button"
      className={active ? "is-active" : undefined}
      aria-pressed={active || undefined}
      title={label}
      aria-label={label}
      disabled={readOnly}
      onMouseDown={(event) => event.preventDefault()}
      onClick={action}
    >
      {icon}
    </button>
  );

  const mod =
    typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl+";

  return (
    <div className="vl-editor" ref={editorRef} aria-label="Visual LaTeX editor">
      <div className="vl-ribbon" role="toolbar" aria-label="Formatting">
        <div className="vl-ribbon-group">
          {ribbonButton("Undo", <Undo2 size={15} />, () => travel(-1))}
          {ribbonButton("Redo", <Redo2 size={15} />, () => travel(1))}
        </div>
        <div className="vl-ribbon-group">
          <select
            className="vl-style-select"
            aria-label="Paragraph style"
            value={style}
            disabled={readOnly}
            onMouseDown={() => {
              const selection = window.getSelection();
              savedRange.current = selection?.rangeCount
                ? selection.getRangeAt(0).cloneRange()
                : null;
            }}
            onChange={(event) => setBlockStyle(event.target.value as StyleValue)}
          >
            {style === "" ? <option value="">—</option> : null}
            {styleOptions
              .filter((option) => !option.chapters || hasChapters)
              .map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
          </select>
        </div>
        <div className="vl-ribbon-group">
          {formatButton("bold", "Bold", <Bold size={15} />, `${mod}B`)}
          {formatButton("italic", "Italic", <Italic size={15} />, `${mod}I`)}
          {formatButton("underline", "Underline", <Underline size={15} />, `${mod}U`)}
          {ribbonButton("Code (monospace)", <Code size={15} />, toggleCode)}
          {formatButton("superscript", "Superscript", <Superscript size={15} />)}
          {formatButton("subscript", "Subscript", <Subscript size={15} />)}
          {ribbonButton("Clear formatting", <RemoveFormatting size={15} />, () =>
            exec("removeFormat"),
          )}
        </div>
        <div className="vl-ribbon-group">
          {ribbonButton(
            "Bulleted list",
            <List size={15} />,
            () => exec("insertUnorderedList"),
            formats.unorderedList,
          )}
          {ribbonButton(
            "Numbered list",
            <ListOrdered size={15} />,
            () => exec("insertOrderedList"),
            formats.orderedList,
          )}
        </div>
        <div className="vl-ribbon-group" aria-label="Insert">
          {ribbonButton("Insert image", <ImagePlus size={15} />, () =>
            imageInput.current?.click(),
          )}
          {ribbonButton("Insert table", <Table2 size={15} />, () =>
            insertIsland("table", blockTemplates.table),
          )}
          {ribbonButton("Insert equation", <SquareFunction size={15} />, () =>
            insertIsland("math", blockTemplates.equation, true),
          )}
          {ribbonButton("Insert inline math", <Sigma size={15} />, () =>
            openPrompt("inlineMath"),
          )}
          {ribbonButton(`Insert link (${mod}K)`, <Link2 size={15} />, () =>
            openPrompt("link"),
          )}
          {ribbonButton("Insert citation", <BookMarked size={15} />, () =>
            openPrompt("citation"),
          )}
          {ribbonButton("Insert cross-reference", <Hash size={15} />, () =>
            openPrompt("reference"),
          )}
          {ribbonButton("Insert footnote", <StickyNote size={15} />, () =>
            openPrompt("footnote"),
          )}
          {ribbonButton("Insert page break", <SeparatorHorizontal size={15} />, () => {
            const element = createIsland("command", blockTemplates.pagebreak);
            element.dataset.command = "pagebreak";
            insertBlock(element);
          })}
        </div>
        <input
          ref={imageInput}
          type="file"
          accept="image/*,application/pdf"
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (!files.length || !importImages) return;
            void importImages(files).then((paths) => {
              for (const path of paths) insertIsland("figure", figureSource(path));
            });
          }}
        />
      </div>
      {prompt ? (
        <form
          className="vl-prompt"
          onSubmit={(event) => {
            event.preventDefault();
            submitPrompt();
          }}
        >
          <label>
            <span>{promptSettings[prompt.kind].label}</span>
            <input
              autoFocus
              value={prompt.value}
              placeholder={promptSettings[prompt.kind].placeholder}
              onChange={(event) => setPrompt({ ...prompt, value: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setPrompt(null);
                  focusEditor();
                }
              }}
            />
          </label>
          <button type="submit">Insert</button>
          <button type="button" onClick={() => setPrompt(null)}>
            Cancel
          </button>
        </form>
      ) : null}
      <div
        className="vl-canvas"
        ref={pageRef}
        onDragOver={handleDragOver}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDropLine(null);
        }}
        onDrop={(event) => void handleDrop(event)}
        onMouseMove={trackHandle}
        onMouseLeave={() => {
          hoveredBlock.current = null;
          setHandle(null);
        }}
      >
        <div className="vl-sheet">
          <div
            ref={rootRef}
            className="vl-root"
            contentEditable={!readOnly}
            suppressContentEditableWarning
            spellCheck
            role="textbox"
            aria-multiline="true"
            aria-label="Document"
            data-visual-editor="true"
          />
        </div>
        {handle && !readOnly ? (
          <div
            className="vl-drag-handle"
            style={{ top: handle.top + Math.min(4, handle.height / 2 - 9) }}
            draggable
            title="Drag to move"
            aria-hidden="true"
            onDragStart={(event) => {
              draggedBlock.current = hoveredBlock.current;
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("application/x-latexdo-block", "block");
              if (hoveredBlock.current)
                event.dataTransfer.setDragImage(hoveredBlock.current, 0, 0);
            }}
            onDragEnd={() => {
              draggedBlock.current = null;
              setDropLine(null);
            }}
          >
            ⋮⋮
          </div>
        ) : null}
        {dropLine !== null ? (
          <div className="vl-drop-line" style={{ top: dropLine }} />
        ) : null}
      </div>
      <div className="vl-status" aria-live="polite">
        <FileText size={12} aria-hidden="true" />
        <span>
          {words} {words === 1 ? "word" : "words"}
        </span>
        <span className="vl-status-hint">
          Drop images anywhere on the page to add a figure
        </span>
      </div>
      {islands.map((entry) => {
        const Island = islandComponents[entry.kind] ?? islandComponents.code;
        return createPortal(
          <Island
            element={entry.element}
            source={islandSources.get(entry.key) ?? entry.element.dataset.source ?? ""}
            context={islandContext}
            update={(source) => updateIsland(entry.element, source)}
            remove={() => removeIsland(entry.element)}
            startEditing={autoEdit.has(entry.element)}
          />,
          entry.element,
          entry.key,
        );
      })}
    </div>
  );
}
