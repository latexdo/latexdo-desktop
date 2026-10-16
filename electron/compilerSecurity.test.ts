import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => {
  const spawn = vi.fn();
  return { spawn, default: { spawn } };
});
import { spawn } from "node:child_process";
import { compileAsymptote, compileLatex } from "./compiler.js";

let directory: string;
let root: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "latexdo-compiler-security-"));
  root = path.join(directory, "project");
  await mkdir(root);
  vi.mocked(spawn).mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    setTimeout(() => child.emit("close", 0), 0);
    return child as ReturnType<typeof spawn>;
  });
});
afterEach(async () => {
  vi.clearAllMocks();
  await rm(directory, { recursive: true, force: true });
});

describe("compiler security boundaries", () => {
  it("passes filenames beginning with a dash as absolute input paths", async () => {
    await compileLatex(
      { projectPath: root, rootFile: "-malicious.tex", engine: "pdflatex" },
      { executable: "fake-latexmk" },
    );
    expect(vi.mocked(spawn).mock.calls[0][1]?.at(-1)).toBe(
      path.join(root, "-malicious.tex"),
    );
    await compileAsymptote(
      { projectPath: root, relativePath: "-malicious.asy" },
      { executable: "fake-asy" },
    );
    expect(vi.mocked(spawn).mock.calls[1][1]?.at(-1)).toBe(
      path.join(root, "-malicious.asy"),
    );
  });
  it("does not create output through a symlink outside the project", async () => {
    const outside = path.join(directory, "outside");
    await mkdir(outside);
    await symlink(
      outside,
      path.join(root, ".latexdo"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      compileLatex(
        { projectPath: root, rootFile: "main.tex", engine: "pdflatex" },
        { executable: "fake-latexmk" },
      ),
    ).rejects.toThrow(/escapes/);
    await expect(
      compileAsymptote(
        { projectPath: root, relativePath: "main.asy" },
        { executable: "fake-asy" },
      ),
    ).rejects.toThrow(/escapes/);
    expect(spawn).not.toHaveBeenCalled();
  });
  it("rejects input traversal before starting an executable", async () => {
    await expect(
      compileLatex(
        { projectPath: root, rootFile: "../secret.tex", engine: "pdflatex" },
        { executable: "fake-latexmk" },
      ),
    ).rejects.toThrow(/escapes/);
    expect(spawn).not.toHaveBeenCalled();
  });
});
