import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertCanonicalCompileInside } from "./compileTrust.js";

let root: string;

async function makeTree(): Promise<string> {
  const dir = await import("node:fs/promises")
    .then((fs) => fs.mkdtemp(path.join(tmpdir(), "latexdo-compile-trust-")))
    .then((p) => p);
  await mkdir(path.join(dir, "src"), { recursive: true });
  await mkdir(path.join(dir, "outside"), { recursive: true });
  await writeFile(path.join(dir, "main.tex"), "% main\n");
  await writeFile(path.join(dir, "src", "main.tex"), "% src main\n");
  return dir;
}

describe("compileTrust", () => {
  beforeEach(async () => {
    root = await makeTree();
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("accepts a root file inside the project", async () => {
    await expect(
      assertCanonicalCompileInside(root, path.join(root, "main.tex")),
    ).resolves.toBeUndefined();
    await expect(
      assertCanonicalCompileInside(root, path.join(root, "src", "main.tex")),
    ).resolves.toBeUndefined();
  });

  it("accepts the project root itself when it is a directory entry", async () => {
    await expect(
      assertCanonicalCompileInside(root, path.join(root, "src")),
    ).resolves.toBeUndefined();
  });

  it("rejects a root file whose resolution escapes via ../", async () => {
    const escaped = path.join(root, "src", "..", "..", "etc", "passwd");
    await expect(assertCanonicalCompileInside(root, escaped)).rejects.toThrow(
      /could not be found|escape|symbolic link/,
    );
  });

  it("rejects a directory symlink that escapes the project", async () => {
    await rm(path.join(root, "outside"), { recursive: true, force: true });
    await writeFile(path.join(root, "secret-target.tex"), "% secret\n");
    await symlink(path.join(root, "secret-target.tex"), path.join(root, "outside"));
    // A symlink named "src" that points outside the project.
    await rm(path.join(root, "src"), { recursive: true, force: true });
    await symlink(path.join(root, ".."), path.join(root, "src"));

    await expect(
      assertCanonicalCompileInside(root, path.join(root, "src", "main.tex")),
    ).rejects.toThrow(/escapes the open project via a symbolic link/);
  });

  it("rejects a file symlink that points out of the project", async () => {
    const outsideSecret = path.join(root, "..", `${path.basename(root)}-secret.tex`);
    await writeFile(outsideSecret, "% secret\n");
    const linkedPath = path.join(root, "linked-main.tex");
    await symlink(outsideSecret, linkedPath);

    await expect(assertCanonicalCompileInside(root, linkedPath)).rejects.toThrow(
      /escapes the open project via a symbolic link/,
    );
    await import("node:fs/promises").then((fs) =>
      fs.rm(outsideSecret, { force: true }),
    );
  });

  it("allows a missing root file that is lexically inside the project", async () => {
    // Missing files are not a trust violation; the compiler reports them.
    await expect(
      assertCanonicalCompileInside(root, path.join(root, "does-not-exist.tex")),
    ).resolves.toBeUndefined();
    // A missing file that would reach outside via ../ still cannot pass.
    await expect(
      assertCanonicalCompileInside(
        root,
        path.join(root, "src", "..", "..", "..", "nope.tex"),
      ),
    ).rejects.toThrow(/escape/);
  });
});
