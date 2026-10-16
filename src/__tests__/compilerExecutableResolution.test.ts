import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveExecutable } from "../../electron/compiler";

const tempDirectories: string[] = [];

async function makeTempDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "latexdo-exec-"));
  tempDirectories.push(directory);
  return directory;
}

async function makeExecutable(directory: string, basename: string): Promise<string> {
  const executable = path.join(directory, basename);
  const script =
    process.platform === "win32"
      ? "@echo off\r\necho fake tool\r\n"
      : "#!/bin/sh\necho fake tool\n";
  await writeFile(executable, script, { mode: 0o755 });
  return executable;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("compiler executable resolution", () => {
  it("resolves executable candidates from PATH", async () => {
    const directory = await makeTempDirectory();
    const basename = process.platform === "win32" ? "fake-latexmk.cmd" : "fake-latexmk";
    const executable = await makeExecutable(directory, basename);
    vi.stubEnv("PATH", directory);
    vi.stubEnv("PATHEXT", ".CMD;.EXE;.BAT;.COM");

    await expect(resolveExecutable(["fake-latexmk"])).resolves.toBe(executable);
  });

  it("resolves absolute executable candidates", async () => {
    const directory = await makeTempDirectory();
    const executable = await makeExecutable(directory, "absolute-latexmk");
    vi.stubEnv("PATH", "");

    await expect(resolveExecutable([executable])).resolves.toBe(executable);
  });

  it("returns null instead of guessing when a tool is unavailable", async () => {
    const directory = await makeTempDirectory();
    vi.stubEnv("PATH", directory);

    await expect(
      resolveExecutable([path.join(directory, "missing-latexmk"), "missing-latexmk"]),
    ).resolves.toBeNull();
  });
});
