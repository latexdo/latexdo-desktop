// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runGitText } from "./git.js";
import {
  compileRevisionPdf,
  parseCatFileBatch,
  parseLsFilesStageOutput,
  parseLsTreeOutput,
  readRevisionFileBytes,
  readRevisionProjectFiles,
} from "./gitRevisionPdf.js";
import { materializeCloudCompileFiles } from "./compiler.js";
import type { CompileResult } from "./types.js";

let root: string;
let cacheRoot: string;
const git = (...args: string[]) => runGitText(root, args);
async function commit(message: string) {
  await git("add", "--all");
  await git("commit", "-m", message);
  return (await git("rev-parse", "HEAD")).trim();
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "latexdo-revision-pdf-"));
  cacheRoot = await mkdtemp(path.join(os.tmpdir(), "latexdo-revision-cache-"));
  await git("init", "--initial-branch=main");
  await git("config", "user.name", "Test Author");
  await git("config", "user.email", "tests@example.invalid");
  await git("config", "commit.gpgsign", "false");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(cacheRoot, { recursive: true, force: true });
});

describe("parsers", () => {
  it("keeps regular files inside the project prefix", () => {
    const output = [
      "100644 blob aaa 12\tpaper/main.tex",
      "100755 blob bbb 3\tpaper/run.sh",
      "120000 blob ccc 9\tpaper/link",
      "160000 commit ddd -\tpaper/sub",
      "100644 blob eee 4\tother/file.tex",
      "",
    ].join("\0");
    expect(parseLsTreeOutput({ projectPrefix: "paper" }, output)).toEqual({
      entries: [
        { relativePath: "main.tex", objectId: "aaa", size: 12 },
        { relativePath: "run.sh", objectId: "bbb", size: 3 },
      ],
      skipped: ["link", "sub"],
    });
  });

  it("skips files over the size limit", () => {
    expect(
      parseLsTreeOutput(
        { projectPrefix: "" },
        `100644 blob aaa ${30 * 1024 * 1024}\tbig.pdf\0`,
      ),
    ).toEqual({ entries: [], skipped: ["big.pdf"] });
  });

  it("reads stage-0 index entries only", () => {
    const output = [
      "100644 aaa 0\tmain.tex",
      "100644 bbb 1\tconflict.tex",
      "100644 ccc 2\tconflict.tex",
    ].join("\0");
    expect(parseLsFilesStageOutput({ projectPrefix: "" }, output)).toEqual([
      { relativePath: "main.tex", objectId: "aaa", mode: "100644" },
    ]);
  });

  it("splits cat-file batch output, including binary content", () => {
    const binary = Buffer.from([0, 10, 255, 10]);
    const output = Buffer.concat([
      Buffer.from("aaa blob 2\nhi\n"),
      Buffer.from("bbb missing\n"),
      Buffer.from("ccc blob 4\n"),
      binary,
      Buffer.from("\n"),
    ]);
    const objects = parseCatFileBatch(output);
    expect(objects.get("aaa")?.toString()).toBe("hi");
    expect(objects.has("bbb")).toBe(false);
    expect(Buffer.from(objects.get("ccc")!)).toEqual(binary);
  });
});

describe("reading revisions from a real repository", () => {
  it("reads a tracked PDF at each revision", async () => {
    await writeFile(path.join(root, "paper.pdf"), "%PDF-1 first");
    const first = await commit("first");
    await writeFile(path.join(root, "paper.pdf"), "%PDF-1 staged");
    await git("add", "paper.pdf");
    await writeFile(path.join(root, "paper.pdf"), "%PDF-1 working");
    const text = (bytes: Uint8Array | null) =>
      bytes ? Buffer.from(bytes).toString() : null;

    expect(
      text(
        await readRevisionFileBytes(root, "paper.pdf", { kind: "commit", hash: first }),
      ),
    ).toBe("%PDF-1 first");
    expect(
      text(await readRevisionFileBytes(root, "paper.pdf", { kind: "index" })),
    ).toBe("%PDF-1 staged");
    expect(
      text(await readRevisionFileBytes(root, "paper.pdf", { kind: "working-tree" })),
    ).toBe("%PDF-1 working");
    expect(
      await readRevisionFileBytes(root, "paper.pdf", { kind: "empty" }),
    ).toBeNull();
    expect(
      await readRevisionFileBytes(root, "missing.pdf", { kind: "commit", hash: first }),
    ).toBeNull();
    expect(
      await readRevisionFileBytes(root, "missing.pdf", { kind: "working-tree" }),
    ).toBeNull();
    await expect(
      readRevisionFileBytes(root, "paper.pdf", { kind: "working-tree" }, 4),
    ).rejects.toThrow(/too large/);
  });

  it("snapshots a project subfolder at a commit and in the index", async () => {
    await mkdir(path.join(root, "paper", "figures"), { recursive: true });
    await mkdir(path.join(root, "paper", ".latexdo"), { recursive: true });
    await writeFile(path.join(root, "paper", "main.tex"), "v1");
    await writeFile(
      path.join(root, "paper", "figures", "a.png"),
      Buffer.from([0, 1, 2]),
    );
    await writeFile(path.join(root, "paper", ".latexdo", "junk.log"), "x");
    await writeFile(path.join(root, "README.md"), "outside");
    await symlink("main.tex", path.join(root, "paper", "link.tex"));
    const first = await commit("first");
    await writeFile(path.join(root, "paper", "main.tex"), "v2");
    await git("add", "paper/main.tex");

    const projectRoot = path.join(root, "paper");
    const atCommit = await readRevisionProjectFiles(projectRoot, {
      kind: "commit",
      hash: first,
    });
    expect(atCommit.files.map((file) => file.relativePath).sort()).toEqual([
      "figures/a.png",
      "main.tex",
    ]);
    expect(atCommit.skipped).toEqual(["link.tex"]);
    const main = atCommit.files.find((file) => file.relativePath === "main.tex")!;
    expect(Buffer.from(main.bytes!).toString()).toBe("v1");
    const png = atCommit.files.find((file) => file.relativePath === "figures/a.png")!;
    expect([...png.bytes!]).toEqual([0, 1, 2]);

    const inIndex = await readRevisionProjectFiles(projectRoot, { kind: "index" });
    expect(
      Buffer.from(
        inIndex.files.find((file) => file.relativePath === "main.tex")!.bytes!,
      ).toString(),
    ).toBe("v2");
    expect(inIndex.skipped).toEqual(["link.tex"]);
  });
});

describe("compileRevisionPdf", () => {
  async function fakeCompile(request: {
    projectPath: string;
    rootFile: string;
  }): Promise<CompileResult> {
    const source = await readFile(
      path.join(request.projectPath, request.rootFile),
      "utf8",
    );
    const pdfPath = path.join(request.projectPath, ".latexdo", "build", "main.pdf");
    await mkdir(path.dirname(pdfPath), { recursive: true });
    await writeFile(pdfPath, `%PDF ${source}`);
    return { ok: true, pdfPath, durationMs: 1, output: "ok", diagnostics: [] };
  }

  it("compiles a commit in a scratch folder and caches the PDF", async () => {
    await writeFile(path.join(root, "main.tex"), "version one");
    const first = await commit("first");
    await writeFile(path.join(root, "main.tex"), "version two");
    await commit("second");

    const compile = vi.fn(fakeCompile);
    const options = {
      projectRoot: root,
      rootFile: "main.tex",
      ref: { kind: "commit" as const, hash: first },
      engine: "pdflatex" as const,
      cacheRoot,
      materialize: materializeCloudCompileFiles,
      compile,
    };
    const result = await compileRevisionPdf(options);
    expect(result.ok).toBe(true);
    expect(result.cached).toBe(false);
    expect(Buffer.from(result.pdf!).toString()).toBe("%PDF version one");
    expect(compile).toHaveBeenCalledTimes(1);
    // The scratch sources are removed after the build.
    expect(existsSync(compile.mock.calls[0][0].projectPath)).toBe(false);

    const again = await compileRevisionPdf(options);
    expect(again).toMatchObject({ ok: true, cached: true });
    expect(Buffer.from(again.pdf!).toString()).toBe("%PDF version one");
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the index every time", async () => {
    await writeFile(path.join(root, "main.tex"), "committed");
    await commit("first");
    await writeFile(path.join(root, "main.tex"), "staged");
    await git("add", "main.tex");
    const compile = vi.fn(fakeCompile);
    const options = {
      projectRoot: root,
      rootFile: "main.tex",
      ref: { kind: "index" as const },
      engine: "pdflatex" as const,
      cacheRoot,
      materialize: materializeCloudCompileFiles,
      compile,
    };
    expect(Buffer.from((await compileRevisionPdf(options)).pdf!).toString()).toBe(
      "%PDF staged",
    );
    await compileRevisionPdf(options);
    expect(compile).toHaveBeenCalledTimes(2);
  });

  it("explains when the root file is missing or the build fails", async () => {
    await writeFile(path.join(root, "other.tex"), "x");
    const first = await commit("first");
    const base = {
      projectRoot: root,
      ref: { kind: "commit" as const, hash: first },
      engine: "pdflatex" as const,
      cacheRoot,
      materialize: materializeCloudCompileFiles,
    };
    expect(
      await compileRevisionPdf({ ...base, rootFile: "main.tex", compile: fakeCompile }),
    ).toMatchObject({ ok: false, error: "main.tex does not exist in this revision." });
    expect(
      await compileRevisionPdf({
        ...base,
        rootFile: "other.tex",
        compile: async () => ({
          ok: false,
          durationMs: 1,
          output: "! Undefined control sequence.",
          diagnostics: [],
        }),
      }),
    ).toMatchObject({
      ok: false,
      output: "! Undefined control sequence.",
      error: "This revision did not compile.",
    });
  });
});
