import { assertBranchName } from "./gitBranchName.js";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type {
  GitBlameLine,
  GitChangeEntry,
  GitCommitDetails,
  GitCommitFile,
  GitDiffSession,
  GitDiffStatus,
  GitFileStatus,
  GitGraphCommit,
  GitGraphSegment,
  GitHistorySummary,
  GitRef,
  GitRevisionRef,
  GitStatusSummary,
} from "./types.js";
import {
  getGitErrorCode,
  gitErrorMessage,
  retryWhileRepositoryIsLocked,
  type GitErrorCode,
} from "./gitErrors.js";

const defaultGitOutputLimit = 16 * 1024 * 1024;
const revisionContentLimit = 5 * 1024 * 1024;
const diffPreviewLimit = 512 * 1024;

export class GitOutputLimitError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Git output exceeded ${maxBytes.toLocaleString()} bytes.`);
    this.name = "GitOutputLimitError";
  }
}

export class GitCommandError extends Error {
  readonly gitErrorCode: GitErrorCode | undefined;
  /** What Git printed, kept for diagnostics when the message is a friendly one. */
  readonly stderr: string;

  constructor(
    readonly args: readonly string[],
    readonly exitCode: number | null,
    stderr: string,
    stdout = "",
  ) {
    // Some failures, such as "nothing to commit", are only reported on stdout.
    const gitErrorCode = getGitErrorCode(`${stderr}\n${stdout}`);
    super(
      gitErrorMessage(gitErrorCode) ??
        (stderr.trim() || stdout.trim() || `git ${args[0] ?? "command"} failed.`),
    );
    this.name = "GitCommandError";
    this.gitErrorCode = gitErrorCode;
    this.stderr = stderr;
  }
}

export class GitNotFoundError extends Error {
  readonly gitErrorCode: GitErrorCode = "GitNotFound";

  constructor() {
    super(gitErrorMessage("GitNotFound") ?? "Git is not installed.");
    this.name = "GitNotFoundError";
  }
}

interface RunGitOptions {
  maxBytes?: number;
  input?: string | Buffer;
  /**
   * False for background reads such as status: Git then skips its optional
   * index refresh lock, so a read never blocks a Git command the user is
   * running in a terminal.
   */
  optionalLocks?: boolean;
  /** Stops a network operation (fetch, pull, push) that hangs on a prompt. */
  timeoutMs?: number;
}

export function runGitBuffer(
  cwd: string,
  args: readonly string[],
  options: RunGitOptions = {},
): Promise<Buffer> {
  return retryWhileRepositoryIsLocked(() => runGitOnce(cwd, args, options));
}

function runGitOnce(
  cwd: string,
  args: readonly string[],
  options: RunGitOptions,
): Promise<Buffer> {
  const maxBytes = options.maxBytes ?? defaultGitOutputLimit;
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...args], {
      cwd,
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_PAGER: "cat",
        LANGUAGE: "en",
        LC_ALL: "C",
        // There is no terminal to answer a credential prompt; fail with a
        // clear error instead of waiting forever.
        GIT_TERMINAL_PROMPT: "0",
        ...(options.optionalLocks === false ? { GIT_OPTIONAL_LOCKS: "0" } : {}),
      },
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill();
        }, options.timeoutMs)
      : null;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let exceededLimit = false;

    child.stdout!.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxBytes) {
        exceededLimit = true;
        child.kill();
        return;
      }
      stdout.push(chunk);
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= 256 * 1024) stderr.push(chunk);
    });
    child.on("error", (error) => {
      // A missing working folder also reports ENOENT; only a missing
      // executable means Git itself is not installed.
      reject(
        (error as NodeJS.ErrnoException).code === "ENOENT" && existsSync(cwd)
          ? new GitNotFoundError()
          : error,
      );
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        reject(
          new Error(
            `git ${args[0] ?? "command"} took too long and was stopped. Check your connection and that Git can sign in without asking (a credential helper or SSH key).`,
          ),
        );
      } else if (exceededLimit) {
        reject(new GitOutputLimitError(maxBytes));
      } else if (code !== 0) {
        reject(
          new GitCommandError(
            args,
            code,
            Buffer.concat(stderr).toString("utf8"),
            Buffer.concat(stdout).toString("utf8").slice(0, 4096),
          ),
        );
      } else {
        resolve(Buffer.concat(stdout));
      }
    });

    if (child.stdin) {
      child.stdin.end(options.input);
    }
  });
}

export async function runGitText(
  cwd: string,
  args: readonly string[],
  options: RunGitOptions = {},
): Promise<string> {
  return (await runGitBuffer(cwd, args, options)).toString("utf8");
}

export interface GitRepositoryContext {
  projectRoot: string;
  repositoryRoot: string;
  projectPrefix: string;
  gitDirectory: string;
  commonGitDirectory: string;
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function getGitRepositoryContext(
  projectRoot: string,
): Promise<GitRepositoryContext> {
  const canonicalProjectRoot = await realpath(projectRoot);
  const repositoryRoot = path.resolve(
    (await runGitText(canonicalProjectRoot, ["rev-parse", "--show-toplevel"])).trim(),
  );
  if (!isInside(repositoryRoot, canonicalProjectRoot)) {
    throw new Error("The Git repository does not contain the open project.");
  }

  const gitDirectory = path.resolve(
    (
      await runGitText(canonicalProjectRoot, ["rev-parse", "--absolute-git-dir"])
    ).trim(),
  );
  let commonGitDirectory = gitDirectory;
  try {
    const rawCommonDirectory = (
      await runGitText(canonicalProjectRoot, ["rev-parse", "--git-common-dir"])
    ).trim();
    commonGitDirectory = path.resolve(canonicalProjectRoot, rawCommonDirectory);
  } catch {
    // Older Git versions do not expose --git-common-dir.
  }

  return {
    projectRoot: canonicalProjectRoot,
    repositoryRoot,
    projectPrefix: toPosixPath(path.relative(repositoryRoot, canonicalProjectRoot)),
    gitDirectory,
    commonGitDirectory,
  };
}

export function repoPathForProjectPath(
  context: GitRepositoryContext,
  relativePath: string,
): string {
  const absolutePath = path.resolve(context.projectRoot, relativePath);
  if (!isInside(context.projectRoot, absolutePath)) {
    throw new Error("The requested path is outside the open project.");
  }
  return toPosixPath(path.relative(context.repositoryRoot, absolutePath));
}

function projectPathForRepoPath(
  context: GitRepositoryContext,
  repositoryPath: string,
): string | null {
  const absolutePath = path.resolve(context.repositoryRoot, repositoryPath);
  if (!isInside(context.projectRoot, absolutePath)) return null;
  return toPosixPath(path.relative(context.projectRoot, absolutePath));
}

function scopePathspec(context: GitRepositoryContext): string[] {
  return context.projectPrefix ? ["--", context.projectPrefix] : [];
}

function statusFromCode(code: string): GitFileStatus {
  switch (code) {
    case ".":
    case " ":
      return "unmodified";
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "type-changed";
    case "?":
      return "untracked";
    default:
      return "conflicted";
  }
}

function splitFixedFields(
  record: string,
  fixedFieldCount: number,
): { fields: string[]; remainder: string } | null {
  const fields: string[] = [];
  let cursor = 0;
  for (let index = 0; index < fixedFieldCount; index += 1) {
    const separator = record.indexOf(" ", cursor);
    if (separator < 0) return null;
    fields.push(record.slice(cursor, separator));
    cursor = separator + 1;
  }
  return { fields, remainder: record.slice(cursor) };
}

function changeEntry(
  pathValue: string,
  originalPath: string | undefined,
  xy: string,
  conflicted = false,
): GitChangeEntry {
  const indexStatus = conflicted ? "conflicted" : statusFromCode(xy[0] ?? ".");
  const worktreeStatus = conflicted ? "conflicted" : statusFromCode(xy[1] ?? ".");
  return {
    path: pathValue,
    originalPath,
    indexStatus,
    worktreeStatus,
    staged: indexStatus !== "unmodified" && indexStatus !== "untracked",
    unstaged: worktreeStatus !== "unmodified",
    untracked: indexStatus === "untracked" || worktreeStatus === "untracked",
    conflicted,
  };
}

export function parseGitStatusPorcelainV2(
  output: string,
  context: GitRepositoryContext,
): GitStatusSummary {
  const records = output.split("\0");
  const entries: GitChangeEntry[] = [];
  let branch: string | null = null;
  let headHash: string | undefined;
  let upstream: string | undefined;
  let ahead: number | undefined;
  let behind: number | undefined;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.startsWith("# branch.oid ")) {
      const oid = record.slice("# branch.oid ".length);
      if (oid !== "(initial)") headHash = oid;
      continue;
    }
    if (record.startsWith("# branch.head ")) {
      const value = record.slice("# branch.head ".length);
      branch = value === "(detached)" ? null : value;
      continue;
    }
    if (record.startsWith("# branch.upstream ")) {
      upstream = record.slice("# branch.upstream ".length);
      continue;
    }
    if (record.startsWith("# branch.ab ")) {
      const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record);
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
      continue;
    }
    if (record.startsWith("? ")) {
      const projectPath = projectPathForRepoPath(context, record.slice(2));
      if (projectPath) {
        entries.push({
          path: projectPath,
          indexStatus: "unmodified",
          worktreeStatus: "untracked",
          staged: false,
          unstaged: true,
          untracked: true,
          conflicted: false,
        });
      }
      continue;
    }
    if (record.startsWith("! ")) continue;

    const recordKind = record[0];
    const fixedCount = recordKind === "1" ? 8 : recordKind === "2" ? 9 : 10;
    const parsed = splitFixedFields(record, fixedCount);
    if (!parsed) continue;
    const xy = parsed.fields[1] ?? "..";
    const projectPath = projectPathForRepoPath(context, parsed.remainder);
    if (!projectPath) {
      if (recordKind === "2") index += 1;
      continue;
    }

    if (recordKind === "2") {
      const originalRepositoryPath = records[index + 1] ?? "";
      index += 1;
      const originalPath =
        projectPathForRepoPath(context, originalRepositoryPath) ?? undefined;
      entries.push(changeEntry(projectPath, originalPath, xy));
    } else {
      entries.push(changeEntry(projectPath, undefined, xy, recordKind === "u"));
    }
  }

  return {
    isRepo: true,
    branch,
    repositoryRoot: context.repositoryRoot,
    headHash,
    upstream,
    ahead,
    behind,
    entries,
  };
}

export async function readStructuredGitStatus(
  projectRoot: string,
): Promise<GitStatusSummary> {
  try {
    const context = await getGitRepositoryContext(projectRoot);
    const output = await runGitText(
      context.repositoryRoot,
      [
        "status",
        "--porcelain=v2",
        "-z",
        "--branch",
        "--untracked-files=all",
        ...scopePathspec(context),
      ],
      { optionalLocks: false },
    );
    return parseGitStatusPorcelainV2(output, context);
  } catch (error) {
    return {
      isRepo: false,
      branch: null,
      entries: [],
      error: normalizeGitError(error, "Git status failed"),
    };
  }
}

function normalizeGitError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  return /not a git repository|no such file or directory/i.test(message)
    ? "Not a Git repository"
    : message;
}

export async function readGitPatch(
  projectRoot: string,
  relativePath: string,
  area: "staged" | "changes",
): Promise<string> {
  const context = await getGitRepositoryContext(projectRoot);
  const repoPath = repoPathForProjectPath(context, relativePath);
  return runGitText(
    context.repositoryRoot,
    [
      "diff",
      "--no-ext-diff",
      "--no-color",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "--no-textconv",
      "--binary",
      "--full-index",
      ...(area === "staged" ? ["--cached"] : []),
      "--",
      repoPath,
    ],
    { maxBytes: diffPreviewLimit },
  );
}

export async function readGitDiffPreview(
  projectRoot: string,
  relativePath: string,
): Promise<string> {
  const context = await getGitRepositoryContext(projectRoot);
  const repoPath = repoPathForProjectPath(context, relativePath);
  try {
    const output = await runGitText(
      context.repositoryRoot,
      ["diff", "--no-ext-diff", "--", repoPath],
      { maxBytes: diffPreviewLimit },
    );
    return output || "No unstaged diff available.";
  } catch (error) {
    if (error instanceof GitOutputLimitError) {
      return "Diff is too large to preview. Open the editor diff instead.";
    }
    throw error;
  }
}

function parseRefs(decorations: string): GitRef[] {
  const refs: GitRef[] = [];
  const add = (ref: GitRef) => {
    const existing = refs.find((candidate) => candidate.name === ref.name);
    if (existing) {
      existing.current ||= ref.current;
      if (ref.kind === "head") existing.kind = "head";
    } else {
      refs.push(ref);
    }
  };

  for (const rawPart of decorations.split(", ")) {
    const part = rawPart.trim();
    if (!part) continue;
    if (part === "HEAD") {
      add({ name: "HEAD", kind: "head", current: true });
      continue;
    }
    if (part.startsWith("HEAD -> ")) {
      const target = part.slice("HEAD -> ".length).replace(/^refs\/heads\//, "");
      add({ name: target, kind: "head", current: true });
      continue;
    }
    if (part.startsWith("tag: refs/tags/")) {
      add({
        name: part.slice("tag: refs/tags/".length),
        kind: "tag",
        current: false,
      });
      continue;
    }
    if (part.startsWith("refs/tags/")) {
      add({ name: part.slice("refs/tags/".length), kind: "tag", current: false });
      continue;
    }
    if (part.startsWith("refs/heads/")) {
      add({
        name: part.slice("refs/heads/".length),
        kind: "local-branch",
        current: false,
      });
      continue;
    }
    if (part.startsWith("refs/remotes/")) {
      add({
        name: part.slice("refs/remotes/".length),
        kind: "remote-branch",
        current: false,
      });
    }
  }
  return refs;
}

interface ParsedCommit {
  hash: string;
  shortHash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  refs: GitRef[];
  subject: string;
}

function parseCommitRecords(output: string): ParsedCommit[] {
  return output
    .split("\u001e")
    .map((record) => record.replace(/^\r?\n/, ""))
    .filter(Boolean)
    .map((record) => {
      const [
        hash,
        shortHash,
        parents,
        authorName,
        authorEmail,
        authoredAt,
        refs,
        subject,
      ] = record.split("\u001f");
      return {
        hash: hash ?? "",
        shortHash: shortHash ?? "",
        parents: parents ? parents.split(" ").filter(Boolean) : [],
        authorName: authorName ?? "",
        authorEmail: authorEmail ?? "",
        authoredAt: authoredAt ?? "",
        refs: parseRefs(refs ?? ""),
        subject: subject ?? "",
      };
    })
    .filter((commit) => Boolean(commit.hash));
}

function segmentKind(fromLane: number, toLane: number): GitGraphSegment["kind"] {
  if (fromLane === toLane) return "vertical";
  return toLane < fromLane ? "merge-left" : "merge-right";
}

export function assignGraphLanes(commits: ParsedCommit[]): GitGraphCommit[] {
  let active: string[] = [];
  return commits.map((commit) => {
    let lane = active.indexOf(commit.hash);
    if (lane < 0) {
      lane = active.length;
      active.push(commit.hash);
    }
    const previous = [...active];
    const next = [...active];
    next.splice(lane, 1);
    const parentsToInsert = commit.parents.filter((parent) => !next.includes(parent));
    next.splice(lane, 0, ...parentsToInsert);

    const segments: GitGraphSegment[] = [];
    for (let previousLane = 0; previousLane < previous.length; previousLane += 1) {
      const branchHash = previous[previousLane];
      if (branchHash === commit.hash) continue;
      const nextLane = next.indexOf(branchHash);
      if (nextLane >= 0) {
        segments.push({
          fromLane: previousLane,
          toLane: nextLane,
          kind: segmentKind(previousLane, nextLane),
        });
      }
    }
    for (const parent of commit.parents) {
      const parentLane = next.indexOf(parent);
      if (parentLane >= 0) {
        segments.push({
          fromLane: lane,
          toLane: parentLane,
          kind: segmentKind(lane, parentLane),
        });
      }
    }
    active = next;
    return {
      ...commit,
      lane,
      segments,
      isHead: commit.refs.some((ref) => ref.kind === "head" || ref.current),
    };
  });
}

const logFormat = "%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%D%x1f%s%x1e";

export interface GitGraphOptions {
  /** How many commits to read; the graph asks for more as it scrolls. */
  limit?: number;
  /**
   * "all" every branch, "auto" the current branch and its upstream (as VS
   * Code's graph does), or one branch name.
   */
  refs?: "all" | "auto" | string;
}

async function graphRevisions(
  repositoryRoot: string,
  refs: GitGraphOptions["refs"],
): Promise<string[]> {
  if (!refs || refs === "all") return ["--all"];
  if (refs === "auto") {
    const upstream = (
      await runGitText(repositoryRoot, [
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{u}",
      ]).catch(() => "")
    ).trim();
    return upstream ? ["HEAD", upstream] : ["HEAD"];
  }
  return [assertBranchName(refs)];
}

export async function readStructuredGitHistory(
  projectRoot: string,
  relativePath?: string,
  options: GitGraphOptions = {},
): Promise<GitHistorySummary> {
  let context: GitRepositoryContext;
  try {
    context = await getGitRepositoryContext(projectRoot);
  } catch {
    return {
      scope: relativePath ? "file" : "repo",
      target: relativePath ?? null,
      commits: [],
    };
  }

  const args = relativePath
    ? [
        "log",
        "--follow",
        "--date=iso-strict",
        "--decorate=full",
        "--topo-order",
        "--parents",
        `--pretty=format:${logFormat}`,
        "-n",
        "200",
        "--",
        repoPathForProjectPath(context, relativePath),
      ]
    : [
        "log",
        ...(await graphRevisions(context.repositoryRoot, options.refs)),
        "--date=iso-strict",
        "--decorate=full",
        "--topo-order",
        "--parents",
        `--pretty=format:${logFormat}`,
        "-n",
        String(Math.max(1, Math.min(options.limit ?? 1000, 5000))),
      ];
  const output = await runGitText(context.repositoryRoot, args).catch((error) => {
    // An empty repository has no HEAD yet: that is an empty history.
    if (
      /does not have any commits|unknown revision|bad default revision/i.test(
        String(error),
      )
    ) {
      return "";
    }
    throw error;
  });
  return {
    scope: relativePath ? "file" : "repo",
    target: relativePath ?? null,
    commits: assignGraphLanes(parseCommitRecords(output)),
  };
}

function diffStatusFromCode(code: string): GitDiffStatus {
  switch (code[0]) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    default:
      return "modified";
  }
}

function parseChangedFiles(
  output: string,
  context: GitRepositoryContext,
): GitCommitFile[] {
  const fields = output.split("\0");
  const files: GitCommitFile[] = [];
  for (let index = 0; index < fields.length; ) {
    const statusCode = fields[index++];
    if (!statusCode) continue;
    const status = diffStatusFromCode(statusCode);
    if (status === "renamed" || status === "copied") {
      const oldRepoPath = fields[index++] ?? "";
      const repoPath = fields[index++] ?? "";
      const filePath = projectPathForRepoPath(context, repoPath);
      if (!filePath) continue;
      files.push({
        path: filePath,
        oldPath: projectPathForRepoPath(context, oldRepoPath) ?? undefined,
        status,
      });
    } else {
      const repoPath = fields[index++] ?? "";
      const filePath = projectPathForRepoPath(context, repoPath);
      if (filePath) files.push({ path: filePath, status });
    }
  }
  return files;
}

async function readCommitChangedFiles(
  context: GitRepositoryContext,
  hash: string,
  parentHash?: string,
): Promise<GitCommitFile[]> {
  const args = parentHash
    ? [
        "diff",
        "--name-status",
        "-z",
        "-M",
        "-C",
        parentHash,
        hash,
        ...scopePathspec(context),
      ]
    : [
        "diff-tree",
        "--root",
        "--no-commit-id",
        "--name-status",
        "-r",
        "-z",
        "-M",
        "-C",
        hash,
        ...scopePathspec(context),
      ];
  return parseChangedFiles(await runGitText(context.repositoryRoot, args), context);
}

interface CommitMetadata {
  hash: string;
  shortHash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  committerName: string;
  committerEmail: string;
  committedAt: string;
  refs: GitRef[];
  summary: string;
  body: string;
}

async function readCommitMetadata(
  context: GitRepositoryContext,
  hash: string,
): Promise<CommitMetadata> {
  const format =
    "%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%cI%x1f%D%x1f%s%x1f%b%x1e";
  const output = await runGitText(context.repositoryRoot, [
    "show",
    "--no-patch",
    "--date=iso-strict",
    "--decorate=full",
    `--format=${format}`,
    hash,
  ]);
  const fields = (output.split("\u001e", 1)[0] ?? "").split("\u001f");
  return {
    hash: fields[0] ?? hash,
    shortHash: fields[1] ?? hash.slice(0, 7),
    parents: fields[2] ? fields[2].split(" ").filter(Boolean) : [],
    authorName: fields[3] ?? "",
    authorEmail: fields[4] ?? "",
    authoredAt: fields[5] ?? "",
    committerName: fields[6] ?? "",
    committerEmail: fields[7] ?? "",
    committedAt: fields[8] ?? "",
    refs: parseRefs(fields[9] ?? ""),
    summary: fields[10] ?? "",
    body: fields.slice(11).join("\u001f").trim(),
  };
}

export async function readStructuredGitCommitDetails(
  projectRoot: string,
  hash: string,
): Promise<GitCommitDetails> {
  const context = await getGitRepositoryContext(projectRoot);
  const metadata = await readCommitMetadata(context, hash);
  const changedFiles = await readCommitChangedFiles(
    context,
    metadata.hash,
    metadata.parents[0],
  );
  return { ...metadata, changedFiles };
}

interface RevisionContent {
  content: string;
  binary: boolean;
  tooLarge: boolean;
}

function decodeRevision(buffer: Buffer): RevisionContent {
  if (buffer.includes(0)) return { content: "", binary: true, tooLarge: false };
  try {
    return {
      content: new TextDecoder("utf-8", { fatal: true }).decode(buffer),
      binary: false,
      tooLarge: false,
    };
  } catch {
    return { content: "", binary: true, tooLarge: false };
  }
}

async function readWorktreeRevision(filePath: string): Promise<RevisionContent> {
  const fileStats = await stat(filePath).catch(() => null);
  if (!fileStats) return { content: "", binary: false, tooLarge: false };
  if (!fileStats.isFile()) return { content: "", binary: true, tooLarge: false };
  if (fileStats.size > revisionContentLimit) {
    return { content: "", binary: false, tooLarge: true };
  }
  return decodeRevision(await readFile(filePath));
}

async function readObjectRevision(
  context: GitRepositoryContext,
  revision: string,
): Promise<RevisionContent> {
  try {
    return decodeRevision(
      await runGitBuffer(context.repositoryRoot, ["show", revision], {
        maxBytes: revisionContentLimit,
      }),
    );
  } catch (error) {
    if (error instanceof GitOutputLimitError) {
      return { content: "", binary: false, tooLarge: true };
    }
    if (error instanceof GitCommandError) {
      return { content: "", binary: false, tooLarge: false };
    }
    throw error;
  }
}

async function readLocalGitAuthor(context: GitRepositoryContext): Promise<string> {
  const configuredName = await runGitText(context.repositoryRoot, [
    "config",
    "--get",
    "user.name",
  ]).catch(() => "");
  return configuredName.trim() || "Local changes";
}

async function modifiedAt(filePath: string): Promise<string | undefined> {
  const fileStats = await stat(filePath).catch(() => null);
  return fileStats?.mtime.toISOString();
}

function languageForPath(relativePath: string): string {
  switch (path.extname(relativePath).toLowerCase()) {
    case ".tex":
    case ".sty":
    case ".cls":
      return "latex";
    case ".bib":
      return "bibtex";
    case ".ts":
    case ".tsx":
      return "typescript";
    case ".js":
    case ".jsx":
      return "javascript";
    case ".json":
      return "json";
    case ".md":
      return "markdown";
    case ".css":
      return "css";
    case ".html":
      return "html";
    case ".xml":
      return "xml";
    case ".yaml":
    case ".yml":
      return "yaml";
    case ".py":
      return "python";
    case ".sh":
      return "shell";
    default:
      return "plaintext";
  }
}

function diffStatusForEntry(
  entry: GitChangeEntry | undefined,
  area: "staged" | "changes",
): GitDiffStatus {
  if (!entry) return "modified";
  const status = area === "staged" ? entry.indexStatus : entry.worktreeStatus;
  if (status === "added" || status === "untracked") return "added";
  if (status === "deleted") return "deleted";
  if (status === "renamed") return "renamed";
  if (status === "copied") return "copied";
  return "modified";
}

function finishDiffSession(
  base: Omit<GitDiffSession, "originalContent" | "modifiedContent">,
  original: RevisionContent,
  modified: RevisionContent,
): GitDiffSession {
  const binary = original.binary || modified.binary;
  const tooLarge = original.tooLarge || modified.tooLarge;
  return {
    ...base,
    originalContent: binary || tooLarge ? "" : original.content,
    modifiedContent: binary || tooLarge ? "" : modified.content,
    binary: binary || undefined,
    tooLarge: tooLarge || undefined,
    message: binary
      ? "Binary files differ"
      : tooLarge
        ? "Diff content is too large to open safely."
        : undefined,
  };
}

export async function readWorkingTreeDiffSession(
  projectRoot: string,
  relativePath: string,
  area: "staged" | "changes" = "changes",
): Promise<GitDiffSession> {
  const context = await getGitRepositoryContext(projectRoot);
  const status = await readStructuredGitStatus(projectRoot);
  const entry = status.entries.find((candidate) => candidate.path === relativePath);
  const repoPath = repoPathForProjectPath(context, relativePath);
  const oldRepoPath = entry?.originalPath
    ? repoPathForProjectPath(context, entry.originalPath)
    : repoPath;
  const diffStatus = diffStatusForEntry(entry, area);
  const headMetadata = status.headHash
    ? await readCommitMetadata(context, status.headHash).catch(() => null)
    : null;
  const localAuthor = await readLocalGitAuthor(context);
  const indexDate = await modifiedAt(path.join(context.gitDirectory, "index"));

  if (area === "staged") {
    const originalRef: GitRevisionRef = status.headHash
      ? { kind: "commit", hash: status.headHash }
      : { kind: "empty" };
    const original =
      diffStatus === "added" || !status.headHash
        ? { content: "", binary: false, tooLarge: false }
        : await readObjectRevision(context, `${status.headHash}:${oldRepoPath}`);
    const modified =
      diffStatus === "deleted"
        ? { content: "", binary: false, tooLarge: false }
        : await readObjectRevision(context, `:${repoPath}`);
    return finishDiffSession(
      {
        id: randomUUID(),
        relativePath,
        originalRef,
        modifiedRef: { kind: "index" },
        originalLabel: "HEAD",
        modifiedLabel: "Index",
        originalShortHash: headMetadata?.shortHash,
        originalAuthor: headMetadata?.authorName,
        originalDate: headMetadata?.authoredAt,
        modifiedAuthor: localAuthor,
        modifiedDate: indexDate,
        status: diffStatus,
        oldPath: entry?.originalPath,
        language: languageForPath(relativePath),
      },
      original,
      modified,
    );
  }

  const originalRef: GitRevisionRef = entry?.untracked
    ? { kind: "empty" }
    : { kind: "index" };
  const original = entry?.untracked
    ? { content: "", binary: false, tooLarge: false }
    : await readObjectRevision(context, `:${oldRepoPath}`);
  const modified =
    diffStatus === "deleted"
      ? { content: "", binary: false, tooLarge: false }
      : await readWorktreeRevision(path.join(context.repositoryRoot, repoPath));
  const workingTreeDate = await modifiedAt(path.join(context.repositoryRoot, repoPath));
  return finishDiffSession(
    {
      id: randomUUID(),
      relativePath,
      originalRef,
      modifiedRef: { kind: "working-tree" },
      originalLabel: entry?.untracked ? "Empty" : "Index",
      modifiedLabel: "Working Tree",
      originalAuthor: entry?.untracked ? undefined : localAuthor,
      modifiedAuthor: localAuthor,
      originalDate: entry?.untracked ? undefined : indexDate,
      modifiedDate: workingTreeDate,
      status: diffStatus,
      oldPath: entry?.originalPath,
      language: languageForPath(relativePath),
    },
    original,
    modified,
  );
}

export async function readCommitDiffSession(
  projectRoot: string,
  relativePath: string,
  hash: string,
  requestedParentHash?: string,
): Promise<GitDiffSession> {
  const context = await getGitRepositoryContext(projectRoot);
  const modifiedMetadata = await readCommitMetadata(context, hash);
  const parentHash = requestedParentHash ?? modifiedMetadata.parents[0];
  if (parentHash && !modifiedMetadata.parents.includes(parentHash)) {
    throw new Error("The selected revision is not a parent of this commit.");
  }
  const changedFiles = await readCommitChangedFiles(context, hash, parentHash);
  const change = changedFiles.find(
    (file) => file.path === relativePath || file.oldPath === relativePath,
  );
  const targetPath = change?.path ?? relativePath;
  const oldPath = change?.oldPath;
  const status = change?.status ?? "modified";
  const targetRepoPath = repoPathForProjectPath(context, targetPath);
  const originalRepoPath = repoPathForProjectPath(context, oldPath ?? targetPath);
  const originalMetadata = parentHash
    ? await readCommitMetadata(context, parentHash)
    : null;
  const original =
    !parentHash || status === "added"
      ? { content: "", binary: false, tooLarge: false }
      : await readObjectRevision(context, `${parentHash}:${originalRepoPath}`);
  const modified =
    status === "deleted"
      ? { content: "", binary: false, tooLarge: false }
      : await readObjectRevision(context, `${hash}:${targetRepoPath}`);

  return finishDiffSession(
    {
      id: randomUUID(),
      relativePath: targetPath,
      originalRef: parentHash
        ? { kind: "commit", hash: parentHash }
        : { kind: "empty" },
      modifiedRef: { kind: "commit", hash },
      originalLabel: originalMetadata?.shortHash ?? "Empty",
      modifiedLabel: modifiedMetadata.shortHash,
      originalShortHash: originalMetadata?.shortHash,
      modifiedShortHash: modifiedMetadata.shortHash,
      originalAuthor: originalMetadata?.authorName,
      modifiedAuthor: modifiedMetadata.authorName,
      originalDate: originalMetadata?.authoredAt,
      modifiedDate: modifiedMetadata.authoredAt,
      status,
      oldPath,
      language: languageForPath(targetPath),
    },
    original,
    modified,
  );
}

export function parseGitBlamePorcelain(output: string): GitBlameLine[] {
  const result: GitBlameLine[] = [];
  const lines = output.split(/\r?\n/);
  let current:
    | {
        line: number;
        hash: string;
        author: string;
        authorTime: string;
        summary: string;
      }
    | undefined;
  for (const line of lines) {
    const header = /^([0-9a-f^]{7,64}) \d+ (\d+)(?: \d+)?$/.exec(line);
    if (header) {
      current = {
        hash: header[1].replace(/^\^/, ""),
        line: Number(header[2]),
        author: "Unknown",
        authorTime: "",
        summary: "",
      };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("author ")) current.author = line.slice(7);
    else if (line.startsWith("author-time ")) {
      const seconds = Number(line.slice(12));
      current.authorTime = Number.isFinite(seconds)
        ? new Date(seconds * 1000).toISOString()
        : "";
    } else if (line.startsWith("summary ")) current.summary = line.slice(8);
    else if (line.startsWith("\t")) {
      result.push({
        line: current.line,
        hash: current.hash,
        shortHash: current.hash.slice(0, 7),
        author: current.author,
        authorTime: current.authorTime,
        summary: current.summary,
      });
      current = undefined;
    }
  }
  return result;
}

export async function readGitBlame(
  projectRoot: string,
  relativePath: string,
  revision: GitRevisionRef,
): Promise<GitBlameLine[]> {
  if (revision.kind === "empty") return [];
  let context: GitRepositoryContext;
  try {
    context = await getGitRepositoryContext(projectRoot);
  } catch {
    return [];
  }
  const repoPath = repoPathForProjectPath(context, relativePath);
  try {
    const args = ["blame", "--line-porcelain", "--date=iso-strict"];
    let input: Buffer | undefined;
    if (revision.kind === "commit") args.push(revision.hash);
    if (revision.kind === "index") {
      const indexContent = await runGitBuffer(
        context.repositoryRoot,
        ["show", `:${repoPath}`],
        { maxBytes: revisionContentLimit },
      );
      input = indexContent;
      const status = await readStructuredGitStatus(projectRoot);
      if (status.headHash) args.push("--contents", "-", status.headHash);
      else return [];
    }
    args.push("--", repoPath);
    const output = await runGitText(context.repositoryRoot, args, {
      maxBytes: 32 * 1024 * 1024,
      input,
    });
    return parseGitBlamePorcelain(output).slice(0, 100_000);
  } catch (error) {
    if (error instanceof GitOutputLimitError || error instanceof GitCommandError) {
      return [];
    }
    throw error;
  }
}
