import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const summary = JSON.parse(
  await readFile(new URL("coverage/coverage-summary.json", root), "utf8"),
);

// Fail if a transform error silently removed application source from the report.
const reported = new Set(
  Object.keys(summary).map((file) => file.replaceAll("\\", "/")),
);
const missing = [];
async function verifyDirectory(relative) {
  for (const entry of await readdir(new URL(relative, root), { withFileTypes: true })) {
    const file = `${relative}${entry.name}`;
    if (entry.isDirectory()) {
      if (!["node_modules", "__tests__"].includes(entry.name)) {
        await verifyDirectory(`${file}/`);
      }
      continue;
    }
    if (!/\.(?:[jt]sx?|[cm][jt]s)$/.test(file)) continue;
    if (/\.(?:test|spec)\.[^.]+$|\.d\.(?:ts|mts|cts)$/.test(file)) continue;
    if (file === "src/test-setup.ts" || /^scripts\/test-/.test(file)) continue;
    if (file === "scripts/run-packaged-app-tests.mjs") continue;
    const absolute = fileURLToPath(new URL(file, root)).replaceAll("\\", "/");
    if (!reported.has(absolute)) missing.push(file);
  }
}
for (const directory of [
  "src",
  "electron",
  "collaborations",
  "cli",
  "scripts",
  "latexdo",
]) {
  await verifyDirectory(`${directory}/`);
}
if (missing.length) {
  throw new Error(`Source files missing from coverage:\n${missing.join("\n")}`);
}

const percentage = summary.total?.lines?.pct;
if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
  throw new Error("Coverage summary does not contain a valid line percentage.");
}

const value = `${percentage.toFixed(2)}%`;
const color = percentage >= 80 ? "#4c1" : percentage >= 60 ? "#dfb317" : "#e05d44";
const label = "JS/TS line coverage";
const title = `${label}: ${value}`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="207" height="20" role="img" aria-label="${title}">
  <title>${title}</title>
  <linearGradient id="shade" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="round"><rect width="207" height="20" rx="3"/></clipPath>
  <g clip-path="url(#round)"><path fill="#555" d="M0 0h145v20H0z"/><path fill="${color}" d="M145 0h62v20h-62z"/><path fill="url(#shade)" d="M0 0h207v20H0z"/></g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="72.5" y="15" fill="#010101" fill-opacity=".3">${label}</text><text x="72.5" y="14">${label}</text>
    <text x="176" y="15" fill="#010101" fill-opacity=".3">${value}</text><text x="176" y="14">${value}</text>
  </g>
</svg>
`;
await mkdir(new URL("docs/", root), { recursive: true });
await writeFile(new URL("docs/coverage.svg", root), svg);
console.log(`Updated README coverage badge: ${value}`);
