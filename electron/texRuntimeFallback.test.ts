import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findTexExecutable, setBundledTexBinLocator, texToolPath } from "./compiler.js";

let directory: string | null = null;

afterEach(async () => {
  setBundledTexBinLocator(async () => null);
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = null;
});

describe.skipIf(process.platform === "win32")("LatexDo-installed TeX fallback", () => {
  it("uses the bundled tool only when no system install is found", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "latexdo tex-"));
    const bundled = path.join(directory, "latexmk");
    await writeFile(bundled, "#!/bin/sh\n");
    await chmod(bundled, 0o755);

    expect(await findTexExecutable("latexmk", [])).toBeNull();
    setBundledTexBinLocator(async () => directory);
    expect(await findTexExecutable("latexmk", [])).toBe(bundled);
    expect(await findTexExecutable("latexmk", [bundled])).toBe(bundled);
    expect(await findTexExecutable("missing-tool", [])).toBeNull();
  });

  it("puts the tool's own directory first on PATH", () => {
    expect(texToolPath("/opt/tex dir/bin/latexmk").split(path.delimiter)[0]).toBe(
      "/opt/tex dir/bin",
    );
  });
});
