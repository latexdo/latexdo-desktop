// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const afterPack = require("./after-pack-linux.cjs");

let root = null;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

/** Packs a fake app whose "binary" prints its arguments, one per line. */
async function pack(flags = {}) {
  root = mkdtempSync(path.join(os.tmpdir(), "latexdo launcher-"));
  const appOutDir = path.join(root, "app");
  const procRoot = path.join(root, "proc");
  mkdirSync(appOutDir);
  for (const [name, value] of Object.entries(flags)) {
    const file = path.join(procRoot, "sys", name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${value}\n`);
  }
  const executable = path.join(appOutDir, "latexdo");
  writeFileSync(executable, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
  chmodSync(executable, 0o755);
  await afterPack({
    electronPlatformName: "linux",
    appOutDir,
    packager: { executableName: "latexdo" },
  });
  writeFileSync(executable, afterPack.linuxLauncherScript("latexdo", procRoot));
  return (...args) =>
    execFileSync(executable, args, { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);
}

describe.skipIf(process.platform === "win32")("Linux launcher", () => {
  it("keeps the sandbox when user namespaces are available", async () => {
    const run = await pack({ "kernel/apparmor_restrict_unprivileged_userns": 0 });
    expect(run("--smoke-test", "a b")).toEqual(["--smoke-test", "a b"]);
  });

  it.each([
    ["kernel/apparmor_restrict_unprivileged_userns", 1],
    ["kernel/unprivileged_userns_clone", 0],
    ["user/max_user_namespaces", 0],
  ])("disables the sandbox when %s is %s", async (name, value) => {
    const run = await pack({ [name]: value });
    expect(run("project dir")).toEqual(["--no-sandbox", "project dir"]);
  });

  it("does not add the flag twice", async () => {
    const run = await pack({ "kernel/apparmor_restrict_unprivileged_userns": 1 });
    expect(run("--no-sandbox")).toEqual(["--no-sandbox"]);
  });

  it("leaves other platforms untouched", async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "latexdo launcher-"));
    const executable = path.join(root, "latexdo");
    writeFileSync(executable, "binary");
    await afterPack({
      electronPlatformName: "darwin",
      appOutDir: root,
      packager: { executableName: "latexdo" },
    });
    expect(readFileSync(executable, "utf8")).toBe("binary");
  });
});
