// `npm run deploy`: builds the co-author web page, then deploys the Worker
// with what it was built from (commit, branch, uncommitted changes), so the
// LatexDo Administrator can tell when the live server is behind `main`.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const workerDir = path.resolve(here, "..");
const repoRoot = path.resolve(workerDir, "../..");
// What ends up on collab.latexdo.org: the server, its web page, and the two
// files the page imports from src/collaboration. Tests and notes never ship.
// The LatexDo Administrator watches the same files (electron/services/github.ts).
const livePaths = [
  "collaborations/cloudflare",
  "web/guest",
  "src/collaboration/collaboratorLook.ts",
  "src/collaboration/remoteCursors.ts",
];
const notShipped = /(\.test\.[cm]?[jt]sx?$|\/test\/|\.md$)/;

function gitOutput(...args) {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  } catch {
    return "";
  }
}
const git = (...args) => gitOutput(...args).trim();

const commit = git("rev-parse", "HEAD");
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
// Untracked files count too: a new file in web/guest is a change. Not
// trimmed: each line starts with a two-letter status that may be a space.
const dirty = gitOutput("status", "--porcelain", "--", ...livePaths)
  .split("\n")
  .map((line) =>
    line
      .slice(3)
      .replace(/^.* -> /, "")
      .replace(/^"|"$/g, ""),
  )
  .some((file) => file && !notShipped.test(file));
const deployedAt = new Date().toISOString();

if (dirty) {
  console.warn(
    "⚠ Deploying uncommitted changes. The Administrator will show this deploy as not matching any commit.",
  );
}

const run = (command, args) =>
  execFileSync(command, args, {
    cwd: workerDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

run("npm", ["run", "build:web"]);
const vars = [
  ...(commit ? ["--var", `BUILD_COMMIT:${commit}`] : []),
  ...(branch ? ["--var", `BUILD_BRANCH:${branch}`] : []),
  "--var",
  `BUILD_DIRTY:${dirty ? "1" : "0"}`,
  "--var",
  `BUILD_DEPLOYED_AT:${deployedAt}`,
];
run("npx", ["wrangler", "deploy", ...vars, ...process.argv.slice(2)]);
