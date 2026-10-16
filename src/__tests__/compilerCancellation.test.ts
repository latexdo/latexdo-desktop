import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compileLatex } from "../../electron/compiler";

const tempDirectories: string[] = [];

async function makeTempProject(): Promise<string> {
  const projectPath = await mkdtemp(path.join(os.tmpdir(), "latexdo-compile-"));
  tempDirectories.push(projectPath);
  await writeFile(path.join(projectPath, "main.tex"), "\\documentclass{article}\n");
  return projectPath;
}

async function makeSleepingExecutable(projectPath: string): Promise<string> {
  const executable = path.join(
    projectPath,
    process.platform === "win32" ? "fake-latexmk.cmd" : "fake-latexmk",
  );
  const script =
    process.platform === "win32"
      ? "@echo off\r\necho started\r\nping -n 6 127.0.0.1 > nul\r\n"
      : "#!/bin/sh\necho started\nsleep 5\n";

  await writeFile(executable, script, { mode: 0o755 });
  return executable;
}

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("compile process cancellation", () => {
  it("times out and kills a long-running latexmk process", async () => {
    const projectPath = await makeTempProject();
    const executable = await makeSleepingExecutable(projectPath);

    const result = await compileLatex(
      {
        projectPath,
        rootFile: "main.tex",
        engine: "pdflatex",
      },
      {
        executable,
        timeoutMs: 100,
        killGraceMs: 100,
      },
    );

    expect(result.ok).toBe(false);
    expect(result.pdfPath).toBeUndefined();
    expect(result.error).toBe("LaTeX compile timed out after 1 second.");
  });

  it("cancels a running latexmk process through AbortSignal", async () => {
    const projectPath = await makeTempProject();
    const executable = await makeSleepingExecutable(projectPath);
    const controller = new AbortController();

    const resultPromise = compileLatex(
      {
        projectPath,
        rootFile: "main.tex",
        engine: "pdflatex",
      },
      {
        executable,
        signal: controller.signal,
        timeoutMs: 5_000,
        killGraceMs: 100,
      },
    );

    setTimeout(() => controller.abort(), 100);

    const result = await resultPromise;

    expect(result.ok).toBe(false);
    expect(result.pdfPath).toBeUndefined();
    expect(result.error).toBe("LaTeX compile canceled.");
  });
});
