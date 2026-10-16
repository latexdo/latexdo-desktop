import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  AsymptoteCompileRequest,
  CompileRequest,
  CompileResult,
  CollaborationJoinRequest,
  CollaborationState,
  CollaboratorPermission,
  CollaboratorRole,
  CompileProgressPayload,
  CreateProjectOptions,
  DocxImportResult,
  MarkdownImportResult,
  PdfImportResult,
  GitBlameLine,
  GitChangedEvent,
  GitCommitDetails,
  GitDiscardResult,
  GitDiffSession,
  GitDiffPreview,
  GitHistorySummary,
  GitRevisionRef,
  GitStatusSummary,
  HostSharingStatus,
  ImportedProjectEntry,
  OpenProject,
  OrcidProfileResult,
  PermissionUpdate,
  ProofreadingResult,
  ProofreadingRequestOptions,
  ProofreadingSettings,
  ProjectEntry,
  ProjectListOptions,
  RendererDiagnosticPayload,
  SaveSharedProjectResult,
  SpellCheckerSettings,
  StartCollaborationOptions,
  SyncTexPdfLocation,
  SyncTexSourceLocation,
  UpdateCheckResult,
  UpdateDownloadProgress,
  UpdateInstallResult,
  UpdateAttemptResolution,
  WhatsNewResult,
} from "./types.js" with { "resolution-mode": "import" };
import type {
  GitAction,
  GitActionResult,
  GitRepositoryInfo,
} from "./gitActions.js" with { "resolution-mode": "import" };
import type { GarbageCollectionStats } from "./garbageCollector.js" with {
  "resolution-mode": "import",
};

// A self-hosted collaboration server (see collaborations/DEPLOY.md), if one is
// configured. Without one, every edition shares a project straight from this
// computer: the main process hosts the backend and guests connect to it. See
// electron/peerCollab.ts.
const collaborationApiBaseUrl = process.env.VITE_LATEXDO_API_BASE_URL?.trim() ?? "";
const hostedEditorUrl =
  process.env.VITE_LATEXDO_HOSTED_EDITOR_URL?.trim() ||
  process.env.LATEXDO_HOSTED_EDITOR_URL?.trim() ||
  collaborationApiBaseUrl;
const hostsProjectsLocally = !collaborationApiBaseUrl;
// Keep in sync with electron/peerInvite.ts; a sandboxed preload cannot import it.
const localHostOrigin = "latexdo-host://local";
const peerInvitePrefix = "latexdo-invite:";
const cloudProjectOriginsKey = "latexdo.cloud.projectOrigins";
const peerRestoreTimeoutMs = 5_000;
const cloudSessionKey = "latexdo.cloud.session";
const cloudClientKey = "latexdo.cloud.client";
const cloudClientNameKey = "latexdo.cloud.clientName";
const cloudShareTokensKey = "latexdo.cloud.shareTokens";
const cloudActiveProjectKey = "latexdo.cloud.activeProject";
const cloudRequestTimeoutMs = 15_000;
const cloudUploadTimeoutMs = 60_000;
const cloudCompileTimeoutMs = 75_000;
const maxCloudFileBytes = 2 * 1024 * 1024;
const maxCloudProjectBytes = 20 * 1024 * 1024;
const maxCloudProjectFiles = 500;
const cloudProjectIds = new Set<string>();

class CloudApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "CloudApiError";
  }
}

// Projects shared from this computer and still reachable in this app session.
const liveHostedProjectIds = new Set<string>();

const cloudCompileControllers = new Map<string, AbortController>();

function storageGet(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Local storage is best-effort in the isolated preload world.
  }
}

function storageRemove(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // Local storage is best-effort in the isolated preload world.
  }
}

function cloudClientName(): string {
  return (storageGet(cloudClientNameKey) ?? "").trim().slice(0, 80);
}

function storageReadOrCreate(key: string, create: () => string): string {
  const existing = storageGet(key)?.trim();
  if (existing) return existing;
  const created = create();
  storageSet(key, created);
  return created;
}

function cloudSessionId(): string {
  return storageReadOrCreate(cloudSessionKey, () => `session-${crypto.randomUUID()}`);
}

function cloudClientId(): string {
  return storageReadOrCreate(cloudClientKey, () => `client-${crypto.randomUUID()}`);
}

function cloudShareTokens(): Record<string, string> {
  try {
    const parsed = JSON.parse(storageGet(cloudShareTokensKey) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

function cloudShareTokenForProject(projectId: string): string | undefined {
  return cloudShareTokens()[projectId];
}

function rememberCloudShareToken(projectId: string, token: string): void {
  storageSet(
    cloudShareTokensKey,
    JSON.stringify({ ...cloudShareTokens(), [projectId]: token }),
  );
}

function forgetCloudShareToken(projectId: string): void {
  const tokens = cloudShareTokens();
  if (!Object.hasOwn(tokens, projectId)) return;
  delete tokens[projectId];
  storageSet(cloudShareTokensKey, JSON.stringify(tokens));
}

function cloudProjectOrigins(): Record<string, string> {
  try {
    const parsed = JSON.parse(storageGet(cloudProjectOriginsKey) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

/** The backend that serves a shared project: a host, or the configured server. */
function cloudOriginForProject(projectId: string): string {
  const origins = cloudProjectOrigins();
  const origin = Object.hasOwn(origins, projectId) ? origins[projectId] : undefined;
  return typeof origin === "string" && origin ? origin : collaborationApiBaseUrl;
}

function markCloudProject(projectId: string, token?: string, origin?: string): void {
  cloudProjectIds.add(projectId);
  storageSet(cloudActiveProjectKey, projectId);
  if (token) {
    rememberCloudShareToken(projectId, token);
  }
  if (origin && origin !== cloudOriginForProject(projectId)) {
    storageSet(
      cloudProjectOriginsKey,
      JSON.stringify({ ...cloudProjectOrigins(), [projectId]: origin }),
    );
  }
}

// Every collaboration path names either its project or its share token, which
// is enough to tell which backend the request belongs to.
function cloudOriginForPath(path: string): string {
  const safeDecode = (value: string): string => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  const projectId = /^\/api\/projects\/([^/?]+)/.exec(path)?.[1];
  if (projectId) return cloudOriginForProject(safeDecode(projectId));
  const shareToken = /^\/api\/shares\/([^/?]+)/.exec(path)?.[1];
  if (shareToken) {
    const token = safeDecode(shareToken);
    const owner = Object.entries(cloudShareTokens()).find(
      ([, candidate]) => candidate === token,
    );
    if (owner) return cloudOriginForProject(owner[0]);
  }
  return collaborationApiBaseUrl;
}

function usesCollaborationBridge(origin: string): boolean {
  return origin !== collaborationApiBaseUrl;
}

function ipcErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}

function looksLikePeerInvite(input: string): boolean {
  return input.replace(/\s+/g, "").startsWith(peerInvitePrefix);
}

function cloudProjectFromSummary(project: { id: string; name: string }): OpenProject {
  return { id: project.id, name: project.name, rootPath: "" };
}

function isCloudProject(projectId: string): boolean {
  return (
    cloudProjectIds.has(projectId) ||
    projectId.startsWith("project_") ||
    projectId.startsWith("session_")
  );
}

const desktopAssetFileExtensions = new Set([".png", ".jpg", ".jpeg", ".svg", ".pdf"]);

function isSafeDesktopProjectId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function isSafeDesktopRelativePath(
  value: unknown,
  allowedExtensions?: ReadonlySet<string>,
): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.replaceAll("\\", "/").replace(/\/+/g, "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    /^[a-z][a-z0-9+.-]*:/i.test(normalized) ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return false;
  }

  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment === ".git" ||
        segment === "node_modules",
    )
  ) {
    return false;
  }

  if (!allowedExtensions) return true;
  const extensionIndex = normalized.lastIndexOf(".");
  const extension =
    extensionIndex >= 0 ? normalized.slice(extensionIndex).toLowerCase() : "";
  return allowedExtensions.has(extension);
}

function invalidDesktopApiInput(action: string): Promise<never> {
  return Promise.reject(new Error(`Invalid desktop API input for ${action}.`));
}

function cloudApiUrl(path: string): string {
  if (!collaborationApiBaseUrl)
    throw new Error("No collaboration server is configured.");
  return new URL(path, collaborationApiBaseUrl).toString();
}

function cloudShareUrl(token: string): string | undefined {
  if (!hostedEditorUrl) return undefined;
  const url = new URL(hostedEditorUrl);
  url.hash = new URLSearchParams({ share: token }).toString();
  return url.toString();
}

// Requests to a host go through the main process, which keeps the page's
// Content-Security-Policy closed to arbitrary origins.
async function peerFetchJson<T>(
  origin: string,
  path: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const signal = options.signal;
  if (signal?.aborted) throw new Error("Cloud request cancelled.");
  let response: { status: number; statusText: string; text: string };
  try {
    response = (await ipcRenderer.invoke("peer:request", {
      origin,
      path,
      method: options.method ?? "GET",
      headers: {
        "content-type": "application/json",
        ...(options.headers as Record<string, string> | undefined),
      },
      body: typeof options.body === "string" ? options.body : undefined,
      timeoutMs,
    })) as { status: number; statusText: string; text: string };
  } catch (error) {
    throw new Error(ipcErrorMessage(error));
  }
  if (signal?.aborted) throw new Error("Cloud request cancelled.");
  if (response.status < 200 || response.status >= 300) {
    let message = `${response.status} ${response.statusText}`.trim();
    let code: string | undefined;
    try {
      const body = JSON.parse(response.text) as { error?: string; code?: string };
      message = body.error || message;
      code = typeof body.code === "string" ? body.code : undefined;
    } catch {
      // Keep the HTTP status fallback.
    }
    throw new CloudApiError(response.status, message, code);
  }
  return (response.text ? JSON.parse(response.text) : undefined) as T;
}

async function cloudFetchJson<T>(
  path: string,
  options: RequestInit,
  timeoutMs = cloudRequestTimeoutMs,
  origin = cloudOriginForPath(path),
): Promise<T> {
  if (usesCollaborationBridge(origin)) {
    return peerFetchJson<T>(origin, path, options, timeoutMs);
  }
  const controller = new AbortController();
  const sourceSignal = options.signal;
  let timedOut = false;
  const abortFromSource = () => controller.abort(sourceSignal?.reason);
  if (sourceSignal?.aborted) {
    throw new Error("Cloud request cancelled.");
  }
  sourceSignal?.addEventListener("abort", abortFromSource, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(cloudApiUrl(path), {
      ...options,
      headers: { "content-type": "application/json", ...options.headers },
      signal: controller.signal,
    });
    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`;
      try {
        const body = (await response.json()) as { error?: string };
        message = body.error || message;
      } catch {
        // Keep the HTTP status fallback.
      }
      throw new CloudApiError(response.status, message);
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  } catch (error) {
    if (timedOut) throw new Error("Cloud request timed out.");
    if (sourceSignal?.aborted) throw new Error("Cloud request cancelled.");
    throw error;
  } finally {
    clearTimeout(timeout);
    sourceSignal?.removeEventListener("abort", abortFromSource);
  }
}

function cloudHeaders(shareToken?: string): Record<string, string> {
  return {
    "x-latexdo-session": cloudSessionId(),
    "x-latexdo-client": cloudClientId(),
    ...(cloudClientName() ? { "x-latexdo-client-name": cloudClientName() } : {}),
    ...(shareToken ? { "x-latexdo-share-token": shareToken } : {}),
  };
}

async function cloudRequestJson<T>(
  path: string,
  options: RequestInit = {},
  shareToken?: string,
  timeoutMs = cloudRequestTimeoutMs,
  origin?: string,
): Promise<T> {
  return cloudFetchJson<T>(
    path,
    {
      ...options,
      headers: {
        ...cloudHeaders(shareToken),
        ...options.headers,
      },
    },
    timeoutMs,
    origin,
  );
}

function filePathQuery(relativePath: string): string {
  return `path=${encodeURIComponent(relativePath)}`;
}

async function normalizeCloudState(
  projectId: string,
  state: CollaborationState,
): Promise<CollaborationState> {
  // The server reports the current invite token; removing someone or resetting
  // the invite changes it, so keep the stored copy in step.
  if (state.token && state.token !== cloudShareTokenForProject(projectId)) {
    rememberCloudShareToken(projectId, state.token);
  }
  const token = state.token ?? cloudShareTokenForProject(projectId);
  const origin = cloudOriginForProject(projectId);
  const normalized: CollaborationState = {
    ...state,
    ...(token ? { token } : {}),
    projectId: state.projectId ?? projectId,
  };
  if (!usesCollaborationBridge(origin)) {
    return {
      ...normalized,
      ...(token ? { shareUrl: state.shareUrl ?? cloudShareUrl(token) } : {}),
    };
  }

  // A project served by someone's computer has no web link: an invite carries
  // the host's current addresses instead.
  const hosted = origin === localHostOrigin;
  const host = hosted
    ? ((await ipcRenderer.invoke("peer:host-status")) as HostSharingStatus)
    : undefined;
  const inviteCode =
    hosted && token && state.enabled
      ? (((await ipcRenderer.invoke("peer:host-invite", token)) as string | null) ??
        undefined)
      : undefined;
  return {
    ...normalized,
    shareUrl: undefined,
    apiBaseUrl: origin,
    hosted,
    ...(host ? { host } : {}),
    ...(inviteCode ? { inviteCode } : {}),
  };
}

function parseShareTokenInput(input: string): string {
  const value = input.trim();
  if (!value) {
    throw new Error("Paste a collaboration token.");
  }
  try {
    const url = new URL(value);
    const fragmentToken = new URLSearchParams(url.hash.replace(/^#/, ""))
      .get("share")
      ?.trim();
    return fragmentToken || url.searchParams.get("share")?.trim() || value;
  } catch {
    return value;
  }
}

function flattenProjectEntries(entries: ProjectEntry[]): ProjectEntry[] {
  const flattened: ProjectEntry[] = [];
  for (const entry of entries) {
    if (entry.limited) continue;
    flattened.push(entry);
    if (entry.children?.length) {
      flattened.push(...flattenProjectEntries(entry.children));
    }
  }
  return flattened;
}

function projectTreeWasLimited(entries: ProjectEntry[]): boolean {
  return entries.some(
    (entry) => Boolean(entry.limited) || projectTreeWasLimited(entry.children ?? []),
  );
}

async function createCloudProject(
  folderName = "LatexDo Shared Project",
  origin = collaborationApiBaseUrl,
) {
  const project = await cloudRequestJson<OpenProject>(
    "/api/projects",
    {
      method: "POST",
      body: JSON.stringify({ folderName }),
    },
    undefined,
    cloudRequestTimeoutMs,
    origin,
  );
  markCloudProject(project.id, undefined, origin);
  return project;
}

async function cloudCreateShare(projectId: string): Promise<CollaborationState> {
  const state = await cloudRequestJson<CollaborationState>(
    `/api/projects/${encodeURIComponent(projectId)}/share`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    cloudShareTokenForProject(projectId),
  );
  if (state.token) {
    markCloudProject(projectId, state.token);
  }
  return normalizeCloudState(projectId, state);
}

async function cloudRotateShare(projectId: string): Promise<CollaborationState> {
  const state = await cloudRequestJson<CollaborationState>(
    `/api/projects/${encodeURIComponent(projectId)}/share/rotate`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    cloudShareTokenForProject(projectId),
  );
  if (state.token) {
    markCloudProject(projectId, state.token);
  }
  return normalizeCloudState(projectId, state);
}

async function openCloudShare(
  tokenOrUrl: string,
  origin = collaborationApiBaseUrl,
  timeoutMs = cloudRequestTimeoutMs,
): Promise<{
  project: OpenProject;
  collaboration: CollaborationState;
}> {
  const token = parseShareTokenInput(tokenOrUrl);
  const opened = await cloudRequestJson<{
    project: OpenProject;
    collaboration: CollaborationState;
  }>(
    `/api/shares/${encodeURIComponent(token)}/open`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    token,
    timeoutMs,
    origin,
  );
  markCloudProject(opened.project.id, token, origin);
  return {
    project: opened.project,
    collaboration: await normalizeCloudState(opened.project.id, opened.collaboration),
  };
}

type JoinCollaborationResult =
  | { project: OpenProject; collaboration: CollaborationState; pending?: undefined }
  | { pending: true; message: string };

async function joinCloudShare(input: string): Promise<JoinCollaborationResult> {
  try {
    if (!looksLikePeerInvite(input)) {
      if (hostsProjectsLocally) {
        throw new Error(
          'Paste the invite you were sent. It starts with "latexdo-invite:".',
        );
      }
      return await openCloudShare(input);
    }
    let resolved: { origin: string; token: string };
    try {
      resolved = (await ipcRenderer.invoke("peer:resolve-invite", input)) as {
        origin: string;
        token: string;
      };
    } catch (error) {
      throw new Error(ipcErrorMessage(error));
    }
    return await openCloudShare(resolved.token, resolved.origin);
  } catch (error) {
    // The owner asked to approve newcomers; the caller keeps knocking.
    if (error instanceof CloudApiError && error.code === "approval-pending") {
      return { pending: true, message: error.message };
    }
    throw error;
  }
}

async function restoreCloudProject(): Promise<OpenProject | null> {
  const activeProjectId = storageGet(cloudActiveProjectKey)?.trim() ?? "";
  if (!activeProjectId) return null;

  const origin = cloudOriginForProject(activeProjectId);
  if (usesCollaborationBridge(origin) && origin !== localHostOrigin) {
    // A project on someone else's computer is only there while they share it.
    // Do not hold the app's startup hostage to a host that has gone offline.
    const hostToken = cloudShareTokenForProject(activeProjectId);
    try {
      if (!hostToken) throw new Error("No invite stored for this project.");
      return (await openCloudShare(hostToken, origin, peerRestoreTimeoutMs)).project;
    } catch {
      storageRemove(cloudActiveProjectKey);
      return null;
    }
  }

  let directory: {
    projects?: Array<{ id?: unknown; name?: unknown; updatedAt?: unknown }>;
  } = {};
  try {
    directory = await cloudRequestJson(
      "/api/projects",
      {},
      undefined,
      cloudRequestTimeoutMs,
      origin,
    );
  } catch {
    // The collaboration backend has no owned-project directory; fall back to
    // reopening the project through its share token below.
  }
  const activeProject = directory.projects?.find(
    (project) => project.id === activeProjectId && typeof project.name === "string",
  );
  if (activeProject && typeof activeProject.id === "string") {
    markCloudProject(activeProject.id, undefined, origin);
    return cloudProjectFromSummary({
      id: activeProject.id,
      name: activeProject.name as string,
    });
  }

  const shareToken = cloudShareTokenForProject(activeProjectId);
  if (!shareToken) {
    storageRemove(cloudActiveProjectKey);
    return null;
  }
  try {
    return (await openCloudShare(shareToken, origin)).project;
  } catch (error) {
    if (error instanceof CloudApiError && [403, 404].includes(error.status)) {
      storageRemove(cloudActiveProjectKey);
      return null;
    }
    throw error;
  }
}

async function uploadLocalProjectToCloud(
  localProjectId: string,
  folderName?: string,
  origin = collaborationApiBaseUrl,
): Promise<OpenProject> {
  const cloudProject = await createCloudProject(folderName, origin);
  const tree = (await ipcRenderer.invoke("project:list", localProjectId, {
    maxDepth: 50,
    maxEntries: 2_000,
  })) as ProjectEntry[];
  if (projectTreeWasLimited(tree)) {
    throw new Error("The local project tree exceeds the cloud upload scan limit.");
  }
  const fileEntries = flattenProjectEntries(tree).filter(
    (entry) => entry.type === "file",
  );
  if (fileEntries.length > maxCloudProjectFiles) {
    throw new Error(`Cloud projects are limited to ${maxCloudProjectFiles} files.`);
  }

  let totalBytes = 0;
  for (const entry of fileEntries) {
    let content: string;
    try {
      content = (await ipcRenderer.invoke(
        "file:read",
        localProjectId,
        entry.relativePath,
      )) as string;
    } catch (error) {
      console.warn(
        `Skipping non-text file while sharing: ${entry.relativePath}`,
        error,
      );
      continue;
    }
    if (content.length > maxCloudFileBytes) {
      throw new Error(`${entry.relativePath} exceeds the cloud file size limit.`);
    }
    totalBytes += content.length;
    if (totalBytes > maxCloudProjectBytes) {
      throw new Error("Cloud projects are limited to 20 MiB.");
    }
    await cloudRequestJson(
      `/api/projects/${encodeURIComponent(cloudProject.id)}/files/content?${filePathQuery(entry.relativePath)}`,
      {
        method: "PUT",
        body: JSON.stringify({ content }),
      },
      undefined,
      cloudUploadTimeoutMs,
    );
  }

  return cloudProject;
}

async function importCloudDocument(
  _projectId: string,
  kind: "docx" | "markdown" | "pdf",
): Promise<DocxImportResult | MarkdownImportResult | PdfImportResult | null> {
  const label = kind === "docx" ? "DOCX" : kind === "pdf" ? "PDF" : "Markdown";
  throw new Error(
    `${label} import is not available for shared cloud projects. Open a local folder to import documents.`,
  );
}

async function compileCloudProject(request: CompileRequest): Promise<CompileResult> {
  cloudCompileControllers.get(request.projectId)?.abort();
  const controller = new AbortController();
  cloudCompileControllers.set(request.projectId, controller);
  try {
    const token = cloudShareTokenForProject(request.projectId);
    const entries = flattenProjectEntries(
      await cloudRequestJson<ProjectEntry[]>(
        `/api/projects/${encodeURIComponent(request.projectId)}/files`,
        { signal: controller.signal },
        token,
      ),
    );

    const files: { relativePath: string; content: string }[] = [];
    for (const entry of entries) {
      if (entry.type !== "file") continue;
      const body = await cloudRequestJson<{ content: string }>(
        `/api/projects/${encodeURIComponent(request.projectId)}/files/content?${filePathQuery(entry.relativePath)}`,
        { signal: controller.signal },
        token,
        cloudCompileTimeoutMs,
      );
      files.push({ relativePath: entry.relativePath, content: body.content });
    }

    return (await ipcRenderer.invoke("latex:compile-cloud", {
      projectId: request.projectId,
      rootFile: request.rootFile,
      engine: request.engine,
      files,
    })) as CompileResult;
  } finally {
    if (cloudCompileControllers.get(request.projectId) === controller) {
      cloudCompileControllers.delete(request.projectId);
    }
  }
}

function cloudUnsupportedCompile(request: CompileRequest): CompileResult {
  return {
    ok: false,
    durationMs: 0,
    output:
      "This is a cloud collaboration project. Local desktop compilation is available for folders opened from disk.",
    diagnostics: [
      {
        file: request.rootFile,
        line: 1,
        column: 1,
        severity: "warning",
        message: "Cloud collaboration project is open.",
        detail:
          "Save a local copy or open a local folder to run the desktop TeX engine.",
        source: "latex",
      },
    ],
    error: "Local compilation is not available for cloud collaboration projects.",
  };
}

function emptyCloudGitStatus(): GitStatusSummary {
  return {
    isRepo: false,
    branch: null,
    entries: [],
    error: "Git actions are not available for cloud collaboration projects.",
  };
}

let nextPeerSocketId = 1;
const peerSocketListeners = new Map<
  number,
  (payload: {
    type?: unknown;
    data?: unknown;
    code?: unknown;
    reason?: unknown;
  }) => void
>();
let peerSocketEventsBound = false;
// Bound on first use so a window that never collaborates carries no listener.
function bindPeerSocketEvents(): void {
  if (peerSocketEventsBound) return;
  peerSocketEventsBound = true;
  ipcRenderer.on("peer:socket-event", (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") return;
    const event = payload as { id?: unknown; type?: unknown };
    if (typeof event.id === "number") peerSocketListeners.get(event.id)?.(event);
  });
}

const api = {
  runtime: "desktop",
  hostsProjectsLocally,
  reportRendererIssue: (payload: RendererDiagnosticPayload): Promise<void> =>
    ipcRenderer.invoke("app:renderer-diagnostic", payload),
  openProject: (): Promise<OpenProject | null> => ipcRenderer.invoke("project:open"),
  reopenLastProject: (): Promise<OpenProject | null> =>
    ipcRenderer.invoke("project:reopen-last"),
  restoreCloudProject,
  createProject: (options?: CreateProjectOptions): Promise<OpenProject | null> =>
    options === undefined
      ? ipcRenderer.invoke("project:create")
      : ipcRenderer.invoke("project:create", options),
  importOverleafProject: (gitUrl: string): Promise<OpenProject | null> =>
    ipcRenderer.invoke("provider:import-overleaf-project", gitUrl),
  createResearchSpace: (): Promise<OpenProject | null> =>
    ipcRenderer.invoke("research-space:create"),
  listProject: (
    projectId: string,
    options?: ProjectListOptions,
  ): Promise<ProjectEntry[]> =>
    isCloudProject(projectId)
      ? cloudRequestJson<ProjectEntry[]>(
          `/api/projects/${encodeURIComponent(projectId)}/files`,
          {},
          cloudShareTokenForProject(projectId),
        )
      : options === undefined
        ? ipcRenderer.invoke("project:list", projectId)
        : ipcRenderer.invoke("project:list", projectId, options),
  readFile: (projectId: string, relativePath: string): Promise<string> =>
    isCloudProject(projectId)
      ? cloudRequestJson<{ content: string }>(
          `/api/projects/${encodeURIComponent(projectId)}/files/content?${filePathQuery(relativePath)}`,
          {},
          cloudShareTokenForProject(projectId),
        ).then((body) => body.content)
      : isSafeDesktopProjectId(projectId) && isSafeDesktopRelativePath(relativePath)
        ? ipcRenderer.invoke("file:read", projectId, relativePath)
        : invalidDesktopApiInput("readFile"),
  readAsset: (projectId: string, relativePath: string): Promise<Uint8Array> =>
    isCloudProject(projectId)
      ? cloudRequestJson<{ content: string }>(
          `/api/projects/${encodeURIComponent(projectId)}/files/content?${filePathQuery(relativePath)}`,
          {},
          cloudShareTokenForProject(projectId),
        ).then((body) => new TextEncoder().encode(body.content))
      : isSafeDesktopProjectId(projectId) &&
          isSafeDesktopRelativePath(relativePath, desktopAssetFileExtensions)
        ? ipcRenderer.invoke("asset:read", projectId, relativePath)
        : invalidDesktopApiInput("readAsset"),
  writeFile: (
    projectId: string,
    relativePath: string,
    content: string,
  ): Promise<void> =>
    isCloudProject(projectId)
      ? cloudRequestJson<void>(
          `/api/projects/${encodeURIComponent(projectId)}/files/content?${filePathQuery(relativePath)}`,
          {
            method: "PUT",
            body: JSON.stringify({ content }),
          },
          cloudShareTokenForProject(projectId),
        )
      : ipcRenderer.invoke("file:write", projectId, relativePath, content),
  fileExists: (projectId: string, relativePath: string): Promise<boolean> =>
    isCloudProject(projectId)
      ? cloudRequestJson<{ exists: boolean }>(
          `/api/projects/${encodeURIComponent(projectId)}/files/exists?${filePathQuery(relativePath)}`,
          {},
          cloudShareTokenForProject(projectId),
        ).then((body) => body.exists)
      : isSafeDesktopProjectId(projectId) && isSafeDesktopRelativePath(relativePath)
        ? ipcRenderer.invoke("file:exists", projectId, relativePath)
        : Promise.resolve(false),
  createFile: (projectId: string, relativePath: string): Promise<string> =>
    isCloudProject(projectId)
      ? cloudRequestJson<{ relativePath: string }>(
          `/api/projects/${encodeURIComponent(projectId)}/files`,
          {
            method: "POST",
            body: JSON.stringify({ relativePath, type: "file" }),
          },
          cloudShareTokenForProject(projectId),
        ).then((body) => body.relativePath)
      : ipcRenderer.invoke("file:create", projectId, relativePath),
  createFolder: (projectId: string, relativePath: string): Promise<string> =>
    isCloudProject(projectId)
      ? cloudRequestJson<{ relativePath: string }>(
          `/api/projects/${encodeURIComponent(projectId)}/files`,
          {
            method: "POST",
            body: JSON.stringify({ relativePath, type: "directory" }),
          },
          cloudShareTokenForProject(projectId),
        ).then((body) => body.relativePath)
      : ipcRenderer.invoke("folder:create", projectId, relativePath),
  getDroppedFilePaths: (files: File[]): string[] =>
    files.map((file) => webUtils.getPathForFile(file)).filter(Boolean),
  importExternalFiles: (
    projectId: string,
    destinationDirectory: string,
    filePaths: string[],
  ): Promise<ImportedProjectEntry[]> =>
    isCloudProject(projectId)
      ? Promise.reject(
          new Error(
            "File and folder drop import is not available for cloud projects. Use DOCX or Markdown import.",
          ),
        )
      : ipcRenderer.invoke(
          "file:import-external",
          projectId,
          destinationDirectory,
          filePaths,
        ),
  chooseImportExternalFiles: (
    projectId: string,
    destinationDirectory: string,
  ): Promise<ImportedProjectEntry[]> =>
    isCloudProject(projectId)
      ? Promise.reject(
          new Error(
            "Tree file import is not available for cloud projects. Use DOCX or Markdown import.",
          ),
        )
      : ipcRenderer.invoke(
          "file:choose-import-external",
          projectId,
          destinationDirectory,
        ),
  importDocx: (projectId?: string): Promise<DocxImportResult | null> =>
    projectId && isCloudProject(projectId)
      ? (importCloudDocument(projectId, "docx") as Promise<DocxImportResult | null>)
      : ipcRenderer.invoke("docx:import", projectId ?? ""),
  importMarkdown: (projectId?: string): Promise<MarkdownImportResult | null> =>
    projectId && isCloudProject(projectId)
      ? (importCloudDocument(
          projectId,
          "markdown",
        ) as Promise<MarkdownImportResult | null>)
      : ipcRenderer.invoke("markdown:import", projectId ?? ""),
  importPdf: (projectId?: string): Promise<PdfImportResult | null> =>
    projectId && isCloudProject(projectId)
      ? (importCloudDocument(projectId, "pdf") as Promise<PdfImportResult | null>)
      : ipcRenderer.invoke("pdf:import", projectId ?? ""),
  moveEntry: (
    projectId: string,
    fromRelativePath: string,
    toRelativePath: string,
  ): Promise<string> =>
    isCloudProject(projectId)
      ? cloudRequestJson<{ relativePath: string }>(
          `/api/projects/${encodeURIComponent(projectId)}/files/move`,
          {
            method: "POST",
            body: JSON.stringify({ fromRelativePath, toRelativePath }),
          },
          cloudShareTokenForProject(projectId),
        ).then((body) => body.relativePath)
      : ipcRenderer.invoke("entry:move", projectId, fromRelativePath, toRelativePath),
  copyEntry: (
    projectId: string,
    fromRelativePath: string,
    toRelativePath: string,
  ): Promise<string> =>
    isCloudProject(projectId)
      ? Promise.reject(
          new Error("Copying files is not available in cloud projects yet."),
        )
      : ipcRenderer.invoke("entry:copy", projectId, fromRelativePath, toRelativePath),
  trashEntry: (projectId: string, relativePath: string): Promise<void> =>
    isCloudProject(projectId)
      ? Promise.reject(
          new Error("Deleting files is not available in cloud projects yet."),
        )
      : ipcRenderer.invoke("entry:trash", projectId, relativePath),
  getGitStatus: (projectId: string): Promise<GitStatusSummary> =>
    isCloudProject(projectId)
      ? Promise.resolve(emptyCloudGitStatus())
      : ipcRenderer.invoke("git:status", projectId),
  getCollaborationState: async (projectId: string): Promise<CollaborationState> => {
    if (!isCloudProject(projectId)) {
      return {
        enabled: false,
        users: [],
      };
    }

    const token = cloudShareTokenForProject(projectId);
    if (token) {
      return cloudRequestJson<CollaborationState>(
        `/api/shares/${encodeURIComponent(token)}/presence`,
        {
          method: "POST",
          body: JSON.stringify({ currentFile: null }),
        },
        token,
      ).then((state) => normalizeCloudState(projectId, state));
    }

    return cloudRequestJson<CollaborationState>(
      `/api/projects/${encodeURIComponent(projectId)}/share`,
    ).then((state) => normalizeCloudState(projectId, state));
  },
  createCollaborationLink: async (
    projectId: string,
    options?: StartCollaborationOptions,
  ): Promise<CollaborationState> => {
    const hostedAlready =
      isCloudProject(projectId) && cloudOriginForProject(projectId) === localHostOrigin;
    if (isCloudProject(projectId) && !hostedAlready) {
      return cloudCreateShare(projectId);
    }
    if (!hostedAlready && !hostsProjectsLocally) {
      const cloudProject = await uploadLocalProjectToCloud(
        projectId,
        options?.projectName,
      );
      return cloudCreateShare(cloudProject.id);
    }

    // Share from this computer. The main process queues the server start ahead
    // of the requests below, so the internet link can come up in the background
    // while the project is copied; its progress arrives through
    // onHostSharingChanged.
    const mode = options?.mode === "local" ? "local" : "internet";
    const starting = ipcRenderer.invoke("peer:host-start", mode) as Promise<unknown>;
    if (mode === "local") {
      await starting.catch((error: unknown) => {
        throw new Error(ipcErrorMessage(error));
      });
    } else {
      void starting.catch(() => undefined);
    }
    let sharedProjectId = projectId;
    if (!hostedAlready) {
      const hostedProject = await uploadLocalProjectToCloud(
        projectId,
        options?.projectName,
        localHostOrigin,
      );
      await ipcRenderer.invoke(
        "peer:host-register-project",
        hostedProject.id,
        projectId,
        options?.projectName ?? "",
      );
      sharedProjectId = hostedProject.id;
    }
    liveHostedProjectIds.add(sharedProjectId);
    return cloudCreateShare(sharedProjectId);
  },
  stopCollaboration: async (projectId: string): Promise<CollaborationState> => {
    if (!isCloudProject(projectId)) {
      return { enabled: false, users: [] };
    }
    const state = await cloudRequestJson<CollaborationState>(
      `/api/projects/${encodeURIComponent(projectId)}/share`,
      { method: "DELETE" },
      cloudShareTokenForProject(projectId),
    );
    forgetCloudShareToken(projectId);
    liveHostedProjectIds.delete(projectId);
    if (
      cloudOriginForProject(projectId) === localHostOrigin &&
      liveHostedProjectIds.size === 0
    ) {
      await ipcRenderer.invoke("peer:host-stop");
    }
    return normalizeCloudState(projectId, { ...state, token: undefined });
  },
  setCollaborationApproval: async (
    projectId: string,
    requireApproval: boolean,
  ): Promise<CollaborationState> => {
    const token = cloudShareTokenForProject(projectId);
    if (!isCloudProject(projectId) || !token) {
      throw new Error("This project has not been shared yet");
    }
    return cloudRequestJson<CollaborationState>(
      `/api/shares/${encodeURIComponent(token)}/approval`,
      { method: "PUT", body: JSON.stringify({ requireApproval }) },
      token,
    ).then((state) => normalizeCloudState(projectId, state));
  },
  resolveCollaborationRequest: async (
    projectId: string,
    clientId: string,
    approve: boolean,
  ): Promise<CollaborationState> => {
    const token = cloudShareTokenForProject(projectId);
    if (!isCloudProject(projectId) || !token) {
      throw new Error("This project has not been shared yet");
    }
    return cloudRequestJson<CollaborationState>(
      `/api/shares/${encodeURIComponent(token)}/pending/${encodeURIComponent(clientId)}`,
      {
        method: "POST",
        body: JSON.stringify({ action: approve ? "approve" : "deny" }),
      },
      token,
    ).then((state) => normalizeCloudState(projectId, state));
  },
  saveSharedProjectToFolder: (projectId: string): Promise<SaveSharedProjectResult> =>
    ipcRenderer.invoke("peer:host-save-project", projectId),
  openSharedProjectFolder: (projectId: string): Promise<OpenProject | null> =>
    ipcRenderer.invoke("peer:host-open-folder", projectId),
  onHostSharingChanged: (callback: (status: HostSharingStatus) => void) => {
    const listener = (_event: unknown, payload: HostSharingStatus) => callback(payload);
    ipcRenderer.on("peer:host-changed", listener);
    return () => {
      ipcRenderer.removeListener("peer:host-changed", listener);
    };
  },
  usesCollaborationBridge,
  // A WebSocket to a host, carried by the main process. Mirrors the small part
  // of the WebSocket API that the collaboration provider uses.
  connectCollaborationSocket: (
    origin: string,
    pathAndQuery: string,
    handlers: {
      onOpen: () => void;
      onMessage: (data: Uint8Array) => void;
      onClose: (code: number, reason: string) => void;
      onError: () => void;
    },
  ): {
    send: (data: Uint8Array) => void;
    close: (code?: number, reason?: string) => void;
  } => {
    bindPeerSocketEvents();
    const socketId = nextPeerSocketId++;
    let finished = false;
    const finish = (code: number, reason: string) => {
      if (finished) return;
      finished = true;
      peerSocketListeners.delete(socketId);
      handlers.onClose(code, reason);
    };
    peerSocketListeners.set(socketId, (payload) => {
      if (payload.type === "open") handlers.onOpen();
      else if (payload.type === "message" && payload.data instanceof Uint8Array) {
        handlers.onMessage(payload.data);
      } else if (payload.type === "error") handlers.onError();
      else if (payload.type === "close") {
        finish(
          typeof payload.code === "number" ? payload.code : 1006,
          typeof payload.reason === "string" ? payload.reason : "",
        );
      }
    });
    const opened = (
      ipcRenderer.invoke(
        "peer:socket-open",
        socketId,
        origin,
        pathAndQuery,
      ) as Promise<unknown>
    ).then(
      () => true,
      () => {
        handlers.onError();
        finish(1006, "");
        return false;
      },
    );
    return {
      send: (data) => {
        if (!finished) ipcRenderer.send("peer:socket-send", socketId, data);
      },
      close: (code, reason) => {
        // Closing must wait for the open to land, or the main process would
        // have no socket to close yet.
        void opened.then((ok) => {
          if (ok) ipcRenderer.send("peer:socket-close", socketId, code, reason);
        });
      },
    };
  },
  rotateCollaborationLink: async (projectId: string): Promise<CollaborationState> => {
    if (!isCloudProject(projectId)) {
      throw new Error("This project has not been shared yet");
    }
    return cloudRotateShare(projectId);
  },
  joinCollaboration: (token: string): Promise<JoinCollaborationResult> =>
    joinCloudShare(token),
  updateCollaborationPresence: async (
    projectId: string,
    currentFile?: string | null,
  ): Promise<CollaborationState> => {
    const token = cloudShareTokenForProject(projectId);
    if (!isCloudProject(projectId) || !token) {
      return {
        enabled: false,
        users: [],
      };
    }

    return cloudRequestJson<CollaborationState>(
      `/api/shares/${encodeURIComponent(token)}/presence`,
      {
        method: "POST",
        body: JSON.stringify({ currentFile: currentFile ?? null }),
      },
      token,
    ).then((state) => normalizeCloudState(projectId, state));
  },
  getCollaborationPermissions: async (
    projectId: string,
  ): Promise<{
    permissions: CollaboratorPermission[];
    isAdmin: boolean;
    currentUserRole: CollaboratorRole;
    requireApproval?: boolean;
    pending?: CollaborationJoinRequest[];
  }> => {
    const token = cloudShareTokenForProject(projectId);
    if (!isCloudProject(projectId) || !token) {
      return { permissions: [], isAdmin: false, currentUserRole: "viewer" };
    }

    try {
      const result = await cloudRequestJson<{
        permissions: CollaboratorPermission[];
        isAdmin: boolean;
        currentUserRole: CollaboratorRole;
        requireApproval?: boolean;
        pending?: CollaborationJoinRequest[];
      }>(`/api/shares/${encodeURIComponent(token)}/permissions`, {}, token);
      return result;
    } catch {
      return { permissions: [], isAdmin: false, currentUserRole: "viewer" };
    }
  },
  updateCollaborationPermission: async (
    projectId: string,
    update: PermissionUpdate,
  ): Promise<CollaboratorPermission> => {
    const token = cloudShareTokenForProject(projectId);
    if (!isCloudProject(projectId) || !token) {
      throw new Error("No share token for this project");
    }

    return cloudRequestJson<CollaboratorPermission>(
      `/api/shares/${encodeURIComponent(token)}/permissions`,
      {
        method: "PUT",
        body: JSON.stringify(update),
      },
      token,
    );
  },
  removeCollaborator: async (
    projectId: string,
    clientIdToRemove: string,
  ): Promise<void> => {
    const token = cloudShareTokenForProject(projectId);
    if (!isCloudProject(projectId) || !token) {
      throw new Error("No share token for this project");
    }

    await cloudRequestJson<void>(
      `/api/shares/${encodeURIComponent(token)}/collaborators/${encodeURIComponent(clientIdToRemove)}`,
      {
        method: "DELETE",
      },
      token,
    );
  },
  isProjectAdmin: async (projectId: string): Promise<boolean> => {
    const token = cloudShareTokenForProject(projectId);
    if (!isCloudProject(projectId) || !token) {
      return false;
    }
    try {
      const result = await cloudRequestJson<{
        isAdmin: boolean;
      }>(`/api/shares/${encodeURIComponent(token)}/permissions`, {}, token);
      return result.isAdmin;
    } catch {
      return false;
    }
  },
  stageGitFile: (projectId: string, relativePath: string): Promise<void> =>
    isCloudProject(projectId)
      ? Promise.reject(
          new Error("Git actions are not available for cloud collaboration projects."),
        )
      : ipcRenderer.invoke("git:stage", projectId, relativePath),
  unstageGitFile: (projectId: string, relativePath: string): Promise<void> =>
    isCloudProject(projectId)
      ? Promise.reject(
          new Error("Git actions are not available for cloud collaboration projects."),
        )
      : ipcRenderer.invoke("git:unstage", projectId, relativePath),
  commitGit: (projectId: string, message: string): Promise<void> =>
    isCloudProject(projectId)
      ? Promise.reject(
          new Error("Git actions are not available for cloud collaboration projects."),
        )
      : ipcRenderer.invoke("git:commit", projectId, message),
  getGitRepositoryInfo: (projectId: string): Promise<GitRepositoryInfo> =>
    isCloudProject(projectId)
      ? Promise.reject(
          new Error("Git actions are not available for cloud collaboration projects."),
        )
      : ipcRenderer.invoke("git:repository-info", projectId),
  runGitAction: (projectId: string, action: GitAction): Promise<GitActionResult> =>
    isCloudProject(projectId)
      ? Promise.reject(
          new Error("Git actions are not available for cloud collaboration projects."),
        )
      : ipcRenderer.invoke("git:action", projectId, action),
  getGitDiff: (projectId: string, relativePath: string): Promise<GitDiffPreview> =>
    isCloudProject(projectId)
      ? Promise.resolve({
          path: relativePath,
          diff: "Git diff is not available for cloud collaboration projects.",
        })
      : ipcRenderer.invoke("git:diff", projectId, relativePath),
  discardGitFile: (
    projectId: string,
    relativePath: string,
  ): Promise<GitDiscardResult> =>
    isCloudProject(projectId)
      ? Promise.resolve({ discarded: false })
      : ipcRenderer.invoke("git:discard", projectId, relativePath),
  stageAllGit: (projectId: string): Promise<void> =>
    isCloudProject(projectId)
      ? Promise.reject(
          new Error("Git actions are not available for cloud collaboration projects."),
        )
      : ipcRenderer.invoke("git:stage-all", projectId),
  unstageAllGit: (projectId: string): Promise<void> =>
    isCloudProject(projectId)
      ? Promise.reject(
          new Error("Git actions are not available for cloud collaboration projects."),
        )
      : ipcRenderer.invoke("git:unstage-all", projectId),
  discardAllGit: (projectId: string): Promise<GitDiscardResult> =>
    isCloudProject(projectId)
      ? Promise.resolve({ discarded: false })
      : ipcRenderer.invoke("git:discard-all", projectId),
  getGitEditorDiff: (
    projectId: string,
    relativePath: string,
    area: "staged" | "changes" = "changes",
  ): Promise<GitDiffSession> =>
    isCloudProject(projectId)
      ? Promise.reject(
          new Error("Git actions are not available for cloud collaboration projects."),
        )
      : ipcRenderer.invoke("git:editor-diff", projectId, relativePath, area),
  getGitHistory: (
    projectId: string,
    relativePath?: string,
  ): Promise<GitHistorySummary> =>
    isCloudProject(projectId)
      ? Promise.resolve({ scope: "repo", target: null, commits: [] })
      : ipcRenderer.invoke("git:history", projectId, relativePath),
  getGitGraph: (
    projectId: string,
    options: { limit: number; refs: string },
  ): Promise<GitHistorySummary & { hasMore: boolean }> =>
    isCloudProject(projectId)
      ? Promise.resolve({ scope: "repo", target: null, commits: [], hasMore: false })
      : ipcRenderer.invoke("git:graph", projectId, options),
  getGitDiffForCommitMessage: (projectId: string): Promise<string> =>
    isCloudProject(projectId)
      ? Promise.reject(
          new Error("Git actions are not available for cloud collaboration projects."),
        )
      : ipcRenderer.invoke("git:diff-for-message", projectId),
  getGitCommitDetails: (projectId: string, hash: string): Promise<GitCommitDetails> =>
    isCloudProject(projectId)
      ? Promise.reject(
          new Error("Git actions are not available for cloud collaboration projects."),
        )
      : ipcRenderer.invoke("git:commit-details", projectId, hash),
  getGitCommitFileDiff: (
    projectId: string,
    relativePath: string,
    hash: string,
    parentHash?: string,
  ): Promise<GitDiffSession> =>
    isCloudProject(projectId)
      ? Promise.reject(
          new Error("Git actions are not available for cloud collaboration projects."),
        )
      : parentHash === undefined
        ? ipcRenderer.invoke("git:commit-file-diff", projectId, relativePath, hash)
        : ipcRenderer.invoke(
            "git:commit-file-diff",
            projectId,
            relativePath,
            hash,
            parentHash,
          ),
  getGitBlame: (
    projectId: string,
    relativePath: string,
    revision: GitRevisionRef,
  ): Promise<GitBlameLine[]> =>
    isCloudProject(projectId)
      ? Promise.resolve([])
      : ipcRenderer.invoke("git:blame", projectId, relativePath, revision),
  revealGitFile: (projectId: string, relativePath: string): Promise<void> =>
    isCloudProject(projectId)
      ? Promise.reject(
          new Error("Reveal file is not available for cloud collaboration projects."),
        )
      : ipcRenderer.invoke("git:reveal-file", projectId, relativePath),
  onGitChanged: (callback: (event: GitChangedEvent) => void) => {
    const listener = (_event: unknown, payload: GitChangedEvent) => callback(payload);
    ipcRenderer.on("git:changed", listener);
    return () => {
      ipcRenderer.removeListener("git:changed", listener);
    };
  },
  checkForUpdates: (): Promise<UpdateCheckResult> =>
    ipcRenderer.invoke("app:check-updates"),
  updateNow: (): Promise<UpdateInstallResult> => ipcRenderer.invoke("app:update-now"),
  lastUpdateStatus: (): Promise<UpdateAttemptResolution> =>
    ipcRenderer.invoke("app:last-update-status"),
  getWhatsNew: (): Promise<WhatsNewResult> => ipcRenderer.invoke("app:whats-new"),
  markWhatsNewPresented: (version: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("app:whats-new-mark-presented", version),
  openReleaseNotesPage: (): Promise<{ opened: boolean }> =>
    ipcRenderer.invoke("app:whats-new-open-notes"),
  onWhatsNewOpen: (callback: () => void) => {
    const listener = (): void => callback();
    ipcRenderer.on("app:open-whats-new", listener);
    return () => {
      ipcRenderer.removeListener("app:open-whats-new", listener);
    };
  },
  onUpdateProgress: (callback: (progress: UpdateDownloadProgress) => void) => {
    const listener = (_event: unknown, payload: UpdateDownloadProgress) =>
      callback(payload);
    ipcRenderer.on("app:update-progress", listener);
    return () => {
      ipcRenderer.removeListener("app:update-progress", listener);
    };
  },
  onCompileProgress: (callback: (payload: CompileProgressPayload) => void) => {
    const listener = (_event: unknown, payload: CompileProgressPayload) =>
      callback(payload);
    ipcRenderer.on("compile:progress", listener);
    return () => {
      ipcRenderer.removeListener("compile:progress", listener);
    };
  },
  openReleasesPage: (releaseUrl?: string): Promise<void> =>
    ipcRenderer.invoke("app:open-releases", releaseUrl),
  openExternalUrl: (url: string): Promise<void> =>
    ipcRenderer.invoke("app:open-external", url),
  fetchScholarlyJson: (url: string): Promise<unknown> =>
    ipcRenderer.invoke("scholarly:fetch-json", url),
  fetchOrcidProfile: (orcidInput: string): Promise<OrcidProfileResult> =>
    ipcRenderer.invoke("orcid:fetch-profile", orcidInput),
  fetchExtensionCatalog: (): Promise<unknown> =>
    ipcRenderer.invoke("extensions:get-catalog"),
  getSpellCheckerSettings: (): Promise<SpellCheckerSettings> =>
    ipcRenderer.invoke("spellchecker:get-settings"),
  updateSpellCheckerSettings: (
    settings: SpellCheckerSettings,
  ): Promise<SpellCheckerSettings> =>
    ipcRenderer.invoke("spellchecker:update-settings", settings),
  getProofreadingSettings: (): Promise<ProofreadingSettings> =>
    ipcRenderer.invoke("proofread:get-settings"),
  updateProofreadingSettings: (
    settings: ProofreadingSettings,
  ): Promise<ProofreadingSettings> =>
    ipcRenderer.invoke("proofread:update-settings", settings),
  proofreadDocument: (
    relativePath: string,
    content: string,
    options?: ProofreadingRequestOptions,
  ): Promise<ProofreadingResult> =>
    options === undefined
      ? ipcRenderer.invoke("proofread:check", relativePath, content)
      : ipcRenderer.invoke("proofread:check", relativePath, content, options),
  compile: (request: CompileRequest): Promise<CompileResult> =>
    isCloudProject(request.projectId)
      ? compileCloudProject(request).catch((error) => ({
          ...cloudUnsupportedCompile(request),
          error:
            error instanceof Error
              ? error.message
              : "Could not compile the shared project locally.",
        }))
      : ipcRenderer.invoke("latex:compile", request),
  cancelCompile: (projectId: string): Promise<boolean> =>
    isCloudProject(projectId)
      ? (async () => {
          const controller = cloudCompileControllers.get(projectId);
          if (controller) {
            cloudCompileControllers.delete(projectId);
            controller.abort();
          }
          const cancelled = await (
            ipcRenderer.invoke("latex:compile-cancel", projectId) as Promise<boolean>
          ).catch(() => false);
          return Boolean(controller) || cancelled;
        })()
      : ipcRenderer.invoke("latex:compile-cancel", projectId),
  compileAsymptote: (request: AsymptoteCompileRequest): Promise<CompileResult> =>
    isCloudProject(request.projectId)
      ? Promise.resolve({
          ok: false,
          durationMs: 0,
          output:
            "This is a cloud collaboration project. Local Asymptote compilation is available for folders opened from disk.",
          diagnostics: [
            {
              file: request.relativePath,
              line: 1,
              column: 1,
              severity: "warning",
              message: "Cloud collaboration project is open.",
              detail:
                "Save a local copy or open a local folder to run the desktop Asymptote compiler.",
              source: "latex",
            },
          ],
          error:
            "Local Asymptote compilation is not available for cloud collaboration projects.",
        })
      : ipcRenderer.invoke("asymptote:compile", request),
  readPdf: (projectId: string, pdfRelativePath: string): Promise<Uint8Array> =>
    ipcRenderer.invoke("pdf:read", projectId, pdfRelativePath),
  collectGarbage: (
    projectId: string,
    options?: { maxBuildBytes?: number },
  ): Promise<GarbageCollectionStats | null> =>
    options === undefined || options.maxBuildBytes === undefined
      ? ipcRenderer.invoke("workspace:collect-garbage", projectId)
      : ipcRenderer.invoke("workspace:collect-garbage", projectId, {
          maxBuildBytes: options.maxBuildBytes,
        }),
  forwardSyncTex: (
    projectId: string,
    pdfRelativePath: string,
    inputRelativePath: string,
    line: number,
    column: number,
  ): Promise<SyncTexPdfLocation | null> =>
    ipcRenderer.invoke(
      "synctex:forward",
      projectId,
      pdfRelativePath,
      inputRelativePath,
      line,
      column,
    ),
  backwardSyncTex: (
    projectId: string,
    pdfRelativePath: string,
    page: number,
    x: number,
    y: number,
  ): Promise<SyncTexSourceLocation | null> =>
    ipcRenderer.invoke("synctex:backward", projectId, pdfRelativePath, page, x, y),
  onOpenSpellCheckerSettings: (callback: () => void) => {
    const listener = () => {
      callback();
    };

    ipcRenderer.on("tools:open-spellchecker", listener);

    return () => {
      ipcRenderer.removeListener("tools:open-spellchecker", listener);
    };
  },
  onSpellCheckerSettingsChanged: (
    callback: (settings: SpellCheckerSettings) => void,
  ) => {
    const listener = (_event: unknown, settings: SpellCheckerSettings) => {
      callback(settings);
    };

    ipcRenderer.on("spellchecker:changed", listener);

    return () => {
      ipcRenderer.removeListener("spellchecker:changed", listener);
    };
  },
  onOpenProjectMenu: (callback: () => void) => {
    const listener = () => {
      callback();
    };

    ipcRenderer.on("file:open-project", listener);

    return () => {
      ipcRenderer.removeListener("file:open-project", listener);
    };
  },
  onCreateFileMenu: (callback: () => void) => {
    const listener = () => {
      callback();
    };

    ipcRenderer.on("file:create-dialog", listener);

    return () => {
      ipcRenderer.removeListener("file:create-dialog", listener);
    };
  },
  onCreateFolderMenu: (callback: () => void) => {
    const listener = () => {
      callback();
    };

    ipcRenderer.on("folder:create-dialog", listener);

    return () => {
      ipcRenderer.removeListener("folder:create-dialog", listener);
    };
  },
  onImportDocxMenu: (callback: () => void) => {
    const listener = () => {
      callback();
    };

    ipcRenderer.on("file:import-docx", listener);

    return () => {
      ipcRenderer.removeListener("file:import-docx", listener);
    };
  },
  onImportMarkdownMenu: (callback: () => void) => {
    const listener = () => {
      callback();
    };

    ipcRenderer.on("file:import-markdown", listener);

    return () => {
      ipcRenderer.removeListener("file:import-markdown", listener);
    };
  },
  onImportPdfMenu: (callback: () => void) => {
    const listener = () => {
      callback();
    };

    ipcRenderer.on("file:import-pdf", listener);

    return () => {
      ipcRenderer.removeListener("file:import-pdf", listener);
    };
  },
  onCloseTabMenu: (callback: () => void) => {
    const listener = () => {
      callback();
    };

    ipcRenderer.on("file:close-tab", listener);

    return () => {
      ipcRenderer.removeListener("file:close-tab", listener);
    };
  },
};

contextBridge.exposeInMainWorld("latexdo", api);

const terminalApi = {
  create: (options: { projectId: string }) =>
    ipcRenderer.invoke("terminal:create", options) as Promise<{
      id: number;
      mode: "pty" | "pipe";
    }>,

  write: (id: number, data: string) => ipcRenderer.send("terminal:write", { id, data }),

  resize: (id: number, cols: number, rows: number) =>
    ipcRenderer.send("terminal:resize", { id, cols, rows }),

  dispose: (id: number) => ipcRenderer.send("terminal:dispose", { id }),

  onData: (callback: (payload: { id: number; data: string }) => void) => {
    const listener = (_event: unknown, payload: { id: number; data: string }) => {
      callback(payload);
    };

    ipcRenderer.on("terminal:data", listener);

    return () => {
      ipcRenderer.removeListener("terminal:data", listener);
    };
  },

  onExit: (callback: (payload: { id: number; exitCode: number }) => void) => {
    const listener = (_event: unknown, payload: { id: number; exitCode: number }) => {
      callback(payload);
    };

    ipcRenderer.on("terminal:exit", listener);

    return () => {
      ipcRenderer.removeListener("terminal:exit", listener);
    };
  },
};

contextBridge.exposeInMainWorld("terminalApi", terminalApi);

// --- AI bridge -----------------------------------------------------------
// Local (node-llama-cpp) + Ollama generation and model management. Cloud
// generation runs directly in the renderer, so it isn't proxied here.
const aiApi = {
  generateStep: (req: unknown): Promise<unknown> =>
    ipcRenderer.invoke("ai:generate-step", req),

  subscribeTokens: (
    callback: (payload: {
      requestId: string;
      text: string;
      activity?: "thinking";
    }) => void,
  ) => {
    const listener = (
      _event: unknown,
      payload: { requestId: string; text: string; activity?: "thinking" },
    ) => callback(payload);
    ipcRenderer.on("ai:token", listener);
    return () => ipcRenderer.removeListener("ai:token", listener);
  },

  abort: (requestId: string): Promise<void> =>
    ipcRenderer.invoke("ai:abort", requestId),

  listModels: (): Promise<unknown[]> => ipcRenderer.invoke("ai:list-models"),

  downloadModel: (tierId: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("ai:download-model", tierId),

  cancelDownload: (modelId: string): Promise<void> =>
    ipcRenderer.invoke("ai:cancel-download", modelId),

  subscribeDownload: (callback: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on("ai:download-progress", listener);
    return () => ipcRenderer.removeListener("ai:download-progress", listener);
  },

  deleteModel: (fileName: string): Promise<void> =>
    ipcRenderer.invoke("ai:delete-model", fileName),

  importModel: (): Promise<unknown | null> => ipcRenderer.invoke("ai:import-model"),

  inspectLocalModel: (fileName: string): Promise<unknown> =>
    ipcRenderer.invoke("ai:inspect-local-model", fileName),

  detectOllama: (baseUrl: string): Promise<{ available: boolean; models: string[] }> =>
    ipcRenderer.invoke("ai:detect-ollama", baseUrl),

  ensureSpeechServer: (request: {
    baseUrl?: string;
    model?: string;
  }): Promise<unknown> => ipcRenderer.invoke("ai:ensure-speech-server", request),

  installSpeechRuntime: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("ai:install-speech-runtime"),

  subscribeSpeechInstall: (callback: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on("ai:speech-install-progress", listener);
    return () => ipcRenderer.removeListener("ai:speech-install-progress", listener);
  },

  getSpeechRuntimeStatus: (): Promise<unknown> =>
    ipcRenderer.invoke("setup:speech-status"),

  getTexRuntimeStatus: (): Promise<unknown> => ipcRenderer.invoke("setup:tex-status"),

  installTexRuntime: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("setup:install-tex"),

  subscribeTexInstall: (callback: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on("setup:tex-install-progress", listener);
    return () => ipcRenderer.removeListener("setup:tex-install-progress", listener);
  },

  getSystemCapabilities: (): Promise<unknown> =>
    ipcRenderer.invoke("ai:system-capabilities"),

  getTierAvailability: (tierId: string): Promise<unknown> =>
    ipcRenderer.invoke("ai:tier-availability", tierId),

  // Cloud API key handling. The key is not persisted in renderer storage; it
  // is forwarded once to main's OS-backed credential vault. `getCredential`
  // returns it only for an in-flight provider request.
  credentialsSupported: (): Promise<boolean> =>
    ipcRenderer.invoke("ai:credentials-supported"),

  setCredential: (credentialId: string, secret: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("ai:credential-set", credentialId, secret),

  getCredential: (credentialId: string): Promise<string | null> =>
    ipcRenderer.invoke("ai:credential-get", credentialId),

  hasCredential: (credentialId: string): Promise<boolean> =>
    ipcRenderer.invoke("ai:credential-has", credentialId),

  deleteCredential: (credentialId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("ai:credential-delete", credentialId),
};

contextBridge.exposeInMainWorld("aiApi", aiApi);

export type LatexDoApi = typeof api;
export type TerminalApi = typeof terminalApi;
export type AiApi = typeof aiApi;
