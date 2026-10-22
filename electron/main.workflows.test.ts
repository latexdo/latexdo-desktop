// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
// Startup, window lifecycle and failure handling of the Electron main process,
// booted repeatedly under different platforms, arguments and environments.
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import path from "node:path";
import { bootMain, H, teardownMain } from "./__tests__/mainHarness.js";

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

describe("native application workflows", () => {
  it("reads external shared files while skipping metadata and symbolic links", async () => {
    const boot = await bootMain();
    const source = path.join(boot.root, "shared");
    await mkdir(path.join(source, "nested"), { recursive: true });
    await mkdir(path.join(source, ".git"));
    await mkdir(path.join(source, "node_modules"));
    await writeFile(path.join(source, "nested", "paper.tex"), "Hello π");
    await writeFile(path.join(source, "image.bin"), Buffer.from([0, 1, 2]));
    await writeFile(path.join(source, "invalid.bin"), Buffer.from([255, 254]));
    await writeFile(path.join(source, ".DS_Store"), "skip");
    await symlink(path.join(source, "nested"), path.join(source, "link"));
    const files = await boot.call("file:read-external-for-share", [
      source,
      path.join(source, "missing"),
    ]);
    expect(files).toHaveLength(3);
    expect(files).toContainEqual({
      sourcePath: path.join(source, "nested", "paper.tex"),
      relativePath: "shared/nested/paper.tex",
      content: "Hello π",
    });
    expect(files.find((f: any) => f.relativePath.endsWith("image.bin")).base64).toBe(
      "AAEC",
    );
    expect(files.find((f: any) => f.relativePath.endsWith("invalid.bin")).base64).toBe(
      "//4=",
    );
    H.open.mockResolvedValueOnce({ canceled: false, filePaths: [source] });
    expect(await boot.call("file:choose-external-for-share")).toEqual(files);
    expect(await boot.call("file:choose-external-for-share")).toEqual([]);
  });
  it("records bounded renderer diagnostics and rejects invalid payloads", async () => {
    const boot = await bootMain();
    await boot.call("app:renderer-diagnostic", {
      kind: "renderer-error",
      error: {
        name: "TypeError",
        message: "test failure",
        stack: "test stack",
        code: "E_TEST",
      },
      context: { text: "detail", n: 1, yes: true, empty: null, nested: { omit: true } },
    });
    await boot.call("app:renderer-diagnostic", {
      kind: "renderer-freeze",
      error: { message: "frozen" },
    });
    const log = await readFile(
      path.join(boot.profile, "diagnostics", "runtime.jsonl"),
      "utf8",
    );
    expect(log).toContain("test failure");
    expect(log).toContain("frozen");
    expect(log).not.toContain('"nested"');
    for (const payload of [
      { kind: "bad", error: { message: "x" } },
      { kind: "renderer-error", error: { message: "x" }, context: [] },
      { kind: "renderer-error", error: { message: "x" }, context: { bad: "a\0b" } },
    ])
      await expect(boot.call("app:renderer-diagnostic", payload)).rejects.toThrow();
  });
  it.each(["docx", "pdf"])("imports %s without an existing project", async (kind) => {
    const boot = await bootMain();
    const input = path.join(boot.root, `input.${kind}`);
    await writeFile(input, "fixture");
    const imported = {
      relativePath: "imported.tex",
      assetDirectory: "assets",
      mediaFiles: ["assets/image.png"],
      bibRelativePath: "references.bib",
    };
    const mock = kind === "docx" ? H.docxImport : H.pdfImport;
    mock.mockResolvedValue(imported);
    H.open.mockResolvedValueOnce({ canceled: false, filePaths: [input] });
    const result = await boot.call(`${kind}:import`, null);
    expect(result).toMatchObject(imported);
    expect(result.project.rootPath).toBe(boot.root);
    expect(mock).toHaveBeenCalledWith(boot.root, input);
    expect(await boot.call(`${kind}:import`, null)).toBeNull();
    await expect(boot.call(`${kind}:import`, "missing")).rejects.toThrow("not open");
  });
  it("compiles Asymptote and routes forward and backward SyncTeX", async () => {
    const boot = await bootMain();
    await writeFile(path.join(boot.root, "main.tex"), "source");
    await writeFile(path.join(boot.root, "drawing.asy"), "draw((0,0)--(1,1));");
    await writeFile(path.join(boot.root, "main.pdf"), "pdf");
    H.open.mockResolvedValueOnce({ canceled: false, filePaths: [boot.root] });
    const project = await boot.call("project:open");
    H.asymptote.mockResolvedValue({
      ok: true,
      diagnostics: [],
      pdfPath: path.join(boot.root, "drawing.pdf"),
    });
    expect(
      await boot.call("asymptote:compile", {
        projectId: project.id,
        relativePath: "drawing.asy",
      }),
    ).toMatchObject({ ok: true, pdfPath: "drawing.pdf" });
    H.forwardSyncTex.mockResolvedValue({ page: 1, x: 10, y: 20 });
    expect(
      await boot.call("synctex:forward", project.id, "main.pdf", "main.tex", 2, 3),
    ).toEqual({ page: 1, x: 10, y: 20 });
    expect(H.forwardSyncTex).toHaveBeenCalledWith(
      boot.root,
      path.join(boot.root, "main.pdf"),
      path.join(boot.root, "main.tex"),
      2,
      3,
    );
    H.backwardSyncTex.mockResolvedValue({ file: "main.tex", line: 2, column: 3 });
    expect(
      await boot.call("synctex:backward", project.id, "main.pdf", 1, 10, 20),
    ).toEqual({ file: "main.tex", line: 2, column: 3 });
    H.fetchOrcidProfile.mockResolvedValue({ name: "Ada" });
    expect(await boot.call("orcid:fetch-profile", "0000-0002-1825-0097")).toEqual({
      name: "Ada",
    });
  });
  it("validates Overleaf origins, handles cancellation and clones to a unique local folder", async () => {
    const boot = await bootMain();
    await expect(
      boot.call("provider:import-overleaf-project", "https://example.org/project"),
    ).rejects.toThrow("Overleaf Git URL");
    expect(
      await boot.call(
        "provider:import-overleaf-project",
        "https://git.overleaf.com/project",
      ),
    ).toBeNull();
    H.open.mockResolvedValueOnce({ canceled: false, filePaths: [boot.root] });
    H.runGitText = vi.fn(async (_cwd: string, args: string[]) => {
      if (args[0] === "clone") await mkdir(args.at(-1)!);
      return "";
    });
    const result = await boot.call(
      "provider:import-overleaf-project",
      "https://git.overleaf.com/project",
    );
    expect(result.rootPath).toBe(path.join(boot.root, "project"));
    expect(H.runGitText).toHaveBeenCalledWith(
      boot.root,
      [
        "clone",
        "--",
        "https://git.overleaf.com/project",
        path.join(boot.root, "project"),
      ],
      { maxBytes: 512 * 1024 },
    );
  });
});

it("prefixes Research Space import assets and SyncTeX results to the correct folder", async () => {
  const boot = await bootMain();
  const folder = path.join(boot.root, "Paper");
  await mkdir(folder);
  await writeFile(path.join(folder, "main.tex"), "source");
  await writeFile(path.join(folder, "main.pdf"), "pdf");
  const space = path.join(boot.root, "Study.latexdo-space");
  await writeFile(
    space,
    JSON.stringify({ folders: [{ name: "Paper", path: folder }] }),
  );
  H.open.mockResolvedValueOnce({ canceled: false, filePaths: [space] });
  const project = await boot.call("project:open");
  const prefix = project.researchSpace.folders[0].name;
  H.docxImport.mockResolvedValue({
    relativePath: "imported.tex",
    assetDirectory: "assets",
    bibRelativePath: "refs.bib",
    mediaFiles: ["assets/image.png"],
  });
  H.open.mockResolvedValueOnce({
    canceled: false,
    filePaths: [path.join(boot.root, "input.docx")],
  });
  const imported = await boot.call("docx:import", project.id);
  expect(imported).toMatchObject({
    relativePath: `${prefix}/imported.tex`,
    assetDirectory: `${prefix}/assets`,
    bibRelativePath: `${prefix}/refs.bib`,
    mediaFiles: [`${prefix}/assets/image.png`],
  });
  H.backwardSyncTex.mockResolvedValue({ file: "main.tex", line: 4, column: 1 });
  expect(
    await boot.call("synctex:backward", project.id, `${prefix}/main.pdf`, 1, 10, 20),
  ).toMatchObject({ file: `${prefix}/main.tex`, line: 4 });
});

it("routes native File and Help menu actions to the focused window or approved website", async () => {
  const boot = await bootMain();
  const template = H.menu.mock.calls.find(([items]) =>
    items.some((item: any) => item.label === "File"),
  )![0];
  const all = (items: any[]): any[] =>
    items.flatMap((item) => [item, ...all(item.submenu ?? [])]);
  const items = all(template);
  for (const [label, channel] of [
    ["New File...", "file:create-dialog"],
    ["New Folder...", "folder:create-dialog"],
    ["Open Folder or Research Space...", "file:open-project"],
    ["Word Document (DOCX)...", "file:import-docx"],
    ["Markdown...", "file:import-markdown"],
    ["PDF...", "file:import-pdf"],
    ["Close Tab", "file:close-tab"],
    ["Spell Checker...", "tools:open-spellchecker"],
    ["What's New", "app:open-whats-new"],
  ]) {
    items.find((item) => item.label === label).click();
    expect(boot.window.webContents.send).toHaveBeenCalledWith(channel);
  }
  for (const label of [
    "Check for Updates",
    "Report an Issue",
    "Support LatexDo ♥",
    "LatexDo Downloads",
  ])
    items.find((item) => item.label === label).click();
  expect(H.external).toHaveBeenCalledTimes(4);
  expect(H.external).toHaveBeenCalledWith(
    "https://github.com/latexdo/latexdo-desktop/issues/new",
  );
});
