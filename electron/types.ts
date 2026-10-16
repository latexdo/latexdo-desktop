export interface ProjectEntry {
  name: string;
  path: string;
  relativePath: string;
  type: "file" | "directory";
  children?: ProjectEntry[];
  limited?: boolean;
}

export interface OrcidPaperRef {
  title: string;
  year?: string;
  doi?: string;
  journal?: string;
}

export interface OrcidProfileResult {
  name: string;
  papers: OrcidPaperRef[];
}

export interface ProjectListOptions {
  ignoredNames?: string[];
  maxDepth?: number;
  maxEntries?: number;
}

export type ProjectId = string;

export type LatexDoResearchSpaceFolderKind = "paper" | "bibliography" | "shared";

export interface LatexDoResearchSpaceFolder {
  name: string;
  path: string;
  kind: LatexDoResearchSpaceFolderKind;
}

export interface LatexDoResearchSpace {
  schemaVersion: 1;
  name: string;
  filePath: string;
  folders: LatexDoResearchSpaceFolder[];
}

export interface OpenProject {
  id: ProjectId;
  rootPath: string;
  name: string;
  researchSpace?: LatexDoResearchSpace;
}

export interface CreateProjectOptions {
  folderName?: string;
}

export type CollaboratorRole = "admin" | "editor" | "viewer";

export interface CollaboratorPresence {
  clientId: string;
  name: string;
  currentFile: string | null;
  lastSeen: number;
  role?: CollaboratorRole;
}

export type HostSharingMode = "internet" | "local";

/** How this computer is currently reachable while it hosts a shared project. */
export interface HostSharingStatus {
  /** True while other people can reach the projects hosted on this computer. */
  active: boolean;
  mode: HostSharingMode | null;
  phase: "off" | "starting" | "ready" | "failed";
  /** Progress or failure detail that is safe to show to the user. */
  message?: string;
  /** Origins a guest can use to reach this computer. */
  addresses: string[];
}

export interface CollaborationJoinRequest {
  clientId: string;
  name: string;
  requestedAt: number;
}

export interface CollaborationState {
  enabled: boolean;
  token?: string;
  shareUrl?: string;
  projectId?: string;
  projectName?: string;
  users: CollaboratorPresence[];
  currentUserRole?: CollaboratorRole;
  isAdmin?: boolean;
  /** Origin of the collaboration backend that serves this project. */
  apiBaseUrl?: string;
  /** True when the project is served by this computer, not a remote server. */
  hosted?: boolean;
  host?: HostSharingStatus;
  /** Single string a guest pastes to join; carries the addresses and the token. */
  inviteCode?: string;
  requireApproval?: boolean;
  /** People waiting for an admin to let them in. Only sent to admins. */
  pending?: CollaborationJoinRequest[];
}

export interface StartCollaborationOptions {
  mode?: HostSharingMode;
  /** Name collaborators see for the shared project. */
  projectName?: string;
}

export interface SaveSharedProjectResult {
  saved: boolean;
  folder?: string;
  written?: number;
  project?: OpenProject;
}

export interface CollaboratorPermission {
  clientId: string;
  name: string;
  role: CollaboratorRole;
  isCurrent?: boolean;
}

export interface PermissionUpdate {
  clientId: string;
  role: CollaboratorRole;
}

export interface DocxImportResult {
  sourcePath: string;
  relativePath: string;
  assetDirectory: string;
  mediaFiles: string[];
  converter: "pandoc" | "built-in";
  warnings: string[];
  project?: OpenProject;
}

export interface MarkdownImportResult {
  sourcePath: string;
  relativePath: string;
  converter: "pandoc" | "built-in";
  warnings: string[];
  project?: OpenProject;
}

export interface PdfImportStats {
  sections: number;
  equations: number;
  figures: number;
  tables: number;
  references: number;
  citations: number;
  crossReferences: number;
  lowConfidenceMath: number;
}

export interface PdfImportResult {
  sourcePath: string;
  relativePath: string;
  /** Generated bibliography, when the PDF carried a reference list. */
  bibRelativePath: string | null;
  assetDirectory: string | null;
  mediaFiles: string[];
  converter: "built-in";
  pageCount: number;
  stats: PdfImportStats;
  warnings: string[];
  project?: OpenProject;
}

export interface DiagnosticContextLine {
  line: number;
  text: string;
  focus: boolean;
}

export interface DiagnosticFix {
  title: string;
  expectedText: string;
  replacement: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  confidence: number;
}

export interface Diagnostic {
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  severity: "error" | "warning";
  message: string;
  detail?: string;
  suggestion?: string;
  compilerExcerpt?: string;
  sourceLine?: string;
  source?: "latex" | "proofread";
  code?: string;
  replacements?: string[];
  title?: string;
  locationAccuracy?: "exact" | "inferred" | "line";
  highlightText?: string;
  sourceContext?: DiagnosticContextLine[];
  reportedLine?: number;
  reportedColumn?: number;
  originReason?: string;
  locationConfidence?: number;
  fixes?: DiagnosticFix[];
  isPrimary?: boolean;
  isCascade?: boolean;
  cascadeReason?: string;
  priority?: number;
}

export interface CompileRequest {
  projectId: ProjectId;
  rootFile: string;
  engine: "pdflatex" | "xelatex" | "lualatex";
}

export interface AsymptoteCompileRequest {
  projectId: ProjectId;
  relativePath: string;
}

export interface CompileResult {
  ok: boolean;
  pdfPath?: string;
  durationMs: number;
  output: string;
  diagnostics: Diagnostic[];
  error?: string;
}

export interface CompileProgressPayload {
  projectId: ProjectId;
  /** Integer percentage 0..100 reported while a compile is running. */
  progress: number;
}

export interface SyncTexSourceLocation {
  file: string;
  line: number;
  column: number;
}

export interface SyncTexPdfLocation {
  page: number;
  x: number;
  y: number;
  h: number;
  v: number;
  width: number;
  height: number;
  word?: string;
}

export type GitFileStatus =
  | "unmodified"
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type-changed"
  | "untracked"
  | "conflicted";

export interface GitChangeEntry {
  path: string;
  originalPath?: string;
  indexStatus: GitFileStatus;
  worktreeStatus: GitFileStatus;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
}

export type GitStatusEntry = GitChangeEntry;

export interface GitStatusSummary {
  isRepo: boolean;
  branch: string | null;
  repositoryRoot?: string;
  headHash?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  entries: GitStatusEntry[];
  error?: string;
}

export interface GitDiffPreview {
  path: string;
  diff: string;
}

export type GitRevisionRef =
  | { kind: "working-tree" }
  | { kind: "index" }
  | { kind: "commit"; hash: string }
  | { kind: "empty" };

export type GitDiffStatus = "added" | "modified" | "deleted" | "renamed" | "copied";

export interface GitDiffSession {
  id: string;
  relativePath: string;
  originalRef: GitRevisionRef;
  modifiedRef: GitRevisionRef;
  originalContent: string;
  modifiedContent: string;
  originalLabel: string;
  modifiedLabel: string;
  originalShortHash?: string;
  modifiedShortHash?: string;
  originalAuthor?: string;
  modifiedAuthor?: string;
  originalDate?: string;
  modifiedDate?: string;
  status: GitDiffStatus;
  oldPath?: string;
  language: string;
  binary?: boolean;
  tooLarge?: boolean;
  message?: string;
}

export type GitDiffEditorInput = GitDiffSession;

export interface GitDiscardResult {
  discarded: boolean;
  recoveryPatch?: string;
}

export interface GitRef {
  name: string;
  kind: "head" | "local-branch" | "remote-branch" | "tag";
  current: boolean;
}

export interface GitGraphSegment {
  fromLane: number;
  toLane: number;
  kind: "vertical" | "merge-left" | "merge-right";
}

export interface GitGraphCommit {
  hash: string;
  shortHash: string;
  parents: string[];
  subject: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  refs: GitRef[];
  lane: number;
  segments: GitGraphSegment[];
  isHead: boolean;
}

export type GitCommitEntry = GitGraphCommit;

export interface GitHistorySummary {
  scope: "repo" | "file";
  target: string | null;
  commits: GitCommitEntry[];
}

export interface GitCommitDetails {
  hash: string;
  shortHash: string;
  summary: string;
  body: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  committerName: string;
  committerEmail: string;
  committedAt: string;
  parents: string[];
  refs: GitRef[];
  changedFiles: GitCommitFile[];
}

export interface GitCommitFile {
  path: string;
  oldPath?: string;
  status: GitDiffStatus;
}

export interface GitBlameLine {
  line: number;
  hash: string;
  shortHash: string;
  author: string;
  authorTime: string;
  summary: string;
}

export interface GitChangedEvent {
  projectId: string;
  reason: "repository" | "working-tree";
}

export interface ImportedProjectEntry {
  sourcePath: string;
  relativePath: string;
  type: "file" | "directory";
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string | null;
  /** Commit of the latest published build; builds can share a version. */
  latestCommit?: string | null;
  /** Commit this app was built from, when known. */
  currentCommit?: string | null;
  releaseUrl: string | null;
  updateAvailable: boolean;
  automaticInstallAvailable?: boolean;
  publishedAt?: string | null;
  channel?: string | null;
  manifestUrl?: string | null;
  releaseNotesUrl?: string | null;
  checkedAt?: string | null;
  error?: string;
}

export type ReleaseHighlightCategory =
  | "new"
  | "ai"
  | "editor"
  | "compiler"
  | "review"
  | "updates"
  | "performance"
  | "security"
  | "other";

export interface ReleaseHighlight {
  id: string;
  category: ReleaseHighlightCategory;
  title: string;
  description: string;
}

export interface ReleaseSecurityNote {
  title: string;
  description: string;
  advisoryUrl?: string;
}

export interface ReleaseNotesDocument {
  schemaVersion: 1;
  version: string;
  title: string;
  summary?: string;
  publishedAt: string;
  releaseUrl: string;
  highlights: ReleaseHighlight[];
  fixes?: string[];
  breakingChanges?: string[];
  security?: ReleaseSecurityNote[];
  signature?: { algorithm: "ed25519"; keyId: string; value: string };
}

export interface WhatsNewResult {
  fromVersion: string | null;
  toVersion: string;
  releases: ReleaseNotesDocument[];
  shouldPresent: boolean;
  notesAvailable: boolean;
  /** What changed between the previous build and this one, newest first. */
  buildChanges?: BuildChangeNote[];
}

export interface BuildChangeNote {
  kind: "new" | "fixed" | "improved";
  text: string;
}

export type UpdatePhase =
  | "checking"
  | "downloading"
  | "download-verified"
  | "installer-launched"
  | "installing"
  | "installation-verified"
  | "relaunching"
  | "confirmed"
  | "failed";

export type UpdateAttemptStatus = "none" | "installing" | "confirmed" | "failed";

export interface UpdateAttemptResolution {
  status: UpdateAttemptStatus;
  currentVersion: string;
  expectedVersion: string | null;
  fromVersion?: string | null;
  attemptedAt?: string | null;
  completedAt?: string | null;
  attempts?: number;
  installerSha256?: string | null;
  error?: string | null;
}

export interface UpdateInstallResult extends UpdateCheckResult {
  installerPath: string | null;
  opened: boolean;
  restartScheduled?: boolean;
  quitScheduled?: boolean;
  manualDownload?: boolean;
  phase?: UpdatePhase;
}

export interface UpdateDownloadProgress {
  status:
    | "checking"
    | "downloading"
    | "verifying"
    | "verifying-download"
    | "ready-to-install"
    | "opening"
    | "installer-launched"
    | "installing"
    | "verifying-installation"
    | "restarting"
    | "restart-required"
    | "confirmed"
    | "done"
    | "error"
    | "failed";
  currentVersion: string;
  latestVersion: string | null;
  fileName: string | null;
  fileLabel: string | null;
  transferredBytes: number;
  totalBytes: number | null;
  percent: number | null;
  message?: string;
  phase?: UpdatePhase;
  /** Set while LatexDo counts down to quitting so the installer can run. */
  restartInSeconds?: number;
}

export interface RendererDiagnosticPayload {
  kind: "renderer-error" | "renderer-unhandled-rejection" | "renderer-react-error";
  error: {
    name?: string;
    message: string;
    stack?: string;
    code?: string;
  };
  context?: Record<string, unknown>;
}

export interface SpellCheckerSettings {
  enabled: boolean;
  languages: string[];
  customWords: string[];
  availableLanguages: string[];
  usesSystemLanguage: boolean;
}

export interface ProofreadingSettings {
  enabled: boolean;
  serverUrl: string;
  language: string;
  picky: boolean;
  motherTongue: string;
}

export interface ProofreadingResult {
  diagnostics: Diagnostic[];
  output: string;
  checkedTextLength: number;
  error?: string;
}

export interface ProofreadingRequestOptions {
  baseLine?: number;
  baseColumn?: number;
  originalTextLength?: number;
  truncated?: boolean;
}
