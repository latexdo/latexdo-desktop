import { access, readFile } from "node:fs/promises";
import path from "node:path";

const manifestPath = process.argv[2] ?? "latexdo-sync.json";
const repoRoot = process.cwd();

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value) {
  return typeof value === "string";
}

function validateRelativePath(label, value) {
  if (!isString(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  if (path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) {
    throw new Error(`${label} must stay inside this repository: ${value}`);
  }
  return value;
}

async function fileExists(repoPath) {
  try {
    await access(path.join(repoRoot, repoPath));
    return true;
  } catch {
    return false;
  }
}

function validateManifest(value) {
  if (!isObject(value)) throw new Error("AI sync manifest must be an object");
  if (value.schemaVersion !== 1) {
    throw new Error("AI sync manifest schemaVersion must be 1");
  }
  if (!Array.isArray(value.files)) {
    throw new Error("AI sync manifest files must be an array");
  }
  const files = value.files.map((entry, index) => {
    if (!isObject(entry)) throw new Error(`files[${index}] must be an object`);
    return {
      from: validateRelativePath(`files[${index}].from`, entry.from),
      to: validateRelativePath(`files[${index}].to`, entry.to),
    };
  });
  const styleFragments = Array.isArray(value.styleFragments)
    ? value.styleFragments.map((entry, index) => {
        if (!isObject(entry)) {
          throw new Error(`styleFragments[${index}] must be an object`);
        }
        if (!isString(entry.startMarker) || !isString(entry.endMarker)) {
          throw new Error(
            `styleFragments[${index}] startMarker/endMarker must be strings`,
          );
        }
        return {
          from: validateRelativePath(`styleFragments[${index}].from`, entry.from),
          to: validateRelativePath(`styleFragments[${index}].to`, entry.to),
          startMarker: entry.startMarker,
          endMarker: entry.endMarker,
        };
      })
    : [];
  return { files, styleFragments };
}

const manifest = validateManifest(JSON.parse(await readFile(manifestPath, "utf8")));
const manifestSources = new Set([
  ...manifest.files.map((entry) => entry.from),
  ...manifest.styleFragments.map((entry) => entry.from),
]);
const manifestTargets = new Set();
for (const entry of [...manifest.files, ...manifest.styleFragments]) {
  if (manifestTargets.has(entry.to)) {
    throw new Error(`Duplicate AI sync target: ${entry.to}`);
  }
  manifestTargets.add(entry.to);
}

for (const sourceFile of manifestSources) {
  if (!(await fileExists(sourceFile))) {
    throw new Error(`${sourceFile} is listed in ${manifestPath} but does not exist`);
  }
}
for (const targetFile of manifestTargets) {
  if (!(await fileExists(targetFile))) {
    throw new Error(`${targetFile} is a sync target but does not exist`);
  }
}
for (const fragment of manifest.styleFragments) {
  const sourceText = await readFile(path.join(repoRoot, fragment.from), "utf8");
  const targetText = await readFile(path.join(repoRoot, fragment.to), "utf8");
  if (!sourceText.includes(fragment.startMarker)) {
    throw new Error(`${fragment.from} does not contain its start marker`);
  }
  if (fragment.from !== fragment.to && sourceText.includes(fragment.endMarker)) {
    throw new Error(`${fragment.from} must not include its host end marker`);
  }
  const start = targetText.indexOf(fragment.startMarker);
  const end = targetText.indexOf(fragment.endMarker);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`${fragment.to} does not contain a valid AI style section`);
  }
}

console.log(
  `Validated LatexDo AI sync manifest with ${manifest.files.length} files and ${manifest.styleFragments.length} style fragment(s).`,
);
