import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = path.resolve(import.meta.dirname, "..");
export const devUserDataPath = path.join(projectRoot, ".latexdo-dev-profile");

function defaultUserDataCandidates() {
  const home = os.homedir();
  const names = ["latexdo", "LatexDo"];

  if (process.platform === "darwin") {
    return names.map((name) => path.join(home, "Library", "Application Support", name));
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    return names.map((name) => path.join(appData, name));
  }

  const configHome = process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");
  return names.map((name) => path.join(configHome, name));
}

function unique(values) {
  return Array.from(new Set(values.map((value) => path.resolve(value))));
}

async function removePath(target, label) {
  await rm(target, { recursive: true, force: true });
  console.log(`[dev] Cleared ${label}: ${target}`);
}

export async function clearDevRuntimeCache() {
  await removePath(devUserDataPath, "dev profile");

  for (const userDataPath of unique(defaultUserDataCandidates())) {
    await removePath(path.join(userDataPath, "models"), "legacy local AI models");
    await removePath(path.join(userDataPath, "speech"), "legacy local speech runtime");
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

if (import.meta.url === invokedPath) {
  clearDevRuntimeCache().catch((error) => {
    console.error("[dev] Failed to clear dev runtime cache:", error);
    process.exitCode = 1;
  });
}
