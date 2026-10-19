/* eslint-disable @typescript-eslint/no-explicit-any */
// Shared harness for the Electron main-process suites. main.ts runs its whole
// startup on import, so each suite boots it (possibly several times, with
// vi.resetModules) against these fakes. State lives on globalThis so it stays
// shared when the module registry is reset between boots.
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { vi, expect } from "vitest";

type Fn = (...args: any[]) => any;

export interface MainHarness {
  handlers: Map<string, Fn>;
  appEvents: Map<string, Fn>;
  windows: any[];
  createdWindows: any[];
  paths: Record<string, string>;
  defaultPath: string;
  packaged: boolean;
  version: string;
  appName: string;
  locale: string;
  lock: boolean;
  ready: Promise<void>;
  resolveReady: () => void;
  rejectReady: (error: unknown) => void;
  entryUrl: string;
  fromWebContents: ((contents: unknown) => any) | undefined;
  focusedWindow: any;
  spellLanguages: string[];
  listWordsFails: boolean;
  isLoadingMainFrame: boolean;
  loadURL: ((window: any, url: string) => Promise<void>) | undefined;
  executeJavaScript: Fn;
  crashRenderer: ((contents: any) => void) | undefined;
  open: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  message: ReturnType<typeof vi.fn>;
  errorBox: ReturnType<typeof vi.fn>;
  external: ReturnType<typeof vi.fn>;
  showItemInFolder: ReturnType<typeof vi.fn>;
  trashItem: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
  exit: ReturnType<typeof vi.fn>;
  setPath: ReturnType<typeof vi.fn>;
  dockSetIcon: ReturnType<typeof vi.fn>;
  menu: ReturnType<typeof vi.fn>;
  setApplicationMenu: ReturnType<typeof vi.fn>;
  protocol: ReturnType<typeof vi.fn>;
  compile: ReturnType<typeof vi.fn>;
  asymptote: ReturnType<typeof vi.fn>;
  registerTerminalIpc: ReturnType<typeof vi.fn>;
  sharedProjectSourceFolder: ReturnType<typeof vi.fn>;
  docxImport: ReturnType<typeof vi.fn>;
  pdfImport: ReturnType<typeof vi.fn>;
  forwardSyncTex: ReturnType<typeof vi.fn>;
  backwardSyncTex: ReturnType<typeof vi.fn>;
  fetchOrcidProfile: ReturnType<typeof vi.fn>;
  buildInfo: unknown;
  spawn: Fn | undefined;
  watch: Fn | undefined;
  runGitText: Fn | undefined;
  fsHooks: Partial<Record<"stat" | "lstat" | "readFile" | "access", Fn>>;
  diagnosticsFail: { record?: boolean; recordSync?: boolean; logPath?: boolean };
  overrides: Record<string, Fn | undefined>;
  fetch: ReturnType<typeof vi.fn>;
}

const globalKey = "__latexdoMainHarness";

function createHarness(): MainHarness {
  const h = {
    handlers: new Map(),
    appEvents: new Map(),
    windows: [],
    createdWindows: [],
    paths: {},
    defaultPath: "",
    packaged: false,
    version: "0.3.0",
    appName: "LatexDo",
    locale: "en-US",
    lock: true,
    entryUrl: "latexdo://app/index.html",
    fromWebContents: undefined,
    focusedWindow: undefined,
    spellLanguages: ["en-US", "fr"],
    listWordsFails: false,
    isLoadingMainFrame: false,
    loadURL: undefined,
    executeJavaScript: async () => undefined,
    crashRenderer: undefined,
    open: vi.fn(),
    save: vi.fn(),
    message: vi.fn(),
    errorBox: vi.fn(),
    external: vi.fn(),
    showItemInFolder: vi.fn(),
    trashItem: vi.fn(),
    quit: vi.fn(),
    exit: vi.fn(),
    setPath: vi.fn(),
    dockSetIcon: vi.fn(),
    menu: vi.fn(),
    setApplicationMenu: vi.fn(),
    protocol: vi.fn(),
    compile: vi.fn(),
    asymptote: vi.fn(),
    registerTerminalIpc: vi.fn(),
    sharedProjectSourceFolder: vi.fn(),
    docxImport: vi.fn(),
    pdfImport: vi.fn(),
    forwardSyncTex: vi.fn(),
    backwardSyncTex: vi.fn(),
    fetchOrcidProfile: vi.fn(),
    buildInfo: null,
    spawn: undefined,
    watch: undefined,
    runGitText: undefined,
    fsHooks: {},
    diagnosticsFail: {},
    overrides: {},
    fetch: vi.fn(),
  } as unknown as MainHarness;
  resetReady(h);
  return h;
}

function resetReady(h: MainHarness): void {
  h.ready = new Promise<void>((resolve, reject) => {
    h.resolveReady = resolve;
    h.rejectReady = reject;
  });
  // A boot that never resolves must not report an unhandled rejection.
  h.ready.catch(() => undefined);
}

export const H: MainHarness = ((globalThis as any)[globalKey] ??= createHarness());

class FakeWebContents extends EventEmitter {
  mainFrame: { url: string };
  send = vi.fn();
  replaceMisspelling = vi.fn();
  windowOpenHandler: Fn | null = null;
  setWindowOpenHandler = vi.fn((handler: Fn) => {
    this.windowOpenHandler = handler;
  });
  executeJavaScript = vi.fn((code: string) => H.executeJavaScript(code, this));
  forcefullyCrashRenderer = vi.fn(() => H.crashRenderer?.(this));
  session: any;
  constructor(readonly owner: FakeWindow) {
    super();
    this.mainFrame = { url: H.entryUrl };
    const dictionary = new Set<string>();
    this.session = {
      availableSpellCheckerLanguages: H.spellLanguages,
      setSpellCheckerEnabled: vi.fn(),
      setSpellCheckerLanguages: vi.fn(),
      dictionary,
      addWordToSpellCheckerDictionary: vi.fn((word: string) => {
        dictionary.add(word);
        return true;
      }),
      removeWordFromSpellCheckerDictionary: vi.fn((word: string) =>
        dictionary.delete(word),
      ),
      listWordsInSpellCheckerDictionary: vi.fn(async () => {
        if (H.listWordsFails) throw new Error("dictionary unavailable");
        return [...dictionary];
      }),
    };
  }
  isDestroyed() {
    return this.owner.destroyed;
  }
  getURL() {
    return this.mainFrame.url;
  }
  isLoadingMainFrame() {
    return H.isLoadingMainFrame;
  }
}

export class FakeWindow extends EventEmitter {
  destroyed = false;
  minimized = false;
  webContents: FakeWebContents;
  restore = vi.fn(() => {
    this.minimized = false;
  });
  show = vi.fn();
  focus = vi.fn();
  loadURL = vi.fn((url: string) =>
    H.loadURL ? H.loadURL(this, url) : Promise.resolve(),
  );
  constructor(readonly options: any) {
    super();
    this.webContents = new FakeWebContents(this);
    H.windows.push(this);
    H.createdWindows.push(this);
  }
  isDestroyed() {
    return this.destroyed;
  }
  isMinimized() {
    return this.minimized;
  }
  destroy = vi.fn(() => {
    if (this.destroyed) return;
    this.destroyed = true;
    H.windows = H.windows.filter((window) => window !== this);
    this.emit("closed");
  });
  close = vi.fn(() => {
    this.emit("close");
  });
  static fromWebContents(contents: unknown) {
    if (H.fromWebContents) return H.fromWebContents(contents);
    return H.windows.find((window) => window.webContents === contents) ?? null;
  }
  static getFocusedWindow() {
    return H.focusedWindow !== undefined ? H.focusedWindow : (H.windows[0] ?? null);
  }
  static getAllWindows() {
    return [...H.windows];
  }
}

export function electronModule() {
  return {
    app: {
      get name() {
        return H.appName;
      },
      get isPackaged() {
        return H.packaged;
      },
      requestSingleInstanceLock: () => H.lock,
      getName: () => H.appName,
      getVersion: () => H.version,
      getPath: (name: string) => H.paths[name] ?? H.defaultPath,
      getLocale: () => H.locale,
      whenReady: () => H.ready,
      on: (name: string, listener: Fn) => H.appEvents.set(name, listener),
      quit: H.quit,
      exit: H.exit,
      dock: { setIcon: H.dockSetIcon },
      setPath: H.setPath,
    },
    BrowserWindow: FakeWindow,
    dialog: {
      showOpenDialog: H.open,
      showSaveDialog: H.save,
      showMessageBox: H.message,
      showErrorBox: H.errorBox,
    },
    Menu: {
      buildFromTemplate: H.menu,
      setApplicationMenu: H.setApplicationMenu,
    },
    nativeTheme: {},
    protocol: { registerSchemesAsPrivileged: vi.fn(), handle: H.protocol },
    shell: {
      openExternal: H.external,
      showItemInFolder: H.showItemInFolder,
      openPath: vi.fn(),
      trashItem: H.trashItem,
    },
    ipcMain: {
      handle: (channel: string, listener: Fn) => H.handlers.set(channel, listener),
      on: vi.fn(),
    },
  };
}

/** A child process stand-in for spawn. */
export function fakeChild(
  behaviour: {
    exitCode?: number | null;
    signal?: string | null;
    error?: Error;
    hang?: boolean;
  } = {},
) {
  const child = Object.assign(new EventEmitter(), {
    kill: vi.fn(),
    unref: vi.fn(),
  });
  setImmediate(() => {
    if (behaviour.error) {
      child.emit("error", behaviour.error);
      return;
    }
    child.emit("spawn");
    if (behaviour.hang) return;
    child.emit("exit", behaviour.exitCode ?? 0, behaviour.signal ?? null);
  });
  return child;
}

export interface BootOptions {
  platform?: NodeJS.Platform;
  arch?: string;
  argv?: string[];
  env?: Record<string, string | undefined>;
  packaged?: boolean;
  lock?: boolean;
  consent?: boolean;
  ready?: boolean;
  waitForWindow?: boolean;
  buildInfo?: unknown;
  appName?: string;
  /** Runs after the fakes are reset and before main.ts is imported. */
  before?: (context: { root: string; profile: string }) => void | Promise<void>;
}

export interface MainBoot {
  root: string;
  profile: string;
  window: FakeWindow;
  uncaughtException: Fn;
  unhandledRejection: Fn;
  streamErrorHandlers: Fn[];
  call: (channel: string, ...args: unknown[]) => Promise<any>;
  callFrom: (sender: unknown, channel: string, ...args: unknown[]) => Promise<any>;
  appEvent: (name: string, ...args: unknown[]) => any;
}

let active: (() => Promise<void>) | null = null;

export async function teardownMain(): Promise<void> {
  const cleanup = active;
  active = null;
  await cleanup?.();
}

const listenerTargets = () =>
  [
    [process, "uncaughtException"],
    [process, "unhandledRejection"],
    [process.stdout, "error"],
    [process.stderr, "error"],
  ] as const;

export async function bootMain(options: BootOptions = {}): Promise<MainBoot> {
  await teardownMain();
  const root = await mkdtemp(path.join(os.tmpdir(), "latexdo-main-harness-"));
  const profile = path.join(root, "profile");
  await mkdir(profile, { recursive: true });
  if (options.consent !== false) {
    await writeFile(
      path.join(profile, "privacy-consent.json"),
      JSON.stringify({ schemaVersion: 1, acceptedAt: "2026-01-01T00:00:00.000Z" }),
    );
  }

  H.handlers.clear();
  H.appEvents.clear();
  H.windows = [];
  H.createdWindows = [];
  H.paths = {};
  H.defaultPath = profile;
  H.packaged = options.packaged ?? false;
  H.version = "0.3.0";
  H.appName = options.appName ?? "LatexDo";
  H.locale = "en-US";
  H.lock = options.lock ?? true;
  H.entryUrl = options.env?.VITE_DEV_SERVER_URL ?? "latexdo://app/index.html";
  H.fromWebContents = undefined;
  H.focusedWindow = undefined;
  H.spellLanguages = ["en-US", "fr"];
  H.listWordsFails = false;
  H.isLoadingMainFrame = false;
  H.loadURL = undefined;
  H.executeJavaScript = async () => undefined;
  H.crashRenderer = undefined;
  H.buildInfo = options.buildInfo ?? null;
  H.spawn = undefined;
  H.watch = undefined;
  H.runGitText = undefined;
  H.fsHooks = {};
  H.diagnosticsFail = {};
  H.overrides = {};
  for (const mock of [
    H.open,
    H.save,
    H.message,
    H.errorBox,
    H.external,
    H.showItemInFolder,
    H.trashItem,
    H.quit,
    H.exit,
    H.setPath,
    H.dockSetIcon,
    H.menu,
    H.setApplicationMenu,
    H.protocol,
    H.compile,
    H.asymptote,
    H.registerTerminalIpc,
    H.sharedProjectSourceFolder,
    H.docxImport,
    H.pdfImport,
    H.forwardSyncTex,
    H.backwardSyncTex,
    H.fetchOrcidProfile,
    H.fetch,
  ])
    mock.mockReset();
  H.open.mockResolvedValue({ canceled: true, filePaths: [] });
  H.save.mockResolvedValue({ canceled: true });
  H.message.mockResolvedValue({ response: 0, checkboxChecked: true });
  H.menu.mockImplementation(() => ({ popup: vi.fn() }));
  H.trashItem.mockResolvedValue(undefined);
  H.external.mockResolvedValue(undefined);
  H.sharedProjectSourceFolder.mockResolvedValue(null);
  H.compile.mockResolvedValue({ ok: true, output: "", diagnostics: [], durationMs: 1 });
  H.asymptote.mockResolvedValue({ ok: true, output: "", diagnostics: [], durationMs: 1 });
  H.fetch.mockRejectedValue(new Error("offline"));
  resetReady(H);

  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
  const originalArch = Object.getOwnPropertyDescriptor(process, "arch")!;
  const originalResourcesPath = Object.getOwnPropertyDescriptor(process, "resourcesPath");
  const originalArgv = process.argv;
  const originalConsole = { log: console.log, warn: console.warn, error: console.error };
  const envBefore = new Map<string, string | undefined>();
  const managedEnv = {
    VITE_DEV_SERVER_URL: undefined,
    LATEXDO_DEV_USER_DATA: undefined,
    LATEXDO_DEV_CLEAR_RUNTIME_CACHE: undefined,
    LATEXDO_EDITION: undefined,
    VITE_LATEXDO_EDITION: undefined,
    LATEXDO_PRODUCT_NAME: undefined,
    LATEXDO_UPDATE_PRODUCT: undefined,
    LATEXDO_DOWNLOADS_URL: undefined,
    LATEXDO_DOWNLOADS_MANIFEST_URL: undefined,
    LATEXDO_UPDATES_FEED_URL: undefined,
    LATEXDO_EXTENSION_CATALOG_URL: undefined,
    LATEXDO_PRIVACY_URL: undefined,
    APPIMAGE: undefined,
    ...options.env,
  };
  for (const [name, value] of Object.entries(managedEnv)) {
    envBefore.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  const listenersBefore = listenerTargets().map(
    ([emitter, event]) => [emitter, event, emitter.listeners(event)] as const,
  );
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: options.platform ?? "darwin",
  });
  if (options.arch)
    Object.defineProperty(process, "arch", { configurable: true, value: options.arch });
  Object.defineProperty(process, "resourcesPath", { configurable: true, value: root });
  process.argv = [originalArgv[0], "main.js", ...(options.argv ?? [])];
  // console is wrapped on import; keep the wrapper from leaking into later boots.
  console.log = () => undefined;
  console.warn = () => undefined;
  console.error = () => undefined;
  vi.stubGlobal("fetch", H.fetch);

  active = async () => {
    Object.defineProperty(process, "platform", originalPlatform);
    Object.defineProperty(process, "arch", originalArch);
    if (originalResourcesPath)
      Object.defineProperty(process, "resourcesPath", originalResourcesPath);
    else Reflect.deleteProperty(process, "resourcesPath");
    process.argv = originalArgv;
    Object.assign(console, originalConsole);
    for (const [name, value] of envBefore) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    for (const [emitter, event, before] of listenersBefore)
      for (const listener of emitter.listeners(event))
        if (!before.includes(listener as never))
          emitter.removeListener(event, listener as Fn);
    vi.unstubAllGlobals();
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  };

  await options.before?.({ root, profile });
  vi.resetModules();
  await import("../main.js");
  const added = listenerTargets().map(([emitter, event], index) =>
    emitter.listeners(event).filter((listener) => !listenersBefore[index][2].includes(listener as never)),
  );
  if (options.ready !== false) H.resolveReady();
  if (options.ready !== false && options.waitForWindow !== false) {
    await vi.waitFor(() => expect(H.createdWindows.length).toBeGreaterThan(0));
  }
  const callFrom = (sender: any, channel: string, ...args: unknown[]) => {
    const handler = H.handlers.get(channel);
    if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
    return Promise.resolve().then(() =>
      handler({ sender, senderFrame: sender?.mainFrame }, ...args),
    );
  };
  const boot: MainBoot = {
    root,
    profile,
    get window() {
      return H.createdWindows[0];
    },
    uncaughtException: added[0][0] as Fn,
    unhandledRejection: added[1][0] as Fn,
    streamErrorHandlers: [...added[2], ...added[3]] as Fn[],
    call: (channel, ...args) => callFrom(H.createdWindows[0].webContents, channel, ...args),
    callFrom,
    appEvent: (name, ...args) => {
      const listener = H.appEvents.get(name);
      if (!listener) throw new Error(`Missing app event: ${name}`);
      return listener(...args);
    },
  };
  return boot;
}

/** Makes chosen setTimeout delays fire immediately; returns a restore function. */
export function fastTimers(delays: number[]): () => void {
  const original = globalThis.setTimeout;
  const spy = vi
    .spyOn(globalThis, "setTimeout")
    .mockImplementation(((callback: Fn, delay?: number, ...args: unknown[]) =>
      original(callback, delays.includes(delay ?? 0) ? 0 : delay, ...args)) as never);
  return () => spy.mockRestore();
}

export async function createProject(boot: MainBoot, folderName: string) {
  const parent = path.join(boot.root, `parent-${folderName.replace(/\W/g, "")}`);
  await mkdir(parent, { recursive: true });
  H.open.mockResolvedValueOnce({ canceled: false, filePaths: [parent] });
  return boot.call("project:create", { folderName });
}
