// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import * as realFs from "node:fs/promises";

// The real repository inputs, which the script accepts; each case breaks one.
const real = {
  ".github/workflows/auto-merge.yml": await realFs.readFile(
    ".github/workflows/auto-merge.yml",
    "utf8",
  ),
  "package.json": await realFs.readFile("package.json", "utf8"),
  "electron/main.ts": await realFs.readFile("electron/main.ts", "utf8"),
  ".github/workflows/ci.yml": await realFs.readFile(".github/workflows/ci.yml", "utf8"),
  "scripts/renew-update-feed.mjs": await realFs.readFile(
    "scripts/renew-update-feed.mjs",
    "utf8",
  ),
  "scripts/build-downloads-page.mjs": await realFs.readFile(
    "scripts/build-downloads-page.mjs",
    "utf8",
  ),
};

async function verify({ files = {}, workflows = ["ci.yml"] } = {}) {
  const contents = { ...real, ...files };
  vi.resetModules();
  vi.doMock("node:fs/promises", () => ({
    readFile: async (file) => contents[file],
    readdir: async () => workflows,
  }));
  await import("./verify-supply-chain.mjs");
}

function withPackage(edit) {
  const pkg = JSON.parse(real["package.json"]);
  edit(pkg);
  return { "package.json": JSON.stringify(pkg) };
}

const without = (file, text) => ({ [file]: real[file].replaceAll(text, "") });

afterEach(() => {
  vi.doUnmock("node:fs/promises");
  vi.restoreAllMocks();
});

describe("verify-supply-chain", () => {
  it("accepts the repository and ignores non-YAML workflow files", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await verify({ workflows: ["README.md", "ci.yml"] });
    expect(log).toHaveBeenCalledWith(
      "Verified single-workflow CI and release publication controls.",
    );
  });

  it("accepts the merge-only workflow with tested-commit protections", async () => {
    await verify({ workflows: ["ci.yml", "auto-merge.yml"] });
  });

  it.each([
    "workflows: [latexdo-ci]",
    "github.event.workflow_run.event == 'pull_request'",
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.head_repository.full_name == github.repository",
    "admin|maintain|write)",
    'select(.name == "no-auto-merge")',
    ".[0].isDraft",
    '--match-head-commit "$HEAD_SHA"',
  ])("rejects missing auto-merge protection %s", async (control) => {
    await expect(
      verify({
        workflows: ["ci.yml", "auto-merge.yml"],
        files: without(".github/workflows/auto-merge.yml", control),
      }),
    ).rejects.toThrow(`Auto-merge protection is missing: ${control}`);
  });

  it("rejects code execution added to the merge workflow", async () => {
    await expect(
      verify({
        workflows: ["ci.yml", "auto-merge.yml"],
        files: {
          ".github/workflows/auto-merge.yml":
            real[".github/workflows/auto-merge.yml"] +
            "\n      - uses: actions/checkout@v4",
        },
      }),
    ).rejects.toThrow("Auto-merge must not check out");
  });

  it.each([
    [
      "a second workflow",
      { workflows: ["ci.yml", "deploy.yaml"] },
      "GitHub Actions may expose only ci.yml and auto-merge.yml: ci.yml, deploy.yaml",
    ],
    [
      "a renamed workflow",
      { workflows: ["main.yml"] },
      "GitHub Actions may expose only ci.yml and auto-merge.yml: main.yml",
    ],
    [
      "no build config",
      { files: withPackage((pkg) => delete pkg.build) },
      "Linux AppImage builds must use the static appimage toolset.",
    ],
    [
      "a dynamic AppImage toolset",
      { files: withPackage((pkg) => (pkg.build.toolsets.appimage = "0.0.0")) },
      "Linux AppImage builds must use the static appimage toolset.",
    ],
    [
      "no asar unpack rules",
      { files: withPackage((pkg) => delete pkg.build.asarUnpack) },
      "Native module unpack rule is missing: **/node_modules/node-pty/**",
    ],
    [
      "a missing update protection",
      { files: without("electron/main.ts", "older than previously trusted version") },
      "Desktop update protection is missing: older than previously trusted version",
    ],
    [
      "a forbidden deploy control",
      {
        files: {
          ".github/workflows/ci.yml": `${real[".github/workflows/ci.yml"]}\n# wrangler deploy`,
        },
      },
      "Single CI workflow contains forbidden control: wrangler deploy",
    ],
    [
      "a missing CI check",
      { files: without(".github/workflows/ci.yml", "npm run lint") },
      "CI control is missing: npm run lint",
    ],
    [
      "a missing release control",
      { files: without(".github/workflows/ci.yml", "group: latexdo-org-downloads") },
      "Release publication control is missing: group: latexdo-org-downloads",
    ],
    [
      "a missing renewal protection",
      {
        files: without("scripts/renew-update-feed.mjs", "immutableFeed(existingFeed)"),
      },
      "Update-feed renewal protection is missing: immutableFeed(existingFeed)",
    ],
    [
      "a shorter first feed window",
      {
        files: without(
          "scripts/build-downloads-page.mjs",
          "publishedAtMs + 30 * 24 * 60 * 60 * 1_000",
        ),
      },
      "New release feeds must start with a thirty-day validity window.",
    ],
    [
      "a mandatory signing key",
      { files: without("scripts/build-downloads-page.mjs", "if (updateFeedEnabled)") },
      "Downloads builder optional feed control is missing: if (updateFeedEnabled)",
    ],
  ])("rejects %s", async (_label, input, message) => {
    await expect(verify(input)).rejects.toThrow(message);
  });
});
