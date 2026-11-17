// Destructive installer integration test: run only on a disposable Windows CI VM.
//
// Existing users update with the code of the LatexDo they already have, so a fix
// that ships in the new build cannot change how they download it. This test
// installs a released build and lets that installed app check, download and
// start the update itself, exactly as the Update button does:
//
// - latexdo.org resolves to a local HTTPS server (hosts file + test certificate)
//   that serves feeds built by the production scripts/build-downloads-page.mjs;
// - the installed app's update-public-key.pem is replaced by a test key, so the
//   signed feed can be produced without the production signing secret. Nothing
//   else in the installed app is changed.
//
// Scenarios (LATEXDO_SELF_UPDATE_SCENARIO):
//   same-volume   TEMP and Downloads on one drive: automatic update must succeed.
//   cross-volume  TEMP on another drive than Downloads. Released builds up to
//                 build 183 stage downloads in TEMP and rename them into
//                 Downloads, which Windows rejects across drives (EXDEV).
//                 LATEXDO_EXPECT_CROSS_VOLUME=fails asserts that known failure;
//                 "succeeds" asserts a full update once baselines carry the fix.
//   manual        The one-time rollout: latexdo.org keeps the previous signed
//                 feed and only the downloads manifest lists the new build. The
//                 app must send the user to the downloads page, and running the
//                 downloaded installer over the existing installation must
//                 upgrade it in place and keep user data.
import { execFile, spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { extractFile, uncache } from "@electron/asar";

if (process.platform !== "win32" || process.env.CI !== "true") {
  throw new Error("This test requires a disposable Windows CI runner.");
}
// The workflow step runs under PowerShell 7. Its module path makes every Windows
// PowerShell 5.1 child (ours, the updater helper's and the installer's own process
// checks) load 7.x modules and lose the Cert: drive and CIM cmdlets. LatexDo started
// from Explorer has no such variable, so remove it for everything this test starts.
delete process.env.PSModulePath;

const exec = promisify(execFile);
const repository = process.cwd();
const scenario = process.env.LATEXDO_SELF_UPDATE_SCENARIO;
if (!["same-volume", "cross-volume", "manual"].includes(scenario)) {
  throw new Error(`Unknown LATEXDO_SELF_UPDATE_SCENARIO: ${scenario}`);
}
const expectCrossVolume = process.env.LATEXDO_EXPECT_CROSS_VOLUME ?? "fails";
if (!["fails", "succeeds"].includes(expectCrossVolume)) {
  throw new Error(`Unknown LATEXDO_EXPECT_CROSS_VOLUME: ${expectCrossVolume}`);
}
const baselineInstaller = process.env.LATEXDO_BASELINE_INSTALLER;
const baselineTag = process.env.LATEXDO_BASELINE_TAG;
if (!baselineInstaller || !baselineTag) {
  throw new Error("LATEXDO_BASELINE_INSTALLER and LATEXDO_BASELINE_TAG are required.");
}

const { version } = JSON.parse(await readFile("package.json", "utf8"));
const expectedBuild = JSON.parse(
  await readFile("dist-electron/build-info.json", "utf8"),
);
const installerDirectory = path.resolve("release/windows");
const installers = (await readdir(installerDirectory)).filter((f) =>
  f.endsWith(".exe"),
);
if (installers.length !== 1) throw new Error("Expected exactly one Windows installer.");
const candidateInstaller = path.join(installerDirectory, installers[0]);

const evidence = path.resolve("test-results/windows-self-update");
await mkdir(evidence, { recursive: true });
const root = await mkdtemp(path.join(os.tmpdir(), "latexdo-self-update-"));
const inspectorPort = 9231;
const hostsPath = path.join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "drivers",
  "etc",
  "hosts",
);
const requestLog = [];
const steps = [];

function note(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  steps.push(line);
  console.log(line);
}

async function powershell(command, options = {}) {
  const { stdout } = await exec(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      command,
    ],
    { cwd: root, timeout: 240_000, maxBuffer: 16 * 1024 * 1024, ...options },
  );
  return stdout.trim();
}

/** Stops a wait immediately instead of being retried until the timeout. */
class FatalError extends Error {}

async function until(check, label, timeout = 60_000) {
  const end = Date.now() + timeout;
  let lastError;
  while (Date.now() < end) {
    try {
      if (await check()) return;
    } catch (error) {
      if (error instanceof FatalError) throw error;
      lastError = error;
    }
    await delay(500);
  }
  throw new Error(
    `Timed out: ${label}${lastError ? ` (last error: ${lastError})` : ""}`,
  );
}

function drive(value) {
  return path.parse(path.resolve(value)).root.toLowerCase();
}

function installedBuild(installDirectory) {
  const archive = path.join(installDirectory, "resources", "app.asar");
  uncache(archive);
  return JSON.parse(extractFile(archive, "dist-electron/build-info.json").toString());
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Installed LatexDo entries from the per-user and machine uninstall registry. */
async function installedEntries() {
  const json = await powershell(`
    $items = @(Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' -ErrorAction SilentlyContinue |
      Get-ItemProperty | Where-Object { $_.DisplayName -like 'LatexDo*' } |
      ForEach-Object { [pscustomobject]@{ name = [string]$_.DisplayName; icon = [string]$_.DisplayIcon; uninstall = [string]$_.UninstallString } })
    ConvertTo-Json -Compress -InputObject $items
  `);
  const entries = JSON.parse(json || "[]");
  return Array.isArray(entries) ? entries : [entries];
}

function executableFromEntry(entry) {
  const icon = entry.icon.replace(/,\s*-?\d+$/, "").replace(/^"|"$/g, "");
  if (icon.toLowerCase().endsWith(".exe")) return icon;
  const uninstaller = entry.uninstall.match(/^"([^"]+)"|^(\S+)/);
  const directory = path.dirname(uninstaller?.[1] ?? uninstaller?.[2] ?? "");
  return path.join(directory, "LatexDo.exe");
}

async function runInstaller(installer, args) {
  // Start-Process keeps the NSIS exit code, which a direct spawn loses on elevation.
  const code = await powershell(
    `$p = Start-Process -FilePath $env:LATEXDO_TEST_INSTALLER -ArgumentList $env:LATEXDO_TEST_INSTALLER_ARGS -Wait -PassThru; $p.ExitCode`,
    {
      env: {
        ...process.env,
        LATEXDO_TEST_INSTALLER: installer,
        LATEXDO_TEST_INSTALLER_ARGS: args,
      },
    },
  );
  if (code !== "0")
    throw new Error(`${path.basename(installer)} ${args} exited with ${code}`);
}

/** Evaluates an expression in the installed app's main process through its inspector. */
async function evaluateInApp(expression, timeout = 30_000) {
  const targets = await (
    await fetch(`http://127.0.0.1:${inspectorPort}/json/list`, {
      signal: AbortSignal.timeout(5_000),
    })
  ).json();
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(`Inspector evaluation timed out: ${expression.slice(0, 80)}`),
          ),
        timeout,
      );
      socket.addEventListener("error", (error) => {
        clearTimeout(timer);
        reject(new Error(`Inspector socket error: ${error.message ?? error.type}`));
      });
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (message.id !== 1) return;
        clearTimeout(timer);
        const details = message.error ?? message.result?.exceptionDetails;
        if (details) reject(new Error(JSON.stringify(details)));
        else resolve(message.result.result.value);
      });
      socket.addEventListener(
        "open",
        () =>
          socket.send(
            JSON.stringify({
              id: 1,
              method: "Runtime.evaluate",
              params: {
                // The inspector context has no require; reach Electron the same way the app does.
                expression: `(async () => {
                  const electron = process.getBuiltinModule("module").createRequire(process.execPath)("electron");
                  return JSON.stringify(await (${expression})(electron));
                })()`,
                awaitPromise: true,
                returnByValue: true,
              },
            }),
          ),
        { once: true },
      );
    }).then((value) => JSON.parse(value));
  } finally {
    socket.close();
  }
}

/** Runs the production downloads builder with a test signing key into the local site. */
async function buildSite({
  site,
  installer,
  commit,
  slug,
  publishedAt,
  signedFeed,
  keys,
}) {
  const builder = await mkdtemp(path.join(root, "feed-builder-"));
  const artifacts = path.join(builder, "artifacts");
  await mkdir(path.join(builder, "build"), { recursive: true });
  await mkdir(artifacts);
  await copyFile(
    path.join(repository, "package.json"),
    path.join(builder, "package.json"),
  );
  await writeFile(path.join(builder, "build", "update-public-key.pem"), keys.publicPem);
  await copyFile(installer, path.join(artifacts, "LatexDo-windows-x64.exe"));
  // The builder lists every platform; only the Windows file is ever downloaded here.
  for (const other of [
    "LatexDo-macos-arm64.dmg",
    "LatexDo-macos-x64.dmg",
    "LatexDo-linux-x64.AppImage",
  ]) {
    await writeFile(path.join(artifacts, other), `placeholder for ${other}\n`);
  }
  await exec(
    process.execPath,
    [
      path.join(repository, "scripts", "build-downloads-page.mjs"),
      artifacts,
      path.join(site, "downloads"),
    ],
    {
      cwd: builder,
      env: {
        ...process.env,
        LATEXDO_DOWNLOAD_BASE_URL: "https://latexdo.org",
        LATEXDO_RELEASE_VERSION: version,
        LATEXDO_RELEASE_SLUG: slug,
        LATEXDO_RELEASE_COMMIT: commit,
        LATEXDO_RELEASE_ASSET_BASE_URL: `https://latexdo.org/downloads/${slug}`,
        LATEXDO_RELEASE_DATE: publishedAt,
        LATEXDO_UPDATE_FEED_ENABLED: signedFeed ? "true" : "false",
        LATEXDO_UPDATE_SIGNING_KEY: signedFeed ? keys.privateBase64 : "",
      },
    },
  );
  return { [`/downloads/${slug}/LatexDo-windows-x64.exe`]: installer };
}

function startServer({ site, pfx, passphrase, installerRoutes }) {
  const server = https.createServer({ pfx, passphrase }, async (request, response) => {
    const pathname = decodeURIComponent(
      new URL(request.url, "https://latexdo.org").pathname,
    );
    let file = installerRoutes[pathname];
    if (!file) {
      const relative = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
      const resolved = path.resolve(site, `.${relative}`);
      if (resolved.startsWith(path.resolve(site) + path.sep)) file = resolved;
    }
    const info = file ? await stat(file).catch(() => null) : null;
    const status = info?.isFile() ? 200 : 404;
    requestLog.push(
      `${new Date().toISOString()} ${request.method} ${request.headers.host}${request.url} ${status} ${request.headers["user-agent"] ?? ""}`,
    );
    if (status !== 200) {
      response.writeHead(404).end("not found");
      return;
    }
    response.writeHead(200, {
      "Content-Length": info.size,
      "Content-Type": file.endsWith(".json")
        ? "application/json"
        : file.endsWith(".html")
          ? "text/html; charset=utf-8"
          : "application/octet-stream",
      "Cache-Control": "no-store",
    });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(443, "127.0.0.1", () => resolve(server));
  });
}

function fetchThroughHosts(url, ca) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { ca, timeout: 10_000 }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => resolve({ status: response.statusCode, body }));
      })
      .on("error", reject);
  });
}

function downloadThroughHosts(url, ca, file) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { ca, timeout: 60_000 }, (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`${url} returned ${response.statusCode}`));
          return;
        }
        pipeline(response, createWriteStream(file)).then(resolve, reject);
      })
      .on("error", reject);
  });
}

async function launch(executable, env) {
  const child = spawn(executable, [`--inspect=127.0.0.1:${inspectorPort}`], {
    cwd: path.dirname(executable),
    env,
    stdio: "ignore",
  });
  child.once("error", (error) => note(`Launch error: ${error}`));
  await until(
    async () =>
      (await evaluateInApp(
        `async (electron) => {
          for (const contents of electron.webContents.getAllWebContents()) {
            if (contents.isLoading() || !contents.getURL().startsWith("latexdo://")) continue;
            if ((await contents.executeJavaScript("typeof window.latexdo?.updateNow")) === "function") return true;
          }
          return false;
        }`,
        10_000,
      )) === true,
    "installed application window",
    90_000,
  );
  return child;
}

const appPaths = `async (electron) => ({
  downloads: electron.app.getPath("downloads"),
  temp: electron.app.getPath("temp"),
  logs: electron.app.getPath("logs"),
  userData: electron.app.getPath("userData"),
  exe: electron.app.getPath("exe"),
})`;

// The same call the Update button makes, with a user gesture.
/**
 * Users reach latexdo.org with a publicly trusted certificate. Here the app must trust
 * the local test certificate instead, and NODE_EXTRA_CA_CERTS alone did not reach its
 * fetch. Record the real error first, then add the certificate to the main process.
 */
const trustLocalServer = (ca) => `async () => {
  const probe = () =>
    fetch("https://latexdo.org/updates/latest.json", { cache: "no-store" }).then(
      (response) => "HTTP " + response.status,
      (error) => "failed: " + (error.cause?.code ?? error.cause?.message ?? error.message),
    );
  const before = await probe();
  if (before === "HTTP 200") return { before };
  const tls = process.getBuiltinModule("tls");
  if (typeof tls.setDefaultCACertificates !== "function") {
    return { before, after: "tls.setDefaultCACertificates is not available" };
  }
  tls.setDefaultCACertificates([...tls.getCACertificates("default"), ${JSON.stringify(ca)}]);
  return { before, after: await probe() };
}`;

const pressUpdate = `async (electron) => {
  const contents = electron.webContents
    .getAllWebContents()
    .find((candidate) => candidate.getURL().startsWith("latexdo://"));
  return contents.executeJavaScript("window.latexdo.updateNow()", true);
}`;

let server;
let originalHosts;
let certificateThumbprint;
let installDirectory;
let oldApp;
let paths;
let failed = false;
const receipt = { scenario, baselineTag, expectCrossVolume };

try {
  note(
    `Scenario ${scenario}; baseline ${baselineTag}; candidate ${expectedBuild.commit}`,
  );

  // 1. A normal per-user installation of the released build, at its default location.
  if ((await installedEntries()).length)
    throw new Error("Runner already has LatexDo installed.");
  await runInstaller(baselineInstaller, "/S");
  const entries = await installedEntries();
  if (entries.length !== 1)
    throw new Error(`Expected one installation: ${JSON.stringify(entries)}`);
  const executable = executableFromEntry(entries[0]);
  installDirectory = path.dirname(executable);
  const oldBuild = installedBuild(installDirectory);
  receipt.installDirectory = installDirectory;
  receipt.baselineCommit = oldBuild.commit;
  if (oldBuild.commit === expectedBuild.commit) {
    throw new Error("Baseline must differ from the candidate build.");
  }
  note(`Installed ${baselineTag} (${oldBuild.commit}) at ${installDirectory}`);

  // 2. Trust a test update key in the installed copy (the only file changed in it).
  const installedKey = path.join(
    installDirectory,
    "resources",
    "update-public-key.pem",
  );
  await stat(installedKey);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keys = {
    publicPem: publicKey.export({ type: "spki", format: "pem" }),
    privateBase64: Buffer.from(
      privateKey.export({ type: "pkcs8", format: "pem" }),
    ).toString("base64"),
  };
  await writeFile(installedKey, keys.publicPem);

  // 3. Feeds built by the production builder.
  const site = path.join(root, "site");
  const runNumber = process.env.GITHUB_RUN_NUMBER ?? "1";
  const runAttempt = process.env.GITHUB_RUN_ATTEMPT ?? "1";
  const candidateSlug = `v${version}-build.${runNumber}.${runAttempt}.${expectedBuild.commit.slice(0, 12)}`;
  const now = Date.now();
  const installerRoutes = {};
  if (scenario === "manual") {
    // latexdo.org keeps the previous signed feed; only the downloads manifest moves on.
    Object.assign(
      installerRoutes,
      await buildSite({
        site,
        installer: baselineInstaller,
        commit: oldBuild.commit,
        slug: baselineTag,
        publishedAt: new Date(now - 10 * 60_000).toISOString(),
        signedFeed: true,
        keys,
      }),
    );
  }
  Object.assign(
    installerRoutes,
    await buildSite({
      site,
      installer: candidateInstaller,
      commit: expectedBuild.commit,
      slug: candidateSlug,
      publishedAt: new Date(now - 60_000).toISOString(),
      signedFeed: scenario !== "manual",
      keys,
    }),
  );
  await copyFile(
    path.join(site, "downloads", "manifest.json"),
    path.join(evidence, "manifest.json"),
  );
  await copyFile(
    path.join(site, "updates", "latest.json"),
    path.join(evidence, "latest.json"),
  );

  // 4. latexdo.org -> local HTTPS server with a test certificate trusted by Windows.
  const pfxPath = path.join(root, "latexdo-test.pfx");
  const caPath = path.join(root, "latexdo-test.pem");
  const passphrase = randomBytes(18).toString("base64url");
  certificateThumbprint = await powershell(
    `$ErrorActionPreference = 'Stop'
    $cert = New-SelfSignedCertificate -DnsName 'latexdo.org','www.latexdo.org' -CertStoreLocation 'Cert:\\LocalMachine\\My' -KeyExportPolicy Exportable -KeyAlgorithm RSA -KeyLength 2048 -NotAfter (Get-Date).AddDays(2) -FriendlyName 'LatexDo updater test'
    $password = ConvertTo-SecureString -String $env:LATEXDO_TEST_PFX_PASSWORD -Force -AsPlainText
    Export-PfxCertificate -Cert $cert -FilePath $env:LATEXDO_TEST_PFX -Password $password -CryptoAlgorithmOption AES256_SHA256 | Out-Null
    $pem = "-----BEGIN CERTIFICATE-----\`n" + [Convert]::ToBase64String($cert.RawData, 'InsertLineBreaks') + "\`n-----END CERTIFICATE-----\`n"
    [IO.File]::WriteAllText($env:LATEXDO_TEST_CA, $pem)
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', 'LocalMachine')
    $store.Open('ReadWrite'); $store.Add($cert); $store.Close()
    $cert.Thumbprint`,
    {
      env: {
        ...process.env,
        LATEXDO_TEST_PFX: pfxPath,
        LATEXDO_TEST_PFX_PASSWORD: passphrase,
        LATEXDO_TEST_CA: caPath,
      },
    },
  );
  const ca = await readFile(caPath, "utf8");
  server = await startServer({
    site,
    pfx: await readFile(pfxPath),
    passphrase,
    installerRoutes,
  });
  originalHosts = await readFile(hostsPath, "utf8");
  await writeFile(
    hostsPath,
    `${originalHosts.trimEnd()}\r\n127.0.0.1 latexdo.org # latexdo-self-update-test\r\n127.0.0.1 www.latexdo.org # latexdo-self-update-test\r\n`,
  );
  await exec("ipconfig.exe", ["/flushdns"]).catch(() => {});
  const probe = await fetchThroughHosts("https://latexdo.org/updates/latest.json", ca);
  if (probe.status !== 200)
    throw new Error(`Local latexdo.org probe returned ${probe.status}`);
  note("latexdo.org now resolves to the local test server");

  // 5. Start the released app as a user would, with this scenario's temp folder.
  const temp =
    scenario === "cross-volume"
      ? path.join(
          process.env.RUNNER_TEMP ?? "D:\\a\\_temp",
          `latexdo-temp-${process.pid}`,
        )
      : path.join(root, "temp");
  await mkdir(temp, { recursive: true });
  const appEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("LATEXDO_")),
  );
  Object.assign(appEnv, {
    LATEXDO_CRASH_REPORTS: "off",
    TEMP: temp,
    TMP: temp,
    NODE_EXTRA_CA_CERTS: caPath,
    NODE_USE_SYSTEM_CA: "1",
  });
  oldApp = await launch(executable, appEnv);
  paths = await evaluateInApp(appPaths);
  receipt.paths = paths;
  note(`Old app ${oldApp.pid}: ${JSON.stringify(paths)}`);
  const trust = await evaluateInApp(trustLocalServer(ca));
  receipt.trust = trust;
  note(`Released app reaching latexdo.org: ${JSON.stringify(trust)}`);
  if ((trust.after ?? trust.before) !== "HTTP 200") {
    throw new Error(
      `The released app cannot reach the local latexdo.org: ${JSON.stringify(trust)}`,
    );
  }
  await mkdir(paths.downloads, { recursive: true });
  const sameDrive = drive(paths.temp) === drive(paths.downloads);
  if (sameDrive !== (scenario !== "cross-volume")) {
    throw new Error(
      `Test setup error: temp ${paths.temp} and Downloads ${paths.downloads} are not arranged for ${scenario}.`,
    );
  }
  const sentinel = path.join(paths.userData, "updater-test-preserve.tex");
  const document =
    "\\documentclass{article}\n\\begin{document}Preserve my work.\\end{document}";
  await writeFile(sentinel, document);
  const pendingPath = path.join(paths.userData, "pending-update.json");
  const updaterLog = path.join(paths.logs, "updater.log");

  // 6. Press Update in the released app.
  const result = await evaluateInApp(pressUpdate, 240_000);
  receipt.updateResult = result;
  note(`updateNow returned ${JSON.stringify(result)}`);

  const expectSuccess =
    scenario === "same-volume" ||
    (scenario === "cross-volume" && expectCrossVolume === "succeeds");

  if (expectSuccess) {
    if (result.error || !result.quitScheduled) {
      throw new Error(
        `The released app did not start the update: ${JSON.stringify(result)}`,
      );
    }
    if (
      path.dirname(result.installerPath).toLowerCase() !== paths.downloads.toLowerCase()
    ) {
      throw new Error(`Installer was not saved in Downloads: ${result.installerPath}`);
    }
    // The app closes itself after its restart countdown, as it does for users.
    await until(() => !processAlive(oldApp.pid), "released app closing itself", 60_000);
    note("Released app closed itself; waiting for installation and relaunch");
    await until(
      async () => {
        const log = await readFile(updaterLog, "utf8");
        if (log.includes("Verification=FAIL")) {
          throw new FatalError(`Updater reported a failure:\n${log}`);
        }
        return log.includes("Verification=PASS") && log.includes("RelaunchedPid=");
      },
      "installation, verification and relaunch",
      300_000,
    );
    const newBuild = installedBuild(installDirectory);
    if (newBuild.commit !== expectedBuild.commit) {
      throw new Error(
        `Installed build is ${newBuild.commit}, expected ${expectedBuild.commit}.`,
      );
    }
    await until(
      async () => JSON.parse(await readFile(pendingPath, "utf8")).state === "confirmed",
      "relaunched application confirming the update",
      120_000,
    );
    receipt.pending = JSON.parse(await readFile(pendingPath, "utf8"));
    receipt.installedCommit = newBuild.commit;
  } else if (scenario === "cross-volume") {
    // Known failure in released builds: the user is shown this error on every try.
    if (!/EXDEV|cross-device/i.test(result.error ?? "") || result.quitScheduled) {
      throw new Error(
        `Expected the released build to fail with EXDEV across drives, got ${JSON.stringify(result)}`,
      );
    }
    if (!processAlive(oldApp.pid))
      throw new Error("Released app quit after a failed download.");
    if (installedBuild(installDirectory).commit !== oldBuild.commit) {
      throw new Error("Installation changed although the download failed.");
    }
    const pending = await readFile(pendingPath, "utf8").catch(() => null);
    receipt.pendingAfterFailure = pending ? JSON.parse(pending) : null;
    receipt.confirmedKnownFailure = true;
    note("Confirmed: this released build cannot update itself across drives");
  } else {
    // manual: the app must hand the user to the downloads page instead.
    if (result.error || !result.manualDownload || !result.opened) {
      throw new Error(`Expected the downloads page to open: ${JSON.stringify(result)}`);
    }
    if (!String(result.releaseUrl).startsWith("https://latexdo.org/downloads/")) {
      throw new Error(`Unexpected downloads page: ${result.releaseUrl}`);
    }
    if (installedBuild(installDirectory).commit !== oldBuild.commit) {
      throw new Error("Installation changed before the user ran the installer.");
    }
    await powershell(
      "Stop-Process -Name msedge,chrome,firefox -Force -ErrorAction SilentlyContinue",
    ).catch(() => {});
    note(
      "Downloads page opened; running the downloaded installer with LatexDo still open",
    );
    // The user downloads the installer from that page and runs it. LatexDo is
    // still open; the installer closes it (interactive users confirm a prompt).
    const downloaded = path.join(paths.downloads, "LatexDo-windows-x64.exe");
    await downloadThroughHosts(
      `https://latexdo.org/downloads/${candidateSlug}/LatexDo-windows-x64.exe`,
      ca,
      downloaded,
    );
    if (!(await readFile(downloaded)).equals(await readFile(candidateInstaller))) {
      throw new Error("Downloaded installer differs from the candidate.");
    }
    await runInstaller(downloaded, "/S");
    await until(
      () => !processAlive(oldApp.pid),
      "installer closing the running app",
      60_000,
    );
    const after = await installedEntries();
    if (
      after.length !== 1 ||
      path.dirname(executableFromEntry(after[0])).toLowerCase() !==
        installDirectory.toLowerCase()
    ) {
      throw new Error(
        `Manual install did not upgrade in place: ${JSON.stringify(after)}`,
      );
    }
    const newBuild = installedBuild(installDirectory);
    if (newBuild.commit !== expectedBuild.commit) {
      throw new Error(
        `Installed build is ${newBuild.commit}, expected ${expectedBuild.commit}.`,
      );
    }
    // The upgraded app starts and loads its window on the same profile.
    const upgraded = await launch(executable, appEnv);
    const upgradedPaths = await evaluateInApp(appPaths);
    if (upgradedPaths.userData.toLowerCase() !== paths.userData.toLowerCase()) {
      throw new Error(`Upgraded app uses another profile: ${upgradedPaths.userData}`);
    }
    receipt.installedCommit = newBuild.commit;
    receipt.upgradedAppPid = upgraded.pid;
  }

  if ((await readFile(sentinel, "utf8")) !== document) {
    throw new Error("Existing user data was modified.");
  }
  receipt.userDataPreserved = true;
  await writeFile(path.join(evidence, "result.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  failed = true;
  console.error("Self-update test failure:", error);
  await writeFile(
    path.join(evidence, "failure.txt"),
    `${error?.stack ?? error}\n\n${JSON.stringify(receipt, null, 2)}`,
  ).catch(() => {});
} finally {
  await writeFile(path.join(evidence, "steps.log"), steps.join("\n")).catch(() => {});
  await writeFile(path.join(evidence, "requests.log"), requestLog.join("\n")).catch(
    () => {},
  );
  if (paths) {
    for (const [name, file] of [
      ["updater.log", path.join(paths.logs, "updater.log")],
      ["pending-update.json", path.join(paths.userData, "pending-update.json")],
    ]) {
      await copyFile(file, path.join(evidence, name)).catch(() => {});
    }
  }
  console.log(`Requests served:\n${requestLog.join("\n")}`);
  console.log(
    `Updater log:\n${paths ? await readFile(path.join(paths.logs, "updater.log"), "utf8").catch(() => "(none)") : "(none)"}`,
  );
  if (installDirectory) {
    await powershell(
      `
      $prefix = $env:LATEXDO_TEST_INSTALL_DIRECTORY.TrimEnd('\\') + '\\'
      Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
      } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
      $uninstaller = Join-Path $env:LATEXDO_TEST_INSTALL_DIRECTORY 'Uninstall LatexDo.exe'
      if (Test-Path -LiteralPath $uninstaller) { Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait }
    `,
      { env: { ...process.env, LATEXDO_TEST_INSTALL_DIRECTORY: installDirectory } },
    ).catch((error) => console.error("Test cleanup:", error));
  }
  if (originalHosts !== undefined) {
    await writeFile(hostsPath, originalHosts).catch((error) =>
      console.error("Hosts restore:", error),
    );
  }
  if (certificateThumbprint) {
    await powershell(
      `foreach ($store in 'Cert:\\LocalMachine\\Root','Cert:\\LocalMachine\\My') { Remove-Item -LiteralPath (Join-Path $store $env:LATEXDO_TEST_THUMBPRINT) -ErrorAction SilentlyContinue }`,
      { env: { ...process.env, LATEXDO_TEST_THUMBPRINT: certificateThumbprint } },
    ).catch((error) => console.error("Certificate cleanup:", error));
  }
  server?.close();
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 1000,
  }).catch((error) => console.error("Test directory cleanup:", error));
  // Servers and the inspector keep handles open; the result is decided here.
  process.exit(failed ? 1 : 0);
}
