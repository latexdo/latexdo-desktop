import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";

const [
  cli,
  installer,
  publicKey,
  appPackage,
  cliPackage,
  electronMain,
  ciWorkflow,
  renewalScript,
  downloadsBuilder,
  downloadsIndexBuilder,
  workflowFiles,
] = await Promise.all([
  readFile("cli/bin/latexdo", "utf8"),
  readFile("cli/install.sh", "utf8"),
  readFile("build/update-public-key.pem", "utf8"),
  readFile("package.json", "utf8").then(JSON.parse),
  readFile("cli/package.json", "utf8").then(JSON.parse),
  readFile("electron/main.ts", "utf8"),
  readFile(".github/workflows/ci.yml", "utf8"),
  readFile("scripts/renew-update-feed.mjs", "utf8"),
  readFile("scripts/build-downloads-page.mjs", "utf8"),
  readFile("scripts/build-downloads-release-index.mjs", "utf8"),
  readdir(".github/workflows"),
]);

const workflowYamlFiles = workflowFiles
  .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
  .sort();
if (workflowYamlFiles.length !== 1 || workflowYamlFiles[0] !== "ci.yml") {
  throw new Error(
    `GitHub Actions must expose one workflow only: ${workflowYamlFiles.join(", ")}`,
  );
}

if (!cli.includes(publicKey.trim())) {
  throw new Error("CLI update key does not match build/update-public-key.pem.");
}
if (cliPackage.engines?.node !== ">=22.17.0") {
  throw new Error("CLI Node.js minimum must remain pinned to >=22.17.0.");
}
if (appPackage.build?.toolsets?.appimage !== "1.0.3") {
  throw new Error("Linux AppImage builds must use the static appimage toolset.");
}
for (const nativeModuleUnpackPattern of [
  "**/node_modules/node-pty/**",
  "**/node_modules/node-llama-cpp/**",
  "**/node_modules/@node-llama-cpp/**",
]) {
  if (!appPackage.build?.asarUnpack?.includes(nativeModuleUnpackPattern)) {
    throw new Error(
      `Native module unpack rule is missing: ${nativeModuleUnpackPattern}`,
    );
  }
}

for (const [label, content] of [
  ["CLI", cli],
  ["desktop main process", electronMain],
  ["downloads builder", downloadsBuilder],
  ["downloads index builder", downloadsIndexBuilder],
  ["feed renewal script", renewalScript],
]) {
  if (content.includes("app.latexdo.org")) {
    throw new Error(`${label} must use latexdo.org for downloads and updates.`);
  }
}

for (const requiredProtection of [
  "feed freshness window is invalid or expired",
  "feed version ${payload.version} is older than previously trusted",
  "isReleaseSlugForVersion(payload.release, payload.version)",
  "isBuildReleaseSlugForVersion(payload.release, payload.version)",
  "trusted_cached_checkout",
  "state.highestCommit",
  'cached_commit="$(git -C "$APP_DIR" rev-parse HEAD',
]) {
  if (!cli.includes(requiredProtection)) {
    throw new Error(`CLI update protection is missing: ${requiredProtection}`);
  }
}
for (const requiredProtection of [
  'const updateFeedStateFile = "update-feed-state.json"',
  "Website update feed freshness window is invalid or expired.",
  "older than previously trusted version",
  "isReleaseSlugForVersion(release, version)",
  "isBuildReleaseSlugForVersion(release, version)",
]) {
  if (!electronMain.includes(requiredProtection)) {
    throw new Error(`Desktop update protection is missing: ${requiredProtection}`);
  }
}

for (const forbiddenWorkflowControl of [
  "workflow_run:",
  "repository: latexdo/app.latexdo.org",
  "repository: latexdo/editor.latexdo.org",
  "repository: latexdo/cli.latexdo.org",
  "repository: latexdo/docs.latexdo.org",
  "repository: latexdo/store.latexdo.org",
  "deploy-editor",
  "deploy-cli",
  "deploy-docs",
  "deploy-store",
  "deploy-website",
  "latexdo-release",
  "CLOUDFLARE_API_TOKEN",
  "wrangler@latest",
  "wrangler deploy",
  "git -C latexdo-site add -A",
  "git -C latexdo-site add downloads updates bin/latexdo install.sh",
  "Deploy downloads to Cloudflare",
  "Verify deployed downloads",
]) {
  if (ciWorkflow.includes(forbiddenWorkflowControl)) {
    throw new Error(
      `Single CI workflow contains forbidden control: ${forbiddenWorkflowControl}`,
    );
  }
}

for (const requiredCiControl of [
  "This is the only workflow for validation, packaging, release creation, and downloads publication.",
  "flowchart TD",
  "quality / checks and build",
  "npm run format:check",
  "npm run lint",
  "npm run typecheck",
  "npm test",
  "npm run test:coverage",
  "npm audit --audit-level=high",
  "npm run test:supply-chain",
  "npm run build",
  "Test packaged macOS application",
  '"$executable" --smoke-test',
  "macos-15-intel",
  "LatexDo-macos-x64.dmg",
  "Test packaged Windows application",
  'Start-Process -FilePath $executable.FullName -ArgumentList "--smoke-test" -Wait -PassThru',
  "Test Linux AppImage",
  'chmod +x "$package_path"',
  'xvfb-run -a "$executable" --smoke-test',
  'xvfb-run -a "$package_path" --smoke-test',
]) {
  if (!ciWorkflow.includes(requiredCiControl)) {
    throw new Error(`CI control is missing: ${requiredCiControl}`);
  }
}

for (const requiredReleaseControl of [
  "publish / GitHub release and latexdo.org downloads",
  "needs.pipeline.outputs.release_enabled == 'true'",
  "repository: latexdo/latexdo.org",
  "group: latexdo-org-downloads",
  "LATEXDO_RELEASE_TARGET_SHA",
  "LATEXDO_RELEASE_COMMIT: ${{ needs.pipeline.outputs.target_sha }}",
  "Apple signing is disabled because these secrets are missing:",
  "steps.macos_signing.outputs.signed != 'true'",
  "Publishing an unsigned Windows build.",
  "CSC_IDENTITY_AUTO_DISCOVERY=false",
  "--config.forceCodeSigning=true",
  "steps.windows_signing.outputs.signed == 'true'",
  "bash scripts/verify-macos-release.sh",
  "bash scripts/verify-macos-adhoc-release.sh",
  "Signed update feed disabled; LATEXDO_UPDATE_SIGNING_KEY is not configured.",
  "LATEXDO_UPDATE_FEED_ENABLED: ${{ steps.publication_credentials.outputs.update_feed_enabled }}",
  "LATEXDO_DOWNLOAD_BASE_URL: https://latexdo.org",
  "rm -f public-downloads/downloads/index.html",
  "if [ -d public-downloads/updates ]; then",
  "No signed update feed generated; leaving latexdo.org updates/ unchanged.",
  "node scripts/build-downloads-release-index.mjs latexdo-site/downloads --json-only",
  "git -C latexdo-site add -- downloads",
  "git -C latexdo-site add -- updates",
  "Release publication must stage only downloads/ and updates/",
  "Dispatch latexdo.org validation after publication",
  "TARGET_REPOSITORY: latexdo/latexdo.org",
  "TARGET_WORKFLOW: validate.yml",
  "Triggered ${TARGET_REPOSITORY}/${TARGET_WORKFLOW} after publication.",
]) {
  if (!ciWorkflow.includes(requiredReleaseControl)) {
    throw new Error(
      `Release publication control is missing: ${requiredReleaseControl}`,
    );
  }
}

for (const requiredRenewalProtection of [
  "verifyFeedSignature(existingFeed, publicKey)",
  "immutableFeed(existingFeed)",
  'path.join(releaseDirectory, "manifest.json")',
  'path.join(releaseDirectory, "SHA256SUMS.txt")',
  "30 * 24 * 60 * 60 * 1_000",
  "14 * 24 * 60 * 60 * 1_000",
]) {
  if (!renewalScript.includes(requiredRenewalProtection)) {
    throw new Error(
      `Update-feed renewal protection is missing: ${requiredRenewalProtection}`,
    );
  }
}
if (!downloadsBuilder.includes("publishedAtMs + 30 * 24 * 60 * 60 * 1_000")) {
  throw new Error("New release feeds must start with a thirty-day validity window.");
}
for (const requiredDownloadsBuilderControl of [
  "const updateFeedSigningKey",
  "const updateFeedEnabled",
  "if (updateFeedEnabled)",
  "Built downloads without signed update feed; LATEXDO_UPDATE_SIGNING_KEY is not configured.",
]) {
  if (!downloadsBuilder.includes(requiredDownloadsBuilderControl)) {
    throw new Error(
      `Downloads builder optional feed control is missing: ${requiredDownloadsBuilderControl}`,
    );
  }
}

const expectedHash = installer.match(
  /CLI_SHA256="\$\{LATEXDO_CLI_SHA256:-([a-f0-9]{64})\}"/,
)?.[1];
const actualHash = createHash("sha256").update(cli).digest("hex");
if (!expectedHash || expectedHash !== actualHash) {
  throw new Error(`CLI installer hash is stale: expected ${actualHash}.`);
}

console.log(
  `Verified single-workflow CI, CLI hash ${actualHash}, and update signing key.`,
);
