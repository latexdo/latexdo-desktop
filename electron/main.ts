import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeTheme,
  protocol,
  shell,
  type MenuItemConstructorOptions,
  type RenderProcessGoneDetails,
} from "electron";
import { spawn, type SpawnOptions } from "node:child_process";
import {
  createHash,
  createPublicKey,
  randomUUID,
  verify as verifySignature,
} from "node:crypto";
import {
  constants as fsConstants,
  createReadStream,
  createWriteStream,
  watch,
  type FSWatcher,
} from "node:fs";
import {
  access,
  chmod,
  copyFile,
  cp,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  customDictionarySet,
  isCustomDictionaryMatch,
  isProofreadingNoise,
} from "./proofreadingFilter.js";
import {
  compileAsymptote,
  compileLatex,
  materializeCloudCompileFiles,
} from "./compiler.js";
import { createGarbageCollector, type CollectNowOptions } from "./garbageCollector.js";
import { importDocxIntoProject } from "./docxImport.js";
import { assertCanonicalCompileInside } from "./compileTrust.js";
import { assertProjectPath } from "./projectPaths.js";
import { ipcMain, trustIpcRenderer } from "./trustedIpc.js";
import { importMarkdown } from "./markdownImport.js";
import { importPdfIntoProject } from "./pdfImport/index.js";
import { backwardSyncTex, forwardSyncTex } from "./synctex.js";
import { MAX_BIBLIOGRAPHY_FILE_BYTES, readSafeTextFile } from "./textFile.js";
import type {
  Diagnostic,
  DocxImportResult,
  MarkdownImportResult,
  PdfImportResult,
  CompileRequest,
  AsymptoteCompileRequest,
  GitDiscardResult,
  GitStatusSummary,
  GitRevisionRef,
  ImportedProjectEntry,
  LatexDoResearchSpace,
  LatexDoResearchSpaceFolder,
  LatexDoResearchSpaceFolderKind,
  MenuShortcut,
  OpenProject,
  ProofreadingResult,
  ProofreadingRequestOptions,
  ProofreadingSettings,
  ProjectEntry,
  ProjectListOptions,
  RendererDiagnosticPayload,
  SpellCheckerSettings,
  UpdateAttemptResolution,
  UpdateCheckResult,
  UpdateDownloadProgress,
  UpdateInstallResult,
  WhatsNewResult,
  CreateProjectOptions,
} from "./types.js";
import {
  getGitRepositoryContext,
  readCommitDiffSession,
  readGitBlame,
  readGitDiffPreview,
  readStructuredGitCommitDetails,
  readStructuredGitHistory,
  readStructuredGitStatus,
  readWorkingTreeDiffSession,
  repoPathForProjectPath,
  runGitText,
} from "./git.js";
import { runGitExclusive } from "./gitErrors.js";
import {
  parseGitAction,
  readDiffForCommitMessage,
  readGitRepositoryInfo,
  runGitAction,
} from "./gitActions.js";
import { registerTerminalIpc } from "./terminal.js";
import { disposePeerCollab, registerPeerCollabIpc } from "./peerCollabIpc.js";
import { registerAiIpc } from "./ai/aiIpc.js";
import { stopBundledSpeechServer } from "./voiceStt.js";
import { fetchOrcidProfile } from "./orcid.js";
import { listProject } from "./projectTree.js";
import {
  createDiagnosticReporter,
  rendererFailureDataUrl,
  rendererGoneMessage,
  serializeError,
  type DiagnosticKind,
} from "./diagnostics.js";
import {
  compareLatexDoVersions,
  isNewerRelease,
  isBuildReleaseSlugForVersion,
  isReleaseSlugForVersion,
  versionsEquivalent,
} from "./versions.js";
import {
  beginPendingUpdate,
  describePendingUpdate,
  loadPendingUpdate,
  pendingUpdateAttemptLimitReached,
  resolvePendingUpdate,
  markPendingUpdateFailed,
  type PendingUpdateRecord,
} from "./updatePending.js";
import {
  isApprovedReleaseNotesFetchUrl,
  isApprovedReleaseNotesDocumentUrl,
  resolveReleaseNotes,
  resolveReleaseNotesRange,
} from "./releaseNotes.js";
import {
  loadUpdateExperienceState,
  markVersionPresented,
  recordConfirmedUpdate,
  recordLaunchedVersion,
  changesBetweenBuilds,
  shouldShowWhatsNew,
} from "./updateExperience.js";

import {
  macUpdateHelper,
  linuxUpdateHelper,
  windowsUpdateHelper,
} from "./updateHelpers.js";
import { runUpdateVersionProbe } from "./updateVersionProbe.js";
import { readBuildInfo } from "./buildInfo.js";

const probeExitCode = runUpdateVersionProbe(
  process.argv,
  app.isPackaged,
  app.getVersion(),
);
if (probeExitCode !== null) app.exit(probeExitCode);

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const devUserDataPath = isDevelopment ? envString("LATEXDO_DEV_USER_DATA") : undefined;
const devClearRuntimeCache =
  isDevelopment && envString("LATEXDO_DEV_CLEAR_RUNTIME_CACHE") === "1";
const appIconPath = path.join(currentDirectory, "..", "build", "icon.png");
// Null in development and for builds made before build stamping existed.
const buildInfo = readBuildInfo(currentDirectory);
const executableProductName = path.basename(process.execPath).replace(/\.exe$/i, "");
const isProEdition =
  envString("LATEXDO_EDITION") === "pro" ||
  envString("LATEXDO_EDITION") === "business" ||
  envString("VITE_LATEXDO_EDITION") === "pro" ||
  envString("VITE_LATEXDO_EDITION") === "business" ||
  app.getName().toLowerCase().includes("pro") ||
  app.getName().toLowerCase().includes("business") ||
  executableProductName.toLowerCase().includes("pro") ||
  executableProductName.toLowerCase().includes("business");
const productName =
  envString("LATEXDO_PRODUCT_NAME") ?? (isProEdition ? "LatexDo Pro" : "LatexDo");
const researchSpacePrimaryExtension = "latexdo-space";
const researchSpaceExtensions = new Set([
  `.${researchSpacePrimaryExtension}`,
  ".latexdo-workspace",
]);
const expectedUpdateProduct = envString("LATEXDO_UPDATE_PRODUCT") ?? productName;
const packagedRendererOrigin = "latexdo://app";
const packagedRendererRoot = path.resolve(currentDirectory, "..", "dist");
const startupSmokeTest = process.argv.includes("--smoke-test");
const startupE2eTest = process.argv.includes("--e2e-test");
const startupAutomationTest = startupSmokeTest || startupE2eTest;
const startupSmokeTimeoutMs = 20_000;
const extensionCatalogFetchTimeoutMs = 4_500;
const downloadsPageUrl =
  envString("LATEXDO_DOWNLOADS_URL") ?? "https://latexdo.org/downloads/";
const downloadsManifestUrl = startupE2eTest
  ? "http://127.0.0.1:9/downloads/manifest.json"
  : (envString("LATEXDO_DOWNLOADS_MANIFEST_URL") ??
    "https://latexdo.org/downloads/manifest.json");
const updatesFeedUrl = startupE2eTest
  ? "http://127.0.0.1:9/updates/latest.json"
  : (envString("LATEXDO_UPDATES_FEED_URL") ??
    "https://latexdo.org/updates/latest.json");
const extensionStoreCatalogUrl =
  envString("LATEXDO_EXTENSION_CATALOG_URL") ??
  "https://latexdo.org/store/extensions/catalog.json";
const privacyInfoUrl =
  envString("LATEXDO_PRIVACY_URL") ?? "https://www.latexdo.org/privacy";
const externalUrlHosts = new Set([
  "aistudio.google.com",
  "console.anthropic.com",
  "console.groq.com",
  "console.mistral.ai",
  "api.crossref.org",
  "api.openalex.org",
  "arxiv.org",
  "crossref.org",
  "doi.org",
  "openrouter.ai",
  "orcid.org",
  "platform.deepseek.com",
  "platform.openai.com",
  "github.com",
  "latexdo.org",
  "openalex.org",
  "miktex.org",
  "www.tug.org",
  "www.latexdo.org",
  "www.crossref.org",
  "www.doi.org",
  "www.orcid.org",
]);
for (const configuredExternalUrl of [downloadsPageUrl, privacyInfoUrl]) {
  const host = safeUrlHost(configuredExternalUrl);
  if (host) externalUrlHosts.add(host);
}
const updateRedirectHosts = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);
const spellCheckerSettingsFile = "spellchecker-settings.json";
const proofreadingSettingsFile = "proofreading-settings.json";
const privacyConsentFile = "privacy-consent.json";
const trustedWorkspacesFile = "trusted-workspaces.json";
const updateFeedStateFile = "update-feed-state.json";
const privacyConsentSchemaVersion = 1;
const trustedWorkspacesSchemaVersion = 1;
const updateFeedStateSchemaVersion = 1;
let lastUpdateResolution: UpdateAttemptResolution | null = null;
const openSpellCheckerChannel = "tools:open-spellchecker";
const spellCheckerChangedChannel = "spellchecker:changed";
const openProjectChannel = "file:open-project";
const createFileChannel = "file:create-dialog";
const createFolderChannel = "folder:create-dialog";
const importDocxChannel = "file:import-docx";
const importMarkdownChannel = "file:import-markdown";
const importPdfChannel = "file:import-pdf";
const closeTabChannel = "file:close-tab";
const menuCommandChannel = "menu:command";
const maxHostedImportFileBytes = 5 * 1024 * 1024;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "latexdo",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      codeCache: true,
    },
  },
]);
const starterDocument = String.raw`\documentclass[11pt]{article}

\usepackage[margin=1in]{geometry}
\usepackage{microtype}
\usepackage{hyperref}

\title{My LatexDo Document}
\author{}
\date{\today}

\begin{document}

\maketitle

\section{Introduction}

Start writing here.

\end{document}
`;

function isBrokenPipeError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "EPIPE"
  );
}

function installSafeConsole(): void {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (error) => {
      if (isBrokenPipeError(error)) {
        return;
      }
      throw error;
    });
  }

  const wrapConsoleMethod =
    (method: (...data: unknown[]) => void) =>
    (...data: unknown[]) => {
      try {
        method(...data);
      } catch (error) {
        if (!isBrokenPipeError(error)) {
          throw error;
        }
      }
    };

  console.log = wrapConsoleMethod(console.log.bind(console));
  console.warn = wrapConsoleMethod(console.warn.bind(console));
  console.error = wrapConsoleMethod(console.error.bind(console));
}

installSafeConsole();

const mainDiagnostics = createDiagnosticReporter({
  getUserDataPath: () => app.getPath("userData"),
  getAppVersion: () => app.getVersion(),
  processType: "main",
});
let appIsQuitting = false;

const openProjects = new Map<string, OpenProject>();
const cloudCompileProjectIdPattern = /^(?:project|session)_[a-z0-9]{6,64}$/i;
const activeCompileControllers = new Map<string, Set<AbortController>>();

interface GitWatchState {
  watchers: FSWatcher[];
  timer: NodeJS.Timeout | null;
  pendingReason: "repository" | "working-tree";
}

const gitWatchStates = new Map<string, GitWatchState>();

function closeGitWatchers(projectId: string): void {
  const state = gitWatchStates.get(projectId);
  if (!state) return;
  if (state.timer) clearTimeout(state.timer);
  for (const watcher of state.watchers) watcher.close();
  gitWatchStates.delete(projectId);
}

function emitGitChanged(
  projectId: string,
  reason: "repository" | "working-tree",
): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("git:changed", { projectId, reason });
    }
  }
}

function scheduleGitChanged(
  projectId: string,
  reason: "repository" | "working-tree",
): void {
  const state = gitWatchStates.get(projectId);
  if (!state) return;
  if (reason === "repository") state.pendingReason = "repository";
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    emitGitChanged(projectId, state.pendingReason);
    state.pendingReason = "working-tree";
  }, 150);
}

function addGitWatcher(
  state: GitWatchState,
  projectId: string,
  targetPath: string,
  recursive: boolean,
  classify: (filename: string) => "repository" | "working-tree",
): boolean {
  try {
    const watcher = watch(targetPath, { recursive }, (_eventType, filename) => {
      scheduleGitChanged(projectId, classify(filename?.toString() ?? ""));
    });
    watcher.on("error", () => watcher.close());
    state.watchers.push(watcher);
    return true;
  } catch {
    return false;
  }
}

async function addGitDirectoryTreeWatchers(
  state: GitWatchState,
  projectId: string,
  directory: string,
  classify: (filename: string) => "repository" | "working-tree",
  excludedDirectoryNames: ReadonlySet<string> = new Set(),
): Promise<void> {
  if (addGitWatcher(state, projectId, directory, true, classify)) return;
  if (!addGitWatcher(state, projectId, directory, false, classify)) return;
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.isSymbolicLink() &&
          !excludedDirectoryNames.has(entry.name),
      )
      .map((entry) =>
        addGitDirectoryTreeWatchers(
          state,
          projectId,
          path.join(directory, entry.name),
          classify,
          excludedDirectoryNames,
        ),
      ),
  );
}

async function ensureGitWatchers(
  projectId: string,
  projectPath: string,
): Promise<void> {
  if (gitWatchStates.has(projectId)) return;
  let context;
  try {
    context = await getGitRepositoryContext(projectPath);
  } catch {
    return;
  }
  const state: GitWatchState = {
    watchers: [],
    timer: null,
    pendingReason: "working-tree",
  };
  gitWatchStates.set(projectId, state);

  const worktreeClassify = (filename: string) =>
    /(^|[/\\])\.git([/\\]|$)/.test(filename) ? "repository" : "working-tree";
  await addGitDirectoryTreeWatchers(
    state,
    projectId,
    projectPath,
    worktreeClassify,
    new Set([".git", "node_modules", "dist"]),
  );

  const watchedMetadataDirectories = new Set<string>();
  for (const directory of [context.gitDirectory, context.commonGitDirectory]) {
    if (watchedMetadataDirectories.has(directory)) continue;
    watchedMetadataDirectories.add(directory);
    await addGitDirectoryTreeWatchers(state, projectId, directory, () => "repository");
    addGitWatcher(
      state,
      projectId,
      path.join(directory, "index"),
      false,
      () => "repository",
    );
    addGitWatcher(
      state,
      projectId,
      path.join(directory, "HEAD"),
      false,
      () => "repository",
    );
    await addGitDirectoryTreeWatchers(
      state,
      projectId,
      path.join(directory, "refs"),
      () => "repository",
    );
  }
}

interface WebsiteUpdatePayload {
  schemaVersion?: unknown;
  product?: unknown;
  channel?: unknown;
  version?: unknown;
  publishedAt?: unknown;
  expiresAt?: unknown;
  commit?: unknown;
  release?: unknown;
  releaseUrl?: unknown;
  downloadsPage?: unknown;
  manifestUrl?: unknown;
  releaseNotesUrl?: unknown;
  files?: unknown;
  signature?: unknown;
}

interface WebsiteUpdateSignature {
  algorithm: "ed25519";
  keyId: string;
  value: string;
}

interface WebsiteUpdateFile {
  id: string;
  label: string;
  platform: string;
  arch: string;
  filename: string;
  url: string;
  sha256: string;
}

interface ResolvedWebsiteUpdate {
  result: UpdateCheckResult;
  files: WebsiteUpdateFile[];
  automaticInstallTrusted: boolean;
}

interface StoredPrivacyConsent {
  schemaVersion?: unknown;
  acceptedAt?: unknown;
  appVersion?: unknown;
  privacyInfoUrl?: unknown;
}

interface StoredTrustedWorkspaces {
  schemaVersion?: unknown;
  trustedPaths?: unknown;
}

interface StoredUpdateFeedState {
  schemaVersion?: unknown;
  highestVersion?: unknown;
  highestRelease?: unknown;
  highestCommit?: unknown;
  highestPublishedAt?: unknown;
}

function registerProject(rootPath: string): OpenProject {
  const resolvedRoot = path.resolve(rootPath);
  const existingProject = [...openProjects.values()].find(
    (project) => project.rootPath === resolvedRoot,
  );
  if (existingProject) {
    return existingProject;
  }

  const project: OpenProject = {
    id: randomUUID(),
    rootPath: resolvedRoot,
    name: path.basename(resolvedRoot) || resolvedRoot,
  };
  openProjects.set(project.id, project);
  return project;
}

function isResearchSpaceFile(filePath: string): boolean {
  return researchSpaceExtensions.has(path.extname(filePath).toLowerCase());
}

function withResearchSpaceExtension(filePath: string): string {
  return isResearchSpaceFile(filePath)
    ? filePath
    : `${filePath}.${researchSpacePrimaryExtension}`;
}

function isResearchSpaceProject(
  project: OpenProject,
): project is OpenProject & { researchSpace: LatexDoResearchSpace } {
  return Boolean(project.researchSpace);
}

function researchSpaceProjectId(filePath: string): string {
  return `space:${path.resolve(filePath)}`;
}

function cleanResearchSpaceLabel(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96);
  return cleaned || fallback;
}

function sanitizeResearchSpaceFolderName(value: string, fallback: string): string {
  const safeFallback =
    fallback === "." || fallback === ".." || reservedProjectPathSegments.has(fallback)
      ? "Folder"
      : fallback;
  const cleaned = value
    .split("")
    .map((character) => {
      const code = character.charCodeAt(0);
      return invalidProjectFolderCharacters.has(character) || code < 32
        ? " "
        : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+$/, "");
  const safeName = cleaned || safeFallback;
  if (
    safeName === "." ||
    safeName === ".." ||
    reservedProjectPathSegments.has(safeName)
  ) {
    return safeFallback;
  }
  return safeName.slice(0, 96) || safeFallback;
}

function uniqueResearchSpaceFolderName(
  preferredName: string,
  fallback: string,
  usedNames: Set<string>,
): string {
  const baseName = sanitizeResearchSpaceFolderName(preferredName, fallback);
  for (let index = 0; index < 100; index += 1) {
    const candidate = index === 0 ? baseName : `${baseName} ${index + 1}`;
    const key = candidate.toLowerCase();
    if (!usedNames.has(key)) {
      usedNames.add(key);
      return candidate;
    }
  }
  const generated = `${fallback} ${randomUUID().slice(0, 8)}`;
  usedNames.add(generated.toLowerCase());
  return generated;
}

function researchSpaceDefaultName(filePath: string): string {
  const parsed = path.parse(filePath);
  return cleanResearchSpaceLabel(parsed.name, "Research Space");
}

function normalizeResearchSpaceFolderKind(
  value: unknown,
  folderPath: string,
): LatexDoResearchSpaceFolderKind {
  if (value === "paper" || value === "bibliography" || value === "shared") {
    return value;
  }

  const basename = path.basename(folderPath).toLowerCase();
  if (/\b(bib|bibliography|reference|references|citation|citations)\b/.test(basename)) {
    return "bibliography";
  }
  if (/\b(shared|common|assets|figures|data|supplement)\b/.test(basename)) {
    return "shared";
  }
  return "paper";
}

async function normalizeResearchSpaceFolders(
  rawFolders: unknown,
  manifestDirectory: string,
): Promise<LatexDoResearchSpaceFolder[]> {
  if (!Array.isArray(rawFolders) || rawFolders.length === 0) {
    throw new Error("A Research Space needs at least one folder.");
  }

  const usedNames = new Set<string>();
  const folders: LatexDoResearchSpaceFolder[] = [];
  for (const rawFolder of rawFolders) {
    if (!isRecord(rawFolder) || typeof rawFolder.path !== "string") {
      throw new Error("The Research Space file contains an invalid folder entry.");
    }
    const resolvedFolderPath = path.resolve(manifestDirectory, rawFolder.path);
    const folderStats = await stat(resolvedFolderPath).catch(() => null);
    if (!folderStats?.isDirectory()) {
      throw new Error(`Research Space folder is missing: ${resolvedFolderPath}`);
    }

    const fallback = path.basename(resolvedFolderPath) || "Folder";
    const folderName = uniqueResearchSpaceFolderName(
      typeof rawFolder.name === "string" ? rawFolder.name : fallback,
      fallback,
      usedNames,
    );
    folders.push({
      name: folderName,
      path: resolvedFolderPath,
      kind: normalizeResearchSpaceFolderKind(rawFolder.kind, resolvedFolderPath),
    });
  }
  return folders;
}

async function readResearchSpaceFile(filePath: string): Promise<LatexDoResearchSpace> {
  const resolvedFilePath = path.resolve(filePath);
  if (!isResearchSpaceFile(resolvedFilePath)) {
    throw new Error(`Choose a .${researchSpacePrimaryExtension} file.`);
  }

  const rawContent = await readFile(resolvedFilePath, "utf8");
  let data: unknown;
  try {
    data = JSON.parse(rawContent);
  } catch {
    throw new Error("The selected Research Space file is not valid JSON.");
  }
  if (!isRecord(data)) {
    throw new Error("The selected Research Space file is invalid.");
  }

  const manifestDirectory = path.dirname(resolvedFilePath);
  return {
    schemaVersion: 1,
    name: cleanResearchSpaceLabel(
      typeof data.name === "string"
        ? data.name
        : researchSpaceDefaultName(resolvedFilePath),
      researchSpaceDefaultName(resolvedFilePath),
    ),
    filePath: resolvedFilePath,
    folders: await normalizeResearchSpaceFolders(data.folders, manifestDirectory),
  };
}

async function writeResearchSpaceFile(
  space: LatexDoResearchSpace,
): Promise<LatexDoResearchSpace> {
  const manifest = {
    schemaVersion: 1,
    name: space.name,
    folders: space.folders.map((folder) => ({
      name: folder.name,
      path: folder.path,
      kind: folder.kind,
    })),
  };
  // Lives in a folder the person chose: no backup copy next to it.
  await atomicWriteUtf8(space.filePath, `${JSON.stringify(manifest, null, 2)}\n`);
  return readResearchSpaceFile(space.filePath);
}

async function createResearchSpaceFile(
  filePath: string,
  folderPaths: string[],
): Promise<LatexDoResearchSpace> {
  const resolvedFilePath = path.resolve(filePath);
  const usedNames = new Set<string>();
  const folders: LatexDoResearchSpaceFolder[] = [];
  for (const folderPath of folderPaths) {
    const resolvedFolderPath = path.resolve(folderPath);
    const folderStats = await stat(resolvedFolderPath).catch(() => null);
    if (!folderStats?.isDirectory()) {
      continue;
    }
    const fallback = path.basename(resolvedFolderPath) || "Folder";
    folders.push({
      name: uniqueResearchSpaceFolderName(fallback, fallback, usedNames),
      path: resolvedFolderPath,
      kind: normalizeResearchSpaceFolderKind(undefined, resolvedFolderPath),
    });
  }
  if (folders.length === 0) {
    throw new Error("Choose at least one paper or shared folder.");
  }

  const space: LatexDoResearchSpace = {
    schemaVersion: 1,
    name: researchSpaceDefaultName(resolvedFilePath),
    filePath: resolvedFilePath,
    folders,
  };
  return writeResearchSpaceFile(space);
}

async function chooseResearchSpaceFile(
  window: BrowserWindow | null,
  suggestedName: string,
): Promise<string | null> {
  const saveOptions = {
    title: "Save LatexDo Research Space",
    buttonLabel: "Save Research Space",
    defaultPath: path.join(
      app.getPath("documents"),
      `${sanitizeResearchSpaceFolderName(suggestedName, "research-space")}.${researchSpacePrimaryExtension}`,
    ),
    filters: [
      {
        name: "LatexDo Research Space",
        extensions: [researchSpacePrimaryExtension],
      },
    ],
  } satisfies Electron.SaveDialogOptions;
  const result = window
    ? await dialog.showSaveDialog(window, saveOptions)
    : await dialog.showSaveDialog(saveOptions);
  if (result.canceled || !result.filePath) {
    return null;
  }
  return withResearchSpaceExtension(result.filePath);
}

function registerResearchSpace(space: LatexDoResearchSpace): OpenProject {
  const existingProject = [...openProjects.values()].find(
    (project) =>
      project.researchSpace?.filePath === space.filePath ||
      project.rootPath === space.filePath,
  );
  if (existingProject) {
    existingProject.name = space.name;
    existingProject.researchSpace = space;
    return existingProject;
  }

  const project: OpenProject = {
    id: researchSpaceProjectId(space.filePath),
    rootPath: space.filePath,
    name: space.name,
    researchSpace: space,
  };
  openProjects.set(project.id, project);
  return project;
}

async function registerResearchSpaceFileIfTrusted(
  targetWindow: BrowserWindow | null,
  filePath: string,
): Promise<OpenProject | null> {
  const space = await readResearchSpaceFile(filePath);
  for (const folder of space.folders) {
    if (!(await ensureWorkspaceTrust(targetWindow, folder.path))) {
      return null;
    }
  }
  await trustWorkspace(path.dirname(space.filePath));
  return registerResearchSpace(space);
}

function getProjectRoot(projectId: string): string {
  if (!projectId) {
    throw new Error("Open a project before using this action.");
  }

  const project = openProjects.get(projectId);
  if (!project) {
    throw new Error("The requested project is not open.");
  }
  if (isResearchSpaceProject(project)) {
    const folder =
      project.researchSpace.folders.find((candidate) => candidate.kind === "paper") ??
      project.researchSpace.folders[0];
    return folder.path;
  }
  return project.rootPath;
}

function getProjectRoots(projectId: string): string[] {
  if (!projectId) {
    throw new Error("Open a project before using this action.");
  }

  const project = openProjects.get(projectId);
  if (!project) {
    throw new Error("The requested project is not open.");
  }
  if (isResearchSpaceProject(project)) {
    return project.researchSpace.folders.map((folder) => folder.path);
  }
  return [project.rootPath];
}

function getOpenProject(projectId: string): OpenProject {
  if (!projectId) {
    throw new Error("Open a project before using this action.");
  }

  const project = openProjects.get(projectId);
  if (!project) {
    throw new Error("The requested project is not open.");
  }
  return project;
}

function trackCompileController(
  projectId: string,
  controller: AbortController,
): () => void {
  let controllers = activeCompileControllers.get(projectId);
  if (!controllers) {
    controllers = new Set();
    activeCompileControllers.set(projectId, controllers);
  }
  controllers.add(controller);

  return () => {
    controllers.delete(controller);
    if (!controllers.size) {
      activeCompileControllers.delete(projectId);
    }
  };
}

function cancelActiveCompiles(projectId: string): boolean {
  const controllers = activeCompileControllers.get(projectId);
  if (!controllers?.size) {
    return false;
  }

  for (const controller of controllers) {
    controller.abort();
  }
  return true;
}

const projectGarbageCollector = createGarbageCollector({
  getProjectRoot,
  getProjectRoots,
  hasActiveCompiles: (projectId) =>
    Boolean(activeCompileControllers.get(projectId)?.size),
});

function scheduleProjectGarbageCollection(
  project: OpenProject | null,
): OpenProject | null {
  if (project) {
    projectGarbageCollector.schedule(project.id);
  }
  return project;
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertInside(projectPath: string, targetPath: string): void {
  if (!isInside(projectPath, targetPath)) {
    throw new Error("The requested path is outside the open project.");
  }
}

async function resolveProjectPath(
  projectPath: string,
  relativePath: string,
): Promise<string> {
  const cleanPath = relativePath.trim();
  if (!cleanPath || path.isAbsolute(cleanPath)) {
    throw new Error("Enter a relative path inside the project.");
  }

  const targetPath = path.resolve(projectPath, cleanPath);
  assertInside(projectPath, targetPath);
  await assertProjectPath(projectPath, targetPath);
  return targetPath;
}

function relativeProjectPath(projectPath: string, targetPath: string): string {
  assertInside(projectPath, targetPath);
  const relativePath = path.relative(projectPath, targetPath);
  return relativePath || ".";
}

function toPortableRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/");
}

interface ResolvedProjectTarget {
  project: OpenProject;
  projectPath: string;
  relativePath: string;
  requestedRelativePath: string;
  resolvedPath: string;
  spaceFolder?: LatexDoResearchSpaceFolder;
}

function prefixResearchSpaceRelativePath(
  folder: LatexDoResearchSpaceFolder,
  relativePath: string,
): string {
  const portablePath = toPortableRelativePath(relativePath);
  return portablePath === "."
    ? folder.name
    : path.posix.join(folder.name, portablePath);
}

function prefixResearchSpaceDiagnosticPath(
  folder: LatexDoResearchSpaceFolder,
  filePath: string,
): string {
  const portablePath = toPortableRelativePath(filePath);
  if (
    !portablePath ||
    path.isAbsolute(portablePath) ||
    path.posix.isAbsolute(portablePath) ||
    portablePath.startsWith("../") ||
    portablePath.includes("://") ||
    portablePath === folder.name ||
    portablePath.startsWith(`${folder.name}/`)
  ) {
    return filePath;
  }
  return prefixResearchSpaceRelativePath(folder, portablePath);
}

function prefixResultDiagnostics<T extends { diagnostics: Diagnostic[] }>(
  result: T,
  location: Pick<ResolvedProjectTarget, "spaceFolder">,
): T {
  if (!location.spaceFolder) {
    return result;
  }
  return {
    ...result,
    diagnostics: result.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      file: prefixResearchSpaceDiagnosticPath(location.spaceFolder!, diagnostic.file),
    })),
  };
}

async function resolveOpenProjectPath(
  projectId: string,
  relativePath: string,
): Promise<ResolvedProjectTarget> {
  const project = getOpenProject(projectId);
  if (!isResearchSpaceProject(project)) {
    const resolvedPath = await resolveProjectPath(project.rootPath, relativePath);
    return {
      project,
      projectPath: project.rootPath,
      relativePath,
      requestedRelativePath: relativePath,
      resolvedPath,
    };
  }

  const [folderName, ...rest] = relativePath.replace(/\\/g, "/").split("/");
  const folder = project.researchSpace.folders.find(
    (candidate) => candidate.name === folderName,
  );
  if (!folder) {
    throw new Error("Choose a folder inside this Research Space.");
  }

  const folderRelativePath = rest.length ? rest.join("/") : ".";
  const resolvedPath = await resolveProjectPath(folder.path, folderRelativePath);
  return {
    project,
    projectPath: folder.path,
    relativePath: folderRelativePath,
    requestedRelativePath: relativePath,
    resolvedPath,
    spaceFolder: folder,
  };
}

function relativeOpenProjectPath(
  location: Pick<ResolvedProjectTarget, "projectPath" | "spaceFolder">,
  targetPath: string,
): string {
  const relativePath = toPortableRelativePath(
    relativeProjectPath(location.projectPath, targetPath),
  );
  return location.spaceFolder
    ? prefixResearchSpaceRelativePath(location.spaceFolder, relativePath)
    : relativePath;
}

async function resolveImportDestination(
  projectId: string,
  destinationDirectory: string,
): Promise<ResolvedProjectTarget> {
  const project = getOpenProject(projectId);
  if (!isResearchSpaceProject(project)) {
    const resolvedPath = destinationDirectory
      ? await resolveProjectPath(project.rootPath, destinationDirectory)
      : project.rootPath;
    return {
      project,
      projectPath: project.rootPath,
      relativePath: destinationDirectory || ".",
      requestedRelativePath: destinationDirectory,
      resolvedPath,
    };
  }

  if (destinationDirectory) {
    return await resolveOpenProjectPath(projectId, destinationDirectory);
  }

  const folder =
    project.researchSpace.folders.find((candidate) => candidate.kind === "paper") ??
    project.researchSpace.folders[0];
  return {
    project,
    projectPath: folder.path,
    relativePath: ".",
    requestedRelativePath: folder.name,
    resolvedPath: folder.path,
    spaceFolder: folder,
  };
}

function defaultImportTargetForProject(project: OpenProject): ResolvedProjectTarget {
  if (!isResearchSpaceProject(project)) {
    return {
      project,
      projectPath: project.rootPath,
      relativePath: ".",
      requestedRelativePath: "",
      resolvedPath: project.rootPath,
    };
  }

  const folder =
    project.researchSpace.folders.find((candidate) => candidate.kind === "paper") ??
    project.researchSpace.folders[0];
  return {
    project,
    projectPath: folder.path,
    relativePath: ".",
    requestedRelativePath: folder.name,
    resolvedPath: folder.path,
    spaceFolder: folder,
  };
}

function researchSpaceGitStatus(): GitStatusSummary {
  return {
    isRepo: false,
    branch: null,
    entries: [],
    error:
      "Git actions span one folder at a time. Open an individual paper folder to use repository-wide Git tools.",
  };
}

function throwResearchSpaceGitUnavailable(): never {
  throw new Error(
    "Repository-wide Git actions are not available for a multi-folder Research Space. Open an individual paper folder to use Git for that repository.",
  );
}

interface ImportPathPayload {
  relativePath: string;
  assetDirectory?: string | null;
  bibRelativePath?: string | null;
  mediaFiles?: string[];
}

function prefixImportPathPayload<T extends ImportPathPayload>(
  payload: T,
  location: Pick<ResolvedProjectTarget, "spaceFolder">,
): T {
  if (!location.spaceFolder) {
    return payload;
  }

  const prefix = (relativePath: string): string =>
    prefixResearchSpaceRelativePath(location.spaceFolder!, relativePath);
  const next = {
    ...payload,
    relativePath: prefix(payload.relativePath),
  };
  if ("assetDirectory" in payload) {
    next.assetDirectory = payload.assetDirectory
      ? prefix(payload.assetDirectory)
      : payload.assetDirectory;
  }
  if ("bibRelativePath" in payload) {
    next.bibRelativePath = payload.bibRelativePath
      ? prefix(payload.bibRelativePath)
      : payload.bibRelativePath;
  }
  if ("mediaFiles" in payload) {
    next.mediaFiles = payload.mediaFiles?.map(prefix) ?? payload.mediaFiles;
  }
  return next;
}

function prefixResearchSpaceEntry(
  folder: LatexDoResearchSpaceFolder,
  entry: ProjectEntry,
): ProjectEntry {
  return {
    ...entry,
    relativePath: prefixResearchSpaceRelativePath(
      folder,
      toPortableRelativePath(entry.relativePath),
    ),
    children: entry.children?.map((child) => prefixResearchSpaceEntry(folder, child)),
  };
}

async function listOpenProject(
  projectId: string,
  options: ProjectListOptions,
): Promise<ProjectEntry[]> {
  const project = getOpenProject(projectId);
  if (!isResearchSpaceProject(project)) {
    return listProject(project.rootPath, options);
  }

  const roots: ProjectEntry[] = [];
  for (const folder of project.researchSpace.folders) {
    const children = (await listProject(folder.path, options)).map((entry) =>
      prefixResearchSpaceEntry(folder, entry),
    );
    roots.push({
      name: folder.name,
      path: folder.path,
      relativePath: folder.name,
      type: "directory",
      children,
    });
  }
  return roots;
}

function temporarySiblingPath(targetPath: string, label = "tmp"): string {
  return path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${randomUUID()}.${label}`,
  );
}

async function removeIfPresent(filePath: string): Promise<void> {
  await unlink(filePath).catch(() => {});
}

async function syncParentDirectory(filePath: string): Promise<void> {
  let directoryHandle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    directoryHandle = await open(path.dirname(filePath), "r");
    await directoryHandle.sync();
  } catch {
    // Directory fsync is best-effort and unsupported on some platforms.
  } finally {
    await directoryHandle?.close().catch(() => {});
  }
}

async function writeSyncedUtf8(filePath: string, content: string): Promise<void> {
  const fileHandle = await open(filePath, "wx");
  try {
    await fileHandle.writeFile(content, "utf8");
    await fileHandle.sync();
  } finally {
    await fileHandle.close();
  }
}

async function refreshBackupFile(targetPath: string): Promise<void> {
  const backupPath = `${targetPath}.bak`;
  const backupTempPath = temporarySiblingPath(backupPath, "bak.tmp");

  try {
    await copyFile(targetPath, backupTempPath);
    await rename(backupTempPath, backupPath);
    await syncParentDirectory(backupPath);
  } catch (error) {
    await removeIfPresent(backupTempPath);
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function atomicWriteUtf8(
  targetPath: string,
  content: string,
  options: { backup?: boolean; exclusive?: boolean } = {},
): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = temporarySiblingPath(targetPath);

  try {
    await writeSyncedUtf8(tempPath, content);
    if (options.backup) {
      await refreshBackupFile(targetPath);
    }

    if (options.exclusive) {
      await link(tempPath, targetPath);
      await removeIfPresent(tempPath);
    } else {
      await rename(tempPath, targetPath);
    }
    await syncParentDirectory(targetPath);
  } catch (error) {
    await removeIfPresent(tempPath);
    throw error;
  }
}

function userDataFilePath(fileName: string): string {
  return path.join(app.getPath("userData"), fileName);
}

async function clearDevRuntimeCache(): Promise<void> {
  if (!devClearRuntimeCache) return;
  const userDataPath = app.getPath("userData");
  const targets = ["models", "speech"].map((directory) =>
    path.join(userDataPath, directory),
  );

  for (const target of targets) {
    await rm(target, { recursive: true, force: true });
  }

  console.log(
    `[latexdo] dev startup cleared local AI models and speech runtime under ${userDataPath}`,
  );
}

function envString(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function safeUrlHost(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

async function readUserDataJson<T>(fileName: string): Promise<T | null> {
  try {
    const content = await readFile(userDataFilePath(fileName), "utf8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function hasStoredPrivacyConsent(): Promise<boolean> {
  const stored = await readUserDataJson<StoredPrivacyConsent>(privacyConsentFile);
  return (
    isRecord(stored) &&
    stored.schemaVersion === privacyConsentSchemaVersion &&
    typeof stored.acceptedAt === "string"
  );
}

async function writePrivacyConsent(): Promise<void> {
  await atomicWriteUtf8(
    userDataFilePath(privacyConsentFile),
    JSON.stringify(
      {
        schemaVersion: privacyConsentSchemaVersion,
        acceptedAt: new Date().toISOString(),
        appVersion: app.getVersion(),
        privacyInfoUrl,
      },
      null,
      2,
    ),
    { backup: true },
  );
}

async function ensurePrivacyConsent(
  targetWindow: BrowserWindow | null,
): Promise<boolean> {
  if (await hasStoredPrivacyConsent()) {
    return true;
  }

  const options = {
    type: "question" as const,
    buttons: ["Agree and Continue", "View Privacy Info", "Quit"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    title: `${productName} Privacy and Consent`,
    message: `Review ${productName} privacy and consent`,
    detail:
      `${productName} does not currently collect personal analytics, sell user data, or track your documents.\n\n` +
      `${productName} stores app settings, trusted folder choices, editor preferences, spell checker settings, proofreading settings, and extension choices on this device. Project files and PDFs stay on your device unless you choose a feature or external service that sends a request.\n\n` +
      `${productName} reads and writes files only in folders you create, open, or trust. Update checks, the extension catalog, external links, downloads, and optional proofreading can contact ${productName} services or the provider you configure.\n\n` +
      "Choose Agree and Continue to consent to this use.",
  } satisfies Electron.MessageBoxOptions;

  while (true) {
    const result = targetWindow
      ? await dialog.showMessageBox(targetWindow, options)
      : await dialog.showMessageBox(options);

    if (result.response === 0) {
      await writePrivacyConsent();
      return true;
    }

    if (result.response === 1) {
      await shell.openExternal(privacyInfoUrl);
      continue;
    }

    return false;
  }
}

function normalizePathForTrust(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function pathIsTrustedBy(trustedPath: string, targetPath: string): boolean {
  const normalizedTrustedPath = normalizePathForTrust(trustedPath);
  const normalizedTargetPath = normalizePathForTrust(targetPath);
  const relativePath = path.relative(normalizedTrustedPath, normalizedTargetPath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

async function canonicalWorkspacePath(rootPath: string): Promise<string> {
  const resolvedRoot = path.resolve(rootPath);
  try {
    return await realpath(resolvedRoot);
  } catch {
    return resolvedRoot;
  }
}

async function readTrustedWorkspacePaths(): Promise<string[]> {
  const stored = await readUserDataJson<StoredTrustedWorkspaces>(trustedWorkspacesFile);
  if (!isRecord(stored) || !Array.isArray(stored.trustedPaths)) {
    return [];
  }

  const trustedPaths = stored.trustedPaths.filter(
    (value): value is string =>
      typeof value === "string" && value.trim() !== "" && !value.includes("\0"),
  );
  const canonicalPaths = await Promise.all(
    trustedPaths.map((trustedPath) => canonicalWorkspacePath(trustedPath)),
  );
  return [...new Set(canonicalPaths)];
}

async function writeTrustedWorkspacePaths(trustedPaths: string[]): Promise<void> {
  await atomicWriteUtf8(
    userDataFilePath(trustedWorkspacesFile),
    JSON.stringify(
      {
        schemaVersion: trustedWorkspacesSchemaVersion,
        trustedPaths,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    { backup: true },
  );
}

async function isWorkspaceTrusted(rootPath: string): Promise<boolean> {
  const canonicalRoot = await canonicalWorkspacePath(rootPath);
  const trustedPaths = await readTrustedWorkspacePaths();
  return trustedPaths.some((trustedPath) =>
    pathIsTrustedBy(trustedPath, canonicalRoot),
  );
}

async function trustWorkspace(rootPath: string): Promise<void> {
  const canonicalRoot = await canonicalWorkspacePath(rootPath);
  const trustedPaths = await readTrustedWorkspacePaths();
  if (trustedPaths.some((trustedPath) => pathIsTrustedBy(trustedPath, canonicalRoot))) {
    return;
  }
  await writeTrustedWorkspacePaths([...trustedPaths, canonicalRoot]);
}

async function ensureWorkspaceTrust(
  targetWindow: BrowserWindow | null,
  rootPath: string,
): Promise<boolean> {
  const canonicalRoot = await canonicalWorkspacePath(rootPath);
  if (await isWorkspaceTrusted(canonicalRoot)) {
    return true;
  }

  const options = {
    type: "warning" as const,
    buttons: ["Trust and Open", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: "Trust This Folder?",
    message: "Do you trust the authors of the files in this folder?",
    detail:
      `Folder:\n${canonicalRoot}\n\n` +
      `Trusting this folder lets ${productName} read and write files, compile LaTeX, use Git, and start integrated terminals for this workspace. Only trust folders whose contents and authors you trust.`,
    checkboxLabel: "Remember trust for this folder",
    checkboxChecked: true,
  } satisfies Electron.MessageBoxOptions;

  const result = targetWindow
    ? await dialog.showMessageBox(targetWindow, options)
    : await dialog.showMessageBox(options);

  if (result.response !== 0) {
    return false;
  }

  if (result.checkboxChecked !== false) {
    await trustWorkspace(canonicalRoot);
  }

  return true;
}

async function registerProjectIfTrusted(
  targetWindow: BrowserWindow | null,
  rootPath: string,
): Promise<OpenProject | null> {
  if (!(await ensureWorkspaceTrust(targetWindow, rootPath))) {
    return null;
  }
  const project = registerProject(rootPath);
  void rememberLastProject(project.rootPath);
  return project;
}

/** The folder opened last, so the next launch can reopen it (#229). */
const lastProjectFile = "last-project.json";

async function rememberLastProject(rootPath: string): Promise<void> {
  try {
    await atomicWriteUtf8(
      userDataFilePath(lastProjectFile),
      JSON.stringify({ rootPath }),
    );
  } catch {
    // Reopening at the next launch is a convenience.
  }
}

async function reopenLastProject(
  targetWindow: BrowserWindow | null,
): Promise<OpenProject | null> {
  const saved = await readUserDataJson<{ rootPath?: unknown }>(lastProjectFile);
  const rootPath = typeof saved?.rootPath === "string" ? saved.rootPath : "";
  if (!rootPath || !path.isAbsolute(rootPath)) return null;
  const stats = await stat(rootPath).catch(() => null);
  if (!stats?.isDirectory()) return null;
  return registerProjectIfTrusted(targetWindow, rootPath);
}

const maxProjectIdLength = 128;
const maxRelativePathLength = 4096;
const maxTextContentLength = 20 * 1024 * 1024;
// Figures and data shared to the always-on server (its limit is the same).
const maxCloudUploadFileBytes = 25 * 1024 * 1024;
const maxProofreadingContentLength = 5 * 1024 * 1024;
const MAX_PROOFREAD_CHARS = 20_000;
const maxGitCommitMessageLength = 20_000;
const maxSettingsStringLength = 2048;
const maxProjectTreeIgnoredNames = 256;
const maxProjectTreeIgnoreNameLength = 128;
const maxProjectTreeDepth = 50;
const maxProjectTreeEntries = 100_000;
const maxSyncTexNumber = 1_000_000;
const reservedProjectPathSegments = new Set([".git", "node_modules"]);
const compileEngines = new Set(["pdflatex", "xelatex", "lualatex"]);
const languageCodePattern = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/;
const gitHashPattern = /^[0-9a-fA-F]{7,64}$/;
const invalidProjectFolderCharacters = new Set([
  "<",
  ">",
  ":",
  '"',
  "/",
  "\\",
  "|",
  "?",
  "*",
]);

function invalidIpcInput(channel: string): never {
  throw new Error(`Invalid IPC input for ${channel}.`);
}

function expectIpcArgs(
  channel: string,
  args: unknown[],
  expectedCount: number,
): unknown[] {
  if (args.length !== expectedCount) {
    invalidIpcInput(channel);
  }
  return args;
}

function expectIpcArgRange(
  channel: string,
  args: unknown[],
  minCount: number,
  maxCount: number,
): unknown[] {
  if (args.length < minCount || args.length > maxCount) {
    invalidIpcInput(channel);
  }
  return args;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasControlChars(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function parseString(
  channel: string,
  value: unknown,
  options: {
    allowEmpty?: boolean;
    maxLength?: number;
    trim?: boolean;
    rejectControlChars?: boolean;
    rejectNullByte?: boolean;
    pattern?: RegExp;
  } = {},
): string {
  if (typeof value !== "string") {
    invalidIpcInput(channel);
  }

  const parsed = options.trim === false ? value : value.trim();
  const maxLength = options.maxLength ?? maxSettingsStringLength;
  if ((!options.allowEmpty && !parsed) || parsed.length > maxLength) {
    invalidIpcInput(channel);
  }
  if (options.rejectNullByte !== false && parsed.includes("\0")) {
    invalidIpcInput(channel);
  }
  if (options.rejectControlChars && hasControlChars(parsed)) {
    invalidIpcInput(channel);
  }
  if (options.pattern && !options.pattern.test(parsed)) {
    invalidIpcInput(channel);
  }

  return parsed;
}

function parseBoolean(channel: string, value: unknown): boolean {
  if (typeof value !== "boolean") {
    invalidIpcInput(channel);
  }
  return value;
}

function parseInteger(
  channel: string,
  value: unknown,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    invalidIpcInput(channel);
  }
  return value;
}

function parseFiniteNumber(
  channel: string,
  value: unknown,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    invalidIpcInput(channel);
  }
  return value;
}

function parseProjectId(channel: string, value: unknown): string {
  return parseString(channel, value, {
    maxLength: maxProjectIdLength,
    rejectControlChars: true,
  });
}

function sanitizeProjectFolderName(value: string): string {
  const sanitized = value
    .split("")
    .map((character) => {
      const code = character.charCodeAt(0);
      return invalidProjectFolderCharacters.has(character) || code < 32
        ? " "
        : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+$/, "");
  return sanitized || `${productName} Project`;
}

function parseCreateProjectOptions(
  channel: string,
  value: unknown,
): CreateProjectOptions {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    invalidIpcInput(channel);
  }

  const options: CreateProjectOptions = {};
  if (value.folderName !== undefined) {
    options.folderName = sanitizeProjectFolderName(
      parseString(channel, value.folderName, {
        maxLength: 96,
        rejectControlChars: true,
      }),
    );
  }
  return options;
}

async function availableProjectPath(
  parentPath: string,
  folderName: string,
): Promise<string> {
  for (let index = 0; index < 100; index += 1) {
    const candidateName = index === 0 ? folderName : `${folderName} ${index + 1}`;
    const candidatePath = path.join(parentPath, candidateName);
    try {
      await stat(candidatePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return candidatePath;
      }
      throw error;
    }
  }
  throw new Error(`Could not find an available folder named "${folderName}".`);
}

function folderNameFromProviderProjectUrl(value: string): string {
  try {
    const parsed = new URL(value);
    const lastPathSegment = parsed.pathname.split("/").filter(Boolean).pop();
    const rawName = lastPathSegment || "overleaf-project";
    const safeName = rawName
      .replace(/\.git$/i, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    return safeName || "overleaf-project";
  } catch {
    return "overleaf-project";
  }
}

function parseOverleafGitUrl(channel: string, value: unknown): string {
  const url = parseHttpUrl(channel, value);
  if (!url) {
    invalidIpcInput(channel);
  }
  const parsed = new URL(url);
  if (parsed.hostname.toLowerCase() !== "git.overleaf.com") {
    throw new Error(`${channel}: expected an Overleaf Git URL from git.overleaf.com`);
  }
  return parsed.toString();
}

function parseRelativePath(
  channel: string,
  value: unknown,
  options: { extensions?: string[] } = {},
): string {
  const parsed = parseString(channel, value, {
    maxLength: maxRelativePathLength,
    rejectControlChars: true,
  }).replace(/\\/g, "/");

  if (
    path.isAbsolute(parsed) ||
    path.posix.isAbsolute(parsed) ||
    path.win32.isAbsolute(parsed) ||
    /^[A-Za-z]:/.test(parsed)
  ) {
    invalidIpcInput(channel);
  }

  const segments = parsed.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        reservedProjectPathSegments.has(segment),
    )
  ) {
    invalidIpcInput(channel);
  }

  if (
    options.extensions &&
    !options.extensions.includes(path.posix.extname(parsed).toLowerCase())
  ) {
    invalidIpcInput(channel);
  }

  return parsed;
}

function parseOptionalRelativePath(
  channel: string,
  value: unknown,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseRelativePath(channel, value);
}

function parseProjectListOptions(channel: string, value: unknown): ProjectListOptions {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    invalidIpcInput(channel);
  }

  const ignoredNames =
    value.ignoredNames === undefined
      ? undefined
      : parseStringArray(channel, value.ignoredNames, {
          maxItems: maxProjectTreeIgnoredNames,
          maxItemLength: maxProjectTreeIgnoreNameLength,
          pattern: /^[^/\\]+$/,
        });
  if (ignoredNames?.some((name) => name === "." || name === "..")) {
    invalidIpcInput(channel);
  }

  return {
    ignoredNames,
    maxDepth:
      value.maxDepth === undefined
        ? undefined
        : parseInteger(channel, value.maxDepth, 1, maxProjectTreeDepth),
    maxEntries:
      value.maxEntries === undefined
        ? undefined
        : parseInteger(channel, value.maxEntries, 100, maxProjectTreeEntries),
  };
}

function parseTextContent(
  channel: string,
  value: unknown,
  maxLength = maxTextContentLength,
): string {
  return parseString(channel, value, {
    allowEmpty: true,
    maxLength,
    trim: false,
    rejectNullByte: true,
  });
}

function parseOptionalImportDestination(channel: string, value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  return parseRelativePath(channel, value);
}

function parseExternalSourcePaths(channel: string, value: unknown): string[] {
  const sourcePaths = parseStringArray(channel, value, {
    maxItems: 64,
    maxItemLength: 4096,
  });

  for (const sourcePath of sourcePaths) {
    if (
      (!path.isAbsolute(sourcePath) && !path.win32.isAbsolute(sourcePath)) ||
      sourcePath.includes("\0")
    ) {
      invalidIpcInput(channel);
    }
  }

  return [...new Set(sourcePaths.map((sourcePath) => path.resolve(sourcePath)))];
}

function parseStringArray(
  channel: string,
  value: unknown,
  options: { maxItems: number; maxItemLength: number; pattern?: RegExp },
): string[] {
  if (!Array.isArray(value) || value.length > options.maxItems) {
    invalidIpcInput(channel);
  }

  return value.map((item) =>
    parseString(channel, item, {
      maxLength: options.maxItemLength,
      rejectControlChars: true,
      pattern: options.pattern,
    }),
  );
}

const rendererDiagnosticKinds = new Set<RendererDiagnosticPayload["kind"]>([
  "renderer-error",
  "renderer-unhandled-rejection",
  "renderer-react-error",
  "renderer-freeze",
]);

function parseOptionalDiagnosticString(
  channel: string,
  value: unknown,
  maxLength: number,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseString(channel, value, {
    allowEmpty: true,
    maxLength,
    trim: false,
    rejectNullByte: true,
  });
}

function parseRendererDiagnosticContext(
  channel: string,
  value: unknown,
): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    invalidIpcInput(channel);
  }

  const context: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 50)) {
    const key = parseString(channel, rawKey, {
      maxLength: 120,
      rejectControlChars: true,
    });
    if (typeof rawValue === "string") {
      context[key] = parseString(channel, rawValue, {
        allowEmpty: true,
        maxLength: 2_000,
        trim: false,
        rejectNullByte: true,
      });
      continue;
    }
    if (
      rawValue === null ||
      typeof rawValue === "boolean" ||
      (typeof rawValue === "number" && Number.isFinite(rawValue))
    ) {
      context[key] = rawValue;
    }
  }
  return context;
}

function parseRendererDiagnosticPayload(
  channel: string,
  value: unknown,
): RendererDiagnosticPayload {
  if (!isRecord(value) || !isRecord(value.error)) {
    invalidIpcInput(channel);
  }

  const kind = parseString(channel, value.kind, {
    rejectControlChars: true,
    pattern:
      /^(?:renderer-error|renderer-unhandled-rejection|renderer-react-error|renderer-freeze)$/,
  }) as RendererDiagnosticPayload["kind"];
  if (!rendererDiagnosticKinds.has(kind)) {
    invalidIpcInput(channel);
  }

  return {
    kind,
    error: {
      name: parseOptionalDiagnosticString(channel, value.error.name, 200),
      message: parseString(channel, value.error.message, {
        allowEmpty: true,
        maxLength: 2_000,
        trim: false,
        rejectNullByte: true,
      }),
      stack: parseOptionalDiagnosticString(channel, value.error.stack, 12_000),
      code: parseOptionalDiagnosticString(channel, value.error.code, 120),
    },
    context: parseRendererDiagnosticContext(channel, value.context),
  };
}

function normalizeHttpUrl(value: string): string | null {
  if (!value) {
    return "";
  }

  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function parseHttpUrl(channel: string, value: unknown): string {
  const raw = parseString(channel, value, {
    allowEmpty: true,
    maxLength: maxSettingsStringLength,
    rejectControlChars: true,
  });
  const normalized = normalizeHttpUrl(raw);
  if (normalized === null) {
    invalidIpcInput(channel);
  }
  return normalized;
}

function parseSpellCheckerSettingsInput(
  channel: string,
  value: unknown,
): SpellCheckerSettings {
  if (!isRecord(value)) {
    invalidIpcInput(channel);
  }

  return {
    enabled: parseBoolean(channel, value.enabled),
    languages: parseStringArray(channel, value.languages, {
      maxItems: 64,
      maxItemLength: 32,
      pattern: languageCodePattern,
    }),
    customWords: parseStringArray(channel, value.customWords, {
      maxItems: 2000,
      maxItemLength: 128,
    }),
    availableLanguages: [],
    usesSystemLanguage: false,
  };
}

function parseProofreadingSettingsInput(
  channel: string,
  value: unknown,
): ProofreadingSettings {
  if (!isRecord(value)) {
    invalidIpcInput(channel);
  }

  const language = parseString(channel, value.language, {
    maxLength: 32,
    pattern: /^(?:auto|[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*)$/,
  });
  const motherTongue = parseString(channel, value.motherTongue, {
    allowEmpty: true,
    maxLength: 32,
    rejectControlChars: true,
  });
  if (motherTongue && !languageCodePattern.test(motherTongue)) {
    invalidIpcInput(channel);
  }

  return {
    enabled: parseBoolean(channel, value.enabled),
    serverUrl: parseHttpUrl(channel, value.serverUrl),
    language,
    picky: parseBoolean(channel, value.picky),
    motherTongue,
  };
}

function parseProofreadingRequestOptions(
  channel: string,
  value: unknown,
): ProofreadingRequestOptions {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    invalidIpcInput(channel);
  }

  return {
    baseLine:
      value.baseLine === undefined
        ? undefined
        : parseInteger(channel, value.baseLine, 1, maxTextContentLength),
    baseColumn:
      value.baseColumn === undefined
        ? undefined
        : parseInteger(channel, value.baseColumn, 1, maxTextContentLength),
    originalTextLength:
      value.originalTextLength === undefined
        ? undefined
        : parseInteger(channel, value.originalTextLength, 0, maxTextContentLength),
    truncated:
      value.truncated === undefined
        ? undefined
        : parseBoolean(channel, value.truncated),
  };
}

function parseCompileRequestInput(channel: string, value: unknown): CompileRequest {
  if (!isRecord(value)) {
    invalidIpcInput(channel);
  }

  const engine = parseString(channel, value.engine, {
    maxLength: 16,
    rejectControlChars: true,
  }) as CompileRequest["engine"];
  if (!compileEngines.has(engine)) {
    invalidIpcInput(channel);
  }

  return {
    projectId: parseProjectId(channel, value.projectId),
    rootFile: parseRelativePath(channel, value.rootFile, {
      extensions: [".tex"],
    }),
    engine,
  };
}

function parseAsymptoteCompileRequestInput(
  channel: string,
  value: unknown,
): AsymptoteCompileRequest {
  if (!isRecord(value)) {
    invalidIpcInput(channel);
  }

  return {
    projectId: parseProjectId(channel, value.projectId),
    relativePath: parseRelativePath(channel, value.relativePath, {
      extensions: [".asy"],
    }),
  };
}

function parseGitHash(channel: string, value: unknown): string {
  return parseString(channel, value, {
    maxLength: 64,
    rejectControlChars: true,
    pattern: gitHashPattern,
  });
}

function parseOptionalGitHash(channel: string, value: unknown): string | undefined {
  return value === undefined ? undefined : parseGitHash(channel, value);
}

function parseGitRevisionRef(channel: string, value: unknown): GitRevisionRef {
  if (!isRecord(value) || typeof value.kind !== "string") {
    invalidIpcInput(channel);
  }
  if (value.kind === "commit") {
    return { kind: "commit", hash: parseGitHash(channel, value.hash) };
  }
  if (
    value.kind === "working-tree" ||
    value.kind === "index" ||
    value.kind === "empty"
  ) {
    return { kind: value.kind };
  }
  invalidIpcInput(channel);
}

function starterContent(relativePath: string): string {
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === ".tex" && path.basename(relativePath) === "main.tex") {
    return starterDocument;
  }
  if (extension === ".bib") {
    return "% Add BibTeX entries here.\n";
  }
  return "";
}

interface StoredSpellCheckerSettings {
  enabled?: boolean;
  languages?: string[];
  customWords?: string[];
}

interface StoredProofreadingSettings {
  enabled?: boolean;
  serverUrl?: string;
  language?: string;
  picky?: boolean;
  motherTongue?: string;
}

interface ProofreadingMatch {
  message?: string;
  offset?: number;
  length?: number;
  replacements?: Array<{ value?: string }>;
  rule?: {
    id?: string;
    issueType?: string;
    category?: { name?: string };
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeLanguageCode(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  const normalized = trimmed.replace("_", "-");
  const [language] = normalized.split("-");
  if (!language) {
    return [];
  }

  return uniqueStrings([normalized, language]);
}

function defaultSpellCheckerLanguages(availableLanguages: string[]): string[] {
  const availableSet = new Set(availableLanguages);
  const localeCandidates = [...normalizeLanguageCode(app.getLocale()), "en-US", "en"];
  const matched = localeCandidates.filter((code) => availableSet.has(code));
  if (matched.length) {
    return matched;
  }

  return availableLanguages[0] ? [availableLanguages[0]] : [];
}

async function readStoredSpellCheckerSettings(): Promise<StoredSpellCheckerSettings> {
  try {
    const filePath = path.join(app.getPath("userData"), spellCheckerSettingsFile);
    const content = await readFile(filePath, "utf8");
    const parsed = JSON.parse(content) as StoredSpellCheckerSettings;

    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : true,
      languages: Array.isArray(parsed.languages)
        ? parsed.languages.filter((value): value is string => typeof value === "string")
        : [],
      customWords: Array.isArray(parsed.customWords)
        ? parsed.customWords.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
    };
  } catch {
    return {
      enabled: true,
      languages: [],
      customWords: [],
    };
  }
}

async function writeStoredSpellCheckerSettings(
  settings: StoredSpellCheckerSettings,
): Promise<void> {
  const filePath = path.join(app.getPath("userData"), spellCheckerSettingsFile);
  await atomicWriteUtf8(
    filePath,
    JSON.stringify(
      {
        enabled: settings.enabled !== false,
        languages: uniqueStrings(settings.languages ?? []),
        customWords: uniqueStrings(settings.customWords ?? []),
      },
      null,
      2,
    ),
    { backup: true },
  );
}

function sanitizeSpellCheckerSettings(
  stored: StoredSpellCheckerSettings,
  availableLanguages: string[],
): SpellCheckerSettings {
  const usesSystemLanguage = process.platform === "darwin";
  const available = uniqueStrings(availableLanguages).sort((left, right) =>
    left.localeCompare(right),
  );
  const availableSet = new Set(available);
  const requestedLanguages = uniqueStrings(stored.languages ?? []).filter((code) =>
    availableSet.has(code),
  );

  return {
    enabled: stored.enabled !== false,
    languages: usesSystemLanguage
      ? []
      : requestedLanguages.length
        ? requestedLanguages
        : defaultSpellCheckerLanguages(available),
    customWords: uniqueStrings(stored.customWords ?? []),
    availableLanguages: available,
    usesSystemLanguage,
  };
}

async function getSpellCheckerSettings(
  targetWindow?: BrowserWindow | null,
): Promise<SpellCheckerSettings> {
  const window =
    targetWindow ??
    BrowserWindow.getFocusedWindow() ??
    BrowserWindow.getAllWindows()[0] ??
    null;
  const availableLanguages =
    window && process.platform !== "darwin"
      ? window.webContents.session.availableSpellCheckerLanguages
      : [];
  const stored = await readStoredSpellCheckerSettings();
  return sanitizeSpellCheckerSettings(stored, availableLanguages);
}

async function applySpellCheckerSettings(
  targetWindow: BrowserWindow,
  settings: SpellCheckerSettings,
): Promise<void> {
  const { session } = targetWindow.webContents;
  session.setSpellCheckerEnabled(settings.enabled);

  if (!settings.usesSystemLanguage) {
    session.setSpellCheckerLanguages(settings.languages);
  }

  // The saved list is the dictionary: Chromium keeps its own copy, so words
  // removed from the list must be removed there too.
  const wanted = new Set(settings.customWords);
  const known = await session.listWordsInSpellCheckerDictionary().catch(() => []);
  for (const word of known) {
    if (!wanted.has(word)) session.removeWordFromSpellCheckerDictionary(word);
  }
  const knownSet = new Set(known);
  for (const word of settings.customWords) {
    if (!knownSet.has(word)) session.addWordToSpellCheckerDictionary(word);
  }
}

async function syncSpellCheckerSettings(
  targetWindow: BrowserWindow,
): Promise<SpellCheckerSettings> {
  const settings = await getSpellCheckerSettings(targetWindow);
  await applySpellCheckerSettings(targetWindow, settings);
  return settings;
}

async function updateSpellCheckerSettings(
  nextSettings: SpellCheckerSettings,
): Promise<SpellCheckerSettings> {
  const referenceWindow =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const availableLanguages =
    referenceWindow && process.platform !== "darwin"
      ? referenceWindow.webContents.session.availableSpellCheckerLanguages
      : [];
  const sanitized = sanitizeSpellCheckerSettings(
    {
      enabled: nextSettings.enabled,
      languages: nextSettings.languages,
      customWords: nextSettings.customWords,
    },
    availableLanguages,
  );

  await writeStoredSpellCheckerSettings({
    enabled: sanitized.enabled,
    languages: sanitized.languages,
    customWords: sanitized.customWords,
  });

  for (const window of BrowserWindow.getAllWindows()) {
    await applySpellCheckerSettings(window, sanitized);
    // Words can change outside Settings (the context menu), so every window
    // hears about it.
    window.webContents.send(spellCheckerChangedChannel, sanitized);
  }

  return sanitized;
}

async function addSpellCheckerWord(word: string): Promise<SpellCheckerSettings> {
  const current = await getSpellCheckerSettings();
  return updateSpellCheckerSettings({
    ...current,
    customWords: uniqueStrings([...current.customWords, word]),
  });
}

function defaultProofreadingSettings(): ProofreadingSettings {
  return {
    enabled: true,
    serverUrl: "https://api.languagetool.org/v2/check",
    language: "auto",
    picky: false,
    motherTongue: "",
  };
}

async function readStoredProofreadingSettings(): Promise<StoredProofreadingSettings> {
  try {
    const filePath = path.join(app.getPath("userData"), proofreadingSettingsFile);
    const content = await readFile(filePath, "utf8");
    const parsed = JSON.parse(content) as StoredProofreadingSettings;
    return parsed ?? {};
  } catch {
    return {};
  }
}

async function writeStoredProofreadingSettings(
  settings: ProofreadingSettings,
): Promise<void> {
  const filePath = path.join(app.getPath("userData"), proofreadingSettingsFile);
  await atomicWriteUtf8(filePath, JSON.stringify(settings, null, 2), {
    backup: true,
  });
}

function sanitizeProofreadingSettings(
  stored: StoredProofreadingSettings,
): ProofreadingSettings {
  const defaults = defaultProofreadingSettings();
  const serverUrl = typeof stored.serverUrl === "string" ? stored.serverUrl.trim() : "";
  const language = typeof stored.language === "string" ? stored.language.trim() : "";
  const motherTongue =
    typeof stored.motherTongue === "string" ? stored.motherTongue.trim() : "";
  const normalizedServerUrl = normalizeHttpUrl(serverUrl);

  return {
    enabled: stored.enabled !== false,
    serverUrl: normalizedServerUrl || defaults.serverUrl,
    language:
      language === "auto" || languageCodePattern.test(language)
        ? language
        : defaults.language,
    picky: typeof stored.picky === "boolean" ? stored.picky : defaults.picky,
    motherTongue: languageCodePattern.test(motherTongue) ? motherTongue : "",
  };
}

async function getProofreadingSettings(): Promise<ProofreadingSettings> {
  return sanitizeProofreadingSettings(await readStoredProofreadingSettings());
}

async function updateProofreadingSettings(
  settings: ProofreadingSettings,
): Promise<ProofreadingSettings> {
  const sanitized = sanitizeProofreadingSettings(settings);
  await writeStoredProofreadingSettings(sanitized);
  return sanitized;
}

function replaceRangeWithSpaces(source: string, start: number, end: number): string {
  return source.slice(start, end).replace(/[^\n]/g, " ");
}

function sanitizeLatexForProofreading(source: string): string {
  const ignoredArgumentCommands = new Set([
    "cite",
    "citet",
    "citep",
    "parencite",
    "textcite",
    "ref",
    "cref",
    "Cref",
    "autoref",
    "pageref",
    "eqref",
    "label",
    "url",
    "href",
    "includegraphics",
    "bibliography",
    "bibliographystyle",
    "usepackage",
    "documentclass",
    "input",
    "include",
    "begin",
    "end",
    // Author metadata: names and addresses, not prose to proofread.
    "author",
    "affil",
    "affiliation",
    "institute",
    "address",
    "email",
    "orgname",
    "orgdiv",
    "orgaddress",
    "street",
    "city",
    "postcode",
    "state",
    "country",
    "keywords",
  ]);

  // The preamble is configuration (\newcommand, \definecolor, …), not text.
  const bodyStart = source.indexOf("\\begin{document}");
  let sanitized =
    bodyStart > 0
      ? replaceRangeWithSpaces(source, 0, bodyStart) + source.slice(bodyStart)
      : source;
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "%" && source[index - 1] !== "\\") {
      let end = index;
      while (end < source.length && source[end] !== "\n") {
        end += 1;
      }
      sanitized =
        sanitized.slice(0, index) +
        replaceRangeWithSpaces(source, index, end) +
        sanitized.slice(end);
      index = end;
      continue;
    }

    if (char === "$") {
      const doubleMath = next === "$";
      const closeToken = doubleMath ? "$$" : "$";
      let end = index + closeToken.length;

      while (end < source.length) {
        if (source.startsWith(closeToken, end) && source[end - 1] !== "\\") {
          end += closeToken.length;
          break;
        }
        end += 1;
      }

      if (end > index) {
        sanitized =
          sanitized.slice(0, index) +
          replaceRangeWithSpaces(source, index, end) +
          sanitized.slice(end);
        index = end;
        continue;
      }
    }

    if (source.startsWith("\\(", index) || source.startsWith("\\[", index)) {
      const closeToken = source[index + 1] === "(" ? "\\)" : "\\]";
      let end = index + 2;
      while (end < source.length && !source.startsWith(closeToken, end)) {
        end += 1;
      }
      end = Math.min(source.length, end + 2);
      sanitized =
        sanitized.slice(0, index) +
        replaceRangeWithSpaces(source, index, end) +
        sanitized.slice(end);
      index = end;
      continue;
    }

    if (char === "\\") {
      let commandEnd = index + 1;
      while (commandEnd < source.length && /[A-Za-z*@]/.test(source[commandEnd]!)) {
        commandEnd += 1;
      }
      const command = source.slice(index + 1, commandEnd);
      if (!command) {
        index += 1;
        continue;
      }

      sanitized =
        sanitized.slice(0, index) +
        replaceRangeWithSpaces(source, index, commandEnd) +
        sanitized.slice(commandEnd);

      if (ignoredArgumentCommands.has(command)) {
        let pointer = commandEnd;
        while (pointer < source.length && /\s/.test(source[pointer]!)) {
          pointer += 1;
        }

        for (let groups = 0; groups < 2 && pointer < source.length; groups += 1) {
          if (source[pointer] === "[") {
            let depth = 1;
            let end = pointer + 1;
            while (end < source.length && depth > 0) {
              if (source[end] === "[") depth += 1;
              else if (source[end] === "]") depth -= 1;
              end += 1;
            }
            sanitized =
              sanitized.slice(0, pointer) +
              replaceRangeWithSpaces(source, pointer, end) +
              sanitized.slice(end);
            pointer = end;
            while (pointer < source.length && /\s/.test(source[pointer]!)) {
              pointer += 1;
            }
          }

          if (source[pointer] === "{") {
            let depth = 1;
            let end = pointer + 1;
            while (end < source.length && depth > 0) {
              if (source[end] === "{") depth += 1;
              else if (source[end] === "}") depth -= 1;
              end += 1;
            }
            sanitized =
              sanitized.slice(0, pointer) +
              replaceRangeWithSpaces(source, pointer, end) +
              sanitized.slice(end);
            pointer = end;
            while (pointer < source.length && /\s/.test(source[pointer]!)) {
              pointer += 1;
            }
          }
        }
      }

      index = commandEnd;
      continue;
    }

    index += 1;
  }

  return sanitized;
}

function offsetToLocation(
  source: string,
  offset: number,
  baseLine = 1,
  baseColumn = 1,
): {
  line: number;
  column: number;
} {
  let line = baseLine;
  let column = baseColumn;

  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return { line, column };
}

function mapProofreadingMatch(
  relativePath: string,
  source: string,
  sanitized: string,
  match: ProofreadingMatch,
  options: ProofreadingRequestOptions = {},
  customWords: ReadonlySet<string> = new Set(),
): Diagnostic | null {
  const offset = typeof match.offset === "number" ? match.offset : -1;
  const length = typeof match.length === "number" ? Math.max(1, match.length) : 1;
  if (offset < 0 || offset >= source.length) {
    return null;
  }
  if (isProofreadingNoise(source, sanitized, offset, length, match.rule?.id)) {
    return null;
  }

  const baseLine = options.baseLine ?? 1;
  const baseColumn = options.baseColumn ?? 1;
  const start = offsetToLocation(source, offset, baseLine, baseColumn);
  const end = offsetToLocation(
    source,
    Math.min(source.length, offset + length),
    baseLine,
    baseColumn,
  );
  const replacements = uniqueStrings(
    (match.replacements ?? [])
      .map((replacement) => replacement.value ?? "")
      .slice(0, 5),
  );
  const ruleId = match.rule?.id;
  if (
    isCustomDictionaryMatch(
      source.slice(offset, offset + length),
      ruleId,
      match.rule?.issueType,
      customWords,
    )
  ) {
    return null;
  }
  const baseMessage = (match.message ?? "Writing suggestion").replace(/\.\s*$/, "");
  const flaggedText = source.slice(offset, offset + length).trim();
  const flagged = flaggedText.length <= 40 ? flaggedText : "";

  return {
    file: relativePath,
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column,
    severity: "warning",
    // Name the flagged words so the row says what to look at.
    message: flagged ? `${baseMessage}: “${flagged}”` : baseMessage,
    source: "proofread",
    code: ruleId,
    replacements,
  };
}

async function proofreadDocument(
  relativePath: string,
  content: string,
  options: ProofreadingRequestOptions = {},
): Promise<ProofreadingResult> {
  const settings = await getProofreadingSettings();
  if (!settings.enabled) {
    return {
      diagnostics: [],
      output: "Proofreading is disabled.",
      checkedTextLength: 0,
    };
  }

  const sanitizedText = relativePath.endsWith(".tex")
    ? sanitizeLatexForProofreading(content)
    : content;
  const payloadWasLimited =
    sanitizedText.length > MAX_PROOFREAD_CHARS || Boolean(options.truncated);
  const limitedText =
    sanitizedText.length > MAX_PROOFREAD_CHARS
      ? sanitizedText.slice(0, MAX_PROOFREAD_CHARS)
      : sanitizedText;
  const textForCheck = limitedText.replace(/[ \t]+\n/g, "\n");
  if (!textForCheck.trim()) {
    return {
      diagnostics: [],
      output: "No natural-language text found to proofread.",
      checkedTextLength: 0,
    };
  }

  const payload = new URLSearchParams();
  payload.set("text", limitedText);
  payload.set("language", settings.language || "auto");
  if (settings.motherTongue) {
    payload.set("motherTongue", settings.motherTongue);
  }
  if (settings.picky) {
    payload.set("level", "picky");
  }

  try {
    const response = await fetch(settings.serverUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: payload.toString(),
    });

    if (!response.ok) {
      throw new Error(`Proofreading failed (${response.status})`);
    }

    const result = (await response.json()) as { matches?: ProofreadingMatch[] };
    const customWords = customDictionarySet(
      (await readStoredSpellCheckerSettings()).customWords ?? [],
    );
    const diagnostics = (result.matches ?? [])
      .map((match) =>
        mapProofreadingMatch(
          relativePath,
          content,
          sanitizedText,
          match,
          options,
          customWords,
        ),
      )
      .filter((diagnostic): diagnostic is Diagnostic => diagnostic !== null);
    const checkedTextLength = limitedText.trim().length;
    const limitMessage = payloadWasLimited
      ? ` Checked ${checkedTextLength.toLocaleString()} characters from the current document chunk (limit ${MAX_PROOFREAD_CHARS.toLocaleString()}).`
      : "";
    const baseOutput = diagnostics.length
      ? `Found ${diagnostics.length} writing suggestion${diagnostics.length === 1 ? "" : "s"}.`
      : "No grammar or style suggestions found.";

    return {
      diagnostics,
      output: `${baseOutput}${limitMessage}`,
      checkedTextLength,
    };
  } catch (error) {
    return {
      diagnostics: [],
      output: "Proofreading could not reach the grammar service.",
      checkedTextLength: limitedText.trim().length,
      error: error instanceof Error ? error.message : "Proofreading failed",
    };
  }
}

function showSpellCheckerMenu(): void {
  const targetWindow =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
  targetWindow?.webContents.send(openSpellCheckerChannel);
}

function installSpellCheckerContextMenu(window: BrowserWindow): void {
  window.webContents.on("context-menu", (_event, params) => {
    const template: MenuItemConstructorOptions[] = [];

    if (params.dictionarySuggestions.length) {
      template.push(
        ...params.dictionarySuggestions.slice(0, 6).map((suggestion) => ({
          label: suggestion,
          click: () => {
            window.webContents.replaceMisspelling(suggestion);
          },
        })),
      );
    }

    if (params.misspelledWord) {
      if (template.length) {
        template.push({ type: "separator" });
      }
      template.push({
        label: `Add "${params.misspelledWord}" to Dictionary`,
        click: () => {
          void addSpellCheckerWord(params.misspelledWord);
        },
      });
    }

    if (params.isEditable) {
      if (template.length) {
        template.push({ type: "separator" });
      }
      template.push(
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      );
    } else if (params.selectionText.trim()) {
      if (template.length) {
        template.push({ type: "separator" });
      }
      template.push({ role: "copy" });
    }

    if (!template.length) {
      return;
    }

    Menu.buildFromTemplate(template).popup({ window });
  });
}

function sendToFocusedWindow(channel: string, ...args: unknown[]): void {
  BrowserWindow.getFocusedWindow()?.webContents.send(channel, ...args);
}

/**
 * A menu item the renderer carries out. Items marked `editor` run an editor
 * action that the editor already binds to the same keys: their accelerator is
 * shown for reference and only a click runs them, so the key never reaches the
 * editor from an unrelated field such as the AI chat.
 */
function menuCommand(
  label: string,
  command: string,
  accelerator?: string,
  options: { editor?: boolean } = {},
): MenuItemConstructorOptions {
  return {
    label,
    accelerator,
    // Marks the items the shortcut list describes as editor-only.
    id: options.editor ? `${editorMenuCommandPrefix}${command}` : undefined,
    click: (_item, _window, event) => {
      if (options.editor && event.triggeredByAccelerator) {
        return;
      }
      sendToFocusedWindow(menuCommandChannel, command);
    },
  };
}

function editorMenuCommand(
  label: string,
  actionId: string,
  accelerator?: string,
): MenuItemConstructorOptions {
  return menuCommand(label, `editor:${actionId}`, accelerator, { editor: true });
}

const isMac = process.platform === "darwin";
const editorMenuCommandPrefix = "editor-only:";

// Roles take their keys from the platform; the shortcut list still names them.
const roleAccelerators: Partial<Record<string, string>> = {
  undo: "CmdOrCtrl+Z",
  redo: isMac ? "Shift+Cmd+Z" : "Ctrl+Y",
  cut: "CmdOrCtrl+X",
  copy: "CmdOrCtrl+C",
  paste: "CmdOrCtrl+V",
  selectall: "CmdOrCtrl+A",
  resetzoom: "CmdOrCtrl+0",
  zoomin: "CmdOrCtrl+Plus",
  zoomout: "CmdOrCtrl+-",
  togglefullscreen: isMac ? "Ctrl+Cmd+F" : "F11",
  minimize: "CmdOrCtrl+M",
  quit: isMac ? "Cmd+Q" : "",
  hide: "Cmd+H",
  hideothers: "Alt+Cmd+H",
  reload: "CmdOrCtrl+R",
  forcereload: "Shift+CmdOrCtrl+R",
  toggledevtools: isMac ? "Alt+Cmd+I" : "Ctrl+Shift+I",
};

const macKeySymbols: Record<string, string> = {
  CmdOrCtrl: "⌘",
  CommandOrControl: "⌘",
  Cmd: "⌘",
  Command: "⌘",
  Ctrl: "⌃",
  Control: "⌃",
  Alt: "⌥",
  Option: "⌥",
  Shift: "⇧",
  Up: "↑",
  Down: "↓",
  Left: "←",
  Right: "→",
  Enter: "↩",
  Return: "↩",
  Tab: "⇥",
  Plus: "+",
};

function formatAccelerator(accelerator: string, mac = isMac): string {
  // "CmdOrCtrl+Plus" and "CmdOrCtrl+-" both split cleanly on "+".
  const parts = accelerator.split("+").filter(Boolean);
  if (mac) {
    return parts.map((part) => macKeySymbols[part] ?? part).join("");
  }
  return parts
    .map((part) =>
      part === "CmdOrCtrl" || part === "CommandOrControl"
        ? "Ctrl"
        : part === "Plus"
          ? "+"
          : part,
    )
    .join("+");
}

let applicationMenuTemplate: MenuItemConstructorOptions[] = [];

function listMenuShortcuts(
  template: MenuItemConstructorOptions[] = applicationMenuTemplate,
): MenuShortcut[] {
  const shortcuts: MenuShortcut[] = [];
  const visit = (items: MenuItemConstructorOptions[], menu: string) => {
    for (const item of items) {
      if (Array.isArray(item.submenu)) {
        visit(item.submenu, menu);
        continue;
      }
      const accelerator =
        (typeof item.accelerator === "string" ? item.accelerator : "") ||
        (item.role ? (roleAccelerators[item.role.toLowerCase()] ?? "") : "");
      if (!accelerator || !item.label) {
        continue;
      }
      shortcuts.push({
        menu,
        label: item.label.replace(/\.\.\.$|…$/, ""),
        keys: formatAccelerator(accelerator),
        editorOnly: Boolean(item.id?.startsWith(editorMenuCommandPrefix)),
      });
    }
  };
  for (const menu of template) {
    if (Array.isArray(menu.submenu)) {
      visit(menu.submenu, menu.label ?? "");
    }
  }
  return shortcuts;
}

function buildApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [];
  const settingsItem = menuCommand("Settings...", "app.settings", "CmdOrCtrl+,");

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: "about", label: `About ${app.name}` },
        { type: "separator" },
        settingsItem,
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide", label: `Hide ${app.name}` },
        { role: "hideOthers", label: "Hide Others" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit", label: `Quit ${app.name}` },
      ],
    });
  }

  template.push(
    {
      label: "File",
      submenu: [
        {
          label: "New File...",
          accelerator: "CmdOrCtrl+N",
          click: () => sendToFocusedWindow(createFileChannel),
        },
        {
          label: "New Folder...",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => sendToFocusedWindow(createFolderChannel),
        },
        menuCommand("New Project...", "file.newProject"),
        menuCommand("New Research Space...", "file.newResearchSpace"),
        { type: "separator" },
        {
          label: "Open Folder or Research Space...",
          accelerator: "CmdOrCtrl+O",
          click: () => sendToFocusedWindow(openProjectChannel),
        },
        { type: "separator" },
        menuCommand("Add Folder to Research Space...", "file.addFolderToResearchSpace"),
        menuCommand("Save as Research Space...", "file.saveResearchSpaceAs"),
        { type: "separator" },
        menuCommand("Save", "file.save", "CmdOrCtrl+S"),
        menuCommand("Save All", "file.saveAll"),
        menuCommand("Revert Files from Disk", "file.reloadFromDisk"),
        { type: "separator" },
        {
          label: "Import",
          submenu: [
            {
              label: "Word Document (DOCX)...",
              accelerator: "CmdOrCtrl+Alt+W",
              click: () => sendToFocusedWindow(importDocxChannel),
            },
            {
              label: "Markdown...",
              accelerator: "CmdOrCtrl+Alt+M",
              click: () => sendToFocusedWindow(importMarkdownChannel),
            },
            {
              label: "PDF...",
              accelerator: "CmdOrCtrl+Alt+P",
              click: () => sendToFocusedWindow(importPdfChannel),
            },
          ],
        },
        menuCommand("Export PDF...", "build.downloadPdf"),
        { type: "separator" },
        menuCommand("Share Project...", "file.share"),
        { type: "separator" },
        {
          label: "Close Tab",
          accelerator: "CmdOrCtrl+W",
          click: () => sendToFocusedWindow(closeTabChannel),
        },
        ...(isMac
          ? []
          : ([
              { type: "separator" },
              settingsItem,
              { type: "separator" },
              { role: "quit", label: "Exit" },
            ] satisfies MenuItemConstructorOptions[])),
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo", label: "Undo" },
        { role: "redo", label: "Redo" },
        { type: "separator" },
        { role: "cut", label: "Cut" },
        { role: "copy", label: "Copy" },
        { role: "paste", label: "Paste" },
        { type: "separator" },
        menuCommand("Find", "edit.find", "CmdOrCtrl+F"),
        editorMenuCommand(
          "Replace",
          "editor.action.startFindReplaceAction",
          isMac ? "Alt+Cmd+F" : "Ctrl+H",
        ),
        menuCommand("Find in Files", "edit.findInFiles", "CmdOrCtrl+Shift+F"),
        { type: "separator" },
        editorMenuCommand(
          "Toggle Line Comment",
          "editor.action.commentLine",
          "CmdOrCtrl+/",
        ),
        editorMenuCommand("Tidy Document", "latexdo.prettierLists", "Shift+Alt+F"),
        { type: "separator" },
        editorMenuCommand(
          "Search Bibliography...",
          "latexdo.citation.search",
          "CmdOrCtrl+Alt+C",
        ),
      ],
    },
    {
      label: "Selection",
      submenu: [
        { role: "selectAll", label: "Select All" },
        editorMenuCommand(
          "Expand Selection",
          "editor.action.smartSelect.expand",
          isMac ? "Ctrl+Shift+Cmd+Right" : "Shift+Alt+Right",
        ),
        editorMenuCommand(
          "Shrink Selection",
          "editor.action.smartSelect.shrink",
          isMac ? "Ctrl+Shift+Cmd+Left" : "Shift+Alt+Left",
        ),
        { type: "separator" },
        editorMenuCommand(
          "Copy Line Up",
          "editor.action.copyLinesUpAction",
          "Shift+Alt+Up",
        ),
        editorMenuCommand(
          "Copy Line Down",
          "editor.action.copyLinesDownAction",
          "Shift+Alt+Down",
        ),
        editorMenuCommand("Move Line Up", "editor.action.moveLinesUpAction", "Alt+Up"),
        editorMenuCommand(
          "Move Line Down",
          "editor.action.moveLinesDownAction",
          "Alt+Down",
        ),
        editorMenuCommand("Duplicate Selection", "editor.action.duplicateSelection"),
        editorMenuCommand(
          "Delete Line",
          "editor.action.deleteLines",
          "CmdOrCtrl+Shift+K",
        ),
        { type: "separator" },
        editorMenuCommand(
          "Add Cursor Above",
          "editor.action.insertCursorAbove",
          "CmdOrCtrl+Alt+Up",
        ),
        editorMenuCommand(
          "Add Cursor Below",
          "editor.action.insertCursorBelow",
          "CmdOrCtrl+Alt+Down",
        ),
        editorMenuCommand(
          "Add Cursors to Line Ends",
          "editor.action.insertCursorAtEndOfEachLineSelected",
          "Shift+Alt+I",
        ),
        editorMenuCommand(
          "Add Next Occurrence",
          "editor.action.addSelectionToNextFindMatch",
          "CmdOrCtrl+D",
        ),
        editorMenuCommand(
          "Select All Occurrences",
          "editor.action.selectHighlights",
          "CmdOrCtrl+Shift+L",
        ),
      ],
    },
    {
      label: "View",
      submenu: [
        menuCommand("Command Palette...", "view.commandPalette", "CmdOrCtrl+Shift+P"),
        { type: "separator" },
        menuCommand("Explorer", "view.explorer", "CmdOrCtrl+Shift+E"),
        menuCommand("Source Control", "view.sourceControl", "Ctrl+Shift+G"),
        menuCommand("Extensions", "view.extensions", "CmdOrCtrl+Shift+X"),
        menuCommand("AI Assistant", "view.ai", isMac ? "Ctrl+Cmd+I" : "Ctrl+Alt+I"),
        { type: "separator" },
        menuCommand("Problems", "view.problems", "CmdOrCtrl+Shift+M"),
        menuCommand("Output", "view.output", "CmdOrCtrl+Shift+U"),
        menuCommand("Terminal", "view.terminal", "Ctrl+`"),
        { type: "separator" },
        {
          label: "Appearance",
          submenu: [
            menuCommand("Toggle Sidebar", "view.toggleSidebar", "CmdOrCtrl+B"),
            menuCommand("Toggle Panel", "view.togglePanel", "CmdOrCtrl+J"),
            menuCommand("Toggle PDF Preview", "view.togglePreview", "CmdOrCtrl+Alt+V"),
            { type: "separator" },
            menuCommand("Focus Layout", "view.layout.focus"),
            menuCommand("Balanced Layout", "view.layout.balanced"),
            menuCommand("Full Layout", "view.layout.power"),
            { type: "separator" },
            menuCommand("Toggle Word Wrap", "view.toggleWordWrap"),
            menuCommand("Toggle Minimap", "view.toggleMinimap"),
            { type: "separator" },
            { role: "togglefullscreen", label: "Full Screen" },
          ],
        },
        {
          label: "Tools",
          submenu: [
            menuCommand("TikZ Drawing", "view.tool.tikzCanvas"),
            menuCommand("Figure to TikZ", "view.tool.tikzConverter"),
            menuCommand("Table Generator", "view.tool.tableGenerator"),
            menuCommand("Notation Manager", "view.tool.notationManager"),
            menuCommand("Citation Manager", "view.tool.citationManager"),
          ],
        },
        { type: "separator" },
        { role: "zoomIn", label: "Zoom In" },
        { role: "zoomOut", label: "Zoom Out" },
        { role: "resetZoom", label: "Reset Zoom" },
      ],
    },
    {
      label: "Go",
      submenu: [
        menuCommand("Go to File...", "go.file", "CmdOrCtrl+P"),
        editorMenuCommand("Go to Line...", "editor.action.gotoLine", "Ctrl+G"),
        editorMenuCommand(
          "Go to Section...",
          "editor.action.quickOutline",
          "CmdOrCtrl+Shift+O",
        ),
        editorMenuCommand(
          "Go to Bracket",
          "editor.action.jumpToBracket",
          "CmdOrCtrl+Shift+\\",
        ),
        { type: "separator" },
        menuCommand("Next Tab", "go.nextTab", "Ctrl+Tab"),
        menuCommand("Previous Tab", "go.previousTab", "Ctrl+Shift+Tab"),
        { type: "separator" },
        editorMenuCommand("Next Problem", "editor.action.marker.nextInFiles", "F8"),
        editorMenuCommand(
          "Previous Problem",
          "editor.action.marker.prevInFiles",
          "Shift+F8",
        ),
        { type: "separator" },
        editorMenuCommand("Toggle Bookmark", "latexdo.toggleBookmark", "CmdOrCtrl+F2"),
        editorMenuCommand("Next Bookmark", "latexdo.nextBookmark", "Alt+F2"),
        editorMenuCommand(
          "Previous Bookmark",
          "latexdo.previousBookmark",
          "Alt+Shift+F2",
        ),
        { type: "separator" },
        menuCommand("Show Cursor in PDF", "go.syncPdf", "CmdOrCtrl+Alt+J"),
      ],
    },
    {
      label: "Build",
      submenu: [
        menuCommand("Compile", "build.compile", "CmdOrCtrl+Enter"),
        menuCommand("Stop Compiling", "build.stop"),
        { type: "separator" },
        menuCommand("Toggle PDF Preview", "view.togglePreview"),
        menuCommand("Export PDF...", "build.downloadPdf"),
      ],
    },
    {
      label: "Insert",
      submenu: [
        editorMenuCommand("Bold", "latexdo.bold", "CmdOrCtrl+B"),
        editorMenuCommand("Italic", "latexdo.italic", "CmdOrCtrl+I"),
        menuCommand("Underline", "insert.underline"),
        menuCommand("Inline Math", "insert.math"),
        { type: "separator" },
        menuCommand("Section", "insert.section"),
        menuCommand("Subsection", "insert.subsection"),
        { type: "separator" },
        menuCommand("Equation", "insert.equation"),
        menuCommand("Bulleted List", "insert.itemize"),
        menuCommand("Numbered List", "insert.enumerate"),
        { type: "separator" },
        menuCommand("Citation", "insert.cite"),
        menuCommand("Cross-Reference", "insert.ref"),
        menuCommand("Link", "insert.href"),
        { type: "separator" },
        menuCommand("Format Table", "insert.formatTable"),
      ],
    },
    {
      label: "Tools",
      submenu: [
        {
          label: "Spell Checker...",
          accelerator: "CmdOrCtrl+Alt+S",
          click: () => showSpellCheckerMenu(),
        },
        menuCommand("Check Writing Now", "tools.proofread"),
        { type: "separator" },
        menuCommand("Review Paper with AI", "tools.reviewPaper", "CmdOrCtrl+Alt+R"),
        menuCommand("Review a PDF in Reader Mode...", "tools.reviewPdf"),
        { type: "separator" },
        editorMenuCommand(
          "Reformulate with AI",
          "latexdo.ai.reformulateSelection",
          "CmdOrCtrl+Shift+R",
        ),
        editorMenuCommand(
          "Ask AI about Selection",
          "latexdo.ai.askAboutSelection",
          "CmdOrCtrl+Shift+A",
        ),
        menuCommand("AI Settings...", "tools.aiSettings"),
        { type: "separator" },
        editorMenuCommand(
          "Toggle Git Blame",
          "latexdo.toggleFileBlame",
          "CmdOrCtrl+Alt+B",
        ),
        { type: "separator" },
        menuCommand("Share Project...", "file.share"),
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize", label: "Minimize" },
        { role: "zoom" },
        ...(isMac
          ? ([
              { type: "separator" },
              { role: "front" },
            ] satisfies MenuItemConstructorOptions[])
          : ([
              {
                label: "Close Window",
                accelerator: "Alt+F4",
                click: () => {
                  BrowserWindow.getFocusedWindow()?.close();
                },
              },
            ] satisfies MenuItemConstructorOptions[])),
      ],
    },
    {
      label: "Help",
      submenu: [
        menuCommand("Welcome", "help.welcome"),
        menuCommand("Keyboard Shortcuts", "help.shortcuts", "CmdOrCtrl+Alt+K"),
        { type: "separator" },
        {
          label: "What's New",
          click: () => sendToFocusedWindow("app:open-whats-new"),
        },
        {
          label: "Check for Updates",
          click: () => {
            void shell.openExternal(downloadsPageUrl);
          },
        },
        { type: "separator" },
        {
          label: "Report an Issue",
          click: () => {
            void shell.openExternal(
              "https://github.com/latexdo/latexdo-desktop/issues/new",
            );
          },
        },
        {
          label: "Support LatexDo ♥",
          click: () => {
            void shell.openExternal("https://www.latexdo.org/donations/");
          },
        },
        {
          label: `${productName} Downloads`,
          click: () => {
            void shell.openExternal(downloadsPageUrl);
          },
        },
        // Extensions are installed inside the app, not on a website.
        menuCommand("Browse Extensions", "view.extensions"),
        { type: "separator" },
        {
          label: "Developer",
          submenu: [
            { role: "reload", label: "Reload Window" },
            { role: "forceReload", label: "Force Reload Window" },
            { role: "toggleDevTools", label: "Toggle Developer Tools" },
          ],
        },
      ],
    },
  );

  applicationMenuTemplate = template;
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function payloadString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeDownloadsUrl(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxSettingsStringLength
  ) {
    return downloadsPageUrl;
  }

  try {
    const url = new URL(value.trim());
    const isDownloadsHost =
      url.hostname === "latexdo.org" || url.hostname === "www.latexdo.org";
    if (
      url.protocol === "https:" &&
      isDownloadsHost &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith("/downloads/")
    ) {
      return url.href;
    }
  } catch {
    return downloadsPageUrl;
  }

  return downloadsPageUrl;
}

function safeExternalUrl(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxSettingsStringLength
  ) {
    return null;
  }

  try {
    const url = new URL(value.trim());
    if (
      url.protocol === "https:" &&
      externalUrlHosts.has(url.hostname) &&
      !url.username &&
      !url.password
    ) {
      return url.href;
    }
  } catch {
    return null;
  }

  return null;
}

function safeScholarlyMetadataUrl(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxSettingsStringLength
  ) {
    return null;
  }

  try {
    const url = new URL(value.trim());
    const allowedHost =
      url.hostname === "api.openalex.org" || url.hostname === "api.crossref.org";
    if (
      url.protocol === "https:" &&
      allowedHost &&
      !url.username &&
      !url.password &&
      url.pathname === "/works" &&
      url.search.length <= 2048
    ) {
      return url.href;
    }
  } catch {
    return null;
  }

  return null;
}

async function fetchScholarlyMetadataJson(
  rawUrl: unknown,
): Promise<
  | { ok: true; json: unknown }
  | { ok: false; status?: number; retryAfterMs?: number; error: string }
> {
  const url = safeScholarlyMetadataUrl(rawUrl);
  if (!url) {
    return { ok: false, error: "Unsupported scholarly metadata URL." };
  }

  const maxResponseBytes = 2 * 1024 * 1024;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, {
      redirect: "error",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": `${productName}/${app.getVersion()} (https://latexdo.org)`,
      },
    });
    if (!response.ok) {
      const retryAfter = Number(response.headers.get("retry-after") ?? 0);
      return {
        ok: false,
        status: response.status,
        retryAfterMs:
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 15 * 60 * 1000)
            : undefined,
        error: `HTTP ${response.status} from ${new URL(url).hostname}`,
      };
    }

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > maxResponseBytes) {
      return { ok: false, error: "Scholarly metadata response is too large." };
    }

    const text = await response.text();
    if (text.length > maxResponseBytes) {
      return { ok: false, error: "Scholarly metadata response is too large." };
    }
    return { ok: true, json: JSON.parse(text) as unknown };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Scholarly metadata failed.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function safeUpdateDownloadUrl(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxSettingsStringLength
  ) {
    return null;
  }

  try {
    const url = new URL(value.trim());
    const isReleaseAsset =
      url.hostname === "github.com" &&
      url.pathname.startsWith("/latexdo/latexdo-desktop/releases/download/");
    const isWebsiteAsset =
      ["latexdo.org", "www.latexdo.org"].includes(url.hostname) &&
      url.pathname.startsWith("/downloads/");
    if (url.protocol === "https:" && (isReleaseAsset || isWebsiteAsset)) {
      return url.href;
    }
  } catch {
    return null;
  }

  return null;
}

function isSafeUpdateResponseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      safeUpdateDownloadUrl(url.href) !== null ||
      (url.protocol === "https:" && updateRedirectHosts.has(url.hostname))
    );
  } catch {
    return false;
  }
}

function safeUpdateFilename(value: unknown): string | null {
  const filename = payloadString(value);
  if (
    !filename ||
    filename.length > 180 ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename
      .split("")
      .some(
        (character) => character.charCodeAt(0) < 32 || '<>:"|?*'.includes(character),
      ) ||
    filename.startsWith(".")
  ) {
    return null;
  }

  return filename;
}

function updateFileFromPayload(value: unknown): WebsiteUpdateFile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = payloadString(record.id);
  const label = payloadString(record.label);
  const platform = payloadString(record.platform);
  const arch = payloadString(record.arch);
  const filename = safeUpdateFilename(record.filename);
  const url = safeUpdateDownloadUrl(record.url);
  const sha256 = payloadString(record.sha256);

  // Installers are executed after download, so a file without a valid
  // checksum must be rejected outright rather than installed unverified.
  if (
    !id ||
    !label ||
    !platform ||
    !arch ||
    !filename ||
    !url ||
    !sha256 ||
    !/^[a-f0-9]{64}$/i.test(sha256)
  ) {
    return null;
  }

  return {
    id,
    label,
    platform,
    arch,
    filename,
    url,
    sha256: sha256.toLowerCase(),
  };
}

function updateFilesFromPayload(value: unknown): WebsiteUpdateFile[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((file) => updateFileFromPayload(file))
    .filter((file): file is WebsiteUpdateFile => file !== null);
}

function currentUpdatePlatform(): string {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  return process.platform;
}

function currentUpdateArch(): string {
  if (process.arch === "x64" || process.arch === "arm64") {
    return process.arch;
  }

  return process.arch;
}

function selectUpdateFile(files: WebsiteUpdateFile[]): WebsiteUpdateFile | null {
  const platform = currentUpdatePlatform();
  const arch = currentUpdateArch();

  return (
    files.find((file) => file.platform === platform && file.arch === arch) ??
    files.find((file) => file.platform === platform) ??
    null
  );
}

type UpdateProgressSink = (progress: UpdateDownloadProgress) => void;

function updateProgressPayload(
  progress: Omit<UpdateDownloadProgress, "percent">,
): UpdateDownloadProgress {
  const percent =
    progress.totalBytes && progress.totalBytes > 0
      ? Math.min(100, (progress.transferredBytes / progress.totalBytes) * 100)
      : null;
  return {
    ...progress,
    percent,
  };
}

function updateResultFromWebsitePayload(
  payload: WebsiteUpdatePayload,
  currentVersion: string,
): UpdateCheckResult {
  if (payload.schemaVersion !== 2 || payload.product !== expectedUpdateProduct) {
    throw new Error(`Website update payload is not a ${productName} update feed.`);
  }

  const latestVersion = payloadString(payload.version)?.replace(/^v/i, "") ?? null;
  if (!latestVersion) {
    throw new Error("No website update version found.");
  }

  const releaseUrl = safeDownloadsUrl(
    payloadString(payload.releaseUrl) ?? payloadString(payload.downloadsPage),
  );
  return {
    currentVersion,
    latestVersion,
    ...updateBuildFields(payload),
    releaseUrl,
    updateAvailable: payloadIsNewerThanInstalled(
      payload,
      latestVersion,
      currentVersion,
    ),
    publishedAt: payloadString(payload.publishedAt),
    channel: payloadString(payload.channel),
    manifestUrl: payloadString(payload.manifestUrl) ?? downloadsManifestUrl,
    releaseNotesUrl: releaseNotesUrlFromPayload(payload, latestVersion),
    checkedAt: new Date().toISOString(),
  };
}

function payloadCommit(payload: WebsiteUpdatePayload): string | null {
  const commit = payloadString(payload.commit);
  return commit && /^[a-f0-9]{40}$/.test(commit) ? commit : null;
}

function updateBuildFields(
  payload: WebsiteUpdatePayload,
): Pick<UpdateCheckResult, "latestCommit" | "currentCommit"> {
  return {
    latestCommit: payloadCommit(payload),
    currentCommit: buildInfo?.commit ?? null,
  };
}

function payloadIsNewerThanInstalled(
  payload: WebsiteUpdatePayload,
  latestVersion: string,
  currentVersion: string,
): boolean {
  return isNewerRelease(
    {
      version: latestVersion,
      commit: payloadCommit(payload),
      timestamp: payloadString(payload.publishedAt),
    },
    {
      version: currentVersion,
      commit: buildInfo?.commit,
      timestamp: buildInfo?.builtAt,
    },
  );
}

function releaseNotesUrlFromPayload(
  payload: WebsiteUpdatePayload,
  version: string,
): string | null {
  const url = payloadString(payload.releaseNotesUrl) ?? null;
  if (!url || !isApprovedReleaseNotesFetchUrl(url)) return null;
  try {
    const pathname = new URL(url).pathname;
    const expectedSuffix = `/${encodeURIComponent(version)}.json`;
    if (!pathname.endsWith(expectedSuffix)) return null;
  } catch {
    return null;
  }
  return url;
}

function updateResultFromDownloadsManifestPayload(
  payload: WebsiteUpdatePayload,
  currentVersion: string,
): UpdateCheckResult {
  if (payload.schemaVersion !== 1 || payload.product !== expectedUpdateProduct) {
    throw new Error(`Website downloads manifest is not a ${productName} manifest.`);
  }

  const manifestVersion = payloadString(payload.version)?.replace(/^v/i, "") ?? null;
  if (!manifestVersion) throw new Error("No website installer version found.");
  const latestVersion = manifestVersion;
  const updateAvailable = payloadIsNewerThanInstalled(
    payload,
    latestVersion,
    currentVersion,
  );

  return {
    currentVersion,
    latestVersion,
    ...updateBuildFields(payload),
    releaseUrl: safeDownloadsUrl(payloadString(payload.downloadsPage)),
    updateAvailable,
    automaticInstallAvailable: false,
    publishedAt: payloadString(payload.publishedAt),
    manifestUrl: downloadsManifestUrl,
    releaseNotesUrl: null,
    checkedAt: new Date().toISOString(),
  };
}

const updateFeedFetchTimeoutMs = 15_000;
const maxUpdateFeedBytes = 1024 * 1024;
const updateFeedClockSkewMs = 10 * 60 * 1_000;
let updateFeedStateQueue: Promise<void> = Promise.resolve();

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("Update feed contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new Error("Update feed contains an unsupported value.");
}

function updateSignatureFromPayload(value: unknown): WebsiteUpdateSignature | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keyId = payloadString(record.keyId);
  const signature = payloadString(record.value);
  if (
    record.algorithm !== "ed25519" ||
    !keyId ||
    !/^[a-f0-9]{16}$/.test(keyId) ||
    !signature ||
    !/^[A-Za-z0-9+/]{86}==$/.test(signature)
  ) {
    return null;
  }
  return { algorithm: "ed25519", keyId, value: signature };
}

async function verifyWebsiteUpdatePayload(
  payload: WebsiteUpdatePayload,
): Promise<void> {
  const signature = updateSignatureFromPayload(payload.signature);
  if (!signature) throw new Error("Website update feed has no valid signature.");

  const publicKeyPath = app.isPackaged
    ? path.join(process.resourcesPath, "update-public-key.pem")
    : path.join(currentDirectory, "..", "build", "update-public-key.pem");
  const publicKey = createPublicKey(await readFile(publicKeyPath, "utf8"));
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new Error("The embedded update verification key is not Ed25519.");
  }
  const keyId = createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex")
    .slice(0, 16);
  if (keyId !== signature.keyId) {
    throw new Error("Website update feed was signed by an unknown key.");
  }

  const unsignedPayload = {
    ...(payload as unknown as Record<string, unknown>),
  };
  delete unsignedPayload.signature;
  const verified = verifySignature(
    null,
    Buffer.from(canonicalJson(unsignedPayload)),
    publicKey,
    Buffer.from(signature.value, "base64"),
  );
  if (!verified) throw new Error("Website update feed signature verification failed.");
}

async function readStoredUpdateFeedState(): Promise<StoredUpdateFeedState | null> {
  try {
    const state = JSON.parse(
      await readFile(userDataFilePath(updateFeedStateFile), "utf8"),
    ) as StoredUpdateFeedState;
    if (
      state.schemaVersion !== updateFeedStateSchemaVersion ||
      typeof state.highestVersion !== "string" ||
      !/^\d+\.\d+\.\d+$/.test(state.highestVersion) ||
      typeof state.highestCommit !== "string" ||
      !/^[a-f0-9]{40}$/.test(state.highestCommit) ||
      typeof state.highestPublishedAt !== "string" ||
      !Number.isFinite(Date.parse(state.highestPublishedAt))
    ) {
      throw new Error("Stored update rollback state is invalid.");
    }
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function enforceUpdateFeedFreshness(
  payload: WebsiteUpdatePayload,
): Promise<void> {
  const operation = updateFeedStateQueue.then(async () => {
    const version = payloadString(payload.version);
    const release = payloadString(payload.release);
    const commit = payloadString(payload.commit);
    const publishedAtValue = payloadString(payload.publishedAt);
    const expiresAtValue = payloadString(payload.expiresAt);
    if (
      payload.channel !== "stable" ||
      !version ||
      !/^\d+\.\d+\.\d+$/.test(version) ||
      !release ||
      !isReleaseSlugForVersion(release, version) ||
      !commit ||
      !/^[a-f0-9]{40}$/.test(commit) ||
      !publishedAtValue ||
      !expiresAtValue
    ) {
      throw new Error("Website update feed metadata is invalid.");
    }

    const publishedAt = Date.parse(publishedAtValue);
    const expiresAt = Date.parse(expiresAtValue);
    const now = Date.now();
    if (
      !Number.isFinite(publishedAt) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= publishedAt ||
      publishedAt > now + updateFeedClockSkewMs ||
      expiresAt <= now
    ) {
      throw new Error("Website update feed freshness window is invalid or expired.");
    }
    if (compareLatexDoVersions(version, app.getVersion()) < 0) {
      throw new Error(
        `Website update feed version ${version} is older than installed version ${app.getVersion()}.`,
      );
    }

    const previousState = await readStoredUpdateFeedState();
    const versionComparison = previousState
      ? compareLatexDoVersions(version, previousState.highestVersion as string)
      : 1;
    if (versionComparison < 0) {
      throw new Error(
        `Website update feed version ${version} is older than previously trusted version ${String(previousState?.highestVersion)}.`,
      );
    }
    if (previousState && versionComparison === 0) {
      const previousPublishedAt = Date.parse(
        previousState.highestPublishedAt as string,
      );
      if (publishedAt < previousPublishedAt) {
        throw new Error(
          "Website update feed publication date is older than the previously trusted feed.",
        );
      }
      if (commit !== previousState.highestCommit) {
        if (!isBuildReleaseSlugForVersion(release, version)) {
          throw new Error(
            "Website update feed changed the commit for an already trusted stable version.",
          );
        }
        if (publishedAt === previousPublishedAt) {
          throw new Error(
            "Website update feed changed the commit without a newer publication date.",
          );
        }
      }
    }
    if (
      previousState &&
      versionComparison > 0 &&
      publishedAt < Date.parse(previousState.highestPublishedAt as string)
    ) {
      throw new Error("Website update feed publication timeline moved backwards.");
    }

    const isAlreadyStored =
      previousState &&
      versionComparison === 0 &&
      publishedAt === Date.parse(previousState.highestPublishedAt as string);
    if (!isAlreadyStored) {
      await atomicWriteUtf8(
        userDataFilePath(updateFeedStateFile),
        JSON.stringify(
          {
            schemaVersion: updateFeedStateSchemaVersion,
            highestVersion: version,
            highestRelease: release,
            highestCommit: commit,
            highestPublishedAt: publishedAtValue,
            updatedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        { backup: true },
      );
    }
  });
  updateFeedStateQueue = operation.catch(() => undefined);
  return operation;
}

async function fetchWebsiteUpdateJson(
  url: string,
  headers: Record<string, string>,
): Promise<WebsiteUpdatePayload> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), updateFeedFetchTimeoutMs);

  try {
    const freshUrl = new URL(url);
    freshUrl.searchParams.set("_latexdo_check", randomUUID());
    const response = await fetch(freshUrl.toString(), {
      headers: {
        ...headers,
        "Cache-Control": "no-cache, no-store",
        Pragma: "no-cache",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`${url} returned ${response.status}`);
    }

    const body = await response.text();
    if (body.length > maxUpdateFeedBytes) {
      throw new Error(`${url} returned an update feed that is too large.`);
    }

    const payload = JSON.parse(body) as WebsiteUpdatePayload;
    await verifyWebsiteUpdatePayload(payload);
    await enforceUpdateFeedFreshness(payload);
    return payload;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${url} timed out while checking for updates.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWebsiteDownloadsManifestJson(
  url: string,
  headers: Record<string, string>,
): Promise<WebsiteUpdatePayload> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), updateFeedFetchTimeoutMs);

  try {
    const freshUrl = new URL(url);
    freshUrl.searchParams.set("_latexdo_check", randomUUID());
    const response = await fetch(freshUrl.toString(), {
      headers: {
        ...headers,
        "Cache-Control": "no-cache, no-store",
        Pragma: "no-cache",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`${url} returned ${response.status}`);
    }

    const body = await response.text();
    if (body.length > maxUpdateFeedBytes) {
      throw new Error(`${url} returned a downloads manifest that is too large.`);
    }

    return JSON.parse(body) as WebsiteUpdatePayload;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${url} timed out while checking for updates.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchExtensionStoreCatalogJson(): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), extensionCatalogFetchTimeoutMs);

  try {
    const response = await fetch(extensionStoreCatalogUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": `latexdo/${app.getVersion()}`,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Store catalog returned HTTP ${response.status}`);
    }

    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWebsiteUpdatePayload(
  url: string,
  currentVersion: string,
  headers: Record<string, string>,
): Promise<ResolvedWebsiteUpdate> {
  const payload = await fetchWebsiteUpdateJson(url, headers);
  const files = updateFilesFromPayload(payload.files);
  const result = updateResultFromWebsitePayload(payload, currentVersion);
  const updateFile = result.updateAvailable ? selectUpdateFile(files) : null;
  return {
    result: {
      ...result,
      automaticInstallAvailable: updateFile
        ? await canInstallUpdateFileAutomatically(updateFile)
        : false,
    },
    files,
    automaticInstallTrusted: true,
  };
}

async function fetchDownloadsManifestUpdatePayload(
  currentVersion: string,
  headers: Record<string, string>,
): Promise<ResolvedWebsiteUpdate> {
  const payload = await fetchWebsiteDownloadsManifestJson(
    downloadsManifestUrl,
    headers,
  );
  const files = updateFilesFromPayload(payload.files);
  const result = updateResultFromDownloadsManifestPayload(payload, currentVersion);
  // The downloads manifest is not signed. Whoever can change the website could
  // point it at any installer under latexdo.org/downloads/ and publish a matching
  // checksum, so it may tell the user that a build exists but must never be
  // installed automatically. Only the signed update feed is trusted for that.
  return {
    result: { ...result, automaticInstallAvailable: false },
    files,
    automaticInstallTrusted: false,
  };
}

async function resolveWebsiteUpdate(
  currentVersion: string,
  headers: Record<string, string>,
): Promise<ResolvedWebsiteUpdate> {
  const errors: string[] = [];

  // Fetch both on every check. A still-valid signed feed can lag behind the
  // website's installable packages during publication.
  const responses = await Promise.allSettled([
    fetchWebsiteUpdatePayload(updatesFeedUrl, currentVersion, headers),
    fetchDownloadsManifestUpdatePayload(currentVersion, headers),
  ]);
  let newest: ResolvedWebsiteUpdate | null = null;
  for (const response of responses) {
    if (response.status === "rejected") {
      errors.push(
        response.reason instanceof Error
          ? response.reason.message
          : String(response.reason),
      );
      continue;
    }
    const candidate = response.value;
    const comparison = newest
      ? compareLatexDoVersions(
          candidate.result.latestVersion!,
          newest.result.latestVersion!,
        )
      : 1;
    // Builds share a version, so the later publication breaks the tie.
    if (
      comparison > 0 ||
      (comparison === 0 &&
        Date.parse(candidate.result.publishedAt ?? "") >
          Date.parse(newest?.result.publishedAt ?? ""))
    ) {
      newest = candidate;
    }
  }
  if (newest) return newest;

  return {
    result: {
      currentVersion,
      latestVersion: null,
      releaseUrl: downloadsPageUrl,
      updateAvailable: false,
      automaticInstallAvailable: false,
      manifestUrl: downloadsManifestUrl,
      checkedAt: new Date().toISOString(),
      error: errors.join(" ") || "Update check failed",
    },
    files: [],
    automaticInstallTrusted: false,
  };
}

async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion();
  const requestHeaders = {
    Accept: "application/json",
    "User-Agent": `latexdo/${currentVersion}`,
  };
  return (await resolveWebsiteUpdate(currentVersion, requestHeaders)).result;
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function uniqueDownloadPath(filename: string): Promise<string> {
  const downloadsDirectory = app.getPath("downloads");
  const parsed = path.parse(filename);

  for (let index = 0; index < 100; index += 1) {
    const candidateName =
      index === 0 ? filename : `${parsed.name} (${index.toString()})${parsed.ext}`;
    const candidate = path.join(downloadsDirectory, candidateName);

    try {
      await access(candidate);
    } catch {
      return candidate;
    }
  }

  throw new Error("Could not choose a download path for the update installer.");
}

async function downloadUpdateInstaller(
  file: WebsiteUpdateFile,
  currentVersion: string,
  latestVersion: string | null,
  onProgress?: UpdateProgressSink,
): Promise<string> {
  const maxInstallerBytes = 1_500_000_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20 * 60 * 1000);
  let response: Response;
  try {
    response = await fetch(file.url, {
      headers: {
        "User-Agent": `latexdo/${currentVersion}`,
      },
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    if (controller.signal.aborted) {
      throw new Error("Update installer download timed out.");
    }
    throw error;
  }

  if (!response.ok) {
    clearTimeout(timeout);
    throw new Error(`Update installer download returned ${response.status}.`);
  }
  if (!response.body) {
    clearTimeout(timeout);
    throw new Error("Update installer download did not include a response body.");
  }
  if (!isSafeUpdateResponseUrl(response.url)) {
    clearTimeout(timeout);
    throw new Error("Update installer redirected to an untrusted host.");
  }

  const contentLength = response.headers.get("content-length");
  const parsedContentLength = contentLength ? Number.parseInt(contentLength, 10) : NaN;
  const totalBytes =
    Number.isFinite(parsedContentLength) && parsedContentLength > 0
      ? parsedContentLength
      : null;
  if (totalBytes !== null && totalBytes > maxInstallerBytes) {
    clearTimeout(timeout);
    throw new Error("Update installer exceeds the maximum download size.");
  }
  let transferredBytes = 0;
  let lastProgressSentAt = 0;
  const emitDownloadProgress = (force = false) => {
    if (!onProgress) return;
    const now = Date.now();
    if (!force && now - lastProgressSentAt < 120) return;
    lastProgressSentAt = now;
    onProgress(
      updateProgressPayload({
        status: "downloading",
        currentVersion,
        latestVersion,
        fileName: file.filename,
        fileLabel: file.label,
        transferredBytes,
        totalBytes,
        message: `Downloading ${file.label}`,
      }),
    );
  };

  const temporaryPath = path.join(
    app.getPath("temp"),
    `latexdo-update-${randomUUID()}-${file.filename}.download`,
  );

  try {
    emitDownloadProgress(true);
    await pipeline(
      Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>),
      new Transform({
        transform(chunk, _encoding, callback) {
          transferredBytes +=
            typeof chunk === "string"
              ? Buffer.byteLength(chunk)
              : (chunk as Uint8Array).byteLength;
          if (transferredBytes > maxInstallerBytes) {
            callback(new Error("Update installer exceeds the maximum download size."));
            return;
          }
          emitDownloadProgress();
          callback(null, chunk);
        },
      }),
      createWriteStream(temporaryPath, { flags: "wx" }),
    );
    emitDownloadProgress(true);

    onProgress?.(
      updateProgressPayload({
        status: "verifying",
        currentVersion,
        latestVersion,
        fileName: file.filename,
        fileLabel: file.label,
        transferredBytes,
        totalBytes: totalBytes ?? transferredBytes,
        message: "Verifying downloaded installer",
      }),
    );
    const actualSha256 = await sha256File(temporaryPath);
    if (actualSha256 !== file.sha256) {
      throw new Error("Downloaded update installer failed checksum verification.");
    }

    const installerPath = await uniqueDownloadPath(file.filename);
    await rename(temporaryPath, installerPath);
    return installerPath;
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/** Seconds the user gets to see the restart notice before LatexDo quits. */
const updateRestartCountdownSeconds = 5;

/**
 * Counts down before quitting so the user is told the update is about to
 * restart LatexDo (#265). Quitting goes through the normal close path, which
 * saves unsaved tabs; the updater helper waits for this process to exit.
 */
function scheduleApplicationQuit(onTick?: (secondsLeft: number) => void): void {
  let remaining = updateRestartCountdownSeconds;
  const tick = (): void => {
    if (remaining <= 0) {
      app.quit();
      return;
    }
    onTick?.(remaining);
    remaining -= 1;
    setTimeout(tick, 1000).unref();
  };
  tick();
}

function downloadedUpdateExtension(file: WebsiteUpdateFile): string {
  return path.extname(file.filename).toLowerCase();
}

function currentMacAppBundlePath(): string | null {
  if (process.platform !== "darwin" || !app.isPackaged) {
    return null;
  }

  const bundlePath = path.resolve(path.dirname(app.getPath("exe")), "../..");
  return path.basename(bundlePath).endsWith(".app") ? bundlePath : null;
}

async function canInstallUpdateFileAutomatically(
  file: WebsiteUpdateFile,
): Promise<boolean> {
  if (!app.isPackaged) {
    return false;
  }

  const extension = downloadedUpdateExtension(file);
  if (process.platform === "darwin") {
    const bundlePath = currentMacAppBundlePath();
    if (!bundlePath || extension !== ".dmg") {
      return false;
    }
    try {
      await access(path.dirname(bundlePath), fsConstants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  if (process.platform === "win32") {
    if (extension !== ".exe") {
      return false;
    }
    try {
      await access(app.getPath("exe"), fsConstants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  if (process.platform === "linux") {
    const currentAppImage = process.env.APPIMAGE;
    if (!currentAppImage || extension !== ".appimage") {
      return false;
    }
    try {
      await access(currentAppImage, fsConstants.R_OK);
      await access(path.dirname(currentAppImage), fsConstants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

async function writeUpdaterHelperFile(
  prefix: string,
  filename: string,
  script: string,
): Promise<string> {
  const helperDirectory = await mkdtemp(path.join(app.getPath("temp"), prefix));
  const helperPath = path.join(helperDirectory, filename);
  await writeFile(helperPath, script, { encoding: "utf8", mode: 0o700, flag: "wx" });
  await chmod(helperPath, 0o700);
  return helperPath;
}

async function writeUpdaterHelperScript(
  prefix: string,
  script: string,
): Promise<string> {
  return writeUpdaterHelperFile(prefix, "run.sh", script);
}

async function spawnDetachedUpdater(
  command: string,
  args: string[],
  options: SpawnOptions,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      detached: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function launchMacDmgUpdater(
  installerPath: string,
  expectedVersion: string,
  failurePath: string,
): Promise<void> {
  const appBundlePath = currentMacAppBundlePath();
  if (!appBundlePath) {
    throw new Error("Automatic macOS updates require a packaged app bundle.");
  }

  await access(path.dirname(appBundlePath), fsConstants.W_OK);
  const logsDirectory = app.getPath("logs");
  await mkdir(logsDirectory, { recursive: true });
  const helperPath = await writeUpdaterHelperScript(
    "latexdo-mac-updater-",
    macUpdateHelper,
  );

  await spawnDetachedUpdater("/bin/sh", [helperPath], {
    env: {
      ...process.env,
      LATEXDO_UPDATE_APP_PID: String(process.pid),
      LATEXDO_UPDATE_DMG: installerPath,
      LATEXDO_UPDATE_EXECUTABLE_NAME: path.basename(app.getPath("exe")),
      LATEXDO_UPDATE_LOG: path.join(logsDirectory, "updater.log"),
      LATEXDO_UPDATE_TARGET_APP: appBundlePath,
      LATEXDO_UPDATE_EXPECTED_VERSION: expectedVersion,
      LATEXDO_UPDATE_FAILURE_FILE: failurePath,
    },
  });
}

async function launchLinuxAppImageUpdater(
  installerPath: string,
  expectedVersion: string,
  failurePath: string,
): Promise<void> {
  const currentAppImage = process.env.APPIMAGE;
  if (!currentAppImage) {
    throw new Error("Automatic Linux updates require running from an AppImage.");
  }

  const logsDirectory = app.getPath("logs");
  await mkdir(logsDirectory, { recursive: true });
  await access(currentAppImage, fsConstants.R_OK);
  await access(path.dirname(currentAppImage), fsConstants.W_OK);
  await chmod(installerPath, 0o755);
  const helperPath = await writeUpdaterHelperScript(
    "latexdo-linux-updater-",
    linuxUpdateHelper,
  );

  await spawnDetachedUpdater("/bin/sh", [helperPath], {
    env: {
      ...process.env,
      LATEXDO_UPDATE_APP_PID: String(process.pid),
      LATEXDO_UPDATE_APPIMAGE: installerPath,
      LATEXDO_UPDATE_LOG: path.join(logsDirectory, "updater.log"),
      LATEXDO_UPDATE_TARGET_APPIMAGE: currentAppImage,
      LATEXDO_UPDATE_EXPECTED_VERSION: expectedVersion,
      LATEXDO_UPDATE_FAILURE_FILE: failurePath,
    },
  });
}

async function launchWindowsNsisUpdater(
  installerPath: string,
  expectedVersion: string,
  failurePath: string,
): Promise<void> {
  if (process.platform !== "win32" || !app.isPackaged) {
    throw new Error("Automatic Windows updates require a packaged app.");
  }

  const targetExePath = app.getPath("exe");
  await access(targetExePath, fsConstants.R_OK);
  const logsDirectory = app.getPath("logs");
  await mkdir(logsDirectory, { recursive: true });
  const helperPath = await writeUpdaterHelperFile(
    "latexdo-windows-updater-",
    "run.ps1",
    windowsUpdateHelper,
  );

  await spawnDetachedUpdater(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helperPath],
    {
      windowsHide: true,
      env: {
        ...process.env,
        LATEXDO_UPDATE_APP_PID: String(process.pid),
        LATEXDO_UPDATE_INSTALLER: installerPath,
        LATEXDO_UPDATE_LOG: path.join(logsDirectory, "updater.log"),
        LATEXDO_UPDATE_TARGET_EXE: targetExePath,
        LATEXDO_UPDATE_EXPECTED_VERSION: expectedVersion,
        LATEXDO_UPDATE_FAILURE_FILE: failurePath,
      },
    },
  );
}

async function launchDownloadedUpdateInstaller(
  file: WebsiteUpdateFile,
  installerPath: string,
  expectedVersion: string,
  failurePath: string,
  onRestartCountdown?: (secondsLeft: number) => void,
): Promise<void> {
  if (!(await canInstallUpdateFileAutomatically(file))) {
    throw new Error("This update package cannot be installed automatically.");
  }

  if (process.platform === "darwin") {
    await launchMacDmgUpdater(installerPath, expectedVersion, failurePath);
    scheduleApplicationQuit(onRestartCountdown);
    return;
  }

  if (process.platform === "linux") {
    await launchLinuxAppImageUpdater(installerPath, expectedVersion, failurePath);
    scheduleApplicationQuit(onRestartCountdown);
    return;
  }

  if (process.platform === "win32") {
    await launchWindowsNsisUpdater(installerPath, expectedVersion, failurePath);
    scheduleApplicationQuit(onRestartCountdown);
    return;
  }

  throw new Error("Automatic updates are not supported on this platform.");
}

let updateInstallationInProgress = false;

function installedApplicationPath(): string {
  return (
    currentMacAppBundlePath() ??
    (process.platform === "linux" ? process.env.APPIMAGE : undefined) ??
    app.getPath("exe")
  );
}

async function updateNow(
  onProgress?: UpdateProgressSink,
): Promise<UpdateInstallResult> {
  const currentVersion = app.getVersion();
  const requestHeaders = {
    Accept: "application/json",
    "User-Agent": `latexdo/${currentVersion}`,
  };

  onProgress?.(
    updateProgressPayload({
      status: "checking",
      currentVersion,
      latestVersion: null,
      fileName: null,
      fileLabel: null,
      transferredBytes: 0,
      totalBytes: null,
      message: "Checking for the latest build",
    }),
  );

  let result: UpdateCheckResult = {
    currentVersion,
    latestVersion: null,
    releaseUrl: downloadsPageUrl,
    updateAvailable: false,
    automaticInstallAvailable: false,
    manifestUrl: downloadsManifestUrl,
    checkedAt: new Date().toISOString(),
  };

  if (updateInstallationInProgress) {
    return {
      ...result,
      installerPath: null,
      opened: false,
      error: "An update installation is already in progress.",
    };
  }
  updateInstallationInProgress = true;
  let attempt: PendingUpdateRecord | null = null;
  let handedOff = false;
  try {
    const resolved = await resolveWebsiteUpdate(currentVersion, requestHeaders);
    result = resolved.result;

    if (result.error) {
      onProgress?.(
        updateProgressPayload({
          status: "error",
          currentVersion,
          latestVersion: result.latestVersion,
          fileName: null,
          fileLabel: null,
          transferredBytes: 0,
          totalBytes: null,
          message: result.error,
        }),
      );
      return {
        ...result,
        installerPath: null,
        opened: false,
        restartScheduled: false,
        manualDownload: false,
      };
    }

    if (!result.updateAvailable) {
      onProgress?.(
        updateProgressPayload({
          status: "done",
          currentVersion,
          latestVersion: result.latestVersion,
          fileName: null,
          fileLabel: null,
          transferredBytes: 0,
          totalBytes: null,
          message: `Current build ${currentVersion} is up to date.`,
        }),
      );
      return {
        ...result,
        installerPath: null,
        opened: false,
        restartScheduled: false,
        manualDownload: false,
      };
    }

    if (!resolved.automaticInstallTrusted) {
      const releaseUrl = safeDownloadsUrl(result.releaseUrl);
      onProgress?.(
        updateProgressPayload({
          status: "opening",
          currentVersion,
          latestVersion: result.latestVersion,
          fileName: null,
          fileLabel: null,
          transferredBytes: 1,
          totalBytes: 1,
          message: "Opening downloads page",
        }),
      );
      await shell.openExternal(releaseUrl);
      return {
        ...result,
        automaticInstallAvailable: false,
        releaseUrl,
        installerPath: null,
        opened: true,
        restartScheduled: false,
        manualDownload: true,
      };
    }

    const updateFile = selectUpdateFile(resolved.files);
    if (!updateFile) {
      const releaseUrl = safeDownloadsUrl(result.releaseUrl);
      onProgress?.(
        updateProgressPayload({
          status: "opening",
          currentVersion,
          latestVersion: result.latestVersion,
          fileName: null,
          fileLabel: null,
          transferredBytes: 1,
          totalBytes: 1,
          message: "Opening downloads page",
        }),
      );
      await shell.openExternal(releaseUrl);
      return {
        ...result,
        automaticInstallAvailable: false,
        releaseUrl,
        installerPath: null,
        opened: true,
        restartScheduled: false,
        manualDownload: true,
      };
    }

    if (!(await canInstallUpdateFileAutomatically(updateFile))) {
      const releaseUrl = safeDownloadsUrl(result.releaseUrl);
      onProgress?.(
        updateProgressPayload({
          status: "opening",
          currentVersion,
          latestVersion: result.latestVersion,
          fileName: null,
          fileLabel: null,
          transferredBytes: 1,
          totalBytes: 1,
          message: "Opening downloads page",
        }),
      );
      await shell.openExternal(releaseUrl);
      return {
        ...result,
        automaticInstallAvailable: false,
        releaseUrl,
        installerPath: null,
        opened: true,
        restartScheduled: false,
        manualDownload: true,
      };
    }

    if (!result.latestVersion) {
      throw new Error("Update metadata did not provide an expected version.");
    }

    const previousRecord = await loadPendingUpdate(app.getPath("userData"));
    if (
      pendingUpdateAttemptLimitReached(
        previousRecord,
        result.latestVersion,
        result.latestCommit,
      )
    ) {
      const releaseUrl = safeDownloadsUrl(result.releaseUrl);
      onProgress?.(
        updateProgressPayload({
          status: "opening",
          currentVersion,
          latestVersion: result.latestVersion,
          fileName: null,
          fileLabel: null,
          transferredBytes: 1,
          totalBytes: 1,
          message: "The automatic update could not be verified. Opening downloads page",
        }),
      );
      await shell.openExternal(releaseUrl);
      return {
        ...result,
        automaticInstallAvailable: false,
        releaseUrl,
        installerPath: null,
        opened: true,
        restartScheduled: false,
        manualDownload: true,
        phase: "failed",
        error:
          "Update failed: automatic installation could not be verified after three attempts. The downloads page has been opened for manual installation.",
      };
    }

    const installerPath = await downloadUpdateInstaller(
      updateFile,
      currentVersion,
      result.latestVersion,
      onProgress,
    );
    attempt = await beginPendingUpdate(app.getPath("userData"), {
      fromVersion: currentVersion,
      expectedVersion: result.latestVersion,
      expectedCommit: result.latestCommit ?? null,
      installerSha256: updateFile.sha256,
      installedPath: installedApplicationPath(),
    });
    onProgress?.(
      updateProgressPayload({
        status: "installing",
        currentVersion,
        latestVersion: result.latestVersion,
        fileName: updateFile.filename,
        fileLabel: updateFile.label,
        transferredBytes: 1,
        totalBytes: 1,
        message: "Installing update",
        phase: "installer-launched",
      }),
    );
    const latestVersion = result.latestVersion;
    await launchDownloadedUpdateInstaller(
      updateFile,
      installerPath,
      latestVersion,
      attempt.failurePath!,
      (secondsLeft) =>
        onProgress?.(
          updateProgressPayload({
            status: "installing",
            currentVersion,
            latestVersion,
            fileName: updateFile.filename,
            fileLabel: updateFile.label,
            transferredBytes: 1,
            totalBytes: 1,
            message: `Save your work. LatexDo restarts to install ${latestVersion} in ${secondsLeft}…`,
            phase: "installer-launched",
            restartInSeconds: secondsLeft,
          }),
        ),
    );
    handedOff = true;

    return {
      ...result,
      automaticInstallAvailable: true,
      installerPath,
      opened: true,
      restartScheduled: false,
      quitScheduled: true,
      manualDownload: false,
      phase: "installer-launched",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (attempt) {
      await markPendingUpdateFailed(app.getPath("userData"), attempt, message);
    }
    onProgress?.(
      updateProgressPayload({
        status: "error",
        currentVersion,
        latestVersion: result.latestVersion,
        fileName: null,
        fileLabel: null,
        transferredBytes: 0,
        totalBytes: null,
        message,
      }),
    );
    return {
      ...result,
      phase: "failed",
      error: message,
      installerPath: null,
      opened: false,
      restartScheduled: false,
      manualDownload: false,
    };
  } finally {
    if (!handedOff) updateInstallationInProgress = false;
  }
}

function currentReleaseNotesBaseUrl(): string {
  try {
    const origin = new URL(downloadsPageUrl).origin;
    return `${origin}/updates/release-notes`;
  } catch {
    return "https://latexdo.org/updates/release-notes";
  }
}

function currentReleaseNotesPublicKeyPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "update-public-key.pem")
    : path.join(currentDirectory, "..", "build", "update-public-key.pem");
}

function releaseNotesResolverOptionsForCurrentApp() {
  return {
    dataDirectory: app.getPath("userData"),
    publicKeyPemPath: currentReleaseNotesPublicKeyPath(),
    baseUrl: currentReleaseNotesBaseUrl(),
  };
}

async function buildWhatsNewResult(): Promise<WhatsNewResult> {
  const runningVersion = app.getVersion();
  const state = await loadUpdateExperienceState(app.getPath("userData"));
  const shouldPresent = shouldShowWhatsNew(runningVersion, state, buildInfo?.commit);
  const confirmed = state.lastConfirmedUpdate;
  const fromVersion =
    confirmed && versionsEquivalent(confirmed.toVersion, runningVersion)
      ? confirmed.fromVersion
      : null;
  const range = await resolveReleaseNotesRange(
    releaseNotesResolverOptionsForCurrentApp(),
    fromVersion ?? runningVersion,
    runningVersion,
  );
  return {
    fromVersion,
    toVersion: runningVersion,
    releases: range.documents,
    shouldPresent,
    notesAvailable: range.available,
    buildChanges:
      confirmed && versionsEquivalent(confirmed.toVersion, runningVersion)
        ? changesBetweenBuilds(buildInfo?.changes ?? [], confirmed.fromCommit)
        : [],
  };
}

async function openReleaseNotesPageForCurrentVersion(): Promise<{ opened: boolean }> {
  const runningVersion = app.getVersion();
  const document = await resolveReleaseNotes(
    releaseNotesResolverOptionsForCurrentApp(),
    runningVersion,
    null,
  );
  const url =
    document && isApprovedReleaseNotesDocumentUrl(document.releaseUrl)
      ? document.releaseUrl
      : downloadsPageUrl;
  await shell.openExternal(url);
  return { opened: true };
}

async function availableImportRelativePath(
  channel: string,
  projectPath: string,
  destinationDirectory: string,
  sourceName: string,
): Promise<string> {
  const parsed = path.posix.parse(sourceName.replaceAll("\\", "/"));

  for (let index = 0; index < 100; index += 1) {
    const candidateName =
      index === 0 ? sourceName : `${parsed.name} ${index + 1}${parsed.ext}`;
    const candidateRelativePath = destinationDirectory
      ? path.posix.join(destinationDirectory, candidateName)
      : candidateName;
    const validatedRelativePath = parseRelativePath(channel, candidateRelativePath);
    const candidatePath = await resolveProjectPath(projectPath, validatedRelativePath);

    try {
      await stat(candidatePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return validatedRelativePath;
      }
      throw error;
    }
  }

  throw new Error(`Could not choose an available path for "${sourceName}".`);
}

/** A file dropped or chosen to add to a shared project, ready to upload. */
interface ExternalShareFile {
  sourcePath: string;
  relativePath: string;
  content?: string;
  base64?: string;
}

const maxExternalShareFiles = 2000;
const maxExternalShareTotalBytes = 200 * 1024 * 1024;

/**
 * Reads dropped or chosen files and folders for a shared project (which has
 * no folder on this computer). Folders keep their structure; links are
 * skipped. Text comes back as text so it can be edited live.
 */
async function readExternalFilesForShare(
  sourcePaths: string[],
): Promise<ExternalShareFile[]> {
  const files: ExternalShareFile[] = [];
  let totalBytes = 0;
  const visit = async (absolutePath: string, relativePath: string): Promise<void> => {
    const entry = await lstat(absolutePath).catch(() => null);
    if (!entry || entry.isSymbolicLink()) return;
    if (entry.isDirectory()) {
      for (const name of (await readdir(absolutePath)).sort()) {
        if (name === ".git" || name === "node_modules" || name === ".DS_Store")
          continue;
        await visit(path.join(absolutePath, name), `${relativePath}/${name}`);
      }
      return;
    }
    if (!entry.isFile()) return;
    if (files.length >= maxExternalShareFiles) {
      throw new Error(`Shared projects are limited to ${maxExternalShareFiles} files.`);
    }
    if (entry.size > maxCloudUploadFileBytes) {
      throw new Error(
        `${path.basename(absolutePath)} is larger than 25 MB, the most sharing accepts for one file.`,
      );
    }
    totalBytes += entry.size;
    if (totalBytes > maxExternalShareTotalBytes) {
      throw new Error("Shared projects are limited to 200 MB.");
    }
    const bytes = await readFile(absolutePath);
    let text: string | null = null;
    if (!bytes.includes(0)) {
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        text = null;
      }
    }
    files.push(
      text !== null
        ? { sourcePath: absolutePath, relativePath, content: text }
        : { sourcePath: absolutePath, relativePath, base64: bytes.toString("base64") },
    );
  };
  for (const sourcePath of sourcePaths) {
    await visit(sourcePath, path.basename(sourcePath));
  }
  return files;
}

async function importExternalFilesIntoProject(
  channel: string,
  projectPath: string,
  destinationDirectory: string,
  sourcePaths: string[],
): Promise<ImportedProjectEntry[]> {
  const destinationRoot = destinationDirectory
    ? await resolveProjectPath(projectPath, destinationDirectory)
    : projectPath;
  const destinationStats = await stat(destinationRoot).catch(() => null);
  if (!destinationStats?.isDirectory()) {
    throw new Error("Drop files onto an existing project folder.");
  }

  const imported: ImportedProjectEntry[] = [];
  for (const sourcePath of sourcePaths) {
    const sourceStats = await stat(sourcePath).catch(() => null);
    if (!sourceStats || (!sourceStats.isFile() && !sourceStats.isDirectory())) {
      continue;
    }

    const sourceName = path.basename(sourcePath);
    const relativePath = await availableImportRelativePath(
      channel,
      projectPath,
      destinationDirectory,
      sourceName,
    );
    const targetPath = await resolveProjectPath(projectPath, relativePath);

    if (sourceStats.isDirectory()) {
      if (isInside(sourcePath, targetPath)) {
        throw new Error("Cannot import a folder into itself.");
      }
      await cp(sourcePath, targetPath, {
        recursive: true,
        errorOnExist: true,
        force: false,
        dereference: true,
      });
    } else {
      await copyFile(sourcePath, targetPath);
    }

    imported.push({
      sourcePath,
      relativePath: relativeProjectPath(projectPath, targetPath),
      type: sourceStats.isDirectory() ? "directory" : "file",
    });
  }

  return imported;
}

function gitRecoveryTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function gitRecoveryScopeLabel(relativePath?: string): string {
  const label = (relativePath ?? "all")
    .replace(/[\\/]+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return label || "changes";
}

async function confirmGitDiscard(
  targetWindow: BrowserWindow | null,
  message: string,
): Promise<boolean> {
  const options = {
    type: "warning" as const,
    buttons: ["Cancel", "Discard changes"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    message,
    detail: `${productName} will save recovery data in .latexdo/recovery before discarding changes.`,
  };
  const result = targetWindow
    ? await dialog.showMessageBox(targetWindow, options)
    : await dialog.showMessageBox(options);
  return result.response === 1;
}

async function createGitDiscardRecoveryPatch(
  projectPath: string,
  relativePath?: string,
): Promise<string | undefined> {
  const context = await getGitRepositoryContext(projectPath);
  const args = ["diff", "--binary", "--no-ext-diff"];
  if (relativePath) {
    args.push("--", repoPathForProjectPath(context, relativePath));
  } else {
    args.push("--", context.projectPrefix || ".");
  }

  const stdout = await runGitText(context.repositoryRoot, args, {
    maxBytes: 100 * 1024 * 1024,
  });
  if (!stdout.trim()) {
    return undefined;
  }

  const recoveryDirectory = await resolveProjectPath(projectPath, ".latexdo/recovery");
  const patchPath = path.join(
    recoveryDirectory,
    `discard-${gitRecoveryTimestamp()}-${gitRecoveryScopeLabel(
      relativePath,
    )}-${randomUUID().slice(0, 8)}.patch`,
  );
  await atomicWriteUtf8(patchPath, stdout, { exclusive: true });
  return relativeProjectPath(projectPath, patchPath);
}

async function createGitUntrackedRecoveryCopy(
  projectPath: string,
  relativePath: string,
  targetPath: string,
): Promise<string> {
  const recoveryDirectory = await resolveProjectPath(projectPath, ".latexdo/recovery");
  const extension = path.extname(relativePath);
  const recoveryPath = path.join(
    recoveryDirectory,
    `discard-${gitRecoveryTimestamp()}-${gitRecoveryScopeLabel(
      relativePath,
    )}-${randomUUID().slice(0, 8)}${extension || ".backup"}`,
  );
  await mkdir(recoveryDirectory, { recursive: true });
  await copyFile(targetPath, recoveryPath);
  return relativeProjectPath(projectPath, recoveryPath);
}

async function gitAdd(projectPath: string, relativePath: string): Promise<void> {
  const context = await getGitRepositoryContext(projectPath);
  await runGitText(context.repositoryRoot, [
    "add",
    "--",
    repoPathForProjectPath(context, relativePath),
  ]);
}

async function gitUnstage(projectPath: string, relativePath: string): Promise<void> {
  const context = await getGitRepositoryContext(projectPath);
  const repoPath = repoPathForProjectPath(context, relativePath);
  try {
    await runGitText(context.repositoryRoot, ["restore", "--staged", "--", repoPath]);
  } catch {
    await runGitText(context.repositoryRoot, ["reset", "HEAD", "--", repoPath]);
  }
}

async function gitCommit(projectPath: string, message: string): Promise<void> {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error("Enter a commit message.");
  }

  const context = await getGitRepositoryContext(projectPath);
  await runGitText(context.repositoryRoot, ["commit", "-m", trimmed]);
}

async function gitDiscard(
  projectPath: string,
  relativePath: string,
): Promise<GitDiscardResult> {
  const targetPath = await resolveProjectPath(projectPath, relativePath);
  const status = await readStructuredGitStatus(projectPath);
  const entry = status.entries.find((candidate) => candidate.path === relativePath);
  const recoveryPatch = entry?.untracked
    ? await createGitUntrackedRecoveryCopy(projectPath, relativePath, targetPath)
    : await createGitDiscardRecoveryPatch(projectPath, relativePath);
  if (entry?.untracked) {
    await unlink(targetPath);
    return { discarded: true, recoveryPatch };
  }
  const context = await getGitRepositoryContext(projectPath);
  const repoPath = repoPathForProjectPath(context, relativePath);
  try {
    await runGitText(context.repositoryRoot, ["restore", "--worktree", "--", repoPath]);
  } catch {
    await runGitText(context.repositoryRoot, ["checkout", "--", repoPath]);
  }
  return {
    discarded: true,
    recoveryPatch,
  };
}

async function gitStageAll(projectPath: string): Promise<void> {
  const context = await getGitRepositoryContext(projectPath);
  await runGitText(context.repositoryRoot, [
    "add",
    "--all",
    "--",
    context.projectPrefix || ".",
  ]);
}

async function gitUnstageAll(projectPath: string): Promise<void> {
  const context = await getGitRepositoryContext(projectPath);
  const scope = context.projectPrefix || ".";
  try {
    await runGitText(context.repositoryRoot, ["restore", "--staged", "--", scope]);
  } catch {
    await runGitText(context.repositoryRoot, ["reset", "HEAD", "--", scope]);
  }
}

async function gitDiscardAll(projectPath: string): Promise<GitDiscardResult> {
  const recoveryPatch = await createGitDiscardRecoveryPatch(projectPath);
  const context = await getGitRepositoryContext(projectPath);
  const scope = context.projectPrefix || ".";
  try {
    await runGitText(context.repositoryRoot, ["restore", "--worktree", "--", scope]);
  } catch {
    await runGitText(context.repositoryRoot, ["checkout", "--", scope]);
  }
  return {
    discarded: true,
    recoveryPatch,
  };
}

const rendererContentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

async function packagedRendererResponse(request: Request): Promise<Response> {
  // Node's URL parser treats custom schemes as opaque, so `url.origin` is the
  // literal string "null" here; compare protocol and host instead.
  const url = new URL(request.url);
  if (url.protocol !== "latexdo:" || url.host !== "app" || request.method !== "GET") {
    return new Response("Not found", { status: 404 });
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new Response("Invalid path", { status: 400 });
  }
  if (pathname.includes("\0")) {
    return new Response("Invalid path", { status: 400 });
  }

  const relativePath = pathname.replace(/^\/+/, "") || "index.html";
  const filePath = path.resolve(packagedRendererRoot, relativePath);
  const relativeToRoot = path.relative(packagedRendererRoot, filePath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    return new Response("Not found", { status: 404 });
  }

  const file = await stat(filePath).catch(() => null);
  if (!file?.isFile()) {
    return new Response("Not found", { status: 404 });
  }
  const extension = path.extname(filePath).toLowerCase();
  return new Response(await readFile(filePath), {
    headers: {
      "cache-control":
        extension === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
      "content-type": rendererContentTypes[extension] ?? "application/octet-stream",
      "x-content-type-options": "nosniff",
    },
  });
}

function recordMainDiagnosticSync(
  kind: DiagnosticKind,
  severity: "info" | "warning" | "error" | "fatal",
  error: unknown,
  context?: Record<string, unknown>,
): void {
  try {
    mainDiagnostics.recordSync(kind, severity, error, context);
  } catch (diagnosticError) {
    console.error("[latexdo] failed to write diagnostic", diagnosticError);
  }
}

async function recordMainDiagnostic(
  kind: DiagnosticKind,
  severity: "info" | "warning" | "error" | "fatal",
  error: unknown,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    await mainDiagnostics.record(kind, severity, error, context);
  } catch (diagnosticError) {
    console.error("[latexdo] failed to write diagnostic", diagnosticError);
  }
}

function diagnosticLogHint(): string {
  try {
    return `\n\nDiagnostic log:\n${mainDiagnostics.logPath()}`;
  } catch {
    return "";
  }
}

function rendererEntryUrl(): string {
  return isDevelopment
    ? process.env.VITE_DEV_SERVER_URL!
    : `${packagedRendererOrigin}/index.html`;
}

async function showRendererFailurePage(
  window: BrowserWindow,
  title: string,
  message: string,
  detail?: string,
): Promise<void> {
  if (window.isDestroyed()) {
    return;
  }

  try {
    await window.loadURL(
      rendererFailureDataUrl({
        productName,
        title,
        message,
        detail,
      }),
    );
  } catch (error) {
    recordMainDiagnosticSync("renderer-load-failure", "error", error, {
      stage: "fallback-renderer-page",
    });
  }
}

const rendererLoadRecoveryWindows = new WeakSet<BrowserWindow>();
let e2eAllowRendererCrashRecovery = false;
let e2eRendererCrashRecovery: Promise<void> | null = null;

async function handleRendererLoadFailure(
  window: BrowserWindow,
  error: unknown,
  context: Record<string, unknown>,
): Promise<void> {
  if (window.isDestroyed() || rendererLoadRecoveryWindows.has(window)) {
    return;
  }

  rendererLoadRecoveryWindows.add(window);
  await recordMainDiagnostic("renderer-load-failure", "fatal", error, context);
  console.error("[latexdo] renderer failed to load", serializeError(error));

  await showRendererFailurePage(
    window,
    "LatexDo could not load the editor",
    "The application files may be missing, damaged, or blocked by the operating system. Try reloading the editor, or reinstall LatexDo if this repeats.",
    serializeError(error).message,
  );

  if (startupAutomationTest) {
    app.exit(1);
    return;
  }

  const result = await dialog.showMessageBox(window, {
    type: "error",
    buttons: ["Retry", "Quit"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: `${productName} Startup Error`,
    message: "The editor could not be loaded.",
    detail:
      "LatexDo recorded a diagnostic entry for this failure." + diagnosticLogHint(),
  });

  rendererLoadRecoveryWindows.delete(window);
  if (result.response === 0) {
    await loadRendererWindow(window);
  } else {
    app.quit();
  }
}

async function loadRendererWindow(window: BrowserWindow): Promise<void> {
  const targetUrl = rendererEntryUrl();
  try {
    await window.loadURL(targetUrl);
  } catch (error) {
    await handleRendererLoadFailure(window, error, {
      stage: "loadURL",
      targetUrl,
    });
  }
}

async function recoverRendererProcess(
  window: BrowserWindow,
  details: RenderProcessGoneDetails,
): Promise<void> {
  if (window.isDestroyed()) {
    return;
  }

  if (startupE2eTest && e2eAllowRendererCrashRecovery) {
    e2eRendererCrashRecovery = loadRendererWindow(window);
    await e2eRendererCrashRecovery;
    return;
  }

  const message = rendererGoneMessage(details);
  await showRendererFailurePage(
    window,
    "LatexDo needs to recover the editor",
    message,
    `Reason: ${details.reason}; exit code: ${details.exitCode}`,
  );

  if (startupAutomationTest) {
    app.exit(1);
    return;
  }

  const result = await dialog.showMessageBox(window, {
    type: details.reason === "oom" ? "warning" : "error",
    buttons: ["Reload Editor", "Quit"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: `${productName} Renderer Recovery`,
    message,
    detail:
      `Reason: ${details.reason}; exit code: ${details.exitCode}.` +
      "\n\nLatexDo recorded a diagnostic entry for this failure." +
      diagnosticLogHint(),
  });

  if (result.response === 0) {
    await loadRendererWindow(window);
  } else {
    app.quit();
  }
}

function showFatalMainProcessDialog(title: string, error: unknown): void {
  if (startupAutomationTest) {
    return;
  }

  try {
    dialog.showErrorBox(
      title,
      `${serializeError(error).message}\n\nLatexDo recorded a diagnostic entry and will close.` +
        diagnosticLogHint(),
    );
  } catch {
    // The process may be too compromised to show UI. The diagnostic was already
    // written synchronously before this point.
  }
}

function installMainProcessFailureHandlers(): void {
  let handlingFatalException = false;

  process.on("uncaughtException", (error) => {
    recordMainDiagnosticSync("uncaught-exception", "fatal", error);
    console.error("[latexdo] uncaught main-process exception", error);

    if (handlingFatalException) {
      app.exit(1);
      return;
    }
    handlingFatalException = true;
    showFatalMainProcessDialog(`${productName} hit a fatal error`, error);
    app.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    recordMainDiagnosticSync("unhandled-rejection", "error", reason);
    console.error("[latexdo] unhandled main-process rejection", reason);
  });

  app.on("render-process-gone", (_event, webContents, details) => {
    if (appIsQuitting && details.reason === "clean-exit") {
      return;
    }

    const expectedE2eRecovery =
      startupE2eTest && e2eAllowRendererCrashRecovery && details.reason === "killed";
    recordMainDiagnosticSync(
      "renderer-process-gone",
      expectedE2eRecovery ? "info" : "fatal",
      details.reason,
      {
        expectedE2eRecovery,
        reason: details.reason,
        exitCode: details.exitCode,
        url: webContents.getURL(),
      },
    );
    if (expectedE2eRecovery) {
      console.log("[latexdo] renderer process gone during E2E recovery", details);
    } else {
      console.error("[latexdo] renderer process gone", details);
    }

    const window = BrowserWindow.fromWebContents(webContents);
    if (!window || window.isDestroyed()) {
      if (startupAutomationTest) {
        app.exit(1);
      }
      return;
    }

    void recoverRendererProcess(window, details);
  });

  app.on("child-process-gone", (_event, details) => {
    if (details.reason === "clean-exit") {
      return;
    }
    recordMainDiagnosticSync("child-process-gone", "warning", details.reason, {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      serviceName: details.serviceName,
      name: details.name,
    });
    console.warn("[latexdo] Electron child process gone", details);
  });
}

const unresponsiveWindows = new WeakSet<BrowserWindow>();

function isWindowUnresponsive(window: BrowserWindow): boolean {
  return !window.isDestroyed() && unresponsiveWindows.has(window);
}

function createWindow(): BrowserWindow {
  console.log("[latexdo] createWindow:start");
  nativeTheme.themeSource = "dark";
  const window = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    title: productName,
    icon: appIconPath,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#111318",
    webPreferences: {
      preload: path.join(currentDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  console.log("[latexdo] createWindow:created");
  trustIpcRenderer(window.webContents, rendererEntryUrl());

  window.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  // The renderer holds the close while it saves unsaved tabs, then closes the
  // window itself; finish a quit that was waiting on that (#229).
  window.on("closed", () => {
    if (appIsQuitting) app.quit();
  });
  // A hung renderer never answers beforeunload, so a close or quit would wait
  // forever and the stuck process would keep the single-instance lock: every
  // relaunch would just focus the frozen window. Force the close instead.
  let closeRequested = false;
  window.on("close", () => {
    closeRequested = true;
    if (isWindowUnresponsive(window)) {
      setImmediate(() => {
        if (!window.isDestroyed()) window.destroy();
      });
    }
  });
  window.on("unresponsive", () => {
    unresponsiveWindows.add(window);
    recordMainDiagnosticSync("renderer-unresponsive", "warning", "unresponsive", {
      closeRequested,
      appIsQuitting,
      url: window.webContents.getURL(),
    });
    console.warn("[latexdo] renderer unresponsive");
    if ((closeRequested || appIsQuitting) && !window.isDestroyed()) window.destroy();
  });
  window.on("responsive", () => {
    unresponsiveWindows.delete(window);
    closeRequested = false;
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  window.webContents.on(
    "did-fail-load",
    (
      _event,
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
      frameProcessId,
      frameRoutingId,
    ) => {
      if (!isMainFrame || errorCode === -3) {
        return;
      }

      void handleRendererLoadFailure(
        window,
        new Error(
          `Renderer failed to load ${validatedURL}: ${errorCode} ${errorDescription}`,
        ),
        {
          stage: "did-fail-load",
          errorCode,
          errorDescription,
          validatedURL,
          frameProcessId,
          frameRoutingId,
        },
      );
    },
  );

  window.webContents.once("did-finish-load", () => {
    console.log("[latexdo] createWindow:did-finish-load");
    installSpellCheckerContextMenu(window);
    void syncSpellCheckerSettings(window).catch((error) => {
      console.error("Failed to initialize spell checker", error);
    });
  });

  void loadRendererWindow(window);

  return window;
}

function waitForRendererLoad(window: BrowserWindow): Promise<void> {
  if (!window.webContents.isLoadingMainFrame()) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Renderer did not finish loading before the timeout."));
    }, startupSmokeTimeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      window.webContents.off("did-finish-load", handleFinish);
      window.webContents.off("did-fail-load", handleFailure);
    };

    const handleFinish = () => {
      cleanup();
      resolve();
    };

    const handleFailure = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      validatedURL: string,
    ) => {
      cleanup();
      reject(
        new Error(
          `Renderer failed to load ${validatedURL}: ${errorCode} ${errorDescription}`,
        ),
      );
    };

    window.webContents.once("did-finish-load", handleFinish);
    window.webContents.once("did-fail-load", handleFailure);
  });
}

async function runStartupSmokeTest(window: BrowserWindow): Promise<void> {
  await waitForRendererLoad(window);

  const result = (await window.webContents.executeJavaScript(`
    (() => {
      const root = document.getElementById("root");
      return {
        title: document.title,
        rootChildCount: root?.childElementCount ?? 0,
        hasProductText:
          document.body?.innerText?.includes(${JSON.stringify(productName)}) ?? false,
        origin: window.location.origin,
      };
    })()
  `)) as {
    title?: string;
    rootChildCount?: number;
    hasProductText?: boolean;
    origin?: string;
  };

  if (
    result.title !== productName ||
    !result.rootChildCount ||
    result.hasProductText !== true ||
    result.origin !== packagedRendererOrigin
  ) {
    throw new Error(`Renderer smoke test failed: ${JSON.stringify(result)}`);
  }

  console.log("[latexdo] packaged startup smoke test passed", result);
}

interface PackagedE2eStep {
  name: string;
  status: "passed" | "skipped";
  detail?: string;
}

interface PackagedE2eFixtures {
  root: string;
  project: OpenProject;
  gitProject: OpenProject | null;
  largeProject: OpenProject;
}

const e2eValidDocument = String.raw`\documentclass{article}
\begin{document}
Hello from packaged E2E.
\end{document}
`;

const e2eBrokenDocument = String.raw`\documentclass{article}
\begin{document}
\section{Broken
\end{document}
`;

const e2eSlowDocument = String.raw`\documentclass{article}
\begin{document}
\newcount\n
\n=0
\loop
\advance\n by 1
\ifnum\n<100000000
\repeat
Done
\end{document}
`;

function runE2eProcess(
  command: string,
  args: string[],
  options: SpawnOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: "ignore",
      windowsHide: true,
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} timed out.`));
    }, 8_000);
    timeout.unref?.();

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `${command} exited with ${code ?? `signal ${signal ?? "unknown"}`}.`,
          ),
        );
      }
    });
  });
}

async function createPackagedE2eProject(
  basePath: string,
  folderName: string,
): Promise<OpenProject> {
  const projectPath = path.join(basePath, folderName);
  await mkdir(projectPath, { recursive: true });
  await atomicWriteUtf8(path.join(projectPath, "main.tex"), e2eValidDocument);
  await trustWorkspace(projectPath);
  return registerProject(projectPath);
}

async function preparePackagedE2eGitProject(projectPath: string): Promise<boolean> {
  try {
    await runE2eProcess("git", ["--version"]);
    await runE2eProcess("git", ["init", "-q"], { cwd: projectPath });
    await runE2eProcess("git", ["config", "user.name", "LatexDo E2E"], {
      cwd: projectPath,
    });
    await runE2eProcess("git", ["config", "user.email", "e2e@latexdo.local"], {
      cwd: projectPath,
    });
    await runE2eProcess("git", ["add", "main.tex"], { cwd: projectPath });
    await runE2eProcess("git", ["commit", "-q", "-m", "Initial document"], {
      cwd: projectPath,
    });
    return true;
  } catch (error) {
    console.warn("[latexdo] packaged E2E git project skipped", error);
    return false;
  }
}

async function createPackagedE2eFixtures(): Promise<PackagedE2eFixtures> {
  const root = await mkdtemp(path.join(app.getPath("temp"), "latexdo-e2e-"));
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(userDataFilePath(spellCheckerSettingsFile), "{invalid json", "utf8");
  await writeFile(userDataFilePath(proofreadingSettingsFile), "{invalid json", "utf8");

  const project = await createPackagedE2eProject(root, "Project With Spaces");
  const gitProject = await createPackagedE2eProject(root, "Git Project");
  const gitReady = await preparePackagedE2eGitProject(gitProject.rootPath);
  const largeProject = await createPackagedE2eProject(root, "Large Project");

  for (let index = 0; index < 320; index += 1) {
    const group = `group-${Math.floor(index / 40)
      .toString()
      .padStart(2, "0")}`;
    const directory = path.join(largeProject.rootPath, group);
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, `file-${index.toString().padStart(3, "0")}.tex`),
      `% fixture ${index}\n`,
      "utf8",
    );
  }

  return {
    root,
    project,
    gitProject: gitReady ? gitProject : null,
    largeProject,
  };
}

async function runRendererPackagedE2eWorkflows(
  window: BrowserWindow,
  fixtures: PackagedE2eFixtures,
): Promise<PackagedE2eStep[]> {
  await waitForRendererLoad(window);

  return (await window.webContents.executeJavaScript(`
    (async () => {
      const params = ${JSON.stringify({
        projectId: fixtures.project.id,
        gitProjectId: fixtures.gitProject?.id ?? null,
        largeProjectId: fixtures.largeProject.id,
        productName,
        validDocument: e2eValidDocument,
        brokenDocument: e2eBrokenDocument,
        slowDocument: e2eSlowDocument,
      })};
      const steps = [];
      let latexmkMissing = false;
      const delay = (milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds));
      const assert = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      const byteLength = (value) => Number(value?.byteLength ?? value?.length ?? 0);
      const flatten = (entries) =>
        entries.flatMap((entry) => [entry, ...flatten(entry.children ?? [])]);
      const step = async (name, fn) => {
        const detail = await fn();
        steps.push({
          name,
          status: "passed",
          detail: detail === undefined ? undefined : String(detail),
        });
      };
      const skip = (name, detail) => {
        steps.push({ name, status: "skipped", detail: String(detail) });
      };

      await step("renderer-root-rendered", async () => {
        const root = document.getElementById("root");
        assert(document.title === params.productName, "unexpected document title");
        assert((root?.childElementCount ?? 0) > 0, "React root is empty");
        assert(window.location.origin === "latexdo://app", "unexpected origin");
        return window.location.origin;
      });

      await step("renderer-diagnostic-report", async () => {
        await window.latexdo.reportRendererIssue({
          kind: "renderer-error",
          error: { message: "packaged e2e diagnostic probe" },
          context: { source: "packaged-e2e" },
        });
        return "reported";
      });

      await step("list-project", async () => {
        const entries = await window.latexdo.listProject(params.projectId);
        assert(
          entries.some((entry) => entry.relativePath === "main.tex"),
          "main.tex missing from project tree",
        );
        return String(entries.length);
      });

      await step("edit-save-reopen-file", async () => {
        await window.latexdo.createFolder(params.projectId, "sections");
        const relativePath = await window.latexdo.createFile(
          params.projectId,
          "sections/intro.tex",
        );
        await window.latexdo.writeFile(
          params.projectId,
          relativePath,
          "\\\\section{Intro}\\nSaved from packaged E2E.\\n",
        );
        const saved = await window.latexdo.readFile(params.projectId, relativePath);
        assert(saved.includes("Saved from packaged E2E"), "saved file did not reopen");
        return relativePath;
      });

      await step("spaces-unicode-long-path", async () => {
        const relativePath =
          "sections/path with spaces and unicode \\u03c0 and long " +
          "x".repeat(72) +
          ".tex";
        await window.latexdo.createFile(params.projectId, relativePath);
        await window.latexdo.writeFile(params.projectId, relativePath, "ok\\n");
        const saved = await window.latexdo.readFile(params.projectId, relativePath);
        assert(saved === "ok\\n", "path stress file did not round-trip");
        return relativePath.length.toString();
      });

      await step("corrupt-settings-recovery", async () => {
        const spell = await window.latexdo.getSpellCheckerSettings();
        const proof = await window.latexdo.getProofreadingSettings();
        assert(Array.isArray(spell.languages), "spell settings did not recover");
        assert(typeof proof.enabled === "boolean", "proofreading settings did not recover");
        return "defaults loaded";
      });

      await step("git-non-repository", async () => {
        const status = await window.latexdo.getGitStatus(params.projectId);
        assert(status.isRepo === false, "non-git project reported as git repo");
        return status.error ?? "not a repository";
      });

      if (params.gitProjectId) {
        await step("git-repository", async () => {
          const status = await window.latexdo.getGitStatus(params.gitProjectId);
          assert(status.isRepo === true, "git project was not recognized");
          assert(typeof status.branch === "string", "git branch missing");
          return status.branch;
        });
      } else {
        skip("git-repository", "git executable unavailable");
      }

      await step("large-project-scan", async () => {
        const entries = await window.latexdo.listProject(params.largeProjectId, {
          maxDepth: 50,
          maxEntries: 5000,
        });
        const count = flatten(entries).length;
        assert(count >= 320, "large project scan missed fixture files");
        return String(count);
      });

      await step("compile-valid-or-no-tex", async () => {
        await window.latexdo.writeFile(params.projectId, "main.tex", params.validDocument);
        const result = await window.latexdo.compile({
          projectId: params.projectId,
          rootFile: "main.tex",
          engine: "pdflatex",
        });
        if (result.ok) {
          assert(result.pdfPath, "compile succeeded without a pdf path");
          const bytes = await window.latexdo.readPdf(params.projectId, result.pdfPath);
          assert(byteLength(bytes) > 100, "compiled PDF was empty");
          return "compiled";
        }
        if (/latexmk was not found/i.test(result.error ?? "")) {
          latexmkMissing = true;
          return "latexmk missing covered";
        }
        throw new Error(result.error ?? "valid compile failed");
      });

      await step("compile-broken-or-no-tex", async () => {
        if (latexmkMissing) return "latexmk missing covered";
        await window.latexdo.writeFile(params.projectId, "main.tex", params.brokenDocument);
        const result = await window.latexdo.compile({
          projectId: params.projectId,
          rootFile: "main.tex",
          engine: "pdflatex",
        });
        assert(result.ok === false, "broken LaTeX unexpectedly compiled");
        assert(
          Boolean(result.error) || (result.diagnostics?.length ?? 0) > 0,
          "broken compile returned no recoverable error",
        );
        await window.latexdo.writeFile(params.projectId, "main.tex", params.validDocument);
        return result.error ?? "diagnostic reported";
      });

      await step("compile-cancel-or-no-tex", async () => {
        if (latexmkMissing) return "latexmk missing covered";
        await window.latexdo.writeFile(params.projectId, "main.tex", params.slowDocument);
        const compile = window.latexdo.compile({
          projectId: params.projectId,
          rootFile: "main.tex",
          engine: "pdflatex",
        });
        await delay(100);
        const canceled = await window.latexdo.cancelCompile(params.projectId);
        const result = await compile;
        await window.latexdo.writeFile(params.projectId, "main.tex", params.validDocument);
        assert(
          canceled || result.ok || Boolean(result.error),
          "compile cancel returned no terminal result",
        );
        return canceled ? "cancelled" : "finished before cancel";
      });

      await step("offline-update-check-failure", async () => {
        const result = await window.latexdo.checkForUpdates();
        assert(result.updateAvailable === false, "offline update check found an update");
        assert(Boolean(result.error), "offline update check returned no error detail");
        return result.error;
      });

      return steps;
    })()
  `)) as PackagedE2eStep[];
}

function e2eDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForE2eRendererCrashRecovery(): Promise<void> {
  const startedAt = Date.now();
  while (!e2eRendererCrashRecovery) {
    if (Date.now() - startedAt > startupSmokeTimeoutMs) {
      throw new Error("Renderer recovery did not start before the timeout.");
    }
    await e2eDelay(25);
  }
  await e2eRendererCrashRecovery;
}

async function runRendererCrashRecoveryE2e(
  window: BrowserWindow,
): Promise<PackagedE2eStep> {
  e2eAllowRendererCrashRecovery = true;
  e2eRendererCrashRecovery = null;
  try {
    window.webContents.forcefullyCrashRenderer();
    await waitForE2eRendererCrashRecovery();
    const result = (await window.webContents.executeJavaScript(`
      (() => ({
        title: document.title,
        rootChildCount: document.getElementById("root")?.childElementCount ?? 0,
        origin: window.location.origin,
      }))()
    `)) as { title?: string; rootChildCount?: number; origin?: string };

    if (
      result.title !== productName ||
      !result.rootChildCount ||
      result.origin !== packagedRendererOrigin
    ) {
      throw new Error(`Renderer did not recover cleanly: ${JSON.stringify(result)}`);
    }

    return {
      name: "renderer-crash-recovery",
      status: "passed",
      detail: "renderer reloaded after forced crash",
    };
  } finally {
    e2eAllowRendererCrashRecovery = false;
    e2eRendererCrashRecovery = null;
  }
}

async function runPackagedE2eTest(window: BrowserWindow): Promise<void> {
  const fixtures = await createPackagedE2eFixtures();
  try {
    const steps = await runRendererPackagedE2eWorkflows(window, fixtures);
    steps.push(await runRendererCrashRecoveryE2e(window));
    console.log("[latexdo] packaged E2E test passed", JSON.stringify(steps, null, 2));
  } finally {
    for (const projectId of openProjects.keys()) {
      closeGitWatchers(projectId);
    }
    await rm(fixtures.root, { recursive: true, force: true }).catch(() => {});
  }
}

// Automated release tests use isolated profiles and must not be mistaken for a
// request to focus an already-running desktop instance.
if (startupAutomationTest) {
  const profileName = startupSmokeTest ? "latexdo-smoke" : "latexdo-e2e";
  app.setPath(
    "userData",
    path.join(app.getPath("temp"), `${profileName}-${process.pid}`),
  );
} else if (devUserDataPath) {
  app.setPath("userData", path.resolve(devUserDataPath));
}

installMainProcessFailureHandlers();

// Concurrent interactive instances race on the settings store, trusted-workspace
// registry, and history snapshots, so a second launch focuses the existing window.
if (!startupAutomationTest && !app.requestSingleInstanceLock()) {
  app.exit(0);
}

// Set once startApp has registered IPC and opened the first window.
let appWindowsAvailable = false;

// Research Spaces and folders opened from Finder, the Dock or the command
// line, waiting for the renderer to ask for them.
const requestedOpenPaths: string[] = [];
const openRequestedChannel = "project:open-requested";

function requestOpenPath(candidate: string): void {
  if (!candidate || !path.isAbsolute(candidate)) return;
  requestedOpenPaths.splice(0, requestedOpenPaths.length, path.resolve(candidate));
  if (!appWindowsAvailable) return;
  const [window] = BrowserWindow.getAllWindows();
  if (!window) {
    // The new window asks for the path once it has loaded.
    createWindow();
    return;
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  window.webContents.send(openRequestedChannel);
}

function openPathsFromArgv(argv: readonly string[]): string[] {
  return argv
    .slice(1)
    .filter((arg) => !arg.startsWith("-") && isResearchSpaceFile(arg));
}

async function openRequestedPath(
  targetWindow: BrowserWindow | null,
): Promise<OpenProject | null> {
  const requested = requestedOpenPaths.shift();
  if (!requested) return null;
  const stats = await stat(requested).catch(() => null);
  if (stats?.isDirectory()) return registerProjectIfTrusted(targetWindow, requested);
  if (stats?.isFile() && isResearchSpaceFile(requested)) {
    return registerResearchSpaceFileIfTrusted(targetWindow, requested);
  }
  throw new Error(`LatexDo cannot open ${path.basename(requested)}.`);
}

// macOS delivers files double-clicked in Finder (also before the app is ready).
app.on("open-file", (event, filePath) => {
  event.preventDefault();
  requestOpenPath(filePath);
});

// Windows and Linux pass the file on the command line.
if (!startupAutomationTest) {
  for (const candidate of openPathsFromArgv(process.argv)) requestOpenPath(candidate);
}

app.on("second-instance", (_event, argv) => {
  if (!appWindowsAvailable) return;
  const [requested] = openPathsFromArgv(argv);
  if (requested) {
    requestOpenPath(requested);
    return;
  }
  const [window] = BrowserWindow.getAllWindows();
  // Relaunching must always give the user a working window: open one when
  // none is left (macOS keeps the app alive), and replace a frozen one.
  if (!window) {
    createWindow();
    return;
  }
  if (isWindowUnresponsive(window)) {
    console.warn("[latexdo] relaunch replaced an unresponsive window");
    window.destroy();
    createWindow();
    return;
  }
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
});

async function startApp(): Promise<void> {
  console.log("[latexdo] app:ready");
  try {
    await clearDevRuntimeCache();
    lastUpdateResolution = await resolvePendingUpdate(
      app.getPath("userData"),
      app.getVersion(),
      installedApplicationPath(),
      buildInfo?.commit,
    );
    if (lastUpdateResolution?.status === "confirmed") {
      console.log(
        `[latexdo] update confirmed: running ${lastUpdateResolution.currentVersion} from ${lastUpdateResolution.fromVersion}`,
      );
      if (
        lastUpdateResolution.fromVersion &&
        lastUpdateResolution.expectedVersion &&
        versionsEquivalent(lastUpdateResolution.expectedVersion, app.getVersion())
      ) {
        try {
          await recordConfirmedUpdate(app.getPath("userData"), {
            fromVersion: lastUpdateResolution.fromVersion,
            toVersion: lastUpdateResolution.expectedVersion,
            confirmedAt: lastUpdateResolution.completedAt ?? new Date().toISOString(),
          });
        } catch (recordError) {
          if (recordError instanceof Error) {
            console.error(
              "[latexdo] could not record confirmed update",
              recordError.message,
            );
          }
        }
      }
    } else if (lastUpdateResolution?.status === "failed") {
      console.warn(
        `[latexdo] update failed: expected ${String(lastUpdateResolution.expectedVersion)} but running ${lastUpdateResolution.currentVersion}`,
      );
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error("[latexdo] could not resolve pending update", error.message);
      recordMainDiagnosticSync("pending-update", "error", error);
    }
    lastUpdateResolution = null;
  }
  try {
    // Release notes also follow updates installed outside the in-app updater.
    await recordLaunchedVersion(app.getPath("userData"), app.getVersion(), new Date(), {
      commit: buildInfo?.commit,
      history: buildInfo?.changes.map((change) => change.commit),
      updaterConfirmed: lastUpdateResolution?.status === "confirmed",
    });
  } catch (error) {
    if (error instanceof Error) {
      console.error("[latexdo] could not record the launched version", error.message);
    }
  }
  if (!isDevelopment) {
    protocol.handle("latexdo", packagedRendererResponse);
  }
  if (process.platform === "darwin") {
    app.dock?.setIcon(appIconPath);
  }
  registerTerminalIpc({ getProjectRoot });
  registerPeerCollabIpc({ getProjectRoot, registerProject });
  console.log("[latexdo] app:terminal-registered");
  registerAiIpc();
  console.log("[latexdo] app:ai-registered");
  buildApplicationMenu();
  console.log("[latexdo] app:menu-built");
  ipcMain.handle("project:reopen-last", async (event, ...rawArgs: unknown[]) => {
    expectIpcArgs("project:reopen-last", rawArgs, 0);
    const window = BrowserWindow.fromWebContents(event.sender) ?? null;
    return scheduleProjectGarbageCollection(await reopenLastProject(window));
  });
  ipcMain.handle("project:open-requested", async (event, ...rawArgs: unknown[]) => {
    expectIpcArgs("project:open-requested", rawArgs, 0);
    const window = BrowserWindow.fromWebContents(event.sender) ?? null;
    return scheduleProjectGarbageCollection(await openRequestedPath(window));
  });
  ipcMain.handle("project:open", async (event, ...rawArgs: unknown[]) => {
    const channel = "project:open";
    expectIpcArgs(channel, rawArgs, 0);
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const dialogOptions = {
      properties: ["openFile", "openDirectory"],
      title: "Open LaTeX project or Research Space",
      buttonLabel: "Open",
      defaultPath: app.getPath("documents"),
      filters: [
        {
          name: "LatexDo Research Spaces",
          extensions: [researchSpacePrimaryExtension, "latexdo-workspace"],
        },
        { name: "All files", extensions: ["*"] },
      ],
    } satisfies Electron.OpenDialogOptions;
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    const selectedPath = result.filePaths[0];
    const selectedStats = await stat(selectedPath).catch(() => null);
    if (selectedStats?.isDirectory()) {
      return scheduleProjectGarbageCollection(
        await registerProjectIfTrusted(window ?? null, selectedPath),
      );
    }
    if (selectedStats?.isFile() && isResearchSpaceFile(selectedPath)) {
      return scheduleProjectGarbageCollection(
        await registerResearchSpaceFileIfTrusted(window ?? null, selectedPath),
      );
    }
    throw new Error("Open a folder or a LatexDo Research Space file.");
  });
  ipcMain.handle("project:create", async (event, ...rawArgs: unknown[]) => {
    const channel = "project:create";
    const [rawOptions] = expectIpcArgRange(channel, rawArgs, 0, 1);
    const options = parseCreateProjectOptions(channel, rawOptions);
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: options.folderName
        ? `Choose where to create ${options.folderName}`
        : "Choose a folder for the new LaTeX project",
      buttonLabel: options.folderName ? "Create Here" : "Create Project",
      defaultPath: app.getPath("documents"),
    });
    if (result.canceled) {
      return null;
    }

    const projectPath = options.folderName
      ? await availableProjectPath(result.filePaths[0], options.folderName)
      : result.filePaths[0];
    await mkdir(projectPath, { recursive: !options.folderName });
    try {
      await atomicWriteUtf8(path.join(projectPath, "main.tex"), starterDocument, {
        exclusive: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // The folder is already a LaTeX project: open it, never overwrite it.
      const window = BrowserWindow.fromWebContents(event.sender);
      const messageOptions = {
        type: "question",
        message: "This folder already has a main.tex",
        detail: "Open it as your project instead? Nothing in it will be changed.",
        buttons: ["Open Folder", "Cancel"],
        defaultId: 0,
        cancelId: 1,
      } satisfies Electron.MessageBoxOptions;
      const { response } = window
        ? await dialog.showMessageBox(window, messageOptions)
        : await dialog.showMessageBox(messageOptions);
      if (response !== 0) return null;
      return scheduleProjectGarbageCollection(
        await registerProjectIfTrusted(window, projectPath),
      );
    }
    await trustWorkspace(projectPath);
    return scheduleProjectGarbageCollection(registerProject(projectPath));
  });
  ipcMain.handle("provider:import-overleaf-project", async (event, ...rawArgs) => {
    const channel = "provider:import-overleaf-project";
    const [rawGitUrl] = expectIpcArgs(channel, rawArgs, 1);
    const gitUrl = parseOverleafGitUrl(channel, rawGitUrl);
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const result = window
      ? await dialog.showOpenDialog(window, {
          properties: ["openDirectory", "createDirectory"],
          title: "Choose where to save the Overleaf project",
          buttonLabel: "Fetch Project",
          defaultPath: app.getPath("documents"),
        })
      : await dialog.showOpenDialog({
          properties: ["openDirectory", "createDirectory"],
          title: "Choose where to save the Overleaf project",
          buttonLabel: "Fetch Project",
          defaultPath: app.getPath("documents"),
        });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    const projectPath = await availableProjectPath(
      result.filePaths[0],
      folderNameFromProviderProjectUrl(gitUrl),
    );
    await runGitText(result.filePaths[0], ["clone", "--", gitUrl, projectPath], {
      maxBytes: 512 * 1024,
    });
    await trustWorkspace(projectPath);
    return scheduleProjectGarbageCollection(registerProject(projectPath));
  });
  ipcMain.handle("research-space:create", async (event, ...rawArgs: unknown[]) => {
    const channel = "research-space:create";
    expectIpcArgs(channel, rawArgs, 0);
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const openOptions = {
      properties: ["openDirectory", "multiSelections"],
      title: "Choose papers and shared folders",
      buttonLabel: "Add to Research Space",
      defaultPath: app.getPath("documents"),
    } satisfies Electron.OpenDialogOptions;
    const openResult = window
      ? await dialog.showOpenDialog(window, openOptions)
      : await dialog.showOpenDialog(openOptions);
    if (openResult.canceled || openResult.filePaths.length === 0) {
      return null;
    }

    const saveOptions = {
      title: "Save LatexDo Research Space",
      buttonLabel: "Save Research Space",
      defaultPath: path.join(
        app.getPath("documents"),
        `research-space.${researchSpacePrimaryExtension}`,
      ),
      filters: [
        {
          name: "LatexDo Research Space",
          extensions: [researchSpacePrimaryExtension],
        },
      ],
    } satisfies Electron.SaveDialogOptions;
    const saveResult = window
      ? await dialog.showSaveDialog(window, saveOptions)
      : await dialog.showSaveDialog(saveOptions);
    if (saveResult.canceled || !saveResult.filePath) {
      return null;
    }

    const filePath = withResearchSpaceExtension(saveResult.filePath);
    const space = await createResearchSpaceFile(filePath, openResult.filePaths);
    await trustWorkspace(path.dirname(space.filePath));
    for (const folder of space.folders) {
      await trustWorkspace(folder.path);
    }
    return scheduleProjectGarbageCollection(registerResearchSpace(space));
  });
  ipcMain.handle("research-space:save-as", async (event, ...rawArgs: unknown[]) => {
    const channel = "research-space:save-as";
    const [rawProjectId] = expectIpcArgs(channel, rawArgs, 1);
    const projectId = parseProjectId(channel, rawProjectId);
    const project = openProjects.get(projectId);
    if (!project) {
      throw new Error("The requested project is not open.");
    }
    const window = BrowserWindow.fromWebContents(event.sender) ?? null;
    const filePath = await chooseResearchSpaceFile(window, project.name);
    if (!filePath) {
      return null;
    }
    // A copy of a space keeps its folder names and kinds.
    const space = isResearchSpaceProject(project)
      ? await writeResearchSpaceFile({
          ...project.researchSpace,
          filePath,
          name: researchSpaceDefaultName(filePath),
        })
      : await createResearchSpaceFile(filePath, [project.rootPath]);
    await trustWorkspace(path.dirname(space.filePath));
    return scheduleProjectGarbageCollection(registerResearchSpace(space));
  });
  ipcMain.handle("research-space:add-folder", async (event, ...rawArgs: unknown[]) => {
    const channel = "research-space:add-folder";
    const [rawProjectId] = expectIpcArgs(channel, rawArgs, 1);
    const projectId = parseProjectId(channel, rawProjectId);
    const project = openProjects.get(projectId);
    if (!project) {
      throw new Error("The requested project is not open.");
    }
    const window = BrowserWindow.fromWebContents(event.sender) ?? null;
    const openOptions = {
      properties: ["openDirectory", "multiSelections"],
      title: "Add folders to the Research Space",
      buttonLabel: "Add",
      defaultPath: app.getPath("documents"),
    } satisfies Electron.OpenDialogOptions;
    const openResult = window
      ? await dialog.showOpenDialog(window, openOptions)
      : await dialog.showOpenDialog(openOptions);
    if (openResult.canceled || openResult.filePaths.length === 0) {
      return null;
    }
    for (const folderPath of openResult.filePaths) {
      await trustWorkspace(folderPath);
    }

    if (!isResearchSpaceProject(project)) {
      // A plain folder becomes a space holding it and the new folders, like
      // adding a folder to a Visual Studio Code window.
      const filePath = await chooseResearchSpaceFile(window, project.name);
      if (!filePath) {
        return null;
      }
      const folderPaths = [
        project.rootPath,
        ...openResult.filePaths.filter(
          (folderPath) => path.resolve(folderPath) !== path.resolve(project.rootPath),
        ),
      ];
      const space = await createResearchSpaceFile(filePath, folderPaths);
      await trustWorkspace(path.dirname(space.filePath));
      return scheduleProjectGarbageCollection(registerResearchSpace(space));
    }

    const current = project.researchSpace;
    const known = new Set(current.folders.map((folder) => path.resolve(folder.path)));
    const usedNames = new Set(current.folders.map((folder) => folder.name));
    const folders = [...current.folders];
    for (const folderPath of openResult.filePaths) {
      const resolvedFolderPath = path.resolve(folderPath);
      const folderStats = await stat(resolvedFolderPath).catch(() => null);
      if (known.has(resolvedFolderPath) || !folderStats?.isDirectory()) {
        continue;
      }
      known.add(resolvedFolderPath);
      const fallback = path.basename(resolvedFolderPath) || "Folder";
      folders.push({
        name: uniqueResearchSpaceFolderName(fallback, fallback, usedNames),
        path: resolvedFolderPath,
        kind: normalizeResearchSpaceFolderKind(undefined, resolvedFolderPath),
      });
    }
    if (folders.length === current.folders.length) {
      throw new Error("Those folders are already in this Research Space.");
    }
    const space = await writeResearchSpaceFile({ ...current, folders });
    return scheduleProjectGarbageCollection(registerResearchSpace(space));
  });
  ipcMain.handle("app:menu-shortcuts", async (_event, ...rawArgs: unknown[]) => {
    expectIpcArgs("app:menu-shortcuts", rawArgs, 0);
    return listMenuShortcuts();
  });
  ipcMain.handle("project:list", async (_event, ...rawArgs: unknown[]) => {
    const channel = "project:list";
    const [rawProjectId, rawOptions] = expectIpcArgRange(channel, rawArgs, 1, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const options = parseProjectListOptions(channel, rawOptions);
    return listOpenProject(projectId, options);
  });
  ipcMain.handle("file:exists", async (_event, ...rawArgs: unknown[]) => {
    const channel = "file:exists";
    const [rawProjectId, rawFilePath] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const filePath = parseRelativePath(channel, rawFilePath);
    const { resolvedPath } = await resolveOpenProjectPath(projectId, filePath);
    try {
      await access(resolvedPath);
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle("file:read", async (_event, ...rawArgs: unknown[]) => {
    const channel = "file:read";
    const [rawProjectId, rawFilePath] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const filePath = parseRelativePath(channel, rawFilePath);
    const location = await resolveOpenProjectPath(projectId, filePath);
    return readSafeTextFile(
      location.projectPath,
      location.resolvedPath,
      location.relativePath,
      /\.bib$/i.test(location.relativePath)
        ? { maxBytes: MAX_BIBLIOGRAPHY_FILE_BYTES }
        : undefined,
    );
  });
  ipcMain.handle("file:read-cloud-upload", async (_event, ...rawArgs: unknown[]) => {
    const channel = "file:read-cloud-upload";
    const [rawProjectId, rawFilePath] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const filePath = parseRelativePath(channel, rawFilePath);
    const location = await resolveOpenProjectPath(projectId, filePath);
    const file = await stat(location.resolvedPath);
    if (!file.isFile()) {
      throw new Error(`${filePath} is not a file.`);
    }
    if (file.size > maxCloudUploadFileBytes) {
      throw new Error(
        `${filePath} is larger than 25 MB, the most sharing accepts for one file.`,
      );
    }
    const content = await readFile(location.resolvedPath);
    if (content.byteLength !== file.size) {
      throw new Error(`${filePath} changed while preparing the cloud upload.`);
    }
    return {
      contentBase64: content.toString("base64"),
      size: content.byteLength,
    };
  });
  ipcMain.handle("file:choose-hosted-import", async (event, ...rawArgs: unknown[]) => {
    const channel = "file:choose-hosted-import";
    const [rawKind] = expectIpcArgs(channel, rawArgs, 1);
    if (rawKind !== "docx" && rawKind !== "markdown") {
      throw new Error(`${channel}: unsupported import type.`);
    }
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const isDocx = rawKind === "docx";
    const dialogOptions = {
      properties: ["openFile"],
      title: isDocx ? "Import DOCX as LaTeX" : "Import Markdown as LaTeX",
      buttonLabel: isDocx ? "Import DOCX" : "Import Markdown",
      defaultPath: app.getPath("documents"),
      filters: isDocx
        ? [{ name: "Word documents", extensions: ["docx"] }]
        : [{ name: "Markdown documents", extensions: ["md", "markdown"] }],
    } satisfies Electron.OpenDialogOptions;
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    const selectedPath = result.filePaths[0];
    if (result.canceled || !selectedPath) return null;

    const extension = path.extname(selectedPath).toLowerCase();
    const allowedExtensions = isDocx
      ? new Set([".docx"])
      : new Set([".md", ".markdown"]);
    if (!allowedExtensions.has(extension)) {
      throw new Error("The selected file type does not match this importer.");
    }
    const selectedStat = await stat(selectedPath);
    if (!selectedStat.isFile()) throw new Error("The selected path is not a file.");
    if (selectedStat.size > maxHostedImportFileBytes) {
      throw new Error("Hosted imports are limited to 5 MiB.");
    }
    const bytes = await readFile(selectedPath);
    if (
      bytes.byteLength > maxHostedImportFileBytes ||
      bytes.byteLength !== selectedStat.size
    ) {
      throw new Error("The selected import changed while it was being read.");
    }
    return {
      fileName: path.basename(selectedPath),
      contentBase64: bytes.toString("base64"),
    };
  });
  ipcMain.handle("asset:read", async (_event, ...rawArgs: unknown[]) => {
    const channel = "asset:read";
    const [rawProjectId, rawFilePath] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const filePath = parseRelativePath(channel, rawFilePath, {
      extensions: [".png", ".jpg", ".jpeg", ".svg", ".pdf"],
    });
    const { resolvedPath } = await resolveOpenProjectPath(projectId, filePath);
    return readFile(resolvedPath);
  });
  ipcMain.handle("file:write", async (_event, ...rawArgs: unknown[]) => {
    const channel = "file:write";
    const [rawProjectId, rawFilePath, rawContent] = expectIpcArgs(channel, rawArgs, 3);
    const projectId = parseProjectId(channel, rawProjectId);
    const filePath = parseRelativePath(channel, rawFilePath);
    const content = parseTextContent(channel, rawContent);
    const { resolvedPath } = await resolveOpenProjectPath(projectId, filePath);
    // No backup copy: the write is already atomic, and the project folder must
    // only ever contain the person's own files.
    await atomicWriteUtf8(resolvedPath, content);
  });
  ipcMain.handle("file:create", async (_event, ...rawArgs: unknown[]) => {
    const channel = "file:create";
    const [rawProjectId, rawRelativePath] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const relativePath = parseRelativePath(channel, rawRelativePath);
    const location = await resolveOpenProjectPath(projectId, relativePath);
    try {
      await atomicWriteUtf8(location.resolvedPath, starterContent(relativePath), {
        exclusive: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return relativeOpenProjectPath(location, location.resolvedPath);
      }
      throw error;
    }
    return relativeOpenProjectPath(location, location.resolvedPath);
  });
  ipcMain.handle(
    "docx:import",
    async (event, ...rawArgs: unknown[]): Promise<DocxImportResult | null> => {
      const channel = "docx:import";
      const [rawProjectId] = expectIpcArgs(channel, rawArgs, 1);
      let project: OpenProject | null = null;
      if (typeof rawProjectId === "string" && rawProjectId.trim()) {
        const projectId = parseProjectId(channel, rawProjectId);
        project = openProjects.get(projectId) ?? null;
        if (!project) {
          throw new Error("The requested project is not open.");
        }
      }
      const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const initialTarget = project ? defaultImportTargetForProject(project) : null;
      const dialogOptions = {
        properties: ["openFile"],
        title: "Import DOCX as LaTeX",
        buttonLabel: "Import DOCX",
        defaultPath: initialTarget?.projectPath ?? app.getPath("documents"),
        filters: [
          { name: "Word documents", extensions: ["docx"] },
          { name: "All files", extensions: ["*"] },
        ],
      } satisfies Electron.OpenDialogOptions;
      const result = window
        ? await dialog.showOpenDialog(window, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);

      if (result.canceled || !result.filePaths[0]) {
        return null;
      }

      if (!project) {
        project = await registerProjectIfTrusted(
          window ?? null,
          path.dirname(result.filePaths[0]),
        );
        if (!project) {
          return null;
        }
      }
      scheduleProjectGarbageCollection(project);
      const importTarget = defaultImportTargetForProject(project);
      const imported = await importDocxIntoProject(
        importTarget.projectPath,
        result.filePaths[0],
      );
      return {
        ...prefixImportPathPayload(imported, importTarget),
        project,
      };
    },
  );
  ipcMain.handle(
    "markdown:import",
    async (event, ...rawArgs: unknown[]): Promise<MarkdownImportResult | null> => {
      const channel = "markdown:import";
      const [rawProjectId] = expectIpcArgs(channel, rawArgs, 1);
      let project: OpenProject | null = null;
      if (typeof rawProjectId === "string" && rawProjectId.trim()) {
        const projectId = parseProjectId(channel, rawProjectId);
        project = openProjects.get(projectId) ?? null;
        if (!project) {
          throw new Error("The requested project is not open.");
        }
      }
      const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const initialTarget = project ? defaultImportTargetForProject(project) : null;
      const dialogOptions = {
        properties: ["openFile"],
        title: "Import Markdown as LaTeX",
        buttonLabel: "Import Markdown",
        defaultPath: initialTarget?.projectPath ?? app.getPath("documents"),
        filters: [
          { name: "Markdown documents", extensions: ["md", "markdown"] },
          { name: "All files", extensions: ["*"] },
        ],
      } satisfies Electron.OpenDialogOptions;
      const result = window
        ? await dialog.showOpenDialog(window, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);

      if (result.canceled || !result.filePaths[0]) {
        return null;
      }

      if (!project) {
        project = await registerProjectIfTrusted(
          window ?? null,
          path.dirname(result.filePaths[0]),
        );
        if (!project) {
          return null;
        }
      }
      scheduleProjectGarbageCollection(project);
      const importTarget = defaultImportTargetForProject(project);
      const imported = await importMarkdown(
        importTarget.projectPath,
        result.filePaths[0],
      );
      return {
        ...prefixImportPathPayload(imported, importTarget),
        project,
      };
    },
  );
  ipcMain.handle(
    "pdf:import",
    async (event, ...rawArgs: unknown[]): Promise<PdfImportResult | null> => {
      const channel = "pdf:import";
      const [rawProjectId] = expectIpcArgs(channel, rawArgs, 1);
      let project: OpenProject | null = null;
      if (typeof rawProjectId === "string" && rawProjectId.trim()) {
        const projectId = parseProjectId(channel, rawProjectId);
        project = openProjects.get(projectId) ?? null;
        if (!project) {
          throw new Error("The requested project is not open.");
        }
      }
      const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const initialTarget = project ? defaultImportTargetForProject(project) : null;
      const dialogOptions = {
        properties: ["openFile"],
        title: "Import PDF as LaTeX",
        buttonLabel: "Import PDF",
        defaultPath: initialTarget?.projectPath ?? app.getPath("documents"),
        filters: [
          { name: "PDF documents", extensions: ["pdf"] },
          { name: "All files", extensions: ["*"] },
        ],
      } satisfies Electron.OpenDialogOptions;
      const result = window
        ? await dialog.showOpenDialog(window, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);

      if (result.canceled || !result.filePaths[0]) {
        return null;
      }

      if (!project) {
        project = await registerProjectIfTrusted(
          window ?? null,
          path.dirname(result.filePaths[0]),
        );
        if (!project) {
          return null;
        }
      }
      scheduleProjectGarbageCollection(project);
      const importTarget = defaultImportTargetForProject(project);
      const imported = await importPdfIntoProject(
        importTarget.projectPath,
        result.filePaths[0],
      );
      return {
        ...prefixImportPathPayload(imported, importTarget),
        project,
      };
    },
  );
  ipcMain.handle("folder:create", async (_event, ...rawArgs: unknown[]) => {
    const channel = "folder:create";
    const [rawProjectId, rawRelativePath] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const relativePath = parseRelativePath(channel, rawRelativePath);
    const location = await resolveOpenProjectPath(projectId, relativePath);
    try {
      await mkdir(location.resolvedPath, { recursive: false });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return relativeOpenProjectPath(location, location.resolvedPath);
      }
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error("Create the parent folder first.");
      }
      throw error;
    }
    return relativeOpenProjectPath(location, location.resolvedPath);
  });
  ipcMain.handle(
    "file:read-external-for-share",
    async (_event, ...rawArgs: unknown[]) => {
      const channel = "file:read-external-for-share";
      const [rawSourcePaths] = expectIpcArgs(channel, rawArgs, 1);
      return readExternalFilesForShare(
        parseExternalSourcePaths(channel, rawSourcePaths),
      );
    },
  );
  ipcMain.handle(
    "file:choose-external-for-share",
    async (event, ...rawArgs: unknown[]) => {
      const channel = "file:choose-external-for-share";
      expectIpcArgs(channel, rawArgs, 0);
      const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const dialogOptions = {
        properties: ["openFile", "openDirectory", "multiSelections"],
        title: "Add files or folders to the shared project",
        buttonLabel: "Add",
        defaultPath: app.getPath("documents"),
      } satisfies Electron.OpenDialogOptions;
      const result = window
        ? await dialog.showOpenDialog(window, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);
      if (result.canceled || result.filePaths.length === 0) return [];
      return readExternalFilesForShare(
        parseExternalSourcePaths(channel, result.filePaths),
      );
    },
  );
  ipcMain.handle("file:import-external", async (_event, ...rawArgs: unknown[]) => {
    const channel = "file:import-external";
    const [rawProjectId, rawDestinationDirectory, rawSourcePaths] = expectIpcArgs(
      channel,
      rawArgs,
      3,
    );
    const projectId = parseProjectId(channel, rawProjectId);
    const destinationDirectory = parseOptionalImportDestination(
      channel,
      rawDestinationDirectory,
    );
    const sourcePaths = parseExternalSourcePaths(channel, rawSourcePaths);
    const target = await resolveImportDestination(projectId, destinationDirectory);
    const imported = await importExternalFilesIntoProject(
      channel,
      target.projectPath,
      target.relativePath === "." ? "" : target.relativePath,
      sourcePaths,
    );
    return imported.map((entry) => ({
      ...entry,
      relativePath: target.spaceFolder
        ? prefixResearchSpaceRelativePath(target.spaceFolder, entry.relativePath)
        : entry.relativePath,
    }));
  });
  ipcMain.handle(
    "file:choose-import-external",
    async (event, ...rawArgs: unknown[]) => {
      const channel = "file:choose-import-external";
      const [rawProjectId, rawDestinationDirectory] = expectIpcArgs(
        channel,
        rawArgs,
        2,
      );
      const projectId = parseProjectId(channel, rawProjectId);
      const destinationDirectory = parseOptionalImportDestination(
        channel,
        rawDestinationDirectory,
      );
      const target = await resolveImportDestination(projectId, destinationDirectory);
      const destinationRoot = target.resolvedPath;
      const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const dialogOptions = {
        properties: ["openFile", "openDirectory", "multiSelections"],
        title: "Import files or folders into project",
        buttonLabel: "Import",
        defaultPath: destinationRoot,
      } satisfies Electron.OpenDialogOptions;
      const result = window
        ? await dialog.showOpenDialog(window, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);

      if (result.canceled || result.filePaths.length === 0) {
        return [];
      }

      const imported = await importExternalFilesIntoProject(
        channel,
        target.projectPath,
        target.relativePath === "." ? "" : target.relativePath,
        parseExternalSourcePaths(channel, result.filePaths),
      );
      return imported.map((entry) => ({
        ...entry,
        relativePath: target.spaceFolder
          ? prefixResearchSpaceRelativePath(target.spaceFolder, entry.relativePath)
          : entry.relativePath,
      }));
    },
  );
  ipcMain.handle("entry:copy", async (_event, ...rawArgs: unknown[]) => {
    const channel = "entry:copy";
    const [rawProjectId, rawFromRelativePath, rawToRelativePath] = expectIpcArgs(
      channel,
      rawArgs,
      3,
    );
    const projectId = parseProjectId(channel, rawProjectId);
    const fromRelativePath = parseRelativePath(channel, rawFromRelativePath);
    const toRelativePath = parseRelativePath(channel, rawToRelativePath);
    const sourceLocation = await resolveOpenProjectPath(projectId, fromRelativePath);
    const targetLocation = await resolveOpenProjectPath(projectId, toRelativePath);
    const sourcePath = sourceLocation.resolvedPath;
    const targetPath = targetLocation.resolvedPath;

    if (!(await stat(sourcePath).catch(() => null))) {
      throw new Error(`"${fromRelativePath}" no longer exists.`);
    }
    if (isInside(sourcePath, targetPath)) {
      throw new Error("Cannot copy a folder into itself.");
    }
    if (await stat(targetPath).catch(() => null)) {
      throw new Error(`"${toRelativePath}" already exists.`);
    }
    await cp(sourcePath, targetPath, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    return relativeOpenProjectPath(targetLocation, targetPath);
  });
  ipcMain.handle("entry:trash", async (_event, ...rawArgs: unknown[]) => {
    const channel = "entry:trash";
    const [rawProjectId, rawRelativePath] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const relativePath = parseRelativePath(channel, rawRelativePath);
    const location = await resolveOpenProjectPath(projectId, relativePath);
    if (location.relativePath === "." || relativePath === "" || relativePath === ".") {
      throw new Error("The project folder itself cannot be deleted from here.");
    }
    if (!(await stat(location.resolvedPath).catch(() => null))) {
      throw new Error(`"${relativePath}" no longer exists.`);
    }
    await shell.trashItem(location.resolvedPath);
  });
  ipcMain.handle("entry:move", async (_event, ...rawArgs: unknown[]) => {
    const channel = "entry:move";
    const [rawProjectId, rawFromRelativePath, rawToRelativePath] = expectIpcArgs(
      channel,
      rawArgs,
      3,
    );
    const projectId = parseProjectId(channel, rawProjectId);
    const fromRelativePath = parseRelativePath(channel, rawFromRelativePath);
    const toRelativePath = parseRelativePath(channel, rawToRelativePath);
    const sourceLocation = await resolveOpenProjectPath(projectId, fromRelativePath);
    const targetLocation = await resolveOpenProjectPath(projectId, toRelativePath);
    const sourcePath = sourceLocation.resolvedPath;
    const targetPath = targetLocation.resolvedPath;

    if (sourceLocation.spaceFolder && sourceLocation.relativePath === ".") {
      throw new Error(
        "Move files inside a Research Space folder, not the folder root.",
      );
    }

    if (sourcePath === targetPath) {
      return relativeOpenProjectPath(targetLocation, targetPath);
    }

    const sourceStats = await stat(sourcePath).catch(() => null);
    if (!sourceStats) {
      throw new Error(`"${fromRelativePath}" no longer exists.`);
    }

    if (isInside(sourcePath, targetPath)) {
      throw new Error("Cannot move a folder into itself.");
    }

    const targetExists = await stat(targetPath).catch(() => null);
    if (targetExists) {
      throw new Error(`"${toRelativePath}" already exists.`);
    }

    const targetParent = path.dirname(targetPath);
    const targetParentStats = await stat(targetParent).catch(() => null);
    if (!targetParentStats?.isDirectory()) {
      throw new Error("Choose an existing folder as the destination.");
    }

    await rename(sourcePath, targetPath);
    return relativeOpenProjectPath(targetLocation, targetPath);
  });
  ipcMain.handle("git:status", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:status";
    const [rawProjectId] = expectIpcArgs(channel, rawArgs, 1);
    const projectId = parseProjectId(channel, rawProjectId);
    const project = getOpenProject(projectId);
    if (isResearchSpaceProject(project)) {
      return researchSpaceGitStatus();
    }
    const projectPath = getProjectRoot(projectId);
    await ensureGitWatchers(projectId, projectPath);
    return readStructuredGitStatus(projectPath);
  });
  ipcMain.handle("git:stage", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:stage";
    const [rawProjectId, rawRelativePath] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const relativePath = parseRelativePath(channel, rawRelativePath);
    const location = await resolveOpenProjectPath(projectId, relativePath);
    await runGitExclusive(location.projectPath, () =>
      gitAdd(location.projectPath, location.relativePath),
    );
  });
  ipcMain.handle("git:unstage", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:unstage";
    const [rawProjectId, rawRelativePath] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const relativePath = parseRelativePath(channel, rawRelativePath);
    const location = await resolveOpenProjectPath(projectId, relativePath);
    await runGitExclusive(location.projectPath, () =>
      gitUnstage(location.projectPath, location.relativePath),
    );
  });
  ipcMain.handle("git:commit", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:commit";
    const [rawProjectId, rawMessage] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const message = parseString(channel, rawMessage, {
      maxLength: maxGitCommitMessageLength,
    });
    if (isResearchSpaceProject(getOpenProject(projectId))) {
      throwResearchSpaceGitUnavailable();
    }
    const projectPath = getProjectRoot(projectId);
    await runGitExclusive(projectPath, () => gitCommit(projectPath, message));
  });
  ipcMain.handle("git:repository-info", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:repository-info";
    const [rawProjectId] = expectIpcArgs(channel, rawArgs, 1);
    const projectId = parseProjectId(channel, rawProjectId);
    if (isResearchSpaceProject(getOpenProject(projectId))) {
      throwResearchSpaceGitUnavailable();
    }
    return readGitRepositoryInfo(getProjectRoot(projectId));
  });
  ipcMain.handle("git:action", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:action";
    const [rawProjectId, rawAction] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const action = parseGitAction(rawAction);
    if (isResearchSpaceProject(getOpenProject(projectId))) {
      throwResearchSpaceGitUnavailable();
    }
    const projectPath = getProjectRoot(projectId);
    const result = await runGitExclusive(projectPath, () =>
      runGitAction(projectPath, action),
    );
    if (action.kind === "init") await ensureGitWatchers(projectId, projectPath);
    return result;
  });
  ipcMain.handle("git:diff", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:diff";
    const [rawProjectId, rawRelativePath] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const relativePath = parseRelativePath(channel, rawRelativePath);
    const location = await resolveOpenProjectPath(projectId, relativePath);
    return {
      path: relativePath,
      diff: await readGitDiffPreview(location.projectPath, location.relativePath),
    };
  });
  ipcMain.handle("git:discard", async (event, ...rawArgs: unknown[]) => {
    const channel = "git:discard";
    const [rawProjectId, rawRelativePath] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const relativePath = parseRelativePath(channel, rawRelativePath);
    const location = await resolveOpenProjectPath(projectId, relativePath);
    const confirmed = await confirmGitDiscard(
      BrowserWindow.fromWebContents(event.sender),
      `Discard changes in ${relativePath}?`,
    );
    if (!confirmed) {
      return { discarded: false };
    }
    const result = await runGitExclusive(location.projectPath, () =>
      gitDiscard(location.projectPath, location.relativePath),
    );
    return {
      ...result,
      recoveryPatch:
        result.recoveryPatch && location.spaceFolder
          ? prefixResearchSpaceRelativePath(location.spaceFolder, result.recoveryPatch)
          : result.recoveryPatch,
    };
  });
  ipcMain.handle("git:stage-all", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:stage-all";
    const [rawProjectId] = expectIpcArgs(channel, rawArgs, 1);
    const projectId = parseProjectId(channel, rawProjectId);
    if (isResearchSpaceProject(getOpenProject(projectId))) {
      throwResearchSpaceGitUnavailable();
    }
    const projectPath = getProjectRoot(projectId);
    await runGitExclusive(projectPath, () => gitStageAll(projectPath));
  });
  ipcMain.handle("git:unstage-all", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:unstage-all";
    const [rawProjectId] = expectIpcArgs(channel, rawArgs, 1);
    const projectId = parseProjectId(channel, rawProjectId);
    if (isResearchSpaceProject(getOpenProject(projectId))) {
      throwResearchSpaceGitUnavailable();
    }
    const projectPath = getProjectRoot(projectId);
    await runGitExclusive(projectPath, () => gitUnstageAll(projectPath));
  });
  ipcMain.handle("git:discard-all", async (event, ...rawArgs: unknown[]) => {
    const channel = "git:discard-all";
    const [rawProjectId] = expectIpcArgs(channel, rawArgs, 1);
    const projectId = parseProjectId(channel, rawProjectId);
    if (isResearchSpaceProject(getOpenProject(projectId))) {
      throwResearchSpaceGitUnavailable();
    }
    const projectPath = getProjectRoot(projectId);
    const confirmed = await confirmGitDiscard(
      BrowserWindow.fromWebContents(event.sender),
      "Discard all unstaged changes?",
    );
    if (!confirmed) {
      return { discarded: false };
    }
    return runGitExclusive(projectPath, () => gitDiscardAll(projectPath));
  });
  ipcMain.handle("git:editor-diff", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:editor-diff";
    const [rawProjectId, rawRelativePath, rawArea] = expectIpcArgRange(
      channel,
      rawArgs,
      2,
      3,
    );
    const projectId = parseProjectId(channel, rawProjectId);
    const relativePath = parseRelativePath(channel, rawRelativePath);
    const area =
      rawArea === undefined
        ? "changes"
        : parseString(channel, rawArea, {
            pattern: /^(staged|changes)$/,
            rejectControlChars: true,
          });
    const location = await resolveOpenProjectPath(projectId, relativePath);
    const session = await readWorkingTreeDiffSession(
      location.projectPath,
      location.relativePath,
      area as "staged" | "changes",
    );
    return location.spaceFolder
      ? {
          ...session,
          relativePath,
          id: session.id.replace(location.relativePath, relativePath),
        }
      : session;
  });
  ipcMain.handle("git:history", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:history";
    const [rawProjectId, rawRelativePath] = expectIpcArgRange(channel, rawArgs, 1, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const relativePath = parseOptionalRelativePath(channel, rawRelativePath);
    const project = getOpenProject(projectId);
    if (isResearchSpaceProject(project) && !relativePath) {
      return { scope: "repo", target: null, commits: [] };
    }
    if (relativePath) {
      const location = await resolveOpenProjectPath(projectId, relativePath);
      const history = await readStructuredGitHistory(
        location.projectPath,
        location.relativePath,
      );
      return { ...history, target: relativePath };
    }
    const projectPath = getProjectRoot(projectId);
    return readStructuredGitHistory(projectPath, relativePath);
  });
  ipcMain.handle("git:graph", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:graph";
    const [rawProjectId, rawOptions] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const options = (rawOptions ?? {}) as { limit?: unknown; refs?: unknown };
    const limit =
      typeof options.limit === "number" && Number.isFinite(options.limit)
        ? Math.max(1, Math.min(Math.floor(options.limit), 5000))
        : 100;
    const refs =
      typeof options.refs === "string" && options.refs.length <= 250
        ? options.refs
        : "auto";
    if (isResearchSpaceProject(getOpenProject(projectId))) {
      return { scope: "repo", target: null, commits: [], hasMore: false };
    }
    const history = await readStructuredGitHistory(
      getProjectRoot(projectId),
      undefined,
      {
        limit,
        refs,
      },
    );
    return { ...history, hasMore: history.commits.length >= limit };
  });
  ipcMain.handle("git:diff-for-message", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:diff-for-message";
    const [rawProjectId] = expectIpcArgs(channel, rawArgs, 1);
    const projectId = parseProjectId(channel, rawProjectId);
    if (isResearchSpaceProject(getOpenProject(projectId))) {
      throwResearchSpaceGitUnavailable();
    }
    return readDiffForCommitMessage(getProjectRoot(projectId));
  });
  ipcMain.handle("git:commit-details", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:commit-details";
    const [rawProjectId, rawHash] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const hash = parseGitHash(channel, rawHash);
    if (isResearchSpaceProject(getOpenProject(projectId))) {
      throwResearchSpaceGitUnavailable();
    }
    const projectPath = getProjectRoot(projectId);
    return readStructuredGitCommitDetails(projectPath, hash);
  });
  ipcMain.handle("git:commit-file-diff", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:commit-file-diff";
    const [rawProjectId, rawRelativePath, rawHash, rawParentHash] = expectIpcArgRange(
      channel,
      rawArgs,
      3,
      4,
    );
    const projectId = parseProjectId(channel, rawProjectId);
    const relativePath = parseRelativePath(channel, rawRelativePath);
    const hash = parseGitHash(channel, rawHash);
    const parentHash = parseOptionalGitHash(channel, rawParentHash);
    const location = await resolveOpenProjectPath(projectId, relativePath);
    const session = await readCommitDiffSession(
      location.projectPath,
      location.relativePath,
      hash,
      parentHash,
    );
    return location.spaceFolder
      ? {
          ...session,
          relativePath,
          id: session.id.replace(location.relativePath, relativePath),
        }
      : session;
  });
  ipcMain.handle("git:blame", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:blame";
    const [rawProjectId, rawRelativePath, rawRevision] = expectIpcArgs(
      channel,
      rawArgs,
      3,
    );
    const projectId = parseProjectId(channel, rawProjectId);
    const relativePath = parseRelativePath(channel, rawRelativePath);
    const revision = parseGitRevisionRef(channel, rawRevision);
    const location = await resolveOpenProjectPath(projectId, relativePath);
    return readGitBlame(location.projectPath, location.relativePath, revision);
  });
  ipcMain.handle("git:reveal-file", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:reveal-file";
    const [rawProjectId, rawRelativePath] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const relativePath = parseRelativePath(channel, rawRelativePath);
    const { resolvedPath } = await resolveOpenProjectPath(projectId, relativePath);
    shell.showItemInFolder(resolvedPath);
  });
  ipcMain.handle("app:check-updates", async (_event, ...rawArgs: unknown[]) => {
    const channel = "app:check-updates";
    expectIpcArgs(channel, rawArgs, 0);
    return checkForUpdates();
  });
  ipcMain.handle("app:update-now", async (event, ...rawArgs: unknown[]) => {
    const channel = "app:update-now";
    expectIpcArgs(channel, rawArgs, 0);
    return updateNow((progress) => {
      event.sender.send("app:update-progress", progress);
    });
  });
  ipcMain.handle("app:last-update-status", async (_event, ...rawArgs: unknown[]) => {
    const channel = "app:last-update-status";
    expectIpcArgs(channel, rawArgs, 0);
    return (
      lastUpdateResolution ??
      (await describePendingUpdate(app.getPath("userData"), app.getVersion()))
    );
  });
  ipcMain.handle("app:whats-new", async (_event, ...rawArgs: unknown[]) => {
    const channel = "app:whats-new";
    expectIpcArgs(channel, rawArgs, 0);
    return buildWhatsNewResult();
  });
  ipcMain.handle(
    "app:whats-new-mark-presented",
    async (_event, ...rawArgs: unknown[]) => {
      const channel = "app:whats-new-mark-presented";
      const [rawVersion] = expectIpcArgs(channel, rawArgs, 1);
      const version = payloadString(rawVersion);
      if (!version || !versionsEquivalent(version, app.getVersion())) {
        throw new Error("Invalid update version.");
      }
      await markVersionPresented(app.getPath("userData"), version, buildInfo?.commit);
      return { ok: true };
    },
  );
  ipcMain.handle("app:whats-new-open-notes", async (_event, ...rawArgs: unknown[]) => {
    const channel = "app:whats-new-open-notes";
    expectIpcArgs(channel, rawArgs, 0);
    return openReleaseNotesPageForCurrentVersion();
  });
  ipcMain.handle("app:open-releases", async (_event, ...rawArgs: unknown[]) => {
    const channel = "app:open-releases";
    const [rawReleaseUrl] = expectIpcArgRange(channel, rawArgs, 0, 1);
    await shell.openExternal(safeDownloadsUrl(rawReleaseUrl));
  });
  ipcMain.handle("app:open-external", async (_event, ...rawArgs: unknown[]) => {
    const channel = "app:open-external";
    const [rawUrl] = expectIpcArgs(channel, rawArgs, 1);
    const url = safeExternalUrl(rawUrl);
    if (!url) {
      throw new Error("Unsupported external URL.");
    }
    await shell.openExternal(url);
  });
  ipcMain.handle("app:renderer-diagnostic", async (_event, ...rawArgs: unknown[]) => {
    const channel = "app:renderer-diagnostic";
    const [rawPayload] = expectIpcArgs(channel, rawArgs, 1);
    const payload = parseRendererDiagnosticPayload(channel, rawPayload);
    await recordMainDiagnostic(
      payload.kind,
      payload.kind === "renderer-freeze" ? "warning" : "error",
      payload.error,
      payload.context,
    );
  });
  ipcMain.handle("scholarly:fetch-json", async (_event, ...rawArgs: unknown[]) => {
    const channel = "scholarly:fetch-json";
    const [rawUrl] = expectIpcArgs(channel, rawArgs, 1);
    return fetchScholarlyMetadataJson(rawUrl);
  });
  ipcMain.handle("orcid:fetch-profile", async (_event, ...rawArgs: unknown[]) => {
    const channel = "orcid:fetch-profile";
    const [rawOrcidInput] = expectIpcArgs(channel, rawArgs, 1);
    const orcidInput = parseString(channel, rawOrcidInput, {
      maxLength: 128,
      rejectControlChars: true,
    });
    return fetchOrcidProfile(orcidInput);
  });
  ipcMain.handle("extensions:get-catalog", async (_event, ...rawArgs: unknown[]) => {
    const channel = "extensions:get-catalog";
    expectIpcArgs(channel, rawArgs, 0);
    return fetchExtensionStoreCatalogJson();
  });
  ipcMain.handle("spellchecker:get-settings", async (event, ...rawArgs: unknown[]) => {
    const channel = "spellchecker:get-settings";
    expectIpcArgs(channel, rawArgs, 0);
    return getSpellCheckerSettings(BrowserWindow.fromWebContents(event.sender));
  });
  ipcMain.handle(
    "spellchecker:update-settings",
    async (_event, ...rawArgs: unknown[]) => {
      const channel = "spellchecker:update-settings";
      const [rawSettings] = expectIpcArgs(channel, rawArgs, 1);
      const settings = parseSpellCheckerSettingsInput(channel, rawSettings);
      return updateSpellCheckerSettings(settings);
    },
  );
  ipcMain.handle("proofread:get-settings", async (_event, ...rawArgs: unknown[]) => {
    const channel = "proofread:get-settings";
    expectIpcArgs(channel, rawArgs, 0);
    return getProofreadingSettings();
  });
  ipcMain.handle("proofread:update-settings", async (_event, ...rawArgs: unknown[]) => {
    const channel = "proofread:update-settings";
    const [rawSettings] = expectIpcArgs(channel, rawArgs, 1);
    const settings = parseProofreadingSettingsInput(channel, rawSettings);
    return updateProofreadingSettings(settings);
  });
  ipcMain.handle("proofread:check", async (_event, ...rawArgs: unknown[]) => {
    const channel = "proofread:check";
    const [rawRelativePath, rawContent, rawOptions] = expectIpcArgRange(
      channel,
      rawArgs,
      2,
      3,
    );
    const relativePath = parseRelativePath(channel, rawRelativePath, {
      extensions: [".tex", ".md", ".txt"],
    });
    const content = parseTextContent(channel, rawContent, maxProofreadingContentLength);
    const options = parseProofreadingRequestOptions(channel, rawOptions);
    return proofreadDocument(relativePath, content, options);
  });
  ipcMain.handle("latex:compile", async (event, ...rawArgs: unknown[]) => {
    const channel = "latex:compile";
    const [rawRequest] = expectIpcArgs(channel, rawArgs, 1);
    const request = parseCompileRequestInput(channel, rawRequest);
    const location = await resolveOpenProjectPath(request.projectId, request.rootFile);
    await assertCanonicalCompileInside(location.projectPath, location.resolvedPath);
    const controller = new AbortController();
    const untrack = trackCompileController(request.projectId, controller);
    try {
      const result = await compileLatex(
        {
          projectPath: location.projectPath,
          rootFile: location.relativePath,
          engine: request.engine,
        },
        {
          signal: controller.signal,
          onProgress: (progress) => {
            event.sender.send("compile:progress", {
              projectId: request.projectId,
              progress,
            });
          },
        },
      );
      const mappedResult = prefixResultDiagnostics(result, location);
      return {
        ...mappedResult,
        pdfPath: mappedResult.pdfPath
          ? relativeOpenProjectPath(location, mappedResult.pdfPath)
          : undefined,
      };
    } finally {
      untrack();
      projectGarbageCollector.schedule(request.projectId);
    }
  });
  ipcMain.handle("latex:compile-cloud", async (event, ...rawArgs: unknown[]) => {
    const channel = "latex:compile-cloud";
    const [rawRequest] = expectIpcArgs(channel, rawArgs, 1);
    if (!isRecord(rawRequest)) {
      invalidIpcInput(channel);
    }
    const request = parseCompileRequestInput(channel, rawRequest);
    if (!cloudCompileProjectIdPattern.test(request.projectId)) {
      invalidIpcInput(channel);
    }
    if (!Array.isArray(rawRequest.files)) {
      invalidIpcInput(channel);
    }
    const files = rawRequest.files.map((file) => {
      if (!isRecord(file)) {
        invalidIpcInput(channel);
      }
      const relativePath = parseRelativePath(channel, file.relativePath);
      return typeof file.base64 === "string"
        ? { relativePath, bytes: Buffer.from(file.base64, "base64") }
        : {
            relativePath,
            content: typeof file.content === "string" ? file.content : "",
          };
    });

    const projectPath = path.join(
      app.getPath("temp"),
      "latexdo-cloud",
      request.projectId,
    );
    await materializeCloudCompileFiles(projectPath, files);
    if (
      !(await ensureWorkspaceTrust(
        BrowserWindow.fromWebContents(event.sender),
        projectPath,
      ))
    ) {
      throw new Error(
        "Trust the shared project's authors before running local compilers.",
      );
    }
    // Register the scratch copy so PDF preview, SyncTeX, and cancelation
    // resolve the cloud project id to this local mirror.
    openProjects.set(request.projectId, {
      id: request.projectId,
      rootPath: projectPath,
      name: `Shared project ${request.projectId}`,
    });
    await resolveProjectPath(projectPath, request.rootFile);
    await assertCanonicalCompileInside(
      projectPath,
      path.join(projectPath, request.rootFile),
    );

    const controller = new AbortController();
    const untrack = trackCompileController(request.projectId, controller);
    try {
      const result = await compileLatex(
        {
          projectPath,
          rootFile: request.rootFile,
          engine: request.engine,
        },
        {
          signal: controller.signal,
          onProgress: (progress) => {
            event.sender.send("compile:progress", {
              projectId: request.projectId,
              progress,
            });
          },
        },
      );
      return {
        ...result,
        pdfPath: result.pdfPath
          ? relativeProjectPath(projectPath, result.pdfPath)
          : undefined,
      };
    } finally {
      untrack();
      projectGarbageCollector.schedule(request.projectId);
    }
  });
  ipcMain.handle("latex:compile-cancel", async (_event, ...rawArgs: unknown[]) => {
    const channel = "latex:compile-cancel";
    const [rawProjectId] = expectIpcArgs(channel, rawArgs, 1);
    const projectId = parseProjectId(channel, rawProjectId);
    getProjectRoot(projectId);
    return cancelActiveCompiles(projectId);
  });
  ipcMain.handle("asymptote:compile", async (_event, ...rawArgs: unknown[]) => {
    const channel = "asymptote:compile";
    const [rawRequest] = expectIpcArgs(channel, rawArgs, 1);
    const request = parseAsymptoteCompileRequestInput(channel, rawRequest);
    const location = await resolveOpenProjectPath(
      request.projectId,
      request.relativePath,
    );
    await assertCanonicalCompileInside(location.projectPath, location.resolvedPath);
    const controller = new AbortController();
    const untrack = trackCompileController(request.projectId, controller);
    try {
      const result = await compileAsymptote(
        {
          projectPath: location.projectPath,
          relativePath: location.relativePath,
        },
        { signal: controller.signal },
      );
      const mappedResult = prefixResultDiagnostics(result, location);
      return {
        ...mappedResult,
        pdfPath: mappedResult.pdfPath
          ? relativeOpenProjectPath(location, mappedResult.pdfPath)
          : undefined,
      };
    } finally {
      untrack();
      projectGarbageCollector.schedule(request.projectId);
    }
  });
  ipcMain.handle("pdf:read", async (_event, ...rawArgs: unknown[]) => {
    const channel = "pdf:read";
    const [rawProjectId, rawPdfPath] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const pdfPath = parseRelativePath(channel, rawPdfPath, {
      extensions: [".pdf"],
    });
    const { resolvedPath } = await resolveOpenProjectPath(projectId, pdfPath);
    return readFile(resolvedPath);
  });
  ipcMain.handle("synctex:forward", async (_event, ...rawArgs: unknown[]) => {
    const channel = "synctex:forward";
    const [rawProjectId, rawPdfRelativePath, rawInputRelativePath, rawLine, rawColumn] =
      expectIpcArgs(channel, rawArgs, 5);
    const projectId = parseProjectId(channel, rawProjectId);
    const pdfRelativePath = parseRelativePath(channel, rawPdfRelativePath, {
      extensions: [".pdf"],
    });
    const inputRelativePath = parseRelativePath(channel, rawInputRelativePath, {
      extensions: [".tex"],
    });
    const line = parseInteger(channel, rawLine, 1, maxSyncTexNumber);
    const column = parseInteger(channel, rawColumn, 1, maxSyncTexNumber);
    const pdfLocation = await resolveOpenProjectPath(projectId, pdfRelativePath);
    const inputLocation = await resolveOpenProjectPath(projectId, inputRelativePath);
    if (pdfLocation.projectPath !== inputLocation.projectPath) {
      throw new Error(
        "SyncTeX source and PDF must be in the same Research Space folder.",
      );
    }
    return forwardSyncTex(
      pdfLocation.projectPath,
      pdfLocation.resolvedPath,
      inputLocation.resolvedPath,
      line,
      column,
    );
  });
  ipcMain.handle("synctex:backward", async (_event, ...rawArgs: unknown[]) => {
    const channel = "synctex:backward";
    const [rawProjectId, rawPdfRelativePath, rawPage, rawX, rawY] = expectIpcArgs(
      channel,
      rawArgs,
      5,
    );
    const projectId = parseProjectId(channel, rawProjectId);
    const pdfRelativePath = parseRelativePath(channel, rawPdfRelativePath, {
      extensions: [".pdf"],
    });
    const page = parseInteger(channel, rawPage, 1, 100_000);
    const x = parseFiniteNumber(channel, rawX, 0, maxSyncTexNumber);
    const y = parseFiniteNumber(channel, rawY, 0, maxSyncTexNumber);
    const pdfLocation = await resolveOpenProjectPath(projectId, pdfRelativePath);
    const result = await backwardSyncTex(
      pdfLocation.projectPath,
      pdfLocation.resolvedPath,
      page,
      x,
      y,
    );
    if (!result || !pdfLocation.spaceFolder) {
      return result;
    }
    return {
      ...result,
      file: prefixResearchSpaceRelativePath(pdfLocation.spaceFolder, result.file),
    };
  });

  ipcMain.handle("workspace:collect-garbage", async (_event, ...rawArgs: unknown[]) => {
    const channel = "workspace:collect-garbage";
    const [rawProjectId, rawOptions] = expectIpcArgRange(channel, rawArgs, 1, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    let options: CollectNowOptions = {};
    if (rawOptions !== undefined) {
      if (!isRecord(rawOptions)) {
        throw new Error(`${channel}: expected an options object`);
      }
      if (rawOptions.maxBuildBytes !== undefined) {
        options = {
          buildPolicy: {
            maxTotalBytes: parseFiniteNumber(
              channel,
              rawOptions.maxBuildBytes,
              16 * 1024 * 1024,
              4 * 1024 ** 4,
            ),
          },
        };
      }
    }
    return projectGarbageCollector.collectNow(projectId, options);
  });

  const window = createWindow();
  appWindowsAvailable = true;
  console.log("[latexdo] app:window-opened");
  if (startupSmokeTest) {
    void runStartupSmokeTest(window)
      .then(() => app.exit(0))
      .catch((error) => {
        console.error("[latexdo] packaged startup smoke test failed", error);
        app.exit(1);
      });
    return;
  }
  if (startupE2eTest) {
    void runPackagedE2eTest(window)
      .then(() => app.exit(0))
      .catch((error) => {
        console.error("[latexdo] packaged E2E test failed", error);
        app.exit(1);
      });
    return;
  }
  if (!(await ensurePrivacyConsent(window))) {
    app.quit();
    return;
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}

function handleFatalStartupError(error: unknown): void {
  recordMainDiagnosticSync("fatal-startup", "fatal", error, {
    stage: "app.whenReady",
  });
  console.error("[latexdo] fatal startup failure", error);
  showFatalMainProcessDialog(`${productName} could not start`, error);
  app.exit(1);
}

void app.whenReady().then(startApp).catch(handleFatalStartupError);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  appIsQuitting = true;
  for (const projectId of gitWatchStates.keys()) closeGitWatchers(projectId);
  stopBundledSpeechServer();
  disposePeerCollab();
  projectGarbageCollector.dispose();
});
