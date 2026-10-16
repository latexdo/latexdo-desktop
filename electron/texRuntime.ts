import { app } from "electron";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

export type TexInstallStage =
  | "checking"
  | "downloading"
  | "verifying"
  | "installing"
  | "ready";

export interface TexInstallProgress {
  stage: TexInstallStage;
  receivedBytes: number;
  totalBytes: number | null;
  done: boolean;
  error?: string;
  message?: string;
}

interface TexAsset {
  url: string;
  sha256: string;
  sizeBytes: number;
}

// TinyTeX is a relocatable TeX Live distribution. The release is pinned and
// every archive is verified against its published SHA-256 before extraction.
const texRuntimeVersion = "tinytex-v2026.10";
const texBaseUrl =
  "https://github.com/rstudio/tinytex-releases/releases/download/v2026.10";

const darwinAsset: TexAsset = {
  url: `${texBaseUrl}/TinyTeX-darwin-v2026.10.tar.xz`,
  sha256: "9962e445b56f06feb2c28f73561e523e89d550e98abf910ba60b0ffb3856921f",
  sizeBytes: 210_535_256,
};

const texAssets: Record<string, TexAsset> = {
  "darwin-arm64": darwinAsset,
  "darwin-x64": darwinAsset,
  "linux-x64": {
    url: `${texBaseUrl}/TinyTeX-linux-x86_64-v2026.10.tar.xz`,
    sha256: "54fec1c79ab437d2d52e2f918bdb738c85779d654a93e62cc44f022e227692b5",
    sizeBytes: 151_904_844,
  },
  "linux-arm64": {
    url: `${texBaseUrl}/TinyTeX-linux-arm64-v2026.10.tar.xz`,
    sha256: "e4caa195211d4ae8b557a52752c850f63027450065ed7db3d9350ba63e0e1aac",
    sizeBytes: 158_454_704,
  },
  "win32-x64": {
    url: `${texBaseUrl}/TinyTeX-v2026.10.zip`,
    sha256: "dc1d6e63b21af62130ede1dcc4113bffdc184544690a23e3f489d75340f4ff61",
    sizeBytes: 247_389_422,
  },
};

function texAsset(): TexAsset | null {
  return texAssets[`${process.platform}-${process.arch}`] ?? null;
}

export function texDownloadBytes(): number | null {
  return texAsset()?.sizeBytes ?? null;
}

export function installedTexRoot(): string {
  return path.join(app.getPath("userData"), "tex");
}

function latexmkName(): string {
  return process.platform === "win32" ? "latexmk.exe" : "latexmk";
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/** Finds `<root>/<dist>/bin/<arch>` containing latexmk, or null. */
async function findTexBinDirectory(root: string): Promise<string | null> {
  let distributions: string[];
  try {
    distributions = await readdir(root);
  } catch {
    return null;
  }
  for (const distribution of distributions) {
    if (distribution === ".install") continue;
    const binRoot = path.join(root, distribution, "bin");
    let architectures: string[];
    try {
      architectures = await readdir(binRoot);
    } catch {
      continue;
    }
    for (const architecture of architectures) {
      const directory = path.join(binRoot, architecture);
      if (await exists(path.join(directory, latexmkName()))) return directory;
    }
  }
  return null;
}

/** The bin directory of the TeX distribution LatexDo installed, if any. */
export function findBundledTexBinDirectory(): Promise<string | null> {
  return findTexBinDirectory(installedTexRoot());
}

function extractArchive(archive: string, outputDirectory: string): Promise<void> {
  const windows = process.platform === "win32";
  const tar = windows
    ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
    : process.platform === "darwin"
      ? "/usr/bin/tar"
      : "tar";
  const args = windows
    ? ["-xf", archive, "-C", outputDirectory]
    : ["-xJf", archive, "-C", outputDirectory];
  return new Promise((resolve, reject) => {
    const child = spawn(tar, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (data: Buffer) => {
      stderr = `${stderr}${data.toString()}`.slice(-2000);
    });
    child.on("error", (error) =>
      reject(new Error(`Could not unpack the PDF builder: ${error.message}`)),
    );
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Could not unpack the PDF builder. ${stderr.trim()}`));
    });
  });
}

export async function installTexRuntime(events: {
  signal?: AbortSignal;
  onProgress(progress: TexInstallProgress): void;
}): Promise<void> {
  const asset = texAsset();
  if (!asset) {
    throw new Error(
      `Automatic PDF builder install is not available for ${process.platform}/${process.arch}.`,
    );
  }
  const totalBytes = asset.sizeBytes;
  const send = (
    stage: TexInstallStage,
    receivedBytes: number,
    message: string,
    done = false,
  ) => events.onProgress({ stage, receivedBytes, totalBytes, done, message });

  send("checking", 0, "Checking the PDF builder");
  if (await findBundledTexBinDirectory()) {
    send("ready", totalBytes, "PDF builder is ready", true);
    return;
  }

  const root = installedTexRoot();
  const tmp = path.join(root, ".install");
  const archive = path.join(tmp, path.basename(asset.url));
  const unpacked = path.join(tmp, "unpacked");
  await rm(tmp, { recursive: true, force: true });
  await mkdir(unpacked, { recursive: true });
  try {
    const res = await fetch(asset.url, { redirect: "follow", signal: events.signal });
    if (!res.ok || !res.body) {
      throw new Error(`PDF builder download failed: HTTP ${res.status}`);
    }
    const hash = createHash("sha256");
    let received = 0;
    const body = Readable.fromWeb(res.body as unknown as NodeReadableStream);
    body.on("data", (chunk: Buffer) => {
      hash.update(chunk);
      received += chunk.length;
      send("downloading", received, "Downloading the PDF builder");
    });
    await pipeline(body, createWriteStream(archive));

    send("verifying", totalBytes, "Verifying the PDF builder");
    if (received !== asset.sizeBytes || hash.digest("hex") !== asset.sha256) {
      throw new Error("PDF builder checksum verification failed.");
    }

    send("installing", totalBytes, "Installing the PDF builder");
    await extractArchive(archive, unpacked);
    if (!(await findTexBinDirectory(unpacked))) {
      throw new Error("The PDF builder archive did not contain latexmk.");
    }
    for (const entry of await readdir(unpacked)) {
      await rm(path.join(root, entry), { recursive: true, force: true });
      await rename(path.join(unpacked, entry), path.join(root, entry));
    }
    await writeFile(
      path.join(root, "install.json"),
      JSON.stringify(
        {
          version: texRuntimeVersion,
          installedAt: new Date().toISOString(),
          platform: process.platform,
          arch: process.arch,
        },
        null,
        2,
      ),
    );
    send("ready", totalBytes, "PDF builder is ready", true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
