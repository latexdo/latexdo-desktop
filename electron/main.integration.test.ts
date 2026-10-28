// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runGitText } from "./git.js";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import type { OpenProject } from "./types.js";

const native = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  appEvents: new Map<string, (...args: unknown[]) => unknown>(),
  path: "",
  packaged: false,
  windows: [] as unknown[],
  open: vi.fn(),
  save: vi.fn(),
  message: vi.fn(),
  external: vi.fn(),
  trash: vi.fn(),
  quit: vi.fn(),
  exit: vi.fn(),
  menu: vi.fn(),
  protocol: vi.fn(),
  compile: vi.fn(),
  asymptote: vi.fn(),
}));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  class Window extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: { url: "latexdo://app/index.html" },
      isDestroyed: () => false,
      getURL: () => "latexdo://app/index.html",
      replaceMisspelling: vi.fn(),
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      session: {
        availableSpellCheckerLanguages: ["en-US", "fr"],
        setSpellCheckerEnabled: vi.fn(),
        setSpellCheckerLanguages: vi.fn(),
        dictionary: new Set<string>(),
        addWordToSpellCheckerDictionary: vi.fn(function (
          this: { dictionary: Set<string> },
          word: string,
        ) {
          this.dictionary.add(word);
          return true;
        }),
        removeWordFromSpellCheckerDictionary: vi.fn(function (
          this: { dictionary: Set<string> },
          word: string,
        ) {
          return this.dictionary.delete(word);
        }),
        listWordsInSpellCheckerDictionary: vi.fn(async function (this: {
          dictionary: Set<string>;
        }) {
          return [...this.dictionary];
        }),
      },
    });
    options: unknown;
    constructor(options: unknown) {
      super();
      this.options = options;
      native.windows.push(this);
    }
    isDestroyed() {
      return false;
    }
    loadURL = vi.fn(async () => undefined);
    static fromWebContents() {
      return native.windows[0] ?? null;
    }
    static getFocusedWindow() {
      return native.windows[0] ?? null;
    }
    static getAllWindows() {
      return native.windows;
    }
  }
  return {
    app: {
      name: "LatexDo",
      get isPackaged() {
        return native.packaged;
      },
      requestSingleInstanceLock: () => true,
      getName: () => "LatexDo",
      getVersion: () => "0.3.0",
      getPath: () => native.path,
      getLocale: () => "en-US",
      whenReady: () => Promise.resolve(),
      on: (name: string, fn: (...args: unknown[]) => unknown) =>
        native.appEvents.set(name, fn),
      quit: native.quit,
      exit: native.exit,
      dock: { setIcon: vi.fn(), setMenu: vi.fn() },
      setAboutPanelOptions: vi.fn(),
      setPath: vi.fn(),
    },
    BrowserWindow: Window,
    dialog: {
      showOpenDialog: native.open,
      showSaveDialog: native.save,
      showMessageBox: native.message,
      showErrorBox: vi.fn(),
    },
    Menu: { buildFromTemplate: native.menu, setApplicationMenu: vi.fn() },
    nativeTheme: {},
    protocol: { registerSchemesAsPrivileged: vi.fn(), handle: native.protocol },
    shell: {
      openExternal: native.external,
      trashItem: native.trash,
      showItemInFolder: vi.fn(),
      openPath: vi.fn(),
    },
    ipcMain: {
      handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
        native.handlers.set(channel, fn),
      on: vi.fn(),
    },
  };
});
vi.mock("./terminal.js", () => ({ registerTerminalIpc: vi.fn() }));
vi.mock("./peerCollabIpc.js", () => ({
  registerPeerCollabIpc: vi.fn(),
  disposePeerCollab: vi.fn(),
  sharedProjectSourceFolder: vi.fn(async () => null),
}));
vi.mock("./buildInfo.js", () => ({
  readBuildInfo: () => ({
    commit: "e".repeat(40),
    builtAt: "2026-01-01T00:00:00.000Z",
  }),
}));
vi.mock("./ai/aiIpc.js", () => ({ registerAiIpc: vi.fn() }));
vi.mock("./voiceStt.js", () => ({ stopBundledSpeechServer: vi.fn() }));
vi.mock("./compiler.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./compiler.js")>()),
  compileLatex: native.compile,
  compileAsymptote: native.asymptote,
}));

let root: string;
let project: OpenProject;
let window: {
  webContents: EventEmitter & { mainFrame: unknown; send: ReturnType<typeof vi.fn> };
  options: { webPreferences: unknown };
  loadURL: ReturnType<typeof vi.fn>;
};
const fetchMock = vi.fn();
const originalResourcesPath = Object.getOwnPropertyDescriptor(process, "resourcesPath");
const previousListeners = new Map<
  NodeJS.EventEmitter,
  Map<string | symbol, ReturnType<NodeJS.EventEmitter["listeners"]>>
>();
const originalConsole = { log: console.log, warn: console.warn, error: console.error };
function call(channel: string, ...args: unknown[]): Promise<any> {
  const handler = native.handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return Promise.resolve().then(() =>
    handler(
      { sender: window.webContents, senderFrame: window.webContents.mainFrame },
      ...args,
    ),
  );
}
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "latexdo-main-"));
  native.path = path.join(root, "profile");
  await mkdir(native.path);
  await writeFile(
    path.join(native.path, "privacy-consent.json"),
    JSON.stringify({ schemaVersion: 1, accepted: true }),
  );
  for (const emitter of [
    process,
    process.stdout,
    process.stderr,
  ] as NodeJS.EventEmitter[])
    previousListeners.set(
      emitter,
      new Map(emitter.eventNames().map((name) => [name, emitter.listeners(name)])),
    );
  native.message.mockResolvedValue({ response: 0, checkboxChecked: true });
  native.open.mockResolvedValue({ canceled: true, filePaths: [] });
  native.menu.mockReturnValue({ popup: vi.fn() });
  native.compile.mockResolvedValue({
    ok: true,
    output: "compiled",
    diagnostics: [],
    durationMs: 1,
  });
  native.asymptote.mockResolvedValue({
    ok: true,
    output: "compiled",
    diagnostics: [],
    durationMs: 1,
  });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockRejectedValue(new Error("Network unavailable in test"));
  await import("./main.js");
  await vi.waitFor(() => expect(native.windows).toHaveLength(1));
  window = native.windows[0] as typeof window;
  const parent = path.join(root, "projects");
  await mkdir(parent);
  native.open.mockResolvedValueOnce({ canceled: false, filePaths: [parent] });
  project = await call("project:create", { folderName: "Paper" });
});
beforeEach(() => {
  native.packaged = false;
  native.open.mockResolvedValue({ canceled: true, filePaths: [] });
  native.save.mockResolvedValue({ canceled: true });
  native.message.mockResolvedValue({ response: 0, checkboxChecked: true });
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new Error("offline"));
  native.external.mockClear();
});
afterAll(async () => {
  native.appEvents.get("before-quit")?.();
  if (originalResourcesPath)
    Object.defineProperty(process, "resourcesPath", originalResourcesPath);
  else Reflect.deleteProperty(process, "resourcesPath");
  for (const [emitter, events] of previousListeners)
    for (const name of emitter.eventNames())
      for (const listener of emitter.listeners(name))
        if (!events.get(name)?.includes(listener))
          emitter.removeListener(name, listener as (...args: unknown[]) => void);
  Object.assign(console, originalConsole);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe("desktop startup and trusted IPC", () => {
  it("starts an isolated renderer and blocks privileged APIs from untrusted senders", async () => {
    expect(window.options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });
    expect(window.loadURL).toHaveBeenCalledWith("latexdo://app/index.html");
    expect(() =>
      native.handlers.get("file:read")!(
        { sender: {}, senderFrame: {} },
        project.id,
        "main.tex",
      ),
    ).toThrow("Untrusted IPC sender");
    for (const event of ["will-navigate", "will-attach-webview"]) {
      const preventDefault = vi.fn();
      window.webContents.emit(event, { preventDefault });
      expect(preventDefault).toHaveBeenCalledOnce();
    }
  });
  it("serves packaged assets only through its own origin and rejects malformed paths", async () => {
    const handler = native.protocol.mock.calls.find(
      ([scheme]) => scheme === "latexdo",
    )![1] as (request: Request) => Promise<Response>;
    for (const url of [
      "https://app/index.html",
      "latexdo://evil/index.html",
      "latexdo://app/missing-file",
      "latexdo://app/%2e%2e%2fpackage.json",
    ]) {
      expect((await handler(new Request(url))).status).toBe(404);
    }
    expect((await handler(new Request("latexdo://app/%00"))).status).toBe(400);
    expect((await handler(new Request("latexdo://app/%zz"))).status).toBe(400);
    expect(
      (await handler(new Request("latexdo://app/index.html", { method: "POST" })))
        .status,
    ).toBe(404);
  });
  it.each([
    ["file:read", []],
    ["file:read", [{}, "main.tex"]],
    ["file:write", ["unknown", "main.tex", {}]],
    ["project:list", ["unknown", { maxDepth: -1 }]],
    ["project:list", ["unknown", { maxEntries: 0 }]],
    ["project:create", [{ folderName: 42 }]],
    ["project:create", [null]],
    ["latex:compile", [{}]],
    [
      "latex:compile",
      [{ projectId: "unknown", rootFile: "main.tex", engine: "shell" }],
    ],
    ["asymptote:compile", [{}]],
    ["pdf:read", ["unknown", "main.exe"]],
    ["synctex:forward", ["unknown", "main.pdf", "main.tex", 0, 1]],
    ["synctex:backward", ["unknown", "main.pdf", 1, Infinity, 0]],
    ["workspace:collect-garbage", ["unknown", { maxBuildBytes: -1 }]],
    ["spellchecker:update-settings", [null]],
    ["proofread:update-settings", [null]],
    ["proofread:check", ["main.exe", "text"]],
    ["app:renderer-diagnostic", [null]],
    ["provider:import-overleaf-project", ["file:///tmp/repo"]],
  ])("rejects malformed arguments for %s", async (channel, args) => {
    await expect(call(channel as string, ...(args as unknown[]))).rejects.toThrow();
  });
  it.each([
    "../secret",
    "/etc/passwd",
    "C:\\Windows\\system.ini",
    "a\u0000b",
    ".git/config",
    "node_modules/pkg/main.js",
  ])("rejects filesystem escapes at the main-process boundary: %s", async (target) => {
    await expect(call("file:read", project.id, target)).rejects.toThrow();
    await expect(call("file:write", project.id, target, "bad")).rejects.toThrow();
  });
});

describe("project files and data preservation", () => {
  it("creates, reads and atomically saves a document", async () => {
    expect(await call("file:read", project.id, "main.tex")).toContain(
      "\\documentclass",
    );
    expect(await call("file:create", project.id, "notes.tex")).toBe("notes.tex");
    await call("file:write", project.id, "notes.tex", "first version");
    await call("file:write", project.id, "notes.tex", "second version");
    expect(await call("file:read", project.id, "notes.tex")).toBe("second version");
    // Saving leaves only the person's file: no .bak copy and no temporary file.
    expect(
      (await readdir(project.rootPath)).filter((name) => name.startsWith("notes.tex")),
    ).toEqual(["notes.tex"]);
    expect(await call("file:exists", project.id, "notes.tex")).toBe(true);
    expect(await call("file:exists", project.id, "absent.tex")).toBe(false);
    expect(await call("file:create", project.id, "notes.tex")).toBe("notes.tex");
    expect(await call("file:read", project.id, "notes.tex")).toBe("second version");
    const entries = await call("project:list", project.id, {
      maxDepth: 2,
      maxEntries: 100,
    });
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "notes.tex", type: "file" }),
      ]),
    );
    const uploaded = await call("file:read-cloud-upload", project.id, "notes.tex");
    expect(Buffer.from(uploaded.contentBase64, "base64").toString()).toBe(
      "second version",
    );
  });
  it("creates BibTeX starter content and moves files without overwriting destinations", async () => {
    await call("file:create", project.id, "refs.bib");
    expect(await call("file:read", project.id, "refs.bib")).toContain("BibTeX");
    await call("folder:create", project.id, "chapters");
    expect(await call("entry:move", project.id, "refs.bib", "chapters/refs.bib")).toBe(
      "chapters/refs.bib",
    );
    expect(
      await call("entry:move", project.id, "chapters/refs.bib", "chapters/refs.bib"),
    ).toBe("chapters/refs.bib");
    await expect(
      call("entry:move", project.id, "absent.tex", "new.tex"),
    ).rejects.toThrow("no longer exists");
    await expect(
      call("entry:move", project.id, "main.tex", "chapters/refs.bib"),
    ).rejects.toThrow("already exists");
    await expect(
      call("entry:move", project.id, "main.tex", "absent/main.tex"),
    ).rejects.toThrow("existing folder");
    await expect(
      call("entry:move", project.id, "chapters", "chapters/nested"),
    ).rejects.toThrow("into itself");
    await expect(
      call("file:read-cloud-upload", project.id, "chapters"),
    ).rejects.toThrow("not a file");
  });
  it("does not follow a symlink outside the trusted project", async () => {
    const secret = path.join(root, "secret.txt");
    await writeFile(secret, "private");
    await symlink(secret, path.join(project.rootPath, "escape.txt"));
    await expect(call("file:read", project.id, "escape.txt")).rejects.toThrow();
    await expect(
      call("file:write", project.id, "escape.txt", "overwrite"),
    ).rejects.toThrow();
    expect(await readFile(secret, "utf8")).toBe("private");
  });
  it("imports files and folders using unique names and keeps originals intact", async () => {
    const source = path.join(root, "import.tex");
    await writeFile(source, "external");
    const imported = await call("file:import-external", project.id, "", [source]);
    expect(imported[0]).toMatchObject({ relativePath: "import.tex", type: "file" });
    const duplicate = await call("file:import-external", project.id, "", [source]);
    expect(duplicate[0].relativePath).toBe("import 2.tex");
    expect(await readFile(source, "utf8")).toBe("external");
    const folder = path.join(root, "images");
    await mkdir(folder);
    await writeFile(path.join(folder, "a.png"), "image");
    expect((await call("file:import-external", project.id, "", [folder]))[0].type).toBe(
      "directory",
    );
    await expect(
      call("file:import-external", project.id, "absent", [source]),
    ).rejects.toThrow("existing project folder");
  });
  it("cancels dialogs without creating projects or importing files", async () => {
    expect(await call("project:open")).toBeNull();
    expect(await call("project:create")).toBeNull();
    expect(await call("research-space:create")).toBeNull();
    expect(await call("docx:import", project.id)).toBeNull();
    expect(await call("markdown:import", project.id)).toBeNull();
    expect(await call("pdf:import", project.id)).toBeNull();
    expect(await call("file:choose-import-external", project.id, "")).toEqual([]);
  });
  it("reopens the folder opened last at the next launch", async () => {
    native.open.mockResolvedValueOnce({
      canceled: false,
      filePaths: [project.rootPath],
    });
    const opened = await call("project:open");
    await vi.waitFor(async () =>
      expect((await call("project:reopen-last"))?.rootPath).toBe(opened.rootPath),
    );
  });
  it("remembers a newly created project instead of the previously opened folder", async () => {
    native.open.mockResolvedValueOnce({
      canceled: false,
      filePaths: [project.rootPath],
    });
    await call("project:open");
    native.open.mockResolvedValueOnce({
      canceled: false,
      filePaths: [path.dirname(project.rootPath)],
    });
    const created = await call("project:create", { folderName: "Latest Paper" });
    expect(created.rootPath).not.toBe(project.rootPath);
    expect((await call("project:reopen-last"))?.rootPath).toBe(created.rootPath);
    expect(
      await readFile(path.join(project.rootPath, "main.tex"), "utf8"),
    ).toBeTruthy();
    // Returning to an already registered project also updates startup restoration.
    native.open.mockResolvedValueOnce({
      canceled: false,
      filePaths: [project.rootPath],
    });
    await call("project:open");
    expect((await call("project:reopen-last"))?.rootPath).toBe(project.rootPath);
  });

  it("opens a trusted folder and opens, never replaces, an existing main.tex", async () => {
    native.open.mockResolvedValueOnce({
      canceled: false,
      filePaths: [project.rootPath],
    });
    expect((await call("project:open")).rootPath).toBe(project.rootPath);
    const before = await readFile(path.join(project.rootPath, "main.tex"), "utf8");

    // "New Project" on a folder that is already a project offers to open it.
    native.open.mockResolvedValueOnce({
      canceled: false,
      filePaths: [project.rootPath],
    });
    native.message.mockResolvedValueOnce({ response: 0 });
    expect((await call("project:create")).rootPath).toBe(project.rootPath);
    expect(native.message.mock.lastCall?.at(-1)).toMatchObject({
      message: "This folder already has a main.tex",
    });

    native.open.mockResolvedValueOnce({
      canceled: false,
      filePaths: [project.rootPath],
    });
    native.message.mockResolvedValueOnce({ response: 1 });
    expect(await call("project:create")).toBeNull();
    expect(await readFile(path.join(project.rootPath, "main.tex"), "utf8")).toBe(
      before,
    );
  });
});

describe("compilation and settings", () => {
  it("hands a validated source path to the compiler and always releases cancellation state", async () => {
    const request = { projectId: project.id, rootFile: "main.tex", engine: "pdflatex" };
    expect(await call("latex:compile", request)).toMatchObject({ ok: true });
    expect(native.compile).toHaveBeenCalledWith(
      expect.objectContaining({ projectPath: project.rootPath, rootFile: "main.tex" }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(await call("latex:compile-cancel", project.id)).toBe(false);
    native.compile.mockRejectedValueOnce(new Error("tool crashed"));
    await expect(call("latex:compile", request)).rejects.toThrow("tool crashed");
    expect(await call("latex:compile-cancel", project.id)).toBe(false);
  });
  it("saves proofreading preferences and maps server findings to source positions", async () => {
    const settings = {
      enabled: true,
      serverUrl: "http://127.0.0.1:8010/",
      language: "en-US",
      picky: true,
      motherTongue: "fr",
    };
    expect(await call("proofread:update-settings", settings)).toMatchObject(settings);
    expect(await call("proofread:get-settings")).toMatchObject(settings);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          matches: [
            {
              message: "Spelling",
              offset: 0,
              length: 4,
              replacements: [{ value: "This" }],
              rule: {
                id: "SPELL",
                issueType: "misspelling",
                category: { name: "Spelling" },
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const result = await call("proofread:check", "main.tex", "Thsi is text.");
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ file: "main.tex", line: 1 })]),
    );
  });
  it("persists spellchecker settings and applies custom words", async () => {
    const settings = await call("spellchecker:update-settings", {
      enabled: false,
      languages: ["en-US"],
      customWords: ["LatexDo", "LatexDo", " Ada "],
    });
    expect(settings.enabled).toBe(false);
    expect(settings.customWords).toEqual(["LatexDo", "Ada"]);
    expect((await call("spellchecker:get-settings")).customWords).toEqual([
      "LatexDo",
      "Ada",
    ]);
    const window = native.windows.at(-1) as {
      webContents: {
        send: ReturnType<typeof vi.fn>;
        session: { dictionary: Set<string> };
      };
    };
    const { session } = window.webContents;
    expect([...session.dictionary]).toEqual(["LatexDo", "Ada"]);

    // Removing a word removes it from Chromium's dictionary and tells the UI.
    await call("spellchecker:update-settings", { ...settings, customWords: ["Ada"] });
    expect([...session.dictionary]).toEqual(["Ada"]);
    expect(window.webContents.send).toHaveBeenCalledWith(
      "spellchecker:changed",
      expect.objectContaining({ customWords: ["Ada"] }),
    );

    await call("spellchecker:update-settings", { ...settings, customWords: [] });
    expect([...session.dictionary]).toEqual([]);
    expect((await call("spellchecker:get-settings")).customWords).toEqual([]);
  });

  it("does not report dictionary words as misspelled", async () => {
    await call("spellchecker:update-settings", {
      enabled: true,
      languages: ["en-US"],
      customWords: ["latexdo"],
    });
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          matches: [
            {
              message: "Possible spelling mistake",
              offset: 4,
              length: 7,
              replacements: [{ value: "latex" }],
              rule: { id: "MORFOLOGIK_RULE_EN_US", issueType: "misspelling" },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const result = await call("proofread:check", "main.tex", "Use LatexDo now.");
    expect(result.diagnostics).toEqual([]);
  });
});

describe("network and external navigation policy", () => {
  it.each([
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://evil.example/",
    "https://user:pass@latexdo.org/",
    "not a url",
  ])("blocks unsafe external destination %s", async (url) => {
    await expect(call("app:open-external", url)).rejects.toThrow(
      "Unsupported external URL",
    );
    expect(native.external).not.toHaveBeenCalled();
  });
  it("allows approved HTTPS destinations and falls back to official downloads", async () => {
    await call("app:open-external", "https://doi.org/10.1234/test");
    expect(native.external).toHaveBeenCalledWith("https://doi.org/10.1234/test");
    await call("app:open-releases", "https://evil.example/");
    expect(native.external).toHaveBeenLastCalledWith("https://latexdo.org/downloads/");
  });
  it.each([
    "http://127.0.0.1/private",
    "https://evil.example/",
    "https://api.crossref.org.evil.example/",
    "file:///secret",
  ])("blocks scholarly SSRF destination %s", async (url) => {
    expect(await call("scholarly:fetch-json", url)).toMatchObject({
      ok: false,
      error: "Unsupported scholarly metadata URL.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("fetches allowed metadata and surfaces upstream errors", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: { items: [] } }), { status: 200 }),
    );
    expect(
      await call("scholarly:fetch-json", "https://api.crossref.org/works?query=latex"),
    ).toEqual({ ok: true, json: { message: { items: [] } } });
    fetchMock.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    expect(
      await call("scholarly:fetch-json", "https://api.crossref.org/works"),
    ).toMatchObject({ ok: false, error: expect.stringContaining("503") });
  });
  it("returns update failure information when the network is offline", async () => {
    const result = await call("app:check-updates");
    expect(result.currentVersion).toBe("0.3.0");
    expect(result.updateAvailable).toBe(false);
    expect(await call("app:last-update-status")).toHaveProperty("status");
  });
});

describe("multi-folder research spaces", () => {
  let space: OpenProject;
  it("creates a persistent space with inferred folder kinds and unique names", async () => {
    const papers = path.join(root, "space-folders", "paper");
    const bibliography = path.join(root, "space-folders", "references");
    const shared = path.join(root, "space-folders", "shared");
    for (const folder of [papers, bibliography, shared])
      await mkdir(folder, { recursive: true });
    await writeFile(path.join(papers, "main.tex"), "paper source");
    await writeFile(path.join(bibliography, "refs.bib"), "@book{ref}");
    native.open.mockResolvedValueOnce({
      canceled: false,
      filePaths: [papers, bibliography, shared],
    });
    native.save.mockResolvedValueOnce({
      canceled: false,
      filePath: path.join(root, "Study"),
    });
    space = await call("research-space:create");
    expect(space.name).toBe("Study");
    expect(space.researchSpace?.folders.map((f) => f.kind)).toEqual([
      "paper",
      "bibliography",
      "shared",
    ]);
    expect(space.rootPath).toMatch(/\.latexdo-space$/);
    const manifest = JSON.parse(await readFile(space.rootPath, "utf8"));
    expect(manifest.folders).toHaveLength(3);
    const tree = await call("project:list", space.id);
    expect(tree.map((entry: { name: string }) => entry.name)).toEqual([
      "paper",
      "references",
      "shared",
    ]);
    expect(tree[0].children).toEqual([
      expect.objectContaining({ relativePath: "paper/main.tex" }),
    ]);
    native.open.mockResolvedValueOnce({ canceled: false, filePaths: [space.rootPath] });
    expect((await call("project:open")).id).toBe(space.id);
    expect((await call("project:reopen-last"))?.id).toBe(space.id);
  });
  it("routes file operations and imports to the selected folder", async () => {
    expect(await call("file:read", space.id, "paper/main.tex")).toBe("paper source");
    expect(await call("file:create", space.id, "paper/new.tex")).toBe("paper/new.tex");
    await call("file:write", space.id, "paper/new.tex", "new paper");
    await call("folder:create", space.id, "shared/figures");
    expect(await call("entry:move", space.id, "paper/new.tex", "shared/new.tex")).toBe(
      "shared/new.tex",
    );
    expect(await call("file:read", space.id, "shared/new.tex")).toBe("new paper");
    await expect(call("entry:move", space.id, "paper", "shared/paper")).rejects.toThrow(
      "folder root",
    );
    await expect(call("file:read", space.id, "unknown/file.tex")).rejects.toThrow(
      "Choose a folder",
    );
    const source = path.join(root, "space-import.txt");
    await writeFile(source, "imported");
    expect(
      (await call("file:import-external", space.id, "", [source]))[0].relativePath,
    ).toBe("paper/space-import.txt");
    native.open.mockResolvedValueOnce({ canceled: false, filePaths: [source] });
    expect(
      (await call("file:choose-import-external", space.id, "shared"))[0].relativePath,
    ).toBe("shared/space-import.txt");
  });
  it("prefixes compiler diagnostics without changing absolute or already-prefixed paths", async () => {
    native.compile.mockResolvedValueOnce({
      ok: false,
      diagnostics: [
        "main.tex",
        "paper/already.tex",
        "/absolute.tex",
        "../outside.tex",
        "https://example.invalid/source",
      ].map((file) => ({ file, line: 1, message: "error", severity: "error" })),
      output: "failed",
      durationMs: 1,
    });
    const result = await call("latex:compile", {
      projectId: space.id,
      rootFile: "paper/main.tex",
      engine: "pdflatex",
    });
    expect(result.diagnostics.map((d: { file: string }) => d.file)).toEqual([
      "paper/main.tex",
      "paper/already.tex",
      "/absolute.tex",
      "../outside.tex",
      "https://example.invalid/source",
    ]);
    expect(native.compile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        projectPath: space.researchSpace!.folders[0].path,
        rootFile: "main.tex",
      }),
      expect.any(Object),
    );
  });
  it("prevents repository-wide Git actions across unrelated folders", async () => {
    expect(await call("git:status", space.id)).toMatchObject({
      isRepo: false,
      entries: [],
      error: expect.stringContaining("one folder"),
    });
    expect(await call("git:history", space.id)).toEqual({
      scope: "repo",
      target: null,
      commits: [],
    });
    for (const channel of ["git:stage-all", "git:unstage-all", "git:discard-all"])
      await expect(call(channel, space.id)).rejects.toThrow("multi-folder");
    await expect(call("git:commit", space.id, "message")).rejects.toThrow(
      "multi-folder",
    );
    await expect(call("git:commit-details", space.id, "a".repeat(40))).rejects.toThrow(
      "multi-folder",
    );
  });
  it.each([
    "not json",
    "null",
    JSON.stringify({ folders: [] }),
    JSON.stringify({ folders: [null] }),
    JSON.stringify({ folders: [{ path: "absent-folder" }] }),
  ])("rejects malformed Research Space manifests %s", async (content) => {
    const file = path.join(root, "invalid.latexdo-space");
    await writeFile(file, content);
    native.open.mockResolvedValueOnce({ canceled: false, filePaths: [file] });
    await expect(call("project:open")).rejects.toThrow(/Research Space/);
  });
  it("normalizes duplicate unsafe folder labels and infers missing kinds", async () => {
    const file = path.join(root, "duplicate.latexdo-space");
    const folder = space.researchSpace!.folders[0].path;
    await writeFile(
      file,
      JSON.stringify({
        name: "  Duplicate\nStudy  ",
        folders: [
          { name: "same", path: folder },
          { name: "same", path: folder },
          { name: ".git", path: folder },
          { name: "../bad:name", path: folder },
        ],
      }),
    );
    native.open.mockResolvedValueOnce({ canceled: false, filePaths: [file] });
    const opened = await call("project:open");
    expect(opened.researchSpace.folders.map((f: { name: string }) => f.name)).toEqual([
      "same",
      "same 2",
      "paper",
      ".. bad name",
    ]);
    expect(opened.name).toBe("Duplicate Study");
  });
  it("cancels saving the manifest and rejects an empty selection of valid folders", async () => {
    native.open.mockResolvedValueOnce({ canceled: false, filePaths: [root] });
    expect(await call("research-space:create")).toBeNull();
    native.open.mockResolvedValueOnce({
      canceled: false,
      filePaths: [path.join(root, "absent")],
    });
    native.save.mockResolvedValueOnce({
      canceled: false,
      filePath: path.join(root, "empty.latexdo-space"),
    });
    await expect(call("research-space:create")).rejects.toThrow("Choose at least one");
  });
  it("saves an open folder as a space and adds folders to it", async () => {
    native.save.mockResolvedValueOnce({
      canceled: false,
      filePath: path.join(root, "Saved Paper"),
    });
    const saved = await call("research-space:save-as", project.id);
    expect(saved.rootPath).toBe(path.join(root, "Saved Paper.latexdo-space"));
    expect(saved.researchSpace.folders.map((f: { path: string }) => f.path)).toEqual([
      project.rootPath,
    ]);

    const extra = path.join(root, "space-folders", "extra");
    await mkdir(extra, { recursive: true });
    native.open.mockResolvedValueOnce({
      canceled: false,
      filePaths: [extra, project.rootPath],
    });
    const grown = await call("research-space:add-folder", saved.id);
    expect(grown.id).toBe(saved.id);
    expect(grown.researchSpace.folders.map((f: { path: string }) => f.path)).toEqual([
      project.rootPath,
      extra,
    ]);
    const manifest = JSON.parse(await readFile(saved.rootPath, "utf8"));
    expect(manifest.folders).toHaveLength(2);

    native.open.mockResolvedValueOnce({ canceled: false, filePaths: [extra] });
    await expect(call("research-space:add-folder", saved.id)).rejects.toThrow(
      "already in this Research Space",
    );
    native.open.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await call("research-space:add-folder", saved.id)).toBeNull();
  });
  it("turns a plain folder into a space when a folder is added to it", async () => {
    const extra = path.join(root, "space-folders", "notes");
    await mkdir(extra, { recursive: true });
    native.open.mockResolvedValueOnce({ canceled: false, filePaths: [extra] });
    native.save.mockResolvedValueOnce({
      canceled: false,
      filePath: path.join(root, "Paper and notes.latexdo-space"),
    });
    const space = await call("research-space:add-folder", project.id);
    expect(space.researchSpace.folders.map((f: { path: string }) => f.path)).toEqual([
      project.rootPath,
      extra,
    ]);
    await expect(call("research-space:save-as", "missing")).rejects.toThrow("not open");
  });
});

describe("application menu", () => {
  const appMenu = () =>
    native.menu.mock.calls
      .map(([template]) => template as Electron.MenuItemConstructorOptions[])
      .find((template) => template.some((item) => item.label === "File"))!;
  const findItem = (label: string) =>
    appMenu()
      .flatMap((menu) => (menu.submenu as Electron.MenuItemConstructorOptions[]) ?? [])
      .flatMap((item) =>
        Array.isArray(item.submenu) ? [item, ...item.submenu] : [item],
      )
      .find((item) => item.label === label)!;
  const click = (label: string, triggeredByAccelerator: boolean) =>
    (findItem(label).click as (...args: unknown[]) => void)({}, window, {
      triggeredByAccelerator,
    });

  it("opens a separate empty window from File and the macOS Dock", async () => {
    const before = native.windows.length;
    expect(findItem("New Window").accelerator).toBe("CmdOrCtrl+Shift+N");
    click("New Window", true);
    expect(native.windows).toHaveLength(before + 1);
    const created = native.windows.at(-1) as typeof window;
    expect(created).not.toBe(window);
    expect(created.options.webPreferences).toMatchObject({
      additionalArguments: ["--latexdo-empty-workspace"],
      sandbox: true,
      contextIsolation: true,
    });
    expect(created.loadURL).toHaveBeenCalledWith("latexdo://app/index.html");
    native.windows.pop();
    if (process.platform === "darwin") {
      const { app } = await import("electron");
      expect(app.dock!.setMenu).toHaveBeenCalledOnce();
      const dockTemplate = native.menu.mock.calls
        .map(([template]) => template as Electron.MenuItemConstructorOptions[])
        .find(
          (template) => template.length === 1 && template[0].label === "New Window",
        )!;
      (dockTemplate[0].click as () => void)();
      expect(native.windows).toHaveLength(before + 1);
      expect(
        (native.windows.at(-1) as typeof window).options.webPreferences,
      ).toMatchObject({
        additionalArguments: ["--latexdo-empty-workspace"],
      });
      native.windows.pop();
    }
  });

  it("sends menu commands to the focused window", () => {
    window.webContents.send.mockClear();
    click("Go to File...", true);
    expect(window.webContents.send).toHaveBeenCalledWith("menu:command", "go.file");
  });
  it("runs editor-only items from a click but leaves their keys to the editor", () => {
    window.webContents.send.mockClear();
    click("Go to Line...", true);
    expect(window.webContents.send).not.toHaveBeenCalled();
    click("Go to Line...", false);
    expect(window.webContents.send).toHaveBeenCalledWith(
      "menu:command",
      "editor:editor.action.gotoLine",
    );
  });
  it("lists every shortcut in the menu for this platform", async () => {
    const shortcuts = await call("app:menu-shortcuts");
    const mac = process.platform === "darwin";
    expect(shortcuts).toContainEqual({
      menu: "File",
      label: "Save",
      keys: mac ? "⌘S" : "Ctrl+S",
      editorOnly: false,
    });
    expect(shortcuts).toContainEqual({
      menu: "Edit",
      label: "Undo",
      keys: mac ? "⌘Z" : "Ctrl+Z",
      editorOnly: false,
    });
    expect(shortcuts).toContainEqual({
      menu: "Go",
      label: "Go to Line",
      keys: mac ? "⌃G" : "Ctrl+G",
      editorOnly: true,
    });
    const keys = shortcuts.map((s: { keys: string }) => s.keys);
    // One accelerator, one command within each scope: a repeated key would
    // make one of them dead. An editor-only key may reuse a workbench key on
    // purpose (Bold and Toggle Sidebar): the editor takes it while focused.
    const labelsByKey = new Map<string, Set<string>>();
    for (const s of shortcuts as {
      keys: string;
      label: string;
      editorOnly: boolean;
    }[]) {
      const key = `${s.editorOnly ? "editor" : "app"} ${s.keys}`;
      labelsByKey.set(key, (labelsByKey.get(key) ?? new Set()).add(s.label));
    }
    const clashes = [...labelsByKey].filter(([, labels]) => labels.size > 1);
    expect(clashes).toEqual([]);
    expect(shortcuts).toContainEqual({
      menu: "Insert",
      label: "Bold",
      keys: mac ? "⌘B" : "Ctrl+B",
      editorOnly: true,
    });
    expect(keys.length).toBeGreaterThan(50);
  });
});

describe("desktop Git data preservation", () => {
  let repo: OpenProject;
  const git = (...args: string[]) => runGitText(repo.rootPath, args);
  it("stages, unstages and commits through validated IPC", async () => {
    const folder = path.join(root, "git-paper");
    await mkdir(folder);
    native.open.mockResolvedValueOnce({ canceled: false, filePaths: [folder] });
    repo = await call("project:create");
    await git("init", "--initial-branch=main");
    await git("config", "user.name", "Test Author");
    await git("config", "user.email", "test@example.invalid");
    await git("config", "commit.gpgsign", "false");
    await call("git:stage-all", repo.id);
    await call("git:commit", repo.id, "Initial paper");
    await call("file:write", repo.id, "main.tex", "edited\n");
    await call("git:stage", repo.id, "main.tex");
    expect((await call("git:status", repo.id)).entries[0].staged).toBe(true);
    await call("git:unstage", repo.id, "main.tex");
    expect((await call("git:status", repo.id)).entries[0].staged).toBe(false);
    await call("git:stage-all", repo.id);
    await call("git:unstage-all", repo.id);
    expect((await call("git:status", repo.id)).entries[0].staged).toBe(false);
    await expect(call("git:commit", repo.id, "  ")).rejects.toThrow();
    expect((await call("git:diff", repo.id, "main.tex")).diff).toContain("+edited");
    expect(await call("git:editor-diff", repo.id, "main.tex")).toMatchObject({
      modifiedContent: "edited\n",
    });
    const history = await call("git:history", repo.id);
    expect(history.commits[0].subject).toBe("Initial paper");
    const hash = history.commits[0].hash;
    expect(await call("git:commit-details", repo.id, hash)).toMatchObject({
      summary: "Initial paper",
    });
    expect(await call("git:commit-file-diff", repo.id, "main.tex", hash)).toMatchObject(
      { status: "added" },
    );
    expect(
      (await call("git:blame", repo.id, "main.tex", { kind: "commit", hash })).length,
    ).toBeGreaterThan(0);
    await call("git:reveal-file", repo.id, "main.tex");
  });
  it("requires confirmation before discard and saves a recoverable patch before restoring", async () => {
    expect(await call("git:discard", repo.id, "main.tex")).toEqual({
      discarded: false,
    });
    expect(await call("file:read", repo.id, "main.tex")).toBe("edited\n");
    native.message.mockResolvedValueOnce({ response: 1 });
    const result = await call("git:discard", repo.id, "main.tex");
    expect(result.discarded).toBe(true);
    expect(result.recoveryPatch).toMatch(/^\.latexdo\/recovery\/.*\.patch$/);
    expect(
      await readFile(path.join(repo.rootPath, result.recoveryPatch), "utf8"),
    ).toContain("+edited");
    expect(await call("file:read", repo.id, "main.tex")).toContain("\\documentclass");
  });
  it("backs up an untracked file before discarding it and keeps untracked files during discard-all", async () => {
    await call("file:write", repo.id, "draft.tex", "uncommitted research");
    native.message.mockResolvedValueOnce({ response: 1 });
    const discarded = await call("git:discard", repo.id, "draft.tex");
    expect(
      await readFile(path.join(repo.rootPath, discarded.recoveryPatch), "utf8"),
    ).toBe("uncommitted research");
    expect(await call("file:exists", repo.id, "draft.tex")).toBe(false);
    await call("file:write", repo.id, "keep.tex", "keep");
    await call("file:write", repo.id, "main.tex", "changed again\n");
    expect(await call("git:discard-all", repo.id)).toEqual({ discarded: false });
    native.message.mockResolvedValueOnce({ response: 1 });
    const all = await call("git:discard-all", repo.id);
    expect(
      await readFile(path.join(repo.rootPath, all.recoveryPatch), "utf8"),
    ).toContain("+changed again");
    expect(await call("file:read", repo.id, "keep.tex")).toBe("keep");
    expect(await call("file:read", repo.id, "main.tex")).toContain("\\documentclass");
  });
});

describe("proofreading source mapping", () => {
  it("removes commands, comments and math while preserving source offsets", async () => {
    await call("proofread:update-settings", {
      enabled: true,
      serverUrl: "http://127.0.0.1:8010",
      language: "en",
      picky: false,
      motherTongue: "",
    });
    const source =
      "\\documentclass[12pt]{article}\n% hidden\n\\section{Visible title}\nA $x+y$ $$z$$ \\(w\\) \\[v\\] \\cite[see [also]]{nested{key}} \\href{https://example.invalid}{link} \\% word.\nThsi sentence.";
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          matches: [
            {
              offset: source.indexOf("Thsi"),
              length: 4,
              message: "Spelling",
              replacements: [{ value: "This" }, { value: "This" }, {}],
            },
            { offset: -1 },
            { offset: source.length + 1 },
          ],
        }),
      ),
    );
    const result = await call("proofread:check", "main.tex", source, {
      baseLine: 10,
      baseColumn: 3,
    });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        line: 14,
        column: 1,
        endColumn: 5,
        replacements: ["This"],
      }),
    ]);
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    const sanitized = body.get("text")!;
    expect(sanitized.length).toBe(source.length);
    expect(sanitized.indexOf("Thsi")).toBe(source.indexOf("Thsi"));
    for (const hidden of ["hidden", "article", "x+y", "nested", "example.invalid"])
      expect(sanitized).not.toContain(hidden);
    expect(sanitized).toContain("Visible title");
  });
  it("skips disabled or math-only requests and limits large text", async () => {
    await call("proofread:update-settings", {
      ...(await call("proofread:get-settings")),
      enabled: false,
    });
    expect(await call("proofread:check", "main.tex", "text")).toMatchObject({
      checkedTextLength: 0,
      output: "Proofreading is disabled.",
    });
    await call("proofread:update-settings", {
      ...(await call("proofread:get-settings")),
      enabled: true,
    });
    expect(await call("proofread:check", "main.tex", "$x$\n% comment")).toMatchObject({
      checkedTextLength: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ matches: [] })));
    const result = await call("proofread:check", "notes.md", "word ".repeat(5000), {
      truncated: true,
    });
    expect(result.checkedTextLength).toBeLessThanOrEqual(20000);
    expect(result.output).toContain("limit 20");
    fetchMock.mockResolvedValueOnce(new Response("down", { status: 503 }));
    expect(await call("proofread:check", "notes.md", "words")).toMatchObject({
      error: "Proofreading failed (503)",
    });
  });
});

describe("signed update feed checks", () => {
  const keys = generateKeyPairSync("ed25519");
  function canonical(value: any): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object")
      return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
        .join(",")}}`;
    return JSON.stringify(value);
  }
  function feed(changes: Record<string, unknown> = {}) {
    const payload = {
      schemaVersion: 2,
      product: "LatexDo",
      channel: "stable",
      version: "0.4.0",
      release: "v0.4.0",
      commit: "a".repeat(40),
      publishedAt: new Date(Date.now() - 10000).toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      files: [],
      releaseUrl: "https://latexdo.org/downloads/v0.4.0/",
      ...changes,
    };
    return {
      ...payload,
      signature: {
        algorithm: "ed25519",
        keyId: createHash("sha256")
          .update(keys.publicKey.export({ type: "spki", format: "der" }))
          .digest("hex")
          .slice(0, 16),
        value: sign(null, Buffer.from(canonical(payload)), keys.privateKey).toString(
          "base64",
        ),
      },
    };
  }
  async function serve(payload: unknown) {
    native.packaged = true;
    Object.defineProperty(process, "resourcesPath", {
      configurable: true,
      value: root,
    });
    await writeFile(
      path.join(root, "update-public-key.pem"),
      keys.publicKey.export({ type: "spki", format: "pem" }),
    );
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("/updates/")
        ? new Response(JSON.stringify(payload))
        : new Response("unavailable", { status: 503 }),
    );
  }
  it("accepts a valid feed, stores rollback protection and uses manual download when no installer matches", async () => {
    const payload = feed();
    await serve(payload);
    expect(await call("app:check-updates")).toMatchObject({
      latestVersion: "0.4.0",
      updateAvailable: true,
      automaticInstallAvailable: false,
    });
    expect(await call("app:check-updates")).toMatchObject({ updateAvailable: true });
    expect(await call("app:update-now")).toMatchObject({
      opened: true,
      manualDownload: true,
    });
    expect(native.external).toHaveBeenCalledWith(
      "https://latexdo.org/downloads/v0.4.0/",
    );
  });
  it.each([
    { version: "0.2.0", release: "v0.2.0" },
    { expiresAt: "2000-01-01" },
    { channel: "beta" },
    { commit: "bad" },
    { publishedAt: "2099-01-01", expiresAt: "2099-02-01" },
    { commit: "b".repeat(40) },
  ])("rejects stale or invalid signed feed %j", async (changes) => {
    await serve(feed(changes));
    const result = await call("app:check-updates");
    expect(result.updateAvailable).toBe(false);
    expect(result.error).toMatch(/feed|older|trusted/i);
  });
  it("rejects a tampered signature and falls back to a valid downloads manifest", async () => {
    const payload = feed();
    payload.version = "9.0.0";
    await serve(payload);
    expect((await call("app:check-updates")).error).toContain(
      "signature verification failed",
    );
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("/updates/")
        ? new Response("{}")
        : new Response(
            JSON.stringify({
              schemaVersion: 1,
              product: "LatexDo",
              version: "0.3.0",
              files: [],
            }),
          ),
    );
    expect(await call("app:update-now")).toMatchObject({
      updateAvailable: false,
      opened: false,
      manualDownload: false,
    });
  });

  it("never installs automatically from the unsigned downloads manifest", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("/updates/")
        ? new Response("{}")
        : new Response(
            JSON.stringify({
              schemaVersion: 1,
              product: "LatexDo",
              version: "9.9.9",
              downloadsPage: "https://latexdo.org/downloads/v9.9.9/",
              files: [
                {
                  id: "macos-arm64",
                  platform: "macos",
                  arch: "arm64",
                  filename: "LatexDo-macos-arm64.dmg",
                  sha256: "a".repeat(64),
                  url: "https://latexdo.org/downloads/v9.9.9/LatexDo-macos-arm64.dmg",
                },
              ],
            }),
          ),
    );
    expect(await call("app:check-updates")).toMatchObject({
      latestVersion: "9.9.9",
      updateAvailable: true,
      automaticInstallAvailable: false,
    });
    const requestsBeforeInstall = fetchMock.mock.calls.length;
    expect(await call("app:update-now")).toMatchObject({
      installerPath: null,
      manualDownload: true,
    });
    // Only the two metadata documents are fetched again; no installer is downloaded.
    const installerRequests = fetchMock.mock.calls
      .slice(requestsBeforeInstall)
      .filter(([url]) => String(url).includes(".dmg"));
    expect(installerRequests).toEqual([]);
  });

  it("offers a newer build of the same version from the downloads manifest", async () => {
    const manifest = (commit: string, publishedAt: string) => {
      fetchMock.mockImplementation(async (url: string) =>
        url.includes("/updates/")
          ? new Response("{}")
          : new Response(
              JSON.stringify({
                schemaVersion: 1,
                product: "LatexDo",
                version: "0.3.0",
                commit,
                publishedAt,
                files: [],
              }),
            ),
      );
    };
    manifest("f".repeat(40), "2026-02-01T00:00:00.000Z");
    expect(await call("app:check-updates")).toMatchObject({
      currentVersion: "0.3.0",
      latestVersion: "0.3.0",
      latestCommit: "f".repeat(40),
      currentCommit: "e".repeat(40),
      updateAvailable: true,
    });
    // The installed build itself, or one published before it was built, is not an update.
    manifest("e".repeat(40), "2026-02-01T00:00:00.000Z");
    expect((await call("app:check-updates")).updateAvailable).toBe(false);
    manifest("f".repeat(40), "2025-12-01T00:00:00.000Z");
    expect((await call("app:check-updates")).updateAvailable).toBe(false);
  });

  it("checks both website documents freshly and selects the newer published installer version", async () => {
    const payload = feed();
    await serve(payload);
    fetchMock.mockImplementation(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.includes("/updates/")
              ? payload
              : {
                  schemaVersion: 1,
                  product: "LatexDo",
                  version: "0.5.0",
                  files: [],
                },
          ),
        ),
    );
    fetchMock.mockClear();
    expect(await call("app:check-updates")).toMatchObject({
      currentVersion: "0.3.0",
      latestVersion: "0.5.0",
      updateAvailable: true,
    });
    expect(await call("app:check-updates")).toMatchObject({ latestVersion: "0.5.0" });
    const calls = fetchMock.mock.calls;
    expect(calls).toHaveLength(4);
    expect(new Set(calls.map(([url]) => url)).size).toBe(4);
    for (const [url, options] of calls) {
      expect(new URL(url).searchParams.has("_latexdo_check")).toBe(true);
      expect(options.cache).toBe("no-store");
      expect(options.headers["Cache-Control"]).toContain("no-cache");
    }
  });
});

describe("desktop recovery and hosted compilation", () => {
  it("materializes a shared project, compiles it and maps its PDF back to the mirror", async () => {
    const id = "project_coverage123",
      mirror = path.join(native.path, "latexdo-cloud", id);
    native.compile.mockImplementationOnce(async (_request, options) => {
      options.onProgress(45);
      await writeFile(path.join(mirror, "main.pdf"), "%PDF-test");
      return {
        ok: true,
        pdfPath: path.join(mirror, "main.pdf"),
        durationMs: 1,
        diagnostics: [],
        output: "built",
      };
    });
    const result = await call("latex:compile-cloud", {
      projectId: id,
      rootFile: "main.tex",
      engine: "pdflatex",
      files: [
        { relativePath: "main.tex", content: "Shared source" },
        { relativePath: "sections/intro.tex", content: "Introduction" },
      ],
    });
    expect(result).toMatchObject({ ok: true, pdfPath: "main.pdf" });
    expect(await readFile(path.join(mirror, "sections/intro.tex"), "utf8")).toBe(
      "Introduction",
    );
    expect(window.webContents.send).toHaveBeenCalledWith("compile:progress", {
      projectId: id,
      progress: 45,
    });
    expect(Buffer.from(await call("pdf:read", id, "main.pdf")).toString()).toBe(
      "%PDF-test",
    );
    expect(await call("latex:compile-cancel", id)).toBe(false);
  });
  it("rejects invalid shared projects and untrusted authors before starting a compiler", async () => {
    const base = {
      projectId: "project_coverage456",
      rootFile: "main.tex",
      engine: "pdflatex",
      files: [{ relativePath: "main.tex", content: "Source" }],
    };
    for (const patch of [
      { projectId: "bad" },
      { files: null },
      { files: [null] },
      { files: [{ relativePath: "../outside.tex", content: "x" }] },
    ])
      await expect(
        call("latex:compile-cloud", { ...base, ...patch }),
      ).rejects.toThrow();
    await writeFile(
      path.join(native.path, "trusted-workspaces.json"),
      JSON.stringify({ paths: [] }),
    );
    native.message.mockResolvedValueOnce({ response: 1 });
    await expect(call("latex:compile-cloud", base)).rejects.toThrow(
      "Trust the shared project's authors",
    );
  });
  it.each(["docx", "markdown"])(
    "reads an explicitly chosen %s for hosted import and validates type and size",
    async (kind) => {
      const chosen = path.join(root, kind === "docx" ? "hosted.docx" : "hosted.md");
      await writeFile(chosen, "input bytes");
      native.open.mockResolvedValueOnce({ canceled: false, filePaths: [chosen] });
      expect(await call("file:choose-hosted-import", kind)).toEqual({
        fileName: path.basename(chosen),
        contentBase64: Buffer.from("input bytes").toString("base64"),
      });
      native.open.mockResolvedValueOnce({
        canceled: false,
        filePaths: [path.join(root, "wrong.exe")],
      });
      await expect(call("file:choose-hosted-import", kind)).rejects.toThrow(
        "does not match",
      );
      await writeFile(chosen, Buffer.alloc(5 * 1024 * 1024 + 1));
      native.open.mockResolvedValueOnce({ canceled: false, filePaths: [chosen] });
      await expect(call("file:choose-hosted-import", kind)).rejects.toThrow("5 MiB");
      expect(await call("file:choose-hosted-import", kind)).toBeNull();
    },
  );
  it("imports Markdown into an open project and creates a trusted project for standalone imports", async () => {
    const source = path.join(root, "standalone-import", "draft.md");
    await mkdir(path.dirname(source));
    await writeFile(
      source,
      "# Scientific result\n\n**Important** result with [source](https://example.org).",
    );
    native.open.mockResolvedValueOnce({ canceled: false, filePaths: [source] });
    const imported = await call("markdown:import", project.id);
    expect(imported.project.id).toBe(project.id);
    expect(
      await readFile(path.join(project.rootPath, imported.relativePath), "utf8"),
    ).toContain("Scientific result");
    native.open.mockResolvedValueOnce({ canceled: false, filePaths: [source] });
    const standalone = await call("markdown:import", null);
    expect(standalone.project.rootPath).toBe(path.dirname(source));
    expect(
      await call("file:exists", standalone.project.id, standalone.relativePath),
    ).toBe(true);
  });
  it("builds a native spelling menu and persists added dictionary words", async () => {
    window.webContents.emit("did-finish-load");
    await vi.waitFor(() =>
      expect(window.webContents.listenerCount("context-menu")).toBe(1),
    );
    window.webContents.emit(
      "context-menu",
      {},
      {
        dictionarySuggestions: ["correct", "other"],
        misspelledWord: "LatexDoCoverage",
        isEditable: true,
        selectionText: "",
      },
    );
    const menu = native.menu.mock.calls.at(-1)![0];
    menu.find((item: any) => item.label === "correct").click();
    expect((window.webContents as any).replaceMisspelling).toHaveBeenCalledWith(
      "correct",
    );
    menu.find((item: any) => item.label?.startsWith("Add ")).click();
    await vi.waitFor(async () =>
      expect((await call("spellchecker:get-settings")).customWords).toContain(
        "LatexDoCoverage",
      ),
    );
    expect(menu.map((item: any) => item.role)).toEqual(
      expect.arrayContaining(["undo", "cut", "paste"]),
    );
    window.webContents.emit(
      "context-menu",
      {},
      {
        dictionarySuggestions: [],
        misspelledWord: "",
        isEditable: false,
        selectionText: "selection",
      },
    );
    expect(native.menu.mock.calls.at(-1)![0]).toEqual([{ role: "copy" }]);
  });
  it("recovers a renderer crash and offers a controlled quit on memory exhaustion", async () => {
    window.loadURL.mockClear();
    native.appEvents.get("render-process-gone")!({}, window.webContents, {
      reason: "crashed",
      exitCode: 9,
    });
    await vi.waitFor(() =>
      expect(window.loadURL).toHaveBeenCalledWith("latexdo://app/index.html"),
    );
    expect(
      window.loadURL.mock.calls.some(([url]) =>
        String(url).startsWith("data:text/html"),
      ),
    ).toBe(true);
    native.message.mockResolvedValueOnce({ response: 1 });
    native.quit.mockClear();
    native.appEvents.get("render-process-gone")!({}, window.webContents, {
      reason: "oom",
      exitCode: 1,
    });
    await vi.waitFor(() => expect(native.quit).toHaveBeenCalledOnce());
    expect(native.message.mock.calls.at(-1)![1]).toMatchObject({
      type: "warning",
      buttons: ["Reload Editor", "Quit"],
    });
  });
  it("ignores subframe and canceled loads and retries a main-frame load failure", async () => {
    window.loadURL.mockClear();
    window.webContents.emit(
      "did-fail-load",
      {},
      -3,
      "aborted",
      "latexdo://app/index.html",
      true,
    );
    window.webContents.emit(
      "did-fail-load",
      {},
      -6,
      "missing",
      "latexdo://app/index.html",
      false,
    );
    expect(window.loadURL).not.toHaveBeenCalled();
    window.webContents.emit(
      "did-fail-load",
      {},
      -6,
      "missing",
      "latexdo://app/index.html",
      true,
      1,
      1,
    );
    await vi.waitFor(() =>
      expect(window.loadURL).toHaveBeenCalledWith("latexdo://app/index.html"),
    );
  });
  it("records child process failures without quitting the editor", () => {
    native.quit.mockClear();
    native.appEvents.get("child-process-gone")!(
      {},
      { reason: "clean-exit", type: "Utility", exitCode: 0 },
    );
    native.appEvents.get("child-process-gone")!(
      {},
      { reason: "crashed", type: "GPU", exitCode: 1, serviceName: "gpu", name: "GPU" },
    );
    expect(native.quit).not.toHaveBeenCalled();
  });
});

describe("desktop copy, trash and shared-space export", () => {
  it("copies files and directories without overwriting or recursive self-copy", async () => {
    await call("folder:create", project.id, "copy-tests");
    await call("file:write", project.id, "copy-tests/source.tex", "original");
    expect(
      await call(
        "entry:copy",
        project.id,
        "copy-tests/source.tex",
        "copy-tests/copy.tex",
      ),
    ).toBe("copy-tests/copy.tex");
    expect(await call("file:read", project.id, "copy-tests/copy.tex")).toBe("original");
    await expect(
      call("entry:copy", project.id, "copy-tests/source.tex", "copy-tests/copy.tex"),
    ).rejects.toThrow("already exists");
    await expect(
      call("entry:copy", project.id, "missing.tex", "copy-tests/missing.tex"),
    ).rejects.toThrow("no longer exists");
    await expect(
      call("entry:copy", project.id, "copy-tests", "copy-tests/inside"),
    ).rejects.toThrow("into itself");
    await call("entry:copy", project.id, "copy-tests", "copied-folder");
    expect(await call("file:read", project.id, "copied-folder/source.tex")).toBe(
      "original",
    );
    await expect(
      call("entry:copy", project.id, "copy-tests/source.tex", "../escape.tex"),
    ).rejects.toThrow();
  });
  it("delegates trash to the OS only for existing project entries", async () => {
    await call("file:write", project.id, "trash-test.tex", "recoverable");
    await call("entry:trash", project.id, "trash-test.tex");
    expect(native.trash).toHaveBeenCalledWith(
      path.join(project.rootPath, "trash-test.tex"),
    );
    await expect(call("entry:trash", project.id, "missing-trash.tex")).rejects.toThrow(
      "no longer exists",
    );
    await expect(call("entry:trash", project.id, ".")).rejects.toThrow();
    // The mock never touches the real OS Trash.
    expect(await call("file:read", project.id, "trash-test.tex")).toBe("recoverable");
  });
  it("exports shared text and binary files into a fresh Research Space", async () => {
    const destination = path.join(root, "shared-export.latexdo-space");
    native.save.mockResolvedValueOnce({ canceled: false, filePath: destination });
    const exported = await call("research-space:save-as-cloud", "Shared paper", [
      { relativePath: "main.tex", content: "source" },
      {
        relativePath: "image.png",
        base64: Buffer.from([0, 1, 255]).toString("base64"),
      },
      { relativePath: "empty.txt" },
    ]);
    expect(exported.rootPath).toBe(destination);
    const folders = exported.researchSpace.folders;
    expect(folders).toHaveLength(1);
    expect(await call("file:read", exported.id, `${folders[0].name}/main.tex`)).toBe(
      "source",
    );
    expect(
      Buffer.from(
        await call("asset:read", exported.id, `${folders[0].name}/image.png`),
      ),
    ).toEqual(Buffer.from([0, 1, 255]));
    expect(await call("file:read", exported.id, `${folders[0].name}/empty.txt`)).toBe(
      "",
    );
    expect(await call("research-space:save-as-cloud", "Cancelled", [])).toBeNull();
    for (const [name, files] of [
      [null, []],
      ["name", null],
      ["name", [null]],
      ["name", [{ relativePath: "../escape" }]],
    ])
      await expect(call("research-space:save-as-cloud", name, files)).rejects.toThrow();
    for (const channel of ["git:repository-info", "git:diff-for-message"])
      await expect(call(channel, exported.id)).rejects.toThrow();
    await expect(call("git:action", exported.id, { kind: "init" })).rejects.toThrow();
  });
  it("initializes and queries a repository using the general Git action route", async () => {
    const parent = path.join(root, "action-repo");
    await mkdir(parent);
    native.open.mockResolvedValueOnce({ canceled: false, filePaths: [parent] });
    const repo = await call("project:create");
    const git = (...args: string[]) => runGitText(repo.rootPath, args);
    await call("git:action", repo.id, { kind: "init" });
    await git("config", "user.name", "Test");
    await git("config", "user.email", "test@example.invalid");
    await git("config", "commit.gpgsign", "false");
    await call("git:action", repo.id, {
      kind: "commit",
      all: true,
      message: "Initial",
    });
    const details = await call("git:repository-info", repo.id);
    expect(
      details.branches.some((branch: { current: boolean }) => branch.current),
    ).toBe(true);
    await call("file:write", repo.id, "main.tex", "new text");
    expect(await call("git:diff-for-message", repo.id)).toContain("+new text");
    expect(
      (await call("git:graph", repo.id, { limit: 1, refs: "all" })).commits,
    ).toHaveLength(1);
    await expect(call("git:action", repo.id, { kind: "invalid" })).rejects.toThrow();
  });
});
