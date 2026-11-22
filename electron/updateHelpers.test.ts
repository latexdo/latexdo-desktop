// @vitest-environment node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  linuxUpdateHelper,
  macUpdateHelper,
  windowsUpdateHelper,
} from "./updateHelpers.js";
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

it.skipIf(process.platform !== "win32" || !process.env.CI)(
  "reproduces cross-volume Windows rename failure and verifies destination-volume staging",
  async () => {
    const sourceRoot = await fixture();
    const destinationRoot = await mkdtemp(
      path.join(process.cwd(), ".updater-download-test-"),
    );
    roots.push(destinationRoot);
    // Hosted Windows runners place TEMP on C: and the checkout on D:.
    expect(path.parse(sourceRoot).root.toLowerCase()).not.toBe(
      path.parse(destinationRoot).root.toLowerCase(),
    );
    const source = path.join(sourceRoot, "installer.download");
    const destination = path.join(destinationRoot, "installer.exe");
    await writeFile(source, "verified installer bytes");
    await expect(rename(source, destination)).rejects.toMatchObject({ code: "EXDEV" });
    const staged = path.join(destinationRoot, "installer.download");
    await writeFile(staged, await readFile(source));
    await rename(staged, destination);
    expect(await readFile(destination, "utf8")).toBe("verified installer bytes");
  },
);

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

// PowerShell is not available on every CI runner, so these pin the Windows
// helper's behaviour that broke real updates.
describe("Windows update helper", () => {
  const lines = windowsUpdateHelper.split("\r\n");
  const indexOf = (needle: string) => lines.findIndex((line) => line.includes(needle));

  it("reads the probe handle before waiting so Windows PowerShell 5.1 reports its exit code", () => {
    const handle = indexOf("$probe.Handle");
    const wait = indexOf("$probe.WaitForExit(");
    expect(handle).toBeGreaterThan(-1);
    expect(handle).toBeLessThan(wait);
    expect(windowsUpdateHelper).toContain("$null -ne $probeExitCode");
  });

  it("runs the NSIS installer as an update with the install directory last", () => {
    expect(windowsUpdateHelper).toContain('"--updated /S /D=$Directory"');
  });

  it("waits for every process in the install directory instead of failing after 60 seconds", () => {
    expect(windowsUpdateHelper).not.toContain("Wait-Process -Id $appPid -Timeout 60");
    expect(windowsUpdateHelper).toContain("-TimeoutSeconds 300");
    expect(
      indexOf("Stop-InstallDirectoryProcesses -Directory $targetDirectory"),
    ).toBeLessThan(indexOf("Invoke-LatexDoInstaller -Installer $installer"));
  });

  it("waits for the installer itself, bounded, instead of every process it starts", () => {
    const start = indexOf("function Invoke-LatexDoInstaller");
    const end = lines.findIndex((line, index) => index > start && line === "}");
    const body = lines
      .slice(start, end)
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    expect(body).toContain("Start-Process -FilePath $Installer");
    expect(body).not.toMatch(/Start-Process[^\n]*-Wait/);
    expect(body.indexOf("$process.Handle")).toBeGreaterThan(-1);
    expect(body.indexOf("$process.Handle")).toBeLessThan(
      body.indexOf("$process.WaitForExit($installerTimeoutSeconds * 1000)"),
    );
    expect(body).toContain("-Label 'StuckProcess'");
  });

  it("writes the log as UTF-8 so non-ASCII install paths stay readable", () => {
    expect(windowsUpdateHelper).toContain(
      "Add-Content -LiteralPath $logFile -Encoding UTF8",
    );
  });

  it("never stops processes for a drive root or empty install directory", () => {
    expect(windowsUpdateHelper).toContain(
      "if (-not (Test-SafeInstallDirectory -Directory $Directory)) { return @() }",
    );
  });

  it("also matches leftover processes against the canonical long install path", () => {
    const start = indexOf("function Get-InstallDirectoryProcesses");
    const body = lines.slice(start, indexOf("function Wait-ForProcessExit")).join("\n");
    expect(body).toContain("$script:canonicalTargetDirectory");
    expect(windowsUpdateHelper).toContain(
      "$script:canonicalTargetDirectory = Split-Path -Parent $env:LATEXDO_UPDATE_TARGET_CANONICAL_EXE",
    );
  });

  it("reopens LatexDo after a failure once the old process has exited", () => {
    const catchBlock = lines.slice(lines.lastIndexOf("} catch {")).join("\n");
    expect(catchBlock).toContain("Wait-ForProcessExit -ProcessId $appPid");
    expect(catchBlock).toContain("Start-Process -FilePath $targetExe");
  });
});

describe("NSIS silent update", () => {
  it("never waits on an unanswerable dialog when the old uninstaller fails", async () => {
    // electron-builder's default check shows "uninstall failed" without /SD, and NSIS
    // shows such boxes even under /S: the hidden dialog hung every silent update.
    const include = await readFile(
      path.join(process.cwd(), "build", "installer.nsh"),
      "utf8",
    );
    expect(include).toContain("!macro customUnInstallCheck\n");
    expect(include).toContain("!macro customUnInstallCheckCurrentUser\n");
    for (const line of include.split("\n").filter((l) => l.includes("MessageBox"))) {
      expect(line).toContain("/SD ");
    }
    expect(include).toContain("SetErrorLevel 2");
  });
});
