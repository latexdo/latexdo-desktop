import { app } from "electron";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { inflateRawSync } from "node:zlib";

export type SpeechInstallStage =
  | "checking"
  | "downloading-runtime"
  | "downloading-model"
  | "verifying"
  | "installing"
  | "ready";

export interface SpeechInstallProgress {
  stage: SpeechInstallStage;
  receivedBytes: number;
  totalBytes: number | null;
  done: boolean;
  error?: string;
  message?: string;
}

interface RuntimeAsset {
  url: string;
  sha256: string;
  sizeBytes: number;
}

interface ModelAsset {
  url: string;
  fileName: string;
  sha256: string;
  sizeBytes: number;
}

interface DownloadedAsset {
  path: string;
  bytes: number;
}

const speechRuntimeVersion = "openwhispr-whisper-server-v1.0.0";
const runtimeBaseUrl =
  "https://github.com/sjoerdteunisse/whisper.cpp/releases/download/v1.0.0";
const modelAsset: ModelAsset = {
  url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.en.bin",
  fileName: "ggml-base.en.bin",
  sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
  sizeBytes: 147_964_211,
};

const runtimeAssets: Record<string, RuntimeAsset> = {
  "darwin-arm64": {
    url: `${runtimeBaseUrl}/whisper-server-darwin-arm64.zip`,
    sha256: "77a8dd22611de8436f7a3af85e1c439f9b0d72c40559f4fb7e585d6167fc9d20",
    sizeBytes: 1_215_954,
  },
  "darwin-x64": {
    url: `${runtimeBaseUrl}/whisper-server-darwin-x64.zip`,
    sha256: "ac03619b88268c880ffc5e872fe428719df1a12bc6d8fadeecc902d91f49ec0a",
    sizeBytes: 1_256_575,
  },
  "linux-x64": {
    url: `${runtimeBaseUrl}/whisper-server-linux-x64-cpu.zip`,
    sha256: "f40bab8c91c63c857a56b68810739e5665c14547f9c7873869edd71e411e346e",
    sizeBytes: 1_185_878,
  },
  "win32-x64": {
    url: `${runtimeBaseUrl}/whisper-server-win32-x64-cpu.zip`,
    sha256: "446e9c96b0ceee15361b962a549b789fd0a4136926ff6ae6d7ebaa63029be9b1",
    sizeBytes: 803_436,
  },
};

function platformKey(): string {
  return `${process.platform}-${process.arch}`;
}

function executableName(): string {
  return process.platform === "win32" ? "whisper-server.exe" : "whisper-server";
}

export function installedSpeechRoot(): string {
  return path.join(app.getPath("userData"), "speech");
}

export function installedSpeechExecutablePath(): string {
  return path.join(
    installedSpeechRoot(),
    "bin",
    process.platform,
    process.arch,
    executableName(),
  );
}

export function installedSpeechModelPath(): string {
  return path.join(installedSpeechRoot(), "models", modelAsset.fileName);
}

async function fileMatches(filePath: string, sizeBytes: number): Promise<boolean> {
  try {
    const info = await stat(filePath);
    return info.isFile() && info.size === sizeBytes;
  } catch {
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

/** Bytes the speech install downloads on this platform, or null if unsupported. */
export function speechDownloadBytes(): number | null {
  const runtime = runtimeAssets[platformKey()];
  return runtime ? runtime.sizeBytes + modelAsset.sizeBytes : null;
}

export async function isSpeechRuntimeInstalled(): Promise<boolean> {
  return (
    (await fileMatches(installedSpeechModelPath(), modelAsset.sizeBytes)) &&
    (await fileExists(installedSpeechExecutablePath()))
  );
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function sha256OfFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  try {
    for await (const chunk of stream) {
      hash.update(chunk as Buffer);
    }
  } finally {
    stream.destroy();
  }
  return hash.digest("hex");
}

async function downloadToFile(
  url: string,
  outputPath: string,
  signal: AbortSignal | undefined,
  onProgress: (received: number, total: number | null) => void,
): Promise<DownloadedAsset> {
  const res = await fetch(url, { redirect: "follow", signal });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: HTTP ${res.status}`);
  }
  const totalHeader = res.headers.get("content-length");
  const total = totalHeader ? Number.parseInt(totalHeader, 10) : null;
  let received = 0;
  const nodeBody = Readable.fromWeb(res.body as unknown as NodeReadableStream);
  nodeBody.on("data", (chunk: Buffer) => {
    received += chunk.length;
    onProgress(received, Number.isFinite(total) ? total : null);
  });
  await pipeline(nodeBody, createWriteStream(outputPath));
  return { path: outputPath, bytes: received };
}

async function downloadBuffer(
  url: string,
  signal: AbortSignal | undefined,
  onProgress: (received: number, total: number | null) => void,
): Promise<Buffer> {
  const res = await fetch(url, { redirect: "follow", signal });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: HTTP ${res.status}`);
  }
  const totalHeader = res.headers.get("content-length");
  const total = totalHeader ? Number.parseInt(totalHeader, 10) : null;
  const chunks: Buffer[] = [];
  let received = 0;
  const nodeBody = Readable.fromWeb(res.body as unknown as NodeReadableStream);
  for await (const chunk of nodeBody) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.length;
    chunks.push(buffer);
    onProgress(received, Number.isFinite(total) ? total : null);
  }
  return Buffer.concat(chunks);
}

function readUInt16(buffer: Buffer, offset: number): number {
  return buffer.readUInt16LE(offset);
}

function readUInt32(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset);
}

async function extractRuntime(zip: Buffer, outputFile: string): Promise<void> {
  const eocdSignature = 0x06054b50;
  let eocdOffset = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 66_000); i--) {
    if (readUInt32(zip, i) === eocdSignature) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("Speech runtime archive is not a ZIP file.");

  const entryCount = readUInt16(zip, eocdOffset + 10);
  let centralOffset = readUInt32(zip, eocdOffset + 16);
  let serverBuffer: Buffer | null = null;

  for (let i = 0; i < entryCount; i++) {
    if (readUInt32(zip, centralOffset) !== 0x02014b50) {
      throw new Error("Speech runtime archive has an invalid central directory.");
    }
    const compression = readUInt16(zip, centralOffset + 10);
    const compressedSize = readUInt32(zip, centralOffset + 20);
    const fileNameLength = readUInt16(zip, centralOffset + 28);
    const extraLength = readUInt16(zip, centralOffset + 30);
    const commentLength = readUInt16(zip, centralOffset + 32);
    const localOffset = readUInt32(zip, centralOffset + 42);
    const name = zip
      .subarray(centralOffset + 46, centralOffset + 46 + fileNameLength)
      .toString("utf8");

    const localNameLength = readUInt16(zip, localOffset + 26);
    const localExtraLength = readUInt16(zip, localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const data = zip.subarray(dataOffset, dataOffset + compressedSize);
    if (!name.endsWith("/") && /whisper-server/i.test(path.basename(name))) {
      if (compression === 0) {
        serverBuffer = Buffer.from(data);
      } else if (compression === 8) {
        serverBuffer = inflateRawSync(data);
      } else {
        throw new Error(`Unsupported ZIP compression method ${compression}.`);
      }
    }
    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  if (!serverBuffer) {
    throw new Error("Speech runtime archive did not contain whisper-server.");
  }

  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, serverBuffer);
  if (process.platform !== "win32") await chmod(outputFile, 0o755);
}

export async function installSpeechRuntime(events: {
  signal?: AbortSignal;
  onProgress(progress: SpeechInstallProgress): void;
}): Promise<void> {
  const runtime = runtimeAssets[platformKey()];
  if (!runtime) {
    throw new Error(
      `Local speech install is not available for ${process.platform}/${process.arch}.`,
    );
  }

  const totalBytes = runtime.sizeBytes + modelAsset.sizeBytes;
  const root = installedSpeechRoot();
  const tmp = path.join(root, ".install");
  const runtimeZip = path.join(tmp, "runtime.zip");
  const modelPart = path.join(tmp, modelAsset.fileName);
  const send = (
    stage: SpeechInstallStage,
    receivedBytes: number,
    message: string,
    done = false,
  ) =>
    events.onProgress({
      stage,
      receivedBytes,
      totalBytes,
      done,
      message,
    });

  send("checking", 0, "Checking local speech support");
  if (await isSpeechRuntimeInstalled()) {
    send("ready", totalBytes, "Local speech support is ready", true);
    return;
  }

  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  try {
    const runtimeBuffer = await downloadBuffer(runtime.url, events.signal, (received) =>
      send("downloading-runtime", received, "Downloading local speech runtime"),
    );
    if (sha256(runtimeBuffer) !== runtime.sha256) {
      throw new Error("Speech runtime checksum verification failed.");
    }
    await writeFile(runtimeZip, runtimeBuffer);

    const modelDownload = await downloadToFile(
      modelAsset.url,
      modelPart,
      events.signal,
      (received) =>
        send(
          "downloading-model",
          runtime.sizeBytes + received,
          "Downloading speech model",
        ),
    );
    if (modelDownload.bytes !== modelAsset.sizeBytes) {
      throw new Error("Speech model download looks incomplete.");
    }
    send("verifying", totalBytes, "Verifying speech model");
    const modelHash = await sha256OfFile(modelPart);
    if (modelHash !== modelAsset.sha256) {
      throw new Error("Speech model checksum verification failed.");
    }

    send("installing", totalBytes, "Installing local speech support");
    await rm(installedSpeechExecutablePath(), { force: true });
    await rm(installedSpeechModelPath(), { force: true });
    await extractRuntime(runtimeBuffer, installedSpeechExecutablePath());
    await mkdir(path.dirname(installedSpeechModelPath()), { recursive: true });
    await rename(modelPart, installedSpeechModelPath());
    await writeFile(
      path.join(root, "install.json"),
      JSON.stringify(
        {
          version: speechRuntimeVersion,
          installedAt: new Date().toISOString(),
          platform: process.platform,
          arch: process.arch,
          model: modelAsset.fileName,
        },
        null,
        2,
      ),
    );
    send("ready", totalBytes, "Local speech support is ready", true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export async function listInstalledSpeechFiles(): Promise<string[]> {
  try {
    const root = installedSpeechRoot();
    return await readdir(root, { recursive: true });
  } catch {
    return [];
  }
}
