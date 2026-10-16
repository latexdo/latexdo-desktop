import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const artifactsDir = path.resolve(root, process.argv[2] ?? "artifacts");
const outputDir = path.resolve(root, process.argv[3] ?? "public-downloads/downloads");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

const baseUrl = process.env.LATEXDO_DOWNLOAD_BASE_URL ?? "https://latexdo.org";
const publishedAt = process.env.LATEXDO_RELEASE_DATE ?? new Date().toISOString();
const publishedAtMs = Date.parse(publishedAt);
if (!Number.isFinite(publishedAtMs)) {
  throw new Error("LATEXDO_RELEASE_DATE must be a valid timestamp.");
}
const updateFeedSigningKey = process.env.LATEXDO_UPDATE_SIGNING_KEY?.trim() ?? "";
const updateFeedSetting = process.env.LATEXDO_UPDATE_FEED_ENABLED?.toLowerCase().trim();
const updateFeedEnabled =
  updateFeedSetting === undefined || updateFeedSetting === ""
    ? Boolean(updateFeedSigningKey)
    : updateFeedSetting !== "false";
const commit = process.env.LATEXDO_RELEASE_COMMIT ?? process.env.GITHUB_SHA ?? "";
const repository = process.env.GITHUB_REPOSITORY ?? "latexdo/latexdo-desktop";
const siteRootDir = path.dirname(outputDir);
const baseUrlRoot = baseUrl.replace(/\/$/, "");
const releaseVersion = normalizeReleaseVersion(
  process.env.LATEXDO_RELEASE_VERSION ?? packageJson.version,
);
const releaseSlug = normalizeReleaseSlug(
  process.env.LATEXDO_RELEASE_SLUG ?? `v${releaseVersion}`,
);
const latestDownloadsPageUrl = `${baseUrlRoot}/downloads/`;
const releaseDownloadsPageUrl = `${baseUrlRoot}/downloads/${releaseSlug}/`;
const releaseOutputDir = path.join(outputDir, releaseSlug);
const releaseAssetBaseUrl = (
  process.env.LATEXDO_RELEASE_ASSET_BASE_URL ??
  `${baseUrlRoot}/downloads/${releaseSlug}`
).replace(/\/$/, "");

const downloads = [
  {
    id: "macos-arm64",
    label: "macOS Apple Silicon",
    platform: "macos",
    arch: "arm64",
    filename: "LatexDo-macos-arm64.dmg",
    note: "For Macs with Apple Silicon chips.",
  },
  {
    id: "macos-x64",
    label: "macOS Intel",
    platform: "macos",
    arch: "x64",
    filename: "LatexDo-macos-x64.dmg",
    note: "For Intel-based Macs.",
  },
  {
    id: "windows-x64",
    label: "Windows",
    platform: "windows",
    arch: "x64",
    filename: "LatexDo-windows-x64.exe",
    note: "For 64-bit Windows PCs.",
  },
  {
    id: "linux-x64",
    label: "Linux",
    platform: "linux",
    arch: "x64",
    filename: "LatexDo-linux-x64.AppImage",
    note: "For 64-bit Linux distributions that support AppImage.",
  },
];

function normalizeReleaseVersion(value) {
  const version = String(value).trim().replace(/^v/i, "");
  if (
    !version ||
    version.includes("/") ||
    version.includes("\\") ||
    version.includes("..")
  ) {
    throw new Error(`Invalid release version: ${value}`);
  }
  return version;
}

function normalizeReleaseSlug(value) {
  const slug = String(value).trim();
  if (!slug || slug.includes("/") || slug.includes("\\") || slug.includes("..")) {
    throw new Error(`Invalid release slug: ${value}`);
  }
  return slug;
}

function fileUrl(filename) {
  return `${releaseAssetBaseUrl}/${encodeURIComponent(filename)}`;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function sha256(filePath) {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

function htmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot sign a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error("Cannot sign an unsupported JSON value.");
}

function resolveUpdateFeedExpiry() {
  const expiresAt =
    process.env.LATEXDO_UPDATE_EXPIRES_AT ??
    new Date(publishedAtMs + 30 * 24 * 60 * 60 * 1_000).toISOString();
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= publishedAtMs) {
    throw new Error("The signed update feed expiry must follow its publication time.");
  }
  return expiresAt;
}

async function signUpdateFeed(feed) {
  const encodedPrivateKey = updateFeedSigningKey;
  if (!encodedPrivateKey) {
    throw new Error("LATEXDO_UPDATE_SIGNING_KEY is required to publish updates.");
  }

  const privateKey = createPrivateKey(
    Buffer.from(encodedPrivateKey, "base64").toString("utf8"),
  );
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("LATEXDO_UPDATE_SIGNING_KEY must contain an Ed25519 private key.");
  }

  const publicKey = createPublicKey(privateKey);
  const expectedPublicKey = createPublicKey(
    await readFile(path.join(root, "build", "update-public-key.pem"), "utf8"),
  );
  const publicDer = publicKey.export({ type: "spki", format: "der" });
  const expectedDer = expectedPublicKey.export({ type: "spki", format: "der" });
  if (!Buffer.from(publicDer).equals(Buffer.from(expectedDer))) {
    throw new Error("Update signing key does not match build/update-public-key.pem.");
  }

  const keyId = createHash("sha256").update(publicDer).digest("hex").slice(0, 16);
  const signature = sign(null, Buffer.from(canonicalJson(feed)), privateKey);
  return {
    ...feed,
    signature: {
      algorithm: "ed25519",
      keyId,
      value: signature.toString("base64"),
    },
  };
}

function platformIcon(platform, assetPrefix = "") {
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
  return `<img class="platform-logo linux-logo" src="${htmlEscape(assetPrefix)}assets/linux-tux.png" alt="" width="36" height="43" />`;
}

await mkdir(outputDir, { recursive: true });
await mkdir(releaseOutputDir, { recursive: true });

const files = [];
for (const download of downloads) {
  const source = path.join(artifactsDir, download.filename);
  const fileStat = await stat(source);
  files.push({
    ...download,
    size: fileStat.size,
    sizeLabel: formatBytes(fileStat.size),
    sha256: await sha256(source),
    url: fileUrl(download.filename),
  });
}

const manifest = {
  schemaVersion: 1,
  product: "LatexDo",
  version: releaseVersion,
  publishedAt,
  commit,
  repository,
  downloadsPage: releaseDownloadsPageUrl,
  files,
};

const releaseChecksums = files
  .map((file) => `${file.sha256}  ${file.filename}`)
  .join("\n");

await writeFile(
  path.join(outputDir, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
await writeFile(path.join(outputDir, "SHA256SUMS.txt"), `${releaseChecksums}\n`);
await writeFile(
  path.join(releaseOutputDir, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
await writeFile(path.join(releaseOutputDir, "SHA256SUMS.txt"), `${releaseChecksums}\n`);

if (updateFeedEnabled) {
  const expiresAt = resolveUpdateFeedExpiry();
  const updateFeed = {
    schemaVersion: 2,
    product: "LatexDo",
    channel: "stable",
    version: releaseVersion,
    publishedAt,
    expiresAt,
    commit,
    repository,
    release: releaseSlug,
    releaseUrl: releaseDownloadsPageUrl,
    downloadsPage: manifest.downloadsPage,
    manifestUrl: `${manifest.downloadsPage}manifest.json`,
    releaseNotesUrl: `${baseUrlRoot}/updates/release-notes/${releaseVersion}.json`,
    files,
  };
  const signedUpdateFeed = await signUpdateFeed(updateFeed);

  await mkdir(path.join(siteRootDir, "updates"), { recursive: true });
  await writeFile(
    path.join(siteRootDir, "updates", "latest.json"),
    `${JSON.stringify(signedUpdateFeed, null, 2)}\n`,
  );
  await writeFile(
    path.join(siteRootDir, "updates", `${releaseSlug}.json`),
    `${JSON.stringify(signedUpdateFeed, null, 2)}\n`,
  );
} else {
  console.log(
    "Built downloads without signed update feed; LATEXDO_UPDATE_SIGNING_KEY is not configured.",
  );
}

function macBuildName(file) {
  const value = `${file.id} ${file.label} ${file.arch}`.toLowerCase();
  if (value.includes("arm64") || value.includes("silicon")) return "Apple Silicon";
  if (value.includes("x64") || value.includes("intel")) return "Intel";
  return file.label;
}

function installerKind(file) {
  const extension = path.extname(file.filename).replace(".", "").toUpperCase();
  return extension ? `${extension} installer` : "Installer";
}

function renderDownloadOption(file, fileHref, label = file.label, extraClass = "") {
  const className = ["download-option", extraClass].filter(Boolean).join(" ");
  return `<a class="${htmlEscape(className)}" href="${htmlEscape(fileHref(file))}" download>
              <strong>${htmlEscape(label)}</strong>
              <span>${htmlEscape(installerKind(file))}</span>
              <em>${htmlEscape(file.sizeLabel)}<span class="downloads-dev-link"> - SHA-256</span></em>
            </a>`;
}

function renderMacMachinePicker(macFiles, fileHref) {
  const appleSilicon = macFiles.find((file) => file.arch === "arm64");
  const intel = macFiles.find((file) => file.arch === "x64");
  if (!appleSilicon || !intel) {
    return `<div class="download-variant-row" aria-label="macOS build choices">
${macFiles.map((file) => renderDownloadOption(file, fileHref, macBuildName(file))).join("\n")}
            </div>`;
  }

  return `<div class="mac-machine-picker" aria-label="macOS build choices">
              <input class="mac-machine-input" type="radio" name="mac-machine" id="mac-machine-apple-silicon" checked />
              <input class="mac-machine-input" type="radio" name="mac-machine" id="mac-machine-intel" />
              <div class="mac-machine-tabs" aria-label="Mac chip">
                <label for="mac-machine-apple-silicon">Apple Silicon</label>
                <label for="mac-machine-intel">Intel</label>
              </div>
              <div class="mac-machine-downloads">
${renderDownloadOption(appleSilicon, fileHref, "Apple Silicon", "mac-machine-option arm64")}
${renderDownloadOption(intel, fileHref, "Intel", "mac-machine-option x64")}
              </div>
            </div>`;
}

function renderCards(fileHref, assetPrefix) {
  const macFiles = files.filter((file) => file.platform === "macos");
  const windowsFiles = files.filter((file) => file.platform === "windows");
  const linuxFiles = files.filter((file) => file.platform === "linux");

  return `
          <article class="platform-download-card macos">
            <div class="platform-card-top">
              <span class="platform-logo-shell">${platformIcon("macos", assetPrefix)}</span>
              <div>
                <p class="eyebrow">macOS</p>
                <h2>Apple Mac</h2>
              </div>
            </div>
            ${renderMacMachinePicker(macFiles, fileHref)}
          </article>
          <article class="platform-download-card windows">
            <div class="platform-card-top">
              <span class="platform-logo-shell">${platformIcon("windows", assetPrefix)}</span>
              <div>
                <p class="eyebrow">Windows</p>
                <h2>Windows PC</h2>
              </div>
            </div>
            <div class="download-variant-row" aria-label="Windows build choices">
${windowsFiles.map((file) => renderDownloadOption(file, fileHref, "Windows x64")).join("\n")}
            </div>
          </article>
          <article class="platform-download-card linux">
            <div class="platform-card-top">
              <span class="platform-logo-shell">${platformIcon("linux", assetPrefix)}</span>
              <div>
                <p class="eyebrow">Linux</p>
                <h2>Linux desktop</h2>
              </div>
            </div>
            <div class="download-variant-row" aria-label="Linux build choices">
${linuxFiles.map((file) => renderDownloadOption(file, fileHref, "Linux x64")).join("\n")}
            </div>
          </article>`;
}

function renderDownloadsPage({
  pageTitle,
  description,
  assetPrefix,
  manifestHref,
  checksumsHref,
  cards,
  canonicalUrl,
  latestHref,
}) {
  // Exact-release pages (latestHref set) duplicate the main downloads page, so
  // they are kept out of search results.
  const releaseLink = latestHref
    ? `<p>Exact release: <strong>${htmlEscape(releaseSlug)}</strong>. <a href="${htmlEscape(latestHref)}">Latest downloads</a></p>`
    : `<p>
          Latest release:
          <a href="${htmlEscape(`${releaseSlug}/`)}">${htmlEscape(releaseSlug)}</a>.
        </p>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      name="description"
      content="${htmlEscape(description)}"
    />
    <title>${htmlEscape(pageTitle)}</title>
    <meta name="author" content="LatexDo" />
    <meta name="robots" content="${latestHref ? "noindex, follow" : "index, follow, max-image-preview:large"}" />
    <meta name="theme-color" content="#fbfbfd" />
    <link rel="canonical" href="${htmlEscape(canonicalUrl)}" />
    <link rel="icon" type="image/svg+xml" href="${assetPrefix}assets/icon.svg" />
    <link rel="manifest" href="${assetPrefix}site.webmanifest" />
    <link rel="preload" href="${assetPrefix}style.css" as="style" />
    <link rel="stylesheet" href="${assetPrefix}style.css" />
  </head>
  <body>
    <a class="skip-link" href="#content">Skip to content</a>

    <div data-header-src="/partials/header.html"></div>

    <main id="content" class="downloads-page">
      <section class="downloads-hero">
        <p class="eyebrow">Desktop app</p>
        <h1>Download LatexDo</h1>
        ${releaseLink}
      </section>

      <input class="dev-mode-input" type="checkbox" id="dev-mode-toggle" />
      <label class="dev-mode-toggle" for="dev-mode-toggle">
        Developer mode
        <span class="dev-mode-switch" aria-hidden="true"></span>
      </label>

      <section class="download-platform-grid" aria-label="LatexDo installers">
${cards}
      </section>

      <section class="downloads-meta downloads-first-launch">
        <h2>First launch</h2>
        <p>
          LatexDo is not yet signed with an Apple or Microsoft developer certificate,
          so your computer may warn you the first time you open it.
        </p>
        <dl>
          <div>
            <dt>macOS</dt>
            <dd>
              Drag LatexDo to Applications and open it. If macOS says it cannot check the app,
              open System Settings, choose Privacy &amp; Security, and click
              <strong>Open Anyway</strong> next to LatexDo.
            </dd>
          </div>
          <div>
            <dt>Windows</dt>
            <dd>
              If Windows SmartScreen appears, click <strong>More info</strong>, then
              <strong>Run anyway</strong>.
            </dd>
          </div>
          <div>
            <dt>Linux</dt>
            <dd>
              Make the AppImage executable with <code>chmod +x LatexDo-linux-x64.AppImage</code>,
              then run it.
            </dd>
          </div>
        </dl>
        <p>
          You only need to do this once. Updates install from inside LatexDo, and every installer
          is checked against the signed checksum published here.
        </p>
      </section>

      <section class="downloads-meta downloads-dev">
        <h2>Build information</h2>
        <dl>
          <div>
            <dt>Version</dt>
            <dd>${htmlEscape(releaseVersion)}</dd>
          </div>
          <div>
            <dt>Published</dt>
            <dd>${htmlEscape(publishedAt)}</dd>
          </div>
          <div>
            <dt>Commit</dt>
            <dd>${htmlEscape(commit.slice(0, 12) || "local")}</dd>
          </div>
        </dl>
        <p>
          For automated checks, use <a href="${manifestHref}">manifest.json</a>.
          For file verification, use <a href="${checksumsHref}">SHA256SUMS.txt</a>.
        </p>
      </section>
    </main>

    <div data-footer-src="/partials/footer.html"></div>
    <script type="module" src="/assets/site.js"></script>
  </body>
</html>
`;
}

const latestHtml = renderDownloadsPage({
  pageTitle: "LatexDo Downloads",
  description:
    "Download the latest LatexDo desktop release for macOS, Windows and Linux.",
  assetPrefix: "../",
  manifestHref: "manifest.json",
  checksumsHref: "SHA256SUMS.txt",
  cards: renderCards((file) => file.url, "../"),
  canonicalUrl: latestDownloadsPageUrl,
  latestHref: null,
});

const releaseHtml = renderDownloadsPage({
  pageTitle: `LatexDo ${releaseSlug} Downloads`,
  description:
    "Download this exact LatexDo desktop release from the LatexDo website. Installer files are stored in GitHub Releases and indexed here for updates.",
  assetPrefix: "../../",
  manifestHref: "manifest.json",
  checksumsHref: "SHA256SUMS.txt",
  cards: renderCards((file) => file.url, "../../"),
  canonicalUrl: releaseDownloadsPageUrl,
  latestHref: "../",
});

await writeFile(path.join(outputDir, "index.html"), latestHtml);
await writeFile(path.join(releaseOutputDir, "index.html"), releaseHtml);

console.log(`Built LatexDo ${releaseVersion} downloads at ${releaseDownloadsPageUrl}`);
