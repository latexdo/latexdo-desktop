import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertProjectPath } from "./projectPaths.js";

let directory: string;
let root: string;
let outside: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "latexdo-paths-"));
  root = path.join(directory, "project");
  outside = path.join(directory, "outside");
  await mkdir(root);
  await mkdir(outside);
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("project filesystem containment", () => {
  it("allows nested creation and names beginning with two dots", async () => {
    await mkdir(path.join(root, "..notes"));
    await expect(
      assertProjectPath(root, path.join(root, "..notes", "new.tex")),
    ).resolves.toBeUndefined();
    await expect(
      assertProjectPath(root, path.join(root, "new", "nested", "file.tex")),
    ).resolves.toBeUndefined();
  });
  it("rejects traversal and sibling prefix collisions", async () => {
    await expect(
      assertProjectPath(root, path.join(directory, "project-other", "secret")),
    ).rejects.toThrow(/escapes/);
    await expect(
      assertProjectPath(root, path.join(root, "..", "secret")),
    ).rejects.toThrow(/escapes/);
  });
  it("rejects directory links for both reads and new writes", async () => {
    await writeFile(path.join(outside, "secret.tex"), "secret");
    await symlink(
      outside,
      path.join(root, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      assertProjectPath(root, path.join(root, "linked", "secret.tex")),
    ).rejects.toThrow(/escapes/);
    await expect(
      assertProjectPath(root, path.join(root, "linked", "new", "file.tex")),
    ).rejects.toThrow(/escapes/);
  });
  it("fails closed for dangling links", async () => {
    await symlink(
      path.join(outside, "missing"),
      path.join(root, "dangling"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      assertProjectPath(root, path.join(root, "dangling", "new.tex")),
    ).rejects.toThrow();
  });
  it("supports an explicitly opened symlink root and internal links", async () => {
    await mkdir(path.join(root, "real"));
    await symlink(
      path.join(root, "real"),
      path.join(root, "alias"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await symlink(
      root,
      path.join(directory, "opened"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      assertProjectPath(
        path.join(directory, "opened"),
        path.join(directory, "opened", "alias", "new.tex"),
      ),
    ).resolves.toBeUndefined();
  });
});
