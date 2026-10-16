// @vitest-environment node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { linuxUpdateHelper, macUpdateHelper } from "./updateHelpers.js";
import { runUpdateVersionProbe } from "./updateVersionProbe.js";

const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "latexdo-updater-test-"));
  roots.push(root);
  await mkdir(path.join(root, "helper"));
  return root;
}
async function executable(file: string, contents: string) {
  await writeFile(file, contents, { mode: 0o755 });
}
function fakeApp(version: string, supportsProbe = true) {
  return `#!/bin/sh
if [ "\${1:-}" = "--latexdo-verify-update" ]; then
  ${supportsProbe ? `[ "$2" = "${version}" ] || exit 1\n  printf '%s' "$2" > "$3"` : "exit 0"}
  exit 0
fi
printf '%s' '${version}' > "$TEST_RELAUNCHED"
`;
}
async function runHelper(root: string, script: string, extra: NodeJS.ProcessEnv) {
  const helper = path.join(root, "helper/run.sh");
  await writeFile(helper, script);
  return exec("/bin/sh", [helper], {
    timeout: 10000,
    env: {
      ...process.env,
      LATEXDO_UPDATE_APP_PID: "2147483647",
      LATEXDO_UPDATE_EXPECTED_VERSION: "1.5.0",
      LATEXDO_UPDATE_LOG: path.join(root, "updater.log"),
      LATEXDO_UPDATE_FAILURE_FILE: path.join(root, "failure.txt"),
      TEST_RELAUNCHED: path.join(root, "relaunched.txt"),
      ...extra,
    },
  });
}
async function relaunched(root: string, version: string) {
  await expect
    .poll(() => readFile(path.join(root, "relaunched.txt"), "utf8"))
    .toBe(version);
}

describe("installed application probe", () => {
  it("only writes a receipt for a matching packaged runtime version", async () => {
    const root = await fixture();
    const receipt = path.join(root, "receipt");
    const args = ["LatexDo", "--latexdo-verify-update", "1.5.0", receipt];
    expect(runUpdateVersionProbe(args, false, "1.5.0")).toBe(1);
    expect(runUpdateVersionProbe(args, true, "1.4.0")).toBe(1);
    await expect(readFile(receipt)).rejects.toThrow();
    expect(runUpdateVersionProbe(args, true, "1.5.0")).toBe(0);
    expect(await readFile(receipt, "utf8")).toBe("1.5.0");
    expect(runUpdateVersionProbe(args, true, "1.5.0")).toBe(1);
    expect(runUpdateVersionProbe(["LatexDo"], true, "1.5.0")).toBeNull();
  });
});

describe.skipIf(process.platform === "win32")(
  "Linux full application replacement",
  () => {
    it.each([
      { version: "1.5.0", probe: true, success: true },
      { version: "1.4.0", probe: true, success: false },
      { version: "1.5.0", probe: false, success: false },
    ])("replaces and verifies the target: %j", async ({ version, probe, success }) => {
      const root = await fixture();
      const target = path.join(root, "Installed LatexDo.AppImage");
      const replacement = path.join(root, "Downloaded LatexDo.AppImage");
      await executable(target, fakeApp("1.4.0"));
      await executable(replacement, fakeApp(version, probe));
      const result = runHelper(root, linuxUpdateHelper, {
        LATEXDO_UPDATE_TARGET_APPIMAGE: target,
        LATEXDO_UPDATE_APPIMAGE: replacement,
      });
      if (success) {
        await result;
        expect(await readFile(target, "utf8")).toBe(fakeApp("1.5.0"));
        await expect(readFile(path.join(root, "failure.txt"))).rejects.toThrow();
        await relaunched(root, "1.5.0");
      } else {
        await expect(result).rejects.toThrow();
        expect(await readFile(target, "utf8")).toBe(fakeApp("1.4.0"));
        expect(await readFile(path.join(root, "failure.txt"), "utf8")).toContain(
          "Update failed",
        );
        await relaunched(root, "1.4.0");
      }
    });
  },
);

describe.skipIf(process.platform !== "darwin")("macOS bundle replacement", () => {
  it.each([
    { plistVersion: "1.5.0", runtimeVersion: "1.5.0", success: true },
    { plistVersion: "1.4.0", runtimeVersion: "1.4.0", success: false },
    { plistVersion: "1.5.0", runtimeVersion: "1.4.0", success: false },
  ])(
    "verifies plist and packaged runtime, preserving the old bundle on failure: %j",
    async ({ plistVersion, runtimeVersion, success }) => {
      const root = await fixture();
      const source = path.join(root, "Source LatexDo.app");
      const target = path.join(root, "Installed LatexDo.app");
      const bin = path.join(root, "bin");
      await mkdir(bin);
      for (const bundle of [source, target])
        await mkdir(path.join(bundle, "Contents/MacOS"), { recursive: true });
      await executable(path.join(target, "Contents/MacOS/LatexDo"), fakeApp("1.4.0"));
      await executable(
        path.join(source, "Contents/MacOS/LatexDo"),
        fakeApp(runtimeVersion),
      );
      await writeFile(
        path.join(source, "Contents/Info.plist"),
        `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${plistVersion}</string></dict></plist>`,
      );
      // Exercise the real replacement commands and PlistBuddy; substitute only
      // image mounting and GUI launch, which are outside this filesystem test.
      await executable(
        path.join(bin, "hdiutil"),
        '#!/bin/sh\nif [ "$1" = attach ]; then\n for mount do :; done\n cp -R "$TEST_SOURCE" "$mount/LatexDo.app"\nelse\n rm -rf "$2/LatexDo.app"\nfi\n',
      );
      await executable(
        path.join(bin, "open"),
        '#!/bin/sh\n"$2/Contents/MacOS/LatexDo"\n',
      );
      const result = runHelper(root, macUpdateHelper, {
        PATH: `${bin}:${process.env.PATH}`,
        TEST_SOURCE: source,
        LATEXDO_UPDATE_TARGET_APP: target,
        LATEXDO_UPDATE_EXECUTABLE_NAME: "LatexDo",
        LATEXDO_UPDATE_DMG: path.join(root, "download.dmg"),
      });
      if (success) await result;
      else await expect(result).rejects.toThrow();
      const expected = success ? "1.5.0" : "1.4.0";
      expect(await readFile(path.join(target, "Contents/MacOS/LatexDo"), "utf8")).toBe(
        fakeApp(expected),
      );
      await relaunched(root, expected);
      if (!success)
        expect(await readFile(path.join(root, "failure.txt"), "utf8")).toContain(
          "Update failed",
        );
    },
  );
});
