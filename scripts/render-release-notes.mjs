import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recentChanges } from "./write-build-info.mjs";

const changeKinds = { feat: "New", fix: "Fixed", perf: "Improved" };

/**
 * User-facing notes from conventional commit subjects (as the app's What's
 * New does): features, fixes and performance work, without the prefix or
 * issue numbers, once each. Pull-request merges stand for their commits.
 */
export function buildChangeNotes(changes, limit = 40) {
  const notes = [];
  const seen = new Set();
  for (const change of changes) {
    const subjects = change.merged?.length ? change.merged : [change.subject];
    for (const subject of subjects) {
      const match = /^(\w+)(?:\([^)]*\))?!?:\s*(.+)$/.exec(subject);
      const kind = match ? changeKinds[match[1].toLowerCase()] : undefined;
      if (!match || !kind) continue;
      const text = match[2].replace(/\s*\((?:#\d+(?:,\s*)?)+\)\s*$/, "").trim();
      if (!text) continue;
      const note = { kind, text: text[0].toUpperCase() + text.slice(1) };
      if (seen.has(note.text.toLowerCase())) continue;
      seen.add(note.text.toLowerCase());
      notes.push(note);
      if (notes.length >= limit) return notes;
    }
  }
  return notes;
}

export function renderReleaseNotes(notes, buildChanges = []) {
  const lines = [`# ${notes.title}`, "", notes.summary ?? ""];
  // Every build shares the package version: say what this one brought.
  if (buildChanges.length) {
    lines.push("", "## In this build", "");
    for (const change of buildChanges)
      lines.push(`- **${change.kind}** — ${change.text}`);
  }
  for (const [title, items] of [
    ["Highlights", notes.highlights],
    ["Fixes", notes.fixes],
    ["Breaking changes", notes.breakingChanges],
    ["Security", notes.security],
  ]) {
    if (!items?.length) continue;
    lines.push("", `## ${title}`, "");
    for (const item of items) {
      lines.push(
        typeof item === "string"
          ? `- ${item}`
          : `- **${item.title}** — ${item.description}`,
      );
    }
  }
  return `${lines.join("\n").trim()}\n`;
}

/** First-parent changes after `since` (a tag or commit) up to HEAD. */
function changesSince(since) {
  try {
    const log = execFileSync(
      "git",
      ["log", "--first-parent", "-200", "--format=%H%x09%s", `${since}..HEAD`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return recentChanges(() => log);
  } catch {
    return [];
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [source, output, since] = process.argv.slice(2);
  if (!source || !output)
    throw new Error("Usage: render-release-notes.mjs source.json output.md [since]");
  await writeFile(
    output,
    renderReleaseNotes(
      JSON.parse(await readFile(source, "utf8")),
      since ? buildChangeNotes(changesSince(since)) : [],
    ),
  );
}
