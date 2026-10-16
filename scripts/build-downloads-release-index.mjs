import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const jsonOnly = process.argv.includes("--json-only");
const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const downloadsDir = path.resolve(
  root,
  positionalArgs[0] ?? "public-downloads/downloads",
);
const baseUrl = process.env.LATEXDO_DOWNLOAD_BASE_URL ?? "https://latexdo.org";
const baseUrlRoot = baseUrl.replace(/\/$/, "");
const downloadsPageUrl = `${baseUrlRoot}/downloads/`;
const githubRepository = process.env.GITHUB_REPOSITORY ?? "latexdo/latexdo";

function htmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function platformIcon(platform) {
  if (platform === "macos") {
    return `<svg class="platform-logo" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M16.64 12.08c-.03-2.32 1.9-3.45 1.99-3.5-1.09-1.6-2.79-1.82-3.37-1.84-1.42-.15-2.8.85-3.52.85-.74 0-1.86-.83-3.06-.8-1.56.02-3.02.93-3.82 2.35-1.65 2.86-.42 7.06 1.16 9.37.79 1.13 1.71 2.39 2.92 2.35 1.18-.05 1.62-.75 3.04-.75 1.41 0 1.82.75 3.06.72 1.27-.02 2.06-1.14 2.82-2.28.91-1.3 1.27-2.58 1.29-2.65-.03-.01-2.49-.96-2.52-3.82ZM14.34 5.24c.64-.79 1.07-1.86.95-2.94-.92.04-2.07.63-2.74 1.39-.59.67-1.12 1.78-.98 2.81 1.04.08 2.1-.52 2.77-1.26Z" />
    </svg>`;
  }
  if (platform === "windows") {
    return `<svg class="platform-logo" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 5.15 10.8 4v7.38H3V5.15Z" />
      <path d="M12.15 3.82 21 2.5v8.88h-8.85V3.82Z" />
      <path d="M3 12.62h7.8V20L3 18.85v-6.23Z" />
      <path d="M12.15 12.62H21v8.88l-8.85-1.32v-7.56Z" />
    </svg>`;
  }
  return `<svg class="platform-logo linux-logo" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 5.5h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z" />
    <path d="m7 10 3 2-3 2" />
    <path d="M12.5 15h4.5" />
  </svg>`;
}

function comparePublishedAt(a, b) {
  const aTime = Date.parse(a.publishedAt ?? "");
  const bTime = Date.parse(b.publishedAt ?? "");
  if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
    return bTime - aTime;
  }
  return b.tag.localeCompare(a.tag);
}

function releaseFromManifest(tag, manifest) {
  const downloadsPage = `${downloadsPageUrl}${encodeURIComponent(tag)}/`;
  const githubReleaseUrl = `https://github.com/${manifest.repository ?? githubRepository}/releases/tag/${encodeURIComponent(tag)}`;
  return {
    tag,
    version: manifest.version,
    publishedAt: manifest.publishedAt,
    commit: manifest.commit,
    repository: manifest.repository ?? githubRepository,
    downloadsPage,
    manifestUrl: `${downloadsPage}manifest.json`,
    checksumsUrl: `${downloadsPage}SHA256SUMS.txt`,
    githubReleaseUrl,
    files: Array.isArray(manifest.files) ? manifest.files : [],
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function loadReleases() {
  const entries = await readdir(downloadsDir, { withFileTypes: true });
  const releases = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const tag = entry.name;
    if (tag.includes("/") || tag.includes("\\") || tag.includes("..")) {
      continue;
    }

    try {
      const manifest = await readJson(path.join(downloadsDir, tag, "manifest.json"));
      if (manifest?.schemaVersion === 1 && manifest.product === "LatexDo") {
        releases.push(releaseFromManifest(tag, manifest));
      }
    } catch (error) {
      console.warn(
        `Skipping ${tag}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return releases.sort(comparePublishedAt);
}

function renderCards(files) {
  if (!files.length) {
    return `
          <article class="platform-download-card macos">
            <div class="platform-card-top">
              <span class="platform-logo-shell">${platformIcon("macos")}</span>
              <div>
                <p class="eyebrow">macOS</p>
                <h2>Apple Mac</h2>
              </div>
            </div>
            <p>Apple Silicon and Intel DMG installers will appear here when the next release publishes assets.</p>
            <div class="download-variant-row" aria-label="macOS build choices">
              <span class="download-option pending"><strong>Apple Silicon</strong><span>DMG installer</span><em>Release pending</em></span>
              <span class="download-option pending"><strong>Intel</strong><span>DMG installer</span><em>Release pending</em></span>
            </div>
            <a class="button secondary" href="manifest.json">Watch manifest</a>
          </article>
          <article class="platform-download-card windows">
            <div class="platform-card-top">
              <span class="platform-logo-shell">${platformIcon("windows")}</span>
              <div>
                <p class="eyebrow">Windows</p>
                <h2>Windows PC</h2>
              </div>
            </div>
            <p>The Windows x64 executable installer will appear here when release assets are available.</p>
            <div class="download-variant-row" aria-label="Windows build choices">
              <span class="download-option pending"><strong>Windows x64</strong><span>EXE installer</span><em>Release pending</em></span>
            </div>
            <a class="button secondary" href="SHA256SUMS.txt">View checksums</a>
          </article>
          <article class="platform-download-card linux">
            <div class="platform-card-top">
              <span class="platform-logo-shell">${platformIcon("linux")}</span>
              <div>
                <p class="eyebrow">Linux</p>
                <h2>Linux desktop</h2>
              </div>
            </div>
            <p>The Linux x64 AppImage will appear here when release assets are available.</p>
            <div class="download-variant-row" aria-label="Linux build choices">
              <span class="download-option pending"><strong>Linux x64</strong><span>AppImage package</span><em>Release pending</em></span>
            </div>
            <a class="button secondary" href="SHA256SUMS.txt">View checksums</a>
          </article>`;
  }

  const macFiles = files.filter((file) => file.platform === "macos");
  const windowsFiles = files.filter((file) => file.platform === "windows");
  const linuxFiles = files.filter((file) => file.platform === "linux");
  const option = (
    file,
    label,
  ) => `<a class="download-option" href="${htmlEscape(file.url)}" download>
              <strong>${htmlEscape(label)}</strong>
              <span>${htmlEscape(path.extname(file.filename).replace(".", "").toUpperCase() || "Installer")} installer</span>
              <em>${htmlEscape(file.sizeLabel ?? `${file.size ?? ""} bytes`)} - SHA-256</em>
            </a>`;

  return `
          <article class="platform-download-card macos">
            <div class="platform-card-top">
              <span class="platform-logo-shell">${platformIcon("macos")}</span>
              <div>
                <p class="eyebrow">macOS</p>
                <h2>Apple Mac</h2>
              </div>
            </div>
            <p>Choose the DMG for your Mac. Apple Silicon covers M-series Macs; Intel covers older Intel-based Macs.</p>
            <div class="download-variant-row" aria-label="macOS build choices">
${macFiles.map((file) => option(file, file.arch === "arm64" ? "Apple Silicon" : "Intel")).join("\n")}
            </div>
          </article>
          <article class="platform-download-card windows">
            <div class="platform-card-top">
              <span class="platform-logo-shell">${platformIcon("windows")}</span>
              <div>
                <p class="eyebrow">Windows</p>
                <h2>Windows PC</h2>
              </div>
            </div>
            <p>Install LatexDo on a 64-bit Windows PC with the packaged desktop installer.</p>
            <div class="download-variant-row" aria-label="Windows build choices">
${windowsFiles.map((file) => option(file, "Windows x64")).join("\n")}
            </div>
          </article>
          <article class="platform-download-card linux${linuxFiles.length ? "" : " coming-soon"}">
            <div class="platform-card-top">
              <span class="platform-logo-shell">${platformIcon("linux")}</span>
              <div>
                <p class="eyebrow">Linux</p>
                <h2>${linuxFiles.length ? "Linux desktop" : "Coming soon"}</h2>
              </div>
            </div>
            ${
              linuxFiles.length
                ? `<p>Run LatexDo on 64-bit Linux distributions with the packaged AppImage.</p>
            <div class="download-variant-row" aria-label="Linux build choices">
${linuxFiles.map((file) => option(file, "Linux x64")).join("\n")}
            </div>`
                : `<p>A Linux AppImage is available starting with releases that include the Linux asset.</p>
            <span class="coming-soon-pill">Older release has no Linux asset</span>`
            }
          </article>`;
}

function renderReleaseList(releases) {
  if (!releases.length) {
    return `
        <section class="downloads-releases" aria-labelledby="release-history-title">
          <div class="release-heading">
            <div>
              <p class="eyebrow">Release tags</p>
              <h2 id="release-history-title">No releases published yet</h2>
            </div>
          </div>
        </section>`;
  }

  return `
        <section class="downloads-releases" aria-labelledby="release-history-title">
          <div class="release-heading">
            <div>
              <p class="eyebrow">Release tags</p>
              <h2 id="release-history-title">All desktop releases</h2>
            </div>
          </div>
          <div class="release-list">
${releases.map(renderReleaseItem).join("\n")}
          </div>
        </section>`;
}

function renderReleaseItem(release) {
  const published = release.publishedAt
    ? new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(new Date(release.publishedAt))
    : "Unknown date";
  const commit = release.commit ? release.commit.slice(0, 12) : "unknown";

  return `            <article class="release-item">
              <div>
                <h3><a href="${htmlEscape(`${release.tag}/`)}">${htmlEscape(release.tag)}</a></h3>
                <p>Version ${htmlEscape(release.version ?? "unknown")} - ${htmlEscape(published)} UTC - ${htmlEscape(commit)}</p>
              </div>
              <nav aria-label="${htmlEscape(release.tag)} release links">
                <a href="${htmlEscape(`${release.tag}/`)}">Downloads</a>
                <a href="${htmlEscape(`${release.tag}/manifest.json`)}">Manifest</a>
                <a href="${htmlEscape(`${release.tag}/SHA256SUMS.txt`)}">Checksums</a>
                <a href="${htmlEscape(release.githubReleaseUrl)}">GitHub</a>
              </nav>
            </article>`;
}

function renderDownloadsPage(latestManifest, releases) {
  const latestRelease = releases[0];
  const description = latestRelease
    ? `Download the latest LatexDo desktop installers from ${latestRelease.tag}, or inspect every release tag published for macOS, Windows, and Linux.`
    : "Download LatexDo desktop installers and inspect release metadata.";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      name="description"
      content="${htmlEscape(description)}"
    />
    <title>LatexDo Downloads</title>
    <link rel="canonical" href="${htmlEscape(downloadsPageUrl)}" />
    <link rel="icon" type="image/svg+xml" href="../assets/icon.svg" />
    <link rel="stylesheet" href="../style.css" />
  </head>
  <body>
    <header class="site-header">
      <nav class="nav-shell" aria-label="Primary navigation">
        <a class="brand" href="../">
          <img src="../assets/icon.svg" alt="" width="34" height="34" />
          <span>LatexDo</span>
        </a>
        <div class="nav-links">
          <a href="../">Home</a>
          <a href="../about/">About</a>
          <a href="manifest.json">Manifest</a>
          <a href="releases.json">Releases JSON</a>
        </div>
      </nav>
    </header>

    <main class="downloads-page">
      <section class="downloads-hero">
        <p class="eyebrow">Direct downloads</p>
        <h1>LatexDo Downloads</h1>
        <p>${htmlEscape(description)}</p>
        ${
          latestRelease
            ? `<p>Latest tag: <a href="${htmlEscape(`${latestRelease.tag}/`)}">${htmlEscape(latestRelease.tag)}</a>.</p>`
            : ""
        }
      </section>

      <section class="download-platform-grid" aria-label="Latest LatexDo installers">
${renderCards(latestManifest.files ?? [])}
      </section>

      <section class="downloads-meta">
        <h2>Latest build information</h2>
        <dl>
          <div>
            <dt>Version</dt>
            <dd>${htmlEscape(latestManifest.version ?? "unknown")}</dd>
          </div>
          <div>
            <dt>Published</dt>
            <dd>${htmlEscape(latestManifest.publishedAt ?? "unknown")}</dd>
          </div>
          <div>
            <dt>Commit</dt>
            <dd>${htmlEscape((latestManifest.commit ?? "unknown").slice(0, 12))}</dd>
          </div>
        </dl>
        <p>
          For automated checks, use <a href="manifest.json">manifest.json</a>,
          <a href="releases.json">releases.json</a>, and
          <a href="SHA256SUMS.txt">SHA256SUMS.txt</a>.
        </p>
      </section>
${renderReleaseList(releases)}
    </main>

    <footer class="site-footer">
      <span>LatexDo</span>
      <a href="../about/">About</a>
      <a href="../">Website</a>
      <a href="manifest.json">Manifest</a>
    </footer>
  </body>
</html>
`;
}

const releases = await loadReleases();
let latestManifest;
try {
  latestManifest = await readJson(path.join(downloadsDir, "manifest.json"));
} catch {
  latestManifest = releases[0]
    ? await readJson(path.join(downloadsDir, releases[0].tag, "manifest.json"))
    : { files: [] };
}

const index = {
  schemaVersion: 1,
  product: "LatexDo",
  generatedAt: releases[0]?.publishedAt ?? new Date().toISOString(),
  releases,
};

await writeFile(
  path.join(downloadsDir, "releases.json"),
  `${JSON.stringify(index, null, 2)}\n`,
);
if (!jsonOnly) {
  await writeFile(
    path.join(downloadsDir, "index.html"),
    renderDownloadsPage(latestManifest, releases),
  );
}

console.log(
  `Built downloads release ${jsonOnly ? "JSON " : ""}index with ${releases.length} releases.`,
);
