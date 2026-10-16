import type { LatexDoApi, TerminalApi } from "../electron/preload.cjs";
import type {
  GitDiffSession,
  GitDiffPreview,
  GitDiscardResult,
  GitHistorySummary,
  GitStatusSummary,
  OpenProject,
  ProjectEntry,
  ProofreadingSettings,
  SpellCheckerSettings,
} from "./types";
import { appVersion } from "./appVersion";
import { fetchOrcidProfileDirect } from "./features/ai/orcid";

type BrowserLatexDoApi = LatexDoApi & {
  runtime: "browser";
};

interface BrowserProjectRecord {
  id: string;
  name: string;
  rootPath: string;
  files: Record<string, string>;
  folders: string[];
  updatedAt: number;
}

interface BrowserStore {
  currentProjectId: string | null;
  projects: BrowserProjectRecord[];
  proofreadingSettings?: ProofreadingSettings;
  spellCheckerSettings?: SpellCheckerSettings;
}

type BrowserTreeNode = {
  name: string;
  relativePath: string;
  type: "file" | "directory";
  children: Map<string, BrowserTreeNode>;
};

const browserStoreKey = "latexdo.browser.workspace.v1";
const extensionStoreCatalogUrl =
  import.meta.env?.VITE_LATEXDO_EXTENSION_CATALOG_URL?.trim() ||
  "https://latexdo.org/store/extensions/catalog.json";
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

const defaultProofreadingSettings: ProofreadingSettings = {
  enabled: false,
  serverUrl: "https://api.languagetool.org/v2/check",
  language: "auto",
  picky: false,
  motherTongue: "",
};

const defaultSpellCheckerSettings: SpellCheckerSettings = {
  enabled: true,
  languages: ["en-US"],
  customWords: [],
  availableLanguages: ["en-US", "en-GB"],
  usesSystemLanguage: false,
};

function readStore(): BrowserStore {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(browserStoreKey) ?? "",
    ) as Partial<BrowserStore>;
    return {
      currentProjectId:
        typeof parsed.currentProjectId === "string" ? parsed.currentProjectId : null,
      projects: Array.isArray(parsed.projects)
        ? parsed.projects.filter(isProjectRecord)
        : [],
      proofreadingSettings: isProofreadingSettings(parsed.proofreadingSettings)
        ? parsed.proofreadingSettings
        : undefined,
      spellCheckerSettings: isSpellCheckerSettings(parsed.spellCheckerSettings)
        ? parsed.spellCheckerSettings
        : undefined,
    };
  } catch {
    return {
      currentProjectId: null,
      projects: [],
    };
  }
}

function writeStore(store: BrowserStore): void {
  window.localStorage.setItem(browserStoreKey, JSON.stringify(store));
}

function isProjectRecord(value: unknown): value is BrowserProjectRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<BrowserProjectRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.rootPath === "string" &&
    typeof record.files === "object" &&
    record.files !== null &&
    !Array.isArray(record.files) &&
    Array.isArray(record.folders)
  );
}

function isProofreadingSettings(value: unknown): value is ProofreadingSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as Partial<ProofreadingSettings>;
  return (
    typeof settings.enabled === "boolean" &&
    typeof settings.serverUrl === "string" &&
    typeof settings.language === "string" &&
    typeof settings.picky === "boolean" &&
    typeof settings.motherTongue === "string"
  );
}

function isSpellCheckerSettings(value: unknown): value is SpellCheckerSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as Partial<SpellCheckerSettings>;
  return (
    typeof settings.enabled === "boolean" &&
    Array.isArray(settings.languages) &&
    Array.isArray(settings.customWords) &&
    Array.isArray(settings.availableLanguages) &&
    typeof settings.usesSystemLanguage === "boolean"
  );
}

function makeId(): string {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random()}`;
}

function normalizeRelativePath(relativePath: string): string {
  const normalized = relativePath
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/(^|\/)\.\//g, "$1")
    .replace(/\/+$/, "");

  if (
    !normalized ||
    normalized === "." ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new Error("Use a relative path inside the browser workspace.");
  }

  return normalized;
}

function parentPath(relativePath: string): string {
  const parts = relativePath.split("/");
  parts.pop();
  return parts.join("/");
}

function baseName(relativePath: string): string {
  return relativePath.split("/").pop() ?? relativePath;
}

function projectToOpenProject(project: BrowserProjectRecord): OpenProject {
  return {
    id: project.id,
    rootPath: project.rootPath,
    name: project.name,
  };
}

function starterContent(relativePath: string): string {
  if (baseName(relativePath) === "main.tex") {
    return starterDocument;
  }
  if (relativePath.endsWith(".bib")) {
    return "% Add BibTeX entries here.\n";
  }
  return "";
}

function createProjectRecord(
  folderName = "LatexDo Browser Project",
): BrowserProjectRecord {
  const id = makeId();
  const name = folderName.trim() || "LatexDo Browser Project";
  return {
    id,
    name,
    rootPath: `browser://latexdo/${id}/${encodeURIComponent(name)}`,
    files: {
      "main.tex": starterDocument,
    },
    folders: [],
    updatedAt: Date.now(),
  };
}

function currentOrNewProject(store: BrowserStore): BrowserProjectRecord {
  const current =
    store.projects.find((project) => project.id === store.currentProjectId) ??
    store.projects[0];

  if (current) {
    store.currentProjectId = current.id;
    return current;
  }

  const project = createProjectRecord();
  store.projects.push(project);
  store.currentProjectId = project.id;
  return project;
}

function findProject(store: BrowserStore, projectId: string): BrowserProjectRecord {
  const project = store.projects.find((item) => item.id === projectId);
  if (!project) {
    throw new Error("The requested browser workspace is not open.");
  }
  return project;
}

function updateProject(
  projectId: string,
  update: (project: BrowserProjectRecord) => void,
): BrowserProjectRecord {
  const store = readStore();
  const project = findProject(store, projectId);
  update(project);
  project.updatedAt = Date.now();
  store.currentProjectId = project.id;
  writeStore(store);
  return project;
}

function allFolderPaths(project: BrowserProjectRecord): string[] {
  const folders = new Set(project.folders.map(normalizeRelativePath));

  Object.keys(project.files).forEach((filePath) => {
    const parts = filePath.split("/");
    parts.pop();
    let current = "";
    parts.forEach((part) => {
      current = current ? `${current}/${part}` : part;
      folders.add(current);
    });
  });

  return [...folders].sort((left, right) => left.localeCompare(right));
}

function ensureDirectoryNode(
  root: BrowserTreeNode,
  relativePath: string,
): BrowserTreeNode {
  let current = root;
  let currentPath = "";

  relativePath.split("/").forEach((part) => {
    if (!part) return;
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    const existing = current.children.get(part);
    if (existing) {
      current = existing;
      return;
    }

    const node: BrowserTreeNode = {
      name: part,
      relativePath: currentPath,
      type: "directory",
      children: new Map(),
    };
    current.children.set(part, node);
    current = node;
  });

  return current;
}

function treeNodeToEntry(
  project: BrowserProjectRecord,
  node: BrowserTreeNode,
): ProjectEntry {
  const path = `${project.rootPath}/${node.relativePath}`;
  if (node.type === "file") {
    return {
      name: node.name,
      path,
      relativePath: node.relativePath,
      type: "file",
    };
  }

  return {
    name: node.name,
    path,
    relativePath: node.relativePath,
    type: "directory",
    children: sortedEntries(project, node),
  };
}

function sortedEntries(
  project: BrowserProjectRecord,
  node: BrowserTreeNode,
): ProjectEntry[] {
  return [...node.children.values()]
    .sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "directory" ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    })
    .map((child) => treeNodeToEntry(project, child));
}

function listProjectEntries(project: BrowserProjectRecord): ProjectEntry[] {
  const root: BrowserTreeNode = {
    name: project.name,
    relativePath: "",
    type: "directory",
    children: new Map(),
  };

  allFolderPaths(project)
    .filter((folder) => !folder.startsWith(".latexdo"))
    .forEach((folder) => ensureDirectoryNode(root, folder));

  Object.keys(project.files)
    .filter((filePath) => !filePath.startsWith(".latexdo/"))
    .forEach((filePath) => {
      const directory = parentPath(filePath);
      const parent = directory ? ensureDirectoryNode(root, directory) : root;
      parent.children.set(baseName(filePath), {
        name: baseName(filePath),
        relativePath: filePath,
        type: "file",
        children: new Map(),
      });
    });

  return sortedEntries(project, root);
}

function browserUnavailable(feature: string): Error {
  return new Error(
    `${feature} is available in the desktop app. The web editor keeps your source files in this browser.`,
  );
}

function emptyGitStatus(): GitStatusSummary {
  return {
    isRepo: false,
    branch: null,
    entries: [],
    error: "Git actions are available in the desktop app.",
  };
}

function unavailableGitDiffSession(
  relativePath: string,
  originalLabel = "Index",
  modifiedLabel = "Working Tree",
): GitDiffSession {
  return {
    id: `browser-git-diff:${relativePath}:${originalLabel}:${modifiedLabel}`,
    relativePath,
    originalRef: { kind: "empty" },
    modifiedRef: { kind: "empty" },
    originalContent: "",
    modifiedContent: "",
    originalLabel,
    modifiedLabel,
    status: "modified",
    language: "plaintext",
    message: "Git diff is available in the desktop app.",
  };
}

function createBrowserLatexDoApi(): BrowserLatexDoApi {
  const api: BrowserLatexDoApi = {
    runtime: "browser",

    async reportRendererIssue(_payload) {},

    async openProject() {
      const store = readStore();
      const project = currentOrNewProject(store);
      writeStore(store);
      return projectToOpenProject(project);
    },

    async reopenLastProject() {
      return null;
    },
    async restoreCloudProject() {
      return null;
    },

    async createProject(options) {
      const store = readStore();
      const project = createProjectRecord(options?.folderName);
      store.projects = [project, ...store.projects];
      store.currentProjectId = project.id;
      writeStore(store);
      return projectToOpenProject(project);
    },

    async importOverleafProject() {
      throw browserUnavailable("Overleaf project import");
    },

    async createResearchSpace() {
      const store = readStore();
      const project = createProjectRecord("Research Space");
      store.projects = [project, ...store.projects];
      store.currentProjectId = project.id;
      writeStore(store);
      return projectToOpenProject(project);
    },

    async listProject(projectId, _options) {
      const store = readStore();
      return listProjectEntries(findProject(store, projectId));
    },

    async readFile(projectId, relativePath) {
      const store = readStore();
      const project = findProject(store, projectId);
      const filePath = normalizeRelativePath(relativePath);
      const content = project.files[filePath];
      if (content === undefined) {
        throw new Error(`"${filePath}" does not exist in this browser workspace.`);
      }
      return content;
    },

    async readAsset(projectId, relativePath) {
      const store = readStore();
      const project = findProject(store, projectId);
      const filePath = normalizeRelativePath(relativePath);
      const content = project.files[filePath];
      if (content === undefined) {
        throw new Error(`"${filePath}" does not exist in this browser workspace.`);
      }
      return new TextEncoder().encode(content);
    },

    async writeFile(projectId, relativePath, content) {
      updateProject(projectId, (project) => {
        const filePath = normalizeRelativePath(relativePath);
        project.files[filePath] = content;
      });
    },

    async fileExists(projectId, relativePath) {
      const store = readStore();
      const project = findProject(store, projectId);
      const filePath = normalizeRelativePath(relativePath);
      return (
        project.files[filePath] !== undefined ||
        allFolderPaths(project).includes(filePath)
      );
    },

    async createFile(projectId, relativePath) {
      const filePath = normalizeRelativePath(relativePath);
      updateProject(projectId, (project) => {
        if (project.files[filePath] === undefined) {
          project.files[filePath] = starterContent(filePath);
        }
      });
      return filePath;
    },

    async createFolder(projectId, relativePath) {
      const folderPath = normalizeRelativePath(relativePath);
      updateProject(projectId, (project) => {
        const parent = parentPath(folderPath);
        if (parent && !allFolderPaths(project).includes(parent)) {
          throw new Error("Create the parent folder first.");
        }
        project.folders = [...new Set([...project.folders, folderPath])];
      });
      return folderPath;
    },

    getDroppedFilePaths() {
      return [];
    },

    async importExternalFiles() {
      throw browserUnavailable("File drop import");
    },

    async chooseImportExternalFiles() {
      throw browserUnavailable("Tree file import");
    },

    async importDocx() {
      throw browserUnavailable("DOCX import");
    },

    async importMarkdown() {
      throw browserUnavailable("Markdown import");
    },

    async importPdf() {
      throw browserUnavailable("PDF import");
    },

    async moveEntry(projectId, fromRelativePath, toRelativePath) {
      const fromPath = normalizeRelativePath(fromRelativePath);
      const toPath = normalizeRelativePath(toRelativePath);
      updateProject(projectId, (project) => {
        if (project.files[toPath] !== undefined || project.folders.includes(toPath)) {
          throw new Error(`"${toPath}" already exists.`);
        }

        if (project.files[fromPath] !== undefined) {
          project.files[toPath] = project.files[fromPath];
          delete project.files[fromPath];
          return;
        }

        if (!project.folders.includes(fromPath)) {
          throw new Error(`"${fromPath}" does not exist.`);
        }
        if (toPath.startsWith(`${fromPath}/`)) {
          throw new Error("Cannot move a folder into itself.");
        }

        project.folders = project.folders.map((folder) =>
          folder === fromPath || folder.startsWith(`${fromPath}/`)
            ? `${toPath}${folder.slice(fromPath.length)}`
            : folder,
        );
        Object.entries(project.files).forEach(([filePath, content]) => {
          if (filePath.startsWith(`${fromPath}/`)) {
            project.files[`${toPath}${filePath.slice(fromPath.length)}`] = content;
            delete project.files[filePath];
          }
        });
      });
      return toPath;
    },

    async copyEntry(projectId, fromRelativePath, toRelativePath) {
      const fromPath = normalizeRelativePath(fromRelativePath);
      const toPath = normalizeRelativePath(toRelativePath);
      updateProject(projectId, (project) => {
        if (project.files[toPath] !== undefined || project.folders.includes(toPath)) {
          throw new Error(`"${toPath}" already exists.`);
        }
        if (project.files[fromPath] !== undefined) {
          project.files[toPath] = project.files[fromPath];
          return;
        }
        if (!project.folders.includes(fromPath)) {
          throw new Error(`"${fromPath}" does not exist.`);
        }
        if (toPath.startsWith(`${fromPath}/`)) {
          throw new Error("Cannot copy a folder into itself.");
        }
        const copiedFolders = project.folders
          .filter((folder) => folder === fromPath || folder.startsWith(`${fromPath}/`))
          .map((folder) => `${toPath}${folder.slice(fromPath.length)}`);
        project.folders.push(...copiedFolders);
        Object.entries(project.files).forEach(([filePath, content]) => {
          if (filePath.startsWith(`${fromPath}/`)) {
            project.files[`${toPath}${filePath.slice(fromPath.length)}`] = content;
          }
        });
      });
      return toPath;
    },

    async trashEntry(projectId, relativePath) {
      const targetPath = normalizeRelativePath(relativePath);
      updateProject(projectId, (project) => {
        if (project.files[targetPath] !== undefined) {
          delete project.files[targetPath];
          return;
        }
        if (!project.folders.includes(targetPath)) {
          throw new Error(`"${targetPath}" does not exist.`);
        }
        project.folders = project.folders.filter(
          (folder) => folder !== targetPath && !folder.startsWith(`${targetPath}/`),
        );
        Object.keys(project.files).forEach((filePath) => {
          if (filePath.startsWith(`${targetPath}/`)) delete project.files[filePath];
        });
      });
    },

    async getGitStatus() {
      return emptyGitStatus();
    },

    async getCollaborationState() {
      return {
        enabled: false,
        users: [],
      };
    },

    async createCollaborationLink() {
      throw browserUnavailable("Cloud collaboration");
    },

    async rotateCollaborationLink() {
      throw browserUnavailable("Cloud collaboration");
    },

    async joinCollaboration() {
      throw browserUnavailable("Cloud collaboration");
    },

    async stopCollaboration() {
      return { enabled: false, users: [] };
    },

    async setCollaborationApproval() {
      throw browserUnavailable("Cloud collaboration");
    },

    async resolveCollaborationRequest() {
      throw browserUnavailable("Cloud collaboration");
    },

    async saveSharedProjectToFolder() {
      return { saved: false };
    },

    async openSharedProjectFolder() {
      return null;
    },

    onHostSharingChanged() {
      return () => undefined;
    },

    usesCollaborationBridge() {
      return false;
    },

    hostsProjectsLocally: false,

    connectCollaborationSocket() {
      throw browserUnavailable("Cloud collaboration");
    },

    async updateCollaborationPresence() {
      return {
        enabled: false,
        users: [],
      };
    },

    async getCollaborationPermissions() {
      throw browserUnavailable("Cloud collaboration permissions");
    },

    async updateCollaborationPermission() {
      throw browserUnavailable("Cloud collaboration permissions");
    },

    async removeCollaborator() {
      throw browserUnavailable("Cloud collaboration permissions");
    },

    async isProjectAdmin() {
      return false;
    },

    async stageGitFile() {
      throw browserUnavailable("Git staging");
    },

    async unstageGitFile() {
      throw browserUnavailable("Git unstaging");
    },

    async commitGit() {
      throw browserUnavailable("Git commits");
    },

    async getGitRepositoryInfo() {
      throw browserUnavailable("Git");
    },

    async runGitAction() {
      throw browserUnavailable("Git");
    },

    async getGitGraph() {
      return { scope: "repo" as const, target: null, commits: [], hasMore: false };
    },

    async getGitDiffForCommitMessage() {
      throw browserUnavailable("Git");
    },

    async getGitDiff(_projectId, relativePath): Promise<GitDiffPreview> {
      return {
        path: relativePath,
        diff: "Git diff is available in the desktop app.",
      };
    },

    async discardGitFile(): Promise<GitDiscardResult> {
      return {
        discarded: false,
      };
    },

    async stageAllGit() {
      throw browserUnavailable("Git staging");
    },

    async unstageAllGit() {
      throw browserUnavailable("Git unstaging");
    },

    async discardAllGit(): Promise<GitDiscardResult> {
      return {
        discarded: false,
      };
    },

    async getGitEditorDiff(_projectId, relativePath, area): Promise<GitDiffSession> {
      return area === "staged"
        ? unavailableGitDiffSession(relativePath, "HEAD", "Index")
        : unavailableGitDiffSession(relativePath);
    },

    async getGitHistory(): Promise<GitHistorySummary> {
      return {
        scope: "repo",
        target: null,
        commits: [],
      };
    },

    async getGitCommitDetails(hash) {
      return {
        hash,
        shortHash: hash.slice(0, 7),
        summary: "Git history is available in the desktop app.",
        body: "",
        authorName: "",
        authorEmail: "",
        authoredAt: "",
        committerName: "",
        committerEmail: "",
        committedAt: "",
        parents: [],
        refs: [],
        changedFiles: [],
      };
    },

    async getGitCommitFileDiff(_projectId, relativePath): Promise<GitDiffSession> {
      return unavailableGitDiffSession(relativePath, "Parent", "Commit");
    },

    async getGitBlame() {
      return [];
    },

    async revealGitFile() {
      throw browserUnavailable("Reveal file");
    },

    onGitChanged() {
      return () => {};
    },

    async checkForUpdates() {
      return {
        currentVersion: appVersion,
        latestVersion: null,
        releaseUrl: "https://latexdo.org/downloads/",
        updateAvailable: false,
        error: "Update checks are available in the desktop app.",
      };
    },

    async updateNow() {
      await api.openReleasesPage("https://latexdo.org/downloads/");
      return {
        currentVersion: appVersion,
        latestVersion: null,
        releaseUrl: "https://latexdo.org/downloads/",
        updateAvailable: false,
        installerPath: null,
        opened: false,
        error: "Install updates from the desktop app.",
      };
    },

    async lastUpdateStatus() {
      return {
        status: "none",
        currentVersion: appVersion,
        expectedVersion: null,
      } as const;
    },

    async getWhatsNew() {
      return {
        fromVersion: null,
        toVersion: appVersion,
        releases: [],
        shouldPresent: false,
        notesAvailable: false,
      } as const;
    },

    async markWhatsNewPresented() {
      return { ok: true } as const;
    },

    async openReleaseNotesPage() {
      await api.openReleasesPage("https://latexdo.org/downloads/");
      return { opened: true } as const;
    },

    onWhatsNewOpen() {
      return () => {};
    },

    onUpdateProgress() {
      return () => {};
    },

    onCompileProgress() {
      return () => {};
    },

    async openReleasesPage(releaseUrl) {
      window.open(
        releaseUrl || "https://latexdo.org/downloads/",
        "_blank",
        "noopener,noreferrer",
      );
    },

    async openExternalUrl(url) {
      window.open(url, "_blank", "noopener,noreferrer");
    },

    async fetchScholarlyJson(url) {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Scholarly source returned HTTP ${response.status}`);
      }
      return (await response.json()) as unknown;
    },

    fetchOrcidProfile: fetchOrcidProfileDirect,

    async fetchExtensionCatalog() {
      const response = await fetch(extensionStoreCatalogUrl, {
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Store catalog returned HTTP ${response.status}`);
      }
      return (await response.json()) as unknown;
    },

    async getSpellCheckerSettings() {
      return readStore().spellCheckerSettings ?? defaultSpellCheckerSettings;
    },

    async updateSpellCheckerSettings(settings) {
      const store = readStore();
      store.spellCheckerSettings = settings;
      writeStore(store);
      return settings;
    },

    async getProofreadingSettings() {
      return readStore().proofreadingSettings ?? defaultProofreadingSettings;
    },

    async updateProofreadingSettings(settings) {
      const store = readStore();
      store.proofreadingSettings = settings;
      writeStore(store);
      return settings;
    },

    async proofreadDocument(_relativePath, content, _options) {
      return {
        diagnostics: [],
        output:
          "Browser proofreading is disabled by default. Configure a LanguageTool-compatible server to use it.",
        checkedTextLength: content.length,
      };
    },

    async compile(request) {
      return {
        ok: false,
        durationMs: 0,
        output:
          "The web editor stores and edits LaTeX in your browser. Install the desktop app to run a local TeX engine and render PDFs.",
        diagnostics: [
          {
            file: request.rootFile,
            line: 1,
            column: 1,
            severity: "warning",
            message: "Local LaTeX compilation is available in the desktop app.",
            detail:
              "You can keep editing source in the web editor, then use the desktop app for latexmk, SyncTeX, terminal access, and PDF export.",
            source: "latex",
          },
        ],
        error: "Desktop app required for local PDF compilation.",
      };
    },

    async cancelCompile(_projectId) {
      return false;
    },

    async compileAsymptote(request) {
      return {
        ok: false,
        durationMs: 0,
        output:
          "The web editor stores and edits Asymptote source in your browser. Install the desktop app to run the local Asymptote compiler and render PDFs.",
        diagnostics: [
          {
            file: request.relativePath,
            line: 1,
            column: 1,
            severity: "warning",
            message: "Local Asymptote compilation is available in the desktop app.",
            detail:
              "You can keep editing .asy files in the web editor, then use the desktop app for one-click Asymptote PDF compilation.",
            source: "latex",
          },
        ],
        error: "Desktop app required for local Asymptote compilation.",
      };
    },

    async readPdf() {
      return new Uint8Array();
    },

    async collectGarbage() {
      throw browserUnavailable("Disk space cleanup");
    },

    async forwardSyncTex() {
      return null;
    },

    async backwardSyncTex() {
      return null;
    },

    onOpenSpellCheckerSettings: () => () => {},
    onSpellCheckerSettingsChanged: () => () => {},
    onOpenProjectMenu: () => () => {},
    onCreateFileMenu: () => () => {},
    onCreateFolderMenu: () => () => {},
    onImportDocxMenu: () => () => {},
    onImportMarkdownMenu: () => () => {},
    onImportPdfMenu: () => () => {},
    onCloseTabMenu: () => () => {},
  };

  return api;
}

function createBrowserTerminalApi(): TerminalApi {
  const dataListeners = new Set<(payload: { id: number; data: string }) => void>();
  const exitListeners = new Set<(payload: { id: number; exitCode: number }) => void>();
  let nextTerminalId = 1;

  const emitData = (id: number, data: string) => {
    dataListeners.forEach((listener) => listener({ id, data }));
  };

  return {
    async create() {
      const id = nextTerminalId;
      nextTerminalId += 1;
      window.setTimeout(() => {
        emitData(
          id,
          "LatexDo web terminal placeholder\r\nInstall the desktop app for a real project shell.\r\n",
        );
      }, 50);
      return {
        id,
        mode: "pipe",
      };
    },
    write(id, data) {
      const command = data.trim();
      if (command) {
        emitData(
          id,
          `$ ${command}\r\nDesktop terminal access is unavailable in the web editor.\r\n`,
        );
      }
    },
    resize() {},
    dispose(id) {
      exitListeners.forEach((listener) => listener({ id, exitCode: 0 }));
    },
    onData(callback) {
      dataListeners.add(callback);
      return () => dataListeners.delete(callback);
    },
    onExit(callback) {
      exitListeners.add(callback);
      return () => exitListeners.delete(callback);
    },
  };
}

export function installBrowserApis(): void {
  if (!window.latexdo) {
    window.latexdo = createBrowserLatexDoApi();
  }
  if (!window.terminalApi) {
    window.terminalApi = createBrowserTerminalApi();
  }
}
