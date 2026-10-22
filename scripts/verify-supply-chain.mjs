import { readFile, readdir } from "node:fs/promises";

const [
  appPackage,
  electronMain,
  ciWorkflow,
  renewalScript,
  downloadsBuilder,
  workflowFiles,
] = await Promise.all([
  readFile("package.json", "utf8").then(JSON.parse),
  readFile("electron/main.ts", "utf8"),
  readFile(".github/workflows/ci.yml", "utf8"),
  readFile("scripts/renew-update-feed.mjs", "utf8"),
  readFile("scripts/build-downloads-page.mjs", "utf8"),
  readdir(".github/workflows"),
]);

const workflowYamlFiles = workflowFiles
  .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
  .sort();
if (
  !workflowYamlFiles.includes("ci.yml") ||
  workflowYamlFiles.some((file) => !["ci.yml", "auto-merge.yml"].includes(file))
) {
  throw new Error(
    `GitHub Actions may expose only ci.yml and auto-merge.yml: ${workflowYamlFiles.join(", ")}`,
  );
}

// The merge-only workflow was added separately from the release pipeline. It
// must retain the tested-commit and same-repository protections.
if (workflowYamlFiles.includes("auto-merge.yml")) {
  const mergeWorkflow = await readFile(".github/workflows/auto-merge.yml", "utf8");
  for (const control of [
    "workflows: [latexdo-ci]",
    "github.event.workflow_run.event == 'pull_request'",
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.head_repository.full_name == github.repository",
    "admin|maintain|write)",
    'select(.name == "no-auto-merge")',
    ".[0].isDraft",
    '--match-head-commit "$HEAD_SHA"',
  ]) {
    if (!mergeWorkflow.includes(control)) {
      throw new Error(`Auto-merge protection is missing: ${control}`);
    }
  }
  if (/uses:|checkout|npm |wrangler|LATEXDO_UPDATE_SIGNING_KEY/.test(mergeWorkflow)) {
    throw new Error(
      "Auto-merge must not check out, execute, or publish repository code.",
    );
  }
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

console.log("Verified single-workflow CI and release publication controls.");
