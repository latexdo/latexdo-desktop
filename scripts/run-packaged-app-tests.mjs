import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import { constants as fsConstants } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const searchRoots = [path.join(root, "release"), path.join(root, "dist")];

async function isExecutable(filePath) {
  try {
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findInDirectory(directory, predicate, depth = 0) {
  if (depth > 8) return null;

  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (await predicate(filePath, entry)) {
      return filePath;
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "node_modules") continue;
    const found = await findInDirectory(
      path.join(directory, entry.name),
      predicate,
      depth + 1,
    );
    if (found) return found;
  }

  return null;
}

async function findPackagedExecutable() {
  if (process.env.LATEXDO_PACKAGED_EXECUTABLE) {
    return path.resolve(process.env.LATEXDO_PACKAGED_EXECUTABLE);
  }

  const predicates = {
    darwin: async (filePath) =>
      filePath.endsWith(path.join("LatexDo.app", "Contents", "MacOS", "LatexDo")) &&
      (await isExecutable(filePath)),
    win32: async (_filePath, entry) => entry.isFile() && entry.name === "LatexDo.exe",
    linux: async (_filePath, entry) =>
      entry.isFile() && ["LatexDo", "latexdo"].includes(entry.name),
  };
  const predicate = predicates[process.platform];
  if (!predicate) {
    throw new Error(`Unsupported packaged app test platform: ${process.platform}`);
  }

  for (const searchRoot of searchRoots) {
    const executable = await findInDirectory(searchRoot, predicate);
    if (executable) return executable;
  }

  throw new Error(
    "Could not find a packaged LatexDo executable. Run npm run package first, or set LATEXDO_PACKAGED_EXECUTABLE.",
  );
}

function runPackagedTest(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      env: {
        ...process.env,
        ELECTRON_DISABLE_SANDBOX:
          process.platform === "linux" ? "1" : process.env.ELECTRON_DISABLE_SANDBOX,
      },
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `${path.basename(executable)} ${args.join(" ")} exited with ${
              code ?? `signal ${signal ?? "unknown"}`
            }.`,
          ),
        );
      }
    });
  });
}

const runE2e = process.argv.includes("--e2e");
const executable = await findPackagedExecutable();
console.log(`[packaged-test] Using ${executable}`);
const version = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
).version;
const probeDirectory = await mkdtemp(path.join(os.tmpdir(), "latexdo-packaged-probe-"));
try {
  const receipt = path.join(probeDirectory, "version-receipt");
  await runPackagedTest(executable, ["--latexdo-verify-update", version, receipt]);
  if ((await readFile(receipt, "utf8")) !== version) {
    throw new Error("Packaged updater probe did not verify the actual app version.");
  }
  let rejectedMismatch = false;
  try {
    await runPackagedTest(executable, [
      "--latexdo-verify-update",
      "0.0.0-invalid-update",
      path.join(probeDirectory, "wrong-version"),
    ]);
  } catch {
    rejectedMismatch = true;
  }
  if (!rejectedMismatch)
    throw new Error("Packaged updater probe accepted a wrong version.");
  console.log(
    `[packaged-test] Updater verified app.getVersion() = ${version} and rejected a mismatched version.`,
  );
} finally {
  await rm(probeDirectory, { recursive: true, force: true });
}
await runPackagedTest(executable, ["--smoke-test"]);
if (runE2e) {
  await runPackagedTest(executable, ["--e2e-test"]);
  console.log("[packaged-test] Smoke and E2E checks passed.");
} else {
  console.log("[packaged-test] Smoke check passed.");
}
