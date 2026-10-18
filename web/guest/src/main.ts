/*
 * LatexDo in the browser for co-authors: open a shared project from a web
 * link, edit it live with everyone, no account and no install. Everything is
 * end-to-end encrypted exactly like the desktop app; the key comes from the
 * link's "#" part, which browsers never send to any server.
 */

import "./styles.css";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { MonacoBinding } from "y-monaco";
import {
  collaboratorLook,
  remoteCursorCss,
  type RemoteCursor,
} from "../../../src/collaboration/collaboratorLook";
import { parseWebInvite, type WebInvite } from "./invite";
import {
  GuestSession,
  type LiveFile,
  type LiveStatus,
  type Person,
  type TreeEntry,
} from "./session";

const downloadUrl = "https://latexdo.org";
const identityStorageKey = "latexdo-guest-identity";
const nameStorageKey = "latexdo-guest-name";
const approvalPollMs = 4000;
const presencePingMs = 60_000;

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

// --- Small helpers --------------------------------------------------------------

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { [name: string]: string | (() => void) | undefined } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (typeof value === "function") element.addEventListener("click", value);
    else if (value !== undefined) element.setAttribute(name, value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    // Text is always inserted as text, never parsed as HTML.
    element.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return element;
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows may refuse storage; the page still works.
  }
}

function randomId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `${prefix}-${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Kept per browser, so the owner approves this person only once. */
function guestIds(): { sessionId: string; clientId: string } {
  try {
    const stored = JSON.parse(readStorage(identityStorageKey) ?? "null") as {
      sessionId?: unknown;
      clientId?: unknown;
    } | null;
    if (typeof stored?.sessionId === "string" && typeof stored.clientId === "string") {
      return { sessionId: stored.sessionId, clientId: stored.clientId };
    }
  } catch {
    // Start over below.
  }
  const ids = { sessionId: randomId("web-session"), clientId: randomId("web") };
  writeStorage(identityStorageKey, JSON.stringify(ids));
  return ids;
}

const app = document.getElementById("app")!;

function show(...children: Child[]): void {
  app.replaceChildren(
    ...children.filter((child): child is Node | string => Boolean(child)),
  );
}

function brand(): HTMLElement {
  return h(
    "a",
    { class: "brand", href: downloadUrl, target: "_blank", rel: "noopener noreferrer" },
    h("img", { src: "/icon.png", alt: "", width: "22", height: "22" }),
    "LatexDo",
  );
}

function card(...children: Child[]): HTMLElement {
  return h(
    "main",
    { class: "center" },
    h("section", { class: "card" }, brand(), ...children),
  );
}

function getAppButton(label = "Get LatexDo"): HTMLElement {
  return h(
    "a",
    {
      class: "button primary",
      href: downloadUrl,
      target: "_blank",
      rel: "noopener noreferrer",
    },
    label,
  );
}

// --- Screens ------------------------------------------------------------------------

function showInvalidLink(): void {
  show(
    card(
      h("h1", {}, "This link is incomplete"),
      h(
        "p",
        {},
        "Ask the person who shared the project to copy the web link again from LatexDo’s Share window.",
      ),
      getAppButton(),
    ),
  );
}

function showError(message: string): void {
  show(
    card(h("h1", {}, "Can’t open this project"), h("p", {}, message), getAppButton()),
  );
}

function askName(onJoin: (name: string) => void): void {
  const input = h("input", {
    id: "guest-name",
    type: "text",
    maxlength: "60",
    autocomplete: "name",
    placeholder: "Your name",
    "aria-label": "Your name",
  });
  input.value = readStorage(nameStorageKey) ?? "";
  const form = h(
    "form",
    { class: "join-form" },
    h("label", { for: "guest-name" }, "How should others see you?"),
    input,
    h("button", { class: "button primary", type: "submit" }, "Join project"),
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = input.value.trim().slice(0, 60);
    if (!name) {
      input.focus();
      return;
    }
    writeStorage(nameStorageKey, name);
    onJoin(name);
  });
  show(
    card(
      h("h1", {}, "You’re invited to a LatexDo project"),
      h(
        "p",
        { class: "muted" },
        "Edit together in your browser, live. No account needed. Everything is end-to-end encrypted: only people with this link can read it.",
      ),
      form,
    ),
  );
  input.focus();
}

function showWaiting(name: string, onCancel: () => void): void {
  show(
    card(
      h("div", { class: "spinner", "aria-hidden": "true" }),
      h("h1", {}, "Waiting for the owner"),
      h(
        "p",
        {},
        `The owner of this project has been asked to let “${name}” in. This page opens the project as soon as they do.`,
      ),
      h(
        "button",
        { class: "button", type: "button", onClick: onCancel },
        "Change my name",
      ),
    ),
  );
}

// --- Editor ---------------------------------------------------------------------------

function registerLanguages(): void {
  monaco.languages.register({
    id: "latex",
    extensions: [".tex", ".sty", ".cls", ".bbl"],
  });
  monaco.languages.register({ id: "bibtex", extensions: [".bib"] });
  monaco.languages.setMonarchTokensProvider("latex", {
    tokenizer: {
      root: [
        [/%.*$/, "comment"],
        [/\\(?:begin|end)(?=\{)/, "keyword.control"],
        [/\\[a-zA-Z@]+|\\./, "keyword"],
        [/\$[^$]*\$/, "string"],
        [/[{}[\]]/, "delimiter"],
        [/\b\d+(?:\.\d+)?\b/, "number"],
      ],
    },
  });
  monaco.languages.setLanguageConfiguration("latex", {
    comments: { lineComment: "%" },
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: "$", close: "$" },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "$", close: "$" },
    ],
  });
  monaco.languages.setMonarchTokensProvider("bibtex", {
    tokenizer: {
      root: [
        [/%.*$/, "comment"],
        [/@[a-zA-Z]+/, "keyword"],
        [/[a-zA-Z]+(?=\s*=)/, "attribute.name"],
        [/[{}]/, "delimiter"],
      ],
    },
  });
}

function languageFor(path: string): string {
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  if ([".tex", ".sty", ".cls", ".bbl"].includes(extension)) return "latex";
  if (extension === ".bib") return "bibtex";
  return "plaintext";
}

const imageTypes: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

function flattenFiles(entries: TreeEntry[]): TreeEntry[] {
  return entries.flatMap((entry) =>
    entry.type === "directory" ? flattenFiles(entry.children ?? []) : [entry],
  );
}

function firstFile(entries: TreeEntry[]): TreeEntry | undefined {
  const files = flattenFiles(entries).filter((entry) => !entry.binary);
  return (
    files.find((entry) => entry.relativePath === "main.tex") ??
    files.find((entry) => entry.relativePath.endsWith(".tex")) ??
    files[0]
  );
}

const statusLabels: Record<LiveStatus, string> = {
  connecting: "Connecting…",
  live: "Live",
  offline: "Offline, reconnecting…",
  closed: "Disconnected",
};

async function openWorkspace(
  session: GuestSession,
  projectName: string,
  initialPeople: Person[],
): Promise<void> {
  registerLanguages();
  document.title = `${projectName} · LatexDo`;
  const dark = matchMedia("(prefers-color-scheme: dark)");

  const peopleBar = h("div", {
    class: "people",
    "aria-label": "People in this project",
  });
  const status = h(
    "span",
    { class: "status", role: "status" },
    statusLabels.connecting,
  );
  const tree = h("nav", { class: "tree", "aria-label": "Project files" });
  const editorHost = h("div", { class: "editor" });
  const preview = h("div", { class: "preview", hidden: "" });
  const notice = h("div", { class: "notice", hidden: "" });
  const cursorStyle = h("style");
  document.head.append(cursorStyle);

  show(
    h(
      "div",
      { class: "workspace" },
      h(
        "header",
        { class: "topbar" },
        brand(),
        h("span", { class: "project-name", title: projectName }, projectName),
        peopleBar,
        status,
        getAppButton(),
      ),
      h("aside", { class: "sidebar" }, h("h2", {}, "Files"), tree),
      h("section", { class: "main" }, notice, editorHost, preview),
      h(
        "footer",
        { class: "footer" },
        "You’re editing in your browser. Compile the PDF, use the private AI and work offline in the free LatexDo app.",
      ),
    ),
  );

  const editor = monaco.editor.create(editorHost, {
    automaticLayout: true,
    readOnly: true,
    wordWrap: "on",
    minimap: { enabled: false },
    fontSize: 14,
    theme: dark.matches ? "vs-dark" : "vs",
    scrollBeyondLastLine: false,
  });
  dark.addEventListener("change", () =>
    monaco.editor.setTheme(dark.matches ? "vs-dark" : "vs"),
  );

  let current: {
    live: LiveFile;
    binding: MonacoBinding;
    model: monaco.editor.ITextModel;
  } | null = null;
  let currentPath: string | null = null;
  let entries: TreeEntry[] = [];
  let previewUrl: string | null = null;

  const renderPeople = (people: Person[]) => {
    const others = people.filter(
      (person) => person.clientId !== session.identity.clientId,
    );
    peopleBar.replaceChildren(
      ...others.slice(0, 8).map((person) => {
        const look = collaboratorLook(person.clientId);
        const where = person.currentFile ? `in ${person.currentFile}` : "not in a file";
        const button = h(
          "button",
          {
            type: "button",
            class: "avatar",
            style: `border-color:${look.color};background:${look.color}33`,
            title: `${person.name} — ${where}`,
            "aria-label": `${person.name}, ${where}`,
          },
          look.emoji,
        );
        if (person.currentFile) {
          const target = person.currentFile;
          button.addEventListener("click", () => void openPath(target));
        }
        return button;
      }),
      ...(others.length > 8
        ? [h("span", { class: "more" }, `+${others.length - 8}`)]
        : []),
    );
  };

  const setStatus = (value: LiveStatus, detail?: string) => {
    status.textContent = detail
      ? `${statusLabels[value]}: ${detail}`
      : statusLabels[value];
    status.dataset.state = value;
  };

  const showNotice = (message: string | null) => {
    notice.hidden = !message;
    notice.textContent = message ?? "";
  };

  const renderTree = () => {
    const list = (items: TreeEntry[]): HTMLElement =>
      h(
        "ul",
        {},
        ...items.map((entry) => {
          if (entry.type === "directory") {
            return h(
              "li",
              {},
              h(
                "details",
                { open: "" },
                h("summary", {}, entry.name),
                list(entry.children ?? []),
              ),
            );
          }
          const button = h(
            "button",
            {
              type: "button",
              class: entry.relativePath === currentPath ? "file active" : "file",
              title: entry.relativePath,
            },
            entry.name,
          );
          button.addEventListener("click", () => void openPath(entry.relativePath));
          return h("li", {}, button);
        }),
      );
    tree.replaceChildren(list(entries));
  };

  const refreshTree = async () => {
    try {
      entries = await session.tree();
      renderTree();
    } catch {
      // Kept as it was; the next change notice tries again.
    }
  };

  const closeCurrent = async () => {
    const closing = current;
    current = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    preview.hidden = true;
    preview.replaceChildren();
    if (!closing) return;
    closing.binding.destroy();
    editor.setModel(null);
    closing.model.dispose();
    await closing.live.close();
  };

  const openPath = async (path: string) => {
    if (path === currentPath) return;
    const entry = flattenFiles(entries).find((item) => item.relativePath === path);
    await closeCurrent();
    currentPath = path;
    renderTree();
    showNotice(null);
    if (entry?.binary) {
      editorHost.hidden = true;
      preview.hidden = false;
      const type = imageTypes[path.slice(path.lastIndexOf(".")).toLowerCase()];
      if (!type) {
        preview.replaceChildren(
          h(
            "p",
            { class: "muted" },
            "This file can’t be shown in the browser. Open the project in LatexDo to use it.",
          ),
        );
        return;
      }
      preview.replaceChildren(h("p", { class: "muted" }, "Decrypting…"));
      try {
        const bytes = await session.readBinary(path);
        if (currentPath !== path) return;
        previewUrl = URL.createObjectURL(new Blob([bytes], { type }));
        preview.replaceChildren(
          type === "application/pdf"
            ? h("iframe", { src: previewUrl, title: path })
            : h("img", { src: previewUrl, alt: path }),
        );
      } catch {
        preview.replaceChildren(
          h("p", { class: "muted" }, "This file could not be opened."),
        );
      }
      return;
    }
    editorHost.hidden = false;
    preview.hidden = true;
    const model = monaco.editor.createModel("", languageFor(path));
    editor.setModel(model);
    editor.updateOptions({ readOnly: true });
    const live = session.openFile(path, {
      onStatus: (value, detail) => {
        if (current?.live !== live) return;
        setStatus(value, detail);
        if (value === "closed" && detail) {
          editor.updateOptions({ readOnly: true });
          showNotice(detail);
        }
      },
      onReady: (canEdit) => {
        if (current?.live !== live) return;
        editor.updateOptions({ readOnly: !canEdit });
        showNotice(
          canEdit ? null : "You can read this project. Only editors can change it.",
        );
      },
      onPresence: renderPeople,
      onProjectChanged: () => void refreshTree(),
    });
    const binding = new MonacoBinding(
      live.text,
      model,
      new Set([editor]),
      live.awareness,
    );
    current = { live, binding, model };
    live.awareness.on("change", () => {
      const cursors: RemoteCursor[] = [];
      live.awareness.getStates().forEach((state, clientID) => {
        if (clientID === live.doc.clientID) return;
        const user = (state as { user?: Record<string, unknown> }).user;
        if (!user) return;
        cursors.push({
          clientID,
          name: typeof user.name === "string" ? user.name : "",
          emoji: typeof user.emoji === "string" ? user.emoji : "",
          color: typeof user.color === "string" ? user.color : "",
        });
      });
      cursorStyle.textContent = remoteCursorCss(cursors);
    });
    void session
      .presence(path)
      .then(renderPeople)
      .catch(() => undefined);
  };

  renderPeople(initialPeople);
  await refreshTree();
  const start = firstFile(entries);
  if (start) await openPath(start.relativePath);
  else showNotice("This project has no files yet.");

  setInterval(() => {
    void session
      .presence(currentPath)
      .then(renderPeople)
      .catch(() => undefined);
  }, presencePingMs);
  addEventListener("pagehide", () => void closeCurrent());
}

// --- Start --------------------------------------------------------------------------------

function start(invite: WebInvite): void {
  const ids = guestIds();
  const begin = (name: string) => {
    const look = collaboratorLook(ids.clientId);
    const session = new GuestSession(location.origin, invite, {
      ...ids,
      name,
      color: look.color,
      emoji: look.emoji,
    });
    let cancelled = false;
    let waiting = false;
    const attempt = async (): Promise<void> => {
      const result = await session.join();
      if (cancelled) return;
      if (result.status === "ready") {
        await openWorkspace(session, result.projectName, result.users);
        return;
      }
      if (result.status === "pending") {
        // Shown once; checking again must not redraw the page every time.
        if (!waiting) {
          waiting = true;
          showWaiting(name, () => {
            cancelled = true;
            askName(begin);
          });
        }
        setTimeout(() => void attempt(), approvalPollMs);
        return;
      }
      // A brief network failure while waiting keeps the guest in line.
      if (waiting && !result.code) {
        setTimeout(() => void attempt(), approvalPollMs);
        return;
      }
      showError(result.message);
    };
    show(
      card(
        h("div", { class: "spinner", "aria-hidden": "true" }),
        h("p", {}, "Opening…"),
      ),
    );
    void attempt();
  };
  const savedName = readStorage(nameStorageKey);
  if (savedName) begin(savedName);
  else askName(begin);
}

const invite = parseWebInvite(location.hash);
if (invite) start(invite);
else showInvalidLink();
