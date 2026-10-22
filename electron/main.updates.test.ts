// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
// Startup, window lifecycle and failure handling of the Electron main process,
// booted repeatedly under different platforms, arguments and environments.
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { bootMain, fakeChild, H, teardownMain } from "./__tests__/mainHarness.js";

vi.mock("electron", async () =>
  (await import("./__tests__/mainHarness.js")).electronModule(),
);
vi.mock("./terminal.js", async () =>
  (await import("./__tests__/mainMocks.js")).terminalMock(),
);
vi.mock("./peerCollabIpc.js", async () =>
  (await import("./__tests__/mainMocks.js")).peerCollabMock(),
);
vi.mock("./buildInfo.js", async () =>
  (await import("./__tests__/mainMocks.js")).buildInfoMock(),
);
vi.mock("./ai/aiIpc.js", async () =>
  (await import("./__tests__/mainMocks.js")).aiIpcMock(),
);
vi.mock("./voiceStt.js", async () =>
  (await import("./__tests__/mainMocks.js")).voiceMock(),
);
vi.mock("./compiler.js", async (importOriginal) =>
  (await import("./__tests__/mainMocks.js")).compilerMock(await importOriginal()),
);
vi.mock("./docxImport.js", async () =>
  (await import("./__tests__/mainMocks.js")).docxMock(),
);
vi.mock("./pdfImport/index.js", async () =>
  (await import("./__tests__/mainMocks.js")).pdfImportMock(),
);
vi.mock("./synctex.js", async () =>
  (await import("./__tests__/mainMocks.js")).synctexMock(),
);
vi.mock("./orcid.js", async (importOriginal) =>
  (await import("./__tests__/mainMocks.js")).orcidMock(await importOriginal()),
);
vi.mock("node:child_process", async (importOriginal) =>
  (await import("./__tests__/mainWrappers.js")).wrapChildProcess(
    await importOriginal(),
  ),
);
vi.mock("node:fs", async (importOriginal) =>
  (await import("./__tests__/mainWrappers.js")).wrapFs(await importOriginal()),
);
vi.mock("node:fs/promises", async (importOriginal) =>
  (await import("./__tests__/mainWrappers.js")).wrapFsPromises(await importOriginal()),
);
vi.mock("./git.js", async (importOriginal) =>
  (await import("./__tests__/mainWrappers.js")).wrapGit(await importOriginal()),
);
vi.mock("./diagnostics.js", async (importOriginal) =>
  (await import("./__tests__/mainWrappers.js")).wrapDiagnostics(await importOriginal()),
);
vi.mock("./updatePending.js", async (importOriginal) =>
  (await import("./__tests__/mainWrappers.js")).overridable(
    await importOriginal<typeof import("./updatePending.js")>(),
    "pending",
    ["resolvePendingUpdate", "pendingUpdateAttemptLimitReached"],
  ),
);
vi.mock("./updateExperience.js", async (importOriginal) =>
  (await import("./__tests__/mainWrappers.js")).overridable(
    await importOriginal<typeof import("./updateExperience.js")>(),
    "experience",
    ["recordConfirmedUpdate", "recordLaunchedVersion"],
  ),
);
vi.mock("./releaseNotes.js", async (importOriginal) =>
  (await import("./__tests__/mainWrappers.js")).overridable(
    await importOriginal<typeof import("./releaseNotes.js")>(),
    "releaseNotes",
    ["resolveReleaseNotes", "resolveReleaseNotesRange"],
  ),
);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await teardownMain();
});

import { createHash, generateKeyPairSync, sign } from "node:crypto";
const keys = generateKeyPairSync("ed25519");
const installer = Buffer.from("inert test installer bytes");
function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
async function bootUpdater(
  platform: NodeJS.Platform = "darwin",
  options: {
    download?: () => Response | Promise<Response>;
    checksum?: string;
    spawnFailure?: boolean;
    extension?: string;
  } = {},
) {
  const ext =
    options.extension ??
    (platform === "darwin" ? "dmg" : platform === "win32" ? "exe" : "AppImage");
  const file = {
    id: "installer",
    label: "Installer",
    platform:
      platform === "darwin" ? "macos" : platform === "win32" ? "windows" : platform,
    arch: "arm64",
    filename: `LatexDo.${ext}`,
    url: `https://latexdo.org/downloads/v0.4.0/LatexDo.${ext}`,
    sha256: options.checksum ?? createHash("sha256").update(installer).digest("hex"),
  };
  const payload = {
    schemaVersion: 2,
    product: "LatexDo",
    channel: "stable",
    version: "0.4.0",
    release: "v0.4.0",
    commit: "a".repeat(40),
    publishedAt: new Date(Date.now() - 10000).toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    files: [file],
    releaseUrl: "https://latexdo.org/downloads/v0.4.0/",
  };
  const signed = {
    ...payload,
    signature: {
      algorithm: "ed25519",
      keyId: createHash("sha256")
        .update(keys.publicKey.export({ type: "spki", format: "der" }))
        .digest("hex")
        .slice(0, 16),
      value: sign(null, Buffer.from(canonical(payload)), keys.privateKey).toString(
        "base64",
      ),
    },
  };
  const spawn = vi.fn(() =>
    fakeChild(options.spawnFailure ? { error: new Error("spawn denied") } : {}),
  );
  const boot = await bootMain({
    platform,
    arch: "arm64",
    packaged: true,
    before: async ({ root, profile }) => {
      const executable =
        platform === "darwin"
          ? path.join(root, "LatexDo.app/Contents/MacOS/LatexDo")
          : path.join(root, platform === "win32" ? "LatexDo.exe" : "LatexDo.AppImage");
      await mkdir(path.dirname(executable), { recursive: true });
      await writeFile(executable, "installed app");
      H.paths.exe = executable;
      H.paths.downloads = path.join(root, "downloads");
      H.paths.temp = path.join(root, "temp");
      H.paths.logs = path.join(root, "logs");
      for (const p of [H.paths.downloads, H.paths.temp, H.paths.logs])
        await mkdir(p, { recursive: true });
      if (platform === "linux") process.env.APPIMAGE = executable;
      await writeFile(
        path.join(root, "update-public-key.pem"),
        keys.publicKey.export({ type: "spki", format: "pem" }),
      );
      H.spawn = spawn;
      H.fetch.mockImplementation(async (url: string) => {
        if (url.includes("/updates/")) return Response.json(signed);
        if (url === file.url) {
          if (options.download) return options.download();
          const response = new Response(installer, {
            headers: { "content-length": String(installer.length) },
          });
          Object.defineProperty(response, "url", { value: file.url });
          return response;
        }
        return new Response("missing", { status: 404 });
      });
    },
  });
  await vi.waitFor(() => expect(H.appEvents.has("activate")).toBe(true));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  return { boot, file, spawn };
}
describe("verified automatic update installation", () => {
  it.each(["darwin", "linux", "win32"] as const)(
    "verifies the installer and launches the %s helper with safe arguments",
    async (platform) => {
      const { boot, file, spawn } = await bootUpdater(platform);
      await writeFile(path.join(H.paths.downloads, file.filename), "existing download");
      const result = await boot.call("app:update-now");
      expect(result).toMatchObject({
        opened: true,
        quitScheduled: true,
        latestVersion: "0.4.0",
      });
      expect(result.installerPath).toContain("(1)");
      expect(await readFile(result.installerPath)).toEqual(installer);
      expect(spawn).toHaveBeenCalledOnce();
      const [command, args, options] = spawn.mock.calls[0] as unknown as [
        string,
        string[],
        any,
      ];
      expect(command).toBe(platform === "win32" ? "powershell.exe" : "/bin/sh");
      expect(options.env.LATEXDO_UPDATE_EXPECTED_VERSION).toBe("0.4.0");
      const helper = args.at(-1)!;
      expect(await readFile(helper, "utf8")).toContain("LATEXDO_UPDATE");
      const progress = boot.window.webContents.send.mock.calls
        .filter(([channel]: any[]) => channel === "app:update-progress")
        .map(([, payload]: any[]) => payload.status);
      expect(progress).toContain("downloading");
      expect(progress).toContain("verifying");
      await vi.advanceTimersByTimeAsync(15000);
      expect(H.quit).toHaveBeenCalled();
    },
  );
  it("rejects checksum mismatches and removes partial installer data", async () => {
    const { boot, spawn } = await bootUpdater("darwin", { checksum: "0".repeat(64) });
    const result = await boot.call("app:update-now");
    expect(result.opened).toBe(false);
    expect(result.error).toContain("checksum");
    expect(spawn).not.toHaveBeenCalled();
    expect(await readdir(H.paths.downloads)).toEqual([]);
    expect(await readdir(H.paths.temp)).toEqual([]);
  });
  it.each([
    ["HTTP error", () => new Response("down", { status: 503 }), "503"],
    ["missing body", () => new Response(null), "response body"],
    [
      "untrusted redirect",
      () => {
        const r = new Response(installer);
        Object.defineProperty(r, "url", { value: "https://evil.example/installer" });
        return r;
      },
      "untrusted host",
    ],
    [
      "oversized body",
      () => {
        const r = new Response(installer, {
          headers: { "content-length": "1500000001" },
        });
        Object.defineProperty(r, "url", {
          value: "https://latexdo.org/downloads/app.dmg",
        });
        return r;
      },
      "maximum download size",
    ],
  ] as const)(
    "rejects %s before executing an installer",
    async (_name, download, message) => {
      const { boot, spawn } = await bootUpdater("darwin", { download });
      const result = await boot.call("app:update-now");
      expect(result.error).toContain(message);
      expect(spawn).not.toHaveBeenCalled();
    },
  );
  it("records failed helper startup without scheduling a restart", async () => {
    const { boot } = await bootUpdater("darwin", { spawnFailure: true });
    const result = await boot.call("app:update-now");
    expect(result.error).toContain("spawn denied");
    expect(result.opened).toBe(false);
    expect(H.quit).not.toHaveBeenCalled();
  });
  it("falls back to the downloads page for a package unsuitable for automatic install", async () => {
    const { boot, spawn } = await bootUpdater("darwin", { extension: "zip" });
    const result = await boot.call("app:update-now");
    expect(result).toMatchObject({
      opened: true,
      manualDownload: true,
      automaticInstallAvailable: false,
    });
    expect(H.external).toHaveBeenCalledWith("https://latexdo.org/downloads/v0.4.0/");
    expect(spawn).not.toHaveBeenCalled();
  });
  it("serves release notes and validates the presented version", async () => {
    const boot = await bootMain({
      before: () => {
        H.overrides["releaseNotes.resolveReleaseNotesRange"] = async () => ({
          entries: [],
        });
      },
    });
    expect(await boot.call("app:whats-new")).toHaveProperty("shouldPresent");
    await expect(boot.call("app:whats-new-mark-presented", "9.9.9")).rejects.toThrow(
      "Invalid update version",
    );
    expect(await boot.call("app:whats-new-mark-presented", "0.3.0")).toEqual({
      ok: true,
    });
  });
});
