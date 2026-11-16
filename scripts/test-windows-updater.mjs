// Destructive installer integration test: run only on a disposable Windows CI VM.
// Start from a released app and exercise its shipped helper as well as the new one.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";
import { extractFile, uncache } from "@electron/asar";
import { windowsUpdateHelper } from "../dist-electron/updateHelpers.js";
import { beginPendingUpdate } from "../dist-electron/updatePending.js";

if (process.platform !== "win32" || process.env.CI !== "true") {
  throw new Error("This test requires a disposable Windows CI runner.");
}
const exec = promisify(execFile);
const root = await mkdtemp(path.join(os.tmpdir(), "latexdo-update-test-"));
const target = path.join(root, "Installed LatexDo é [test]", "LatexDo.exe");
const archive = path.join(path.dirname(target), "resources/app.asar");
const log = path.join(root, "updater.log");
const failure = path.join(root, "failure.txt");
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const expectedBuild = JSON.parse(
  await readFile("dist-electron/build-info.json", "utf8"),
);
const installerDirectory = path.resolve("release/windows");
const installers = (await readdir(installerDirectory)).filter((f) =>
  f.endsWith(".exe"),
);
if (installers.length !== 1) throw new Error("Expected exactly one Windows installer.");
const candidate = path.join(installerDirectory, installers[0]);
const baseline = process.env.LATEXDO_BASELINE_INSTALLER || candidate;
const env = {
  ...process.env,
  LATEXDO_CRASH_REPORTS: "off",
  LATEXDO_UPDATE_INSTALLER: candidate,
  LATEXDO_UPDATE_TARGET_EXE: target,
  LATEXDO_UPDATE_EXPECTED_VERSION: version,
  LATEXDO_UPDATE_LOG: log,
  LATEXDO_UPDATE_FAILURE_FILE: failure,
  LATEXDO_TEST_BASELINE: baseline,
};
const evidence = path.resolve("test-results/windows-updater");
await mkdir(evidence, { recursive: true });
async function powershell(command) {
  return exec(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      command,
    ],
    {
      env,
      cwd: root,
      timeout: 240_000,
    },
  );
}
async function until(check, label, timeout = 60_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await delay(500);
  }
  throw new Error(`Timed out: ${label}`);
}
function installedJson(file) {
  uncache(archive);
  return JSON.parse(extractFile(archive, file).toString());
}
let helperProcess;
try {
  await powershell(`
    $ErrorActionPreference = 'Stop'
    $directory = Split-Path -Parent $env:LATEXDO_UPDATE_TARGET_EXE
    $p = Start-Process -FilePath $env:LATEXDO_TEST_BASELINE -ArgumentList "/S /D=$directory" -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "Initial installation failed: $($p.ExitCode)" }
  `);
  const oldBuild = installedJson("dist-electron/build-info.json");
  if (baseline !== candidate && oldBuild.commit === expectedBuild.commit) {
    throw new Error("Baseline must differ from the candidate build.");
  }
  let helperSource = windowsUpdateHelper;
  if (process.env.LATEXDO_TEST_HELPER === "released") {
    const modulePath = path.join(root, "released-helper.mjs");
    await writeFile(modulePath, extractFile(archive, "dist-electron/updateHelpers.js"));
    helperSource = (await import(pathToFileURL(modulePath).href)).windowsUpdateHelper;
  }
  const oldPackage = installedJson("package.json");
  const profile = path.join(
    process.env.APPDATA,
    oldPackage.productName || oldPackage.name,
  );
  await mkdir(profile, { recursive: true });
  const sentinel = path.join(profile, "updater-test-preserve.tex");
  const document =
    "\\documentclass{article}\n\\begin{document}Preserve my work.\\end{document}";
  await writeFile(sentinel, document);
  const oldApp = spawn(target, [], { cwd: path.dirname(target), env, stdio: "ignore" });
  const oldExit = new Promise((resolve, reject) => {
    oldApp.once("exit", resolve);
    oldApp.once("error", reject);
  });
  env.LATEXDO_UPDATE_APP_PID = String(oldApp.pid);
  await until(async () => {
    const result = await powershell(
      `$p = Get-Process -Id ${oldApp.pid} -ErrorAction Stop; if ($p.MainWindowHandle -ne 0) { 'ready' }`,
    );
    return result.stdout.includes("ready");
  }, "old application window");
  await beginPendingUpdate(profile, {
    fromVersion: oldPackage.version,
    expectedVersion: version,
    expectedCommit: expectedBuild.commit,
    installerSha256: createHash("sha256")
      .update(await readFile(candidate))
      .digest("hex"),
    installedPath: target,
  });
  const pendingPath = path.join(profile, "pending-update.json");
  const pending = JSON.parse(await readFile(pendingPath, "utf8"));
  env.LATEXDO_UPDATE_FAILURE_FILE = pending.failurePath;
  const helperDirectory = path.join(root, "helper");
  await mkdir(helperDirectory);
  const helper = path.join(helperDirectory, "run.ps1");
  await writeFile(helper, helperSource);
  helperProcess = exec(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", helper],
    {
      env,
      cwd: root,
      timeout: 240_000,
    },
  );
  // Attach immediately so an early PowerShell failure is not an unhandled rejection.
  helperProcess.catch(() => {});
  await until(
    async () =>
      (await readFile(log, "utf8").catch(() => "")).includes("Waiting for PID"),
    "helper startup",
  );
  await powershell(`
    $p = Get-Process -Id ${oldApp.pid} -ErrorAction Stop
    if (-not $p.CloseMainWindow()) { throw 'Could not request a normal application close' }
  `);
  await Promise.race([
    oldExit,
    delay(60_000).then(() => {
      throw new Error("Old app did not close normally");
    }),
  ]);
  await helperProcess;
  const contents = await readFile(log, "utf8");
  if (!contents.includes("Verification=PASS") || !contents.includes("RelaunchedPid=")) {
    throw new Error("Updater did not verify and relaunch the installed app.");
  }
  const newBuild = installedJson("dist-electron/build-info.json");
  if (newBuild.commit !== expectedBuild.commit)
    throw new Error("Installed build was not replaced!");
  await until(
    async () => JSON.parse(await readFile(pendingPath, "utf8")).state === "confirmed",
    "relaunched application confirmation",
  );
  if ((await readFile(sentinel, "utf8")) !== document)
    throw new Error("Existing user data was modified.");
  const receipt = {
    baseline: oldBuild.commit,
    installed: newBuild.commit,
    helper: process.env.LATEXDO_TEST_HELPER || "candidate",
    confirmed: JSON.parse(await readFile(pendingPath, "utf8")),
    userDataPreserved: true,
  };
  await writeFile(path.join(evidence, "result.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  const contents = await readFile(log, "utf8").catch(
    () => "No updater log was created.",
  );
  console.log(contents);
  await writeFile(path.join(evidence, "updater.log"), contents);
  // Stop only this isolated installation before uninstalling it.
  await powershell(`
    $directory = Split-Path -Parent $env:LATEXDO_UPDATE_TARGET_EXE
    $prefix = $directory + '\\'
    Get-CimInstance Win32_Process | Where-Object {
      $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    $uninstaller = Join-Path $directory 'Uninstall LatexDo.exe'
    if (Test-Path -LiteralPath $uninstaller) {
      Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait
    }
  `);
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 });
}
