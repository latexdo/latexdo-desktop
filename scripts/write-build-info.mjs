// Stamps the compiled desktop app with the commit it was built from. Every
// commit on main is published under the same package version, so the updater
// tells builds apart by commit and build time instead of by version number.
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const commitPattern = /^[a-f0-9]{40}$/;

export function resolveBuildCommit(env = process.env, readGitHead = gitHead) {
  const candidates = [readGitHead(), env.LATEXDO_RELEASE_COMMIT, env.GITHUB_SHA];
  return (
    candidates.find(
      (value) => typeof value === "string" && commitPattern.test(value),
    ) ?? null
  );
}

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/** Changes kept in each build so What's New can list what a build update brought. */
const maxBuildChanges = 200;

/** First-parent history of the build, newest first: { commit, subject }. */
export function recentChanges(readLog = gitLog) {
  const output = readLog();
  if (!output) return [];
  return output
    .split("\n")
    .map((line) => {
      const [commit, ...subject] = line.split("\t");
      return { commit, subject: subject.join("\t").trim() };
    })
    .filter((change) => commitPattern.test(change.commit) && change.subject);
}

function gitLog() {
  try {
    return execFileSync(
      "git",
      ["log", "--first-parent", `-${maxBuildChanges}`, "--format=%H%x09%s"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return "";
  }
}

export async function writeBuildInfo(outputDirectory, env = process.env) {
  const info = {
    commit: resolveBuildCommit(env),
    builtAt: new Date().toISOString(),
    changes: recentChanges(),
  };
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    path.join(outputDirectory, "build-info.json"),
    `${JSON.stringify(info, null, 2)}\n`,
  );
  return info;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const info = await writeBuildInfo(path.resolve(process.argv[2] ?? "dist-electron"));
  console.log(
    `Build info: commit ${info.commit ?? "unknown"}, built ${info.builtAt}, ${info.changes.length} changes`,
  );
}
