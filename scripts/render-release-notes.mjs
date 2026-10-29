import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function renderReleaseNotes(notes) {
  const lines = [`# ${notes.title}`, "", notes.summary ?? ""];
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

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [source, output] = process.argv.slice(2);
  if (!source || !output)
    throw new Error("Usage: render-release-notes.mjs source.json output.md");
  await writeFile(
    output,
    renderReleaseNotes(JSON.parse(await readFile(source, "utf8"))),
  );
}
