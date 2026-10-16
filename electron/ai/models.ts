// Local GGUF model storage: list, download (with progress + integrity
// verification), delete. Files live under <userData>/models. Downloads are
// written to a .part path, verified (size band + optional SHA-256), and renamed
// into place only when every check passes.

import { app } from "electron";
import { createHash, randomUUID, type Hash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

export interface ModelFileStatus {
  fileName: string;
  path: string;
  sizeBytes: number;
}

export function modelsDir(): string {
  return path.join(app.getPath("userData"), "models");
}

export function modelPath(fileName: string): string {
  if (
    typeof fileName !== "string" ||
    !fileName.toLowerCase().endsWith(".gguf") ||
    fileName === ".gguf" ||
    /[\\/:]/.test(fileName) ||
    [...fileName].some((character) => character.charCodeAt(0) < 32) ||
    path.basename(fileName) !== fileName
  ) {
    throw new Error("Invalid model filename.");
  }
  return path.join(modelsDir(), fileName);
}

export async function listModelFiles(): Promise<ModelFileStatus[]> {
  const dir = modelsDir();
  try {
    await mkdir(dir, { recursive: true });
    const names = await readdir(dir);
    const out: ModelFileStatus[] = [];
    for (const name of names) {
      if (!name.endsWith(".gguf")) continue;
      const full = path.join(dir, name);
      const info = await stat(full);
      out.push({ fileName: name, path: full, sizeBytes: info.size });
    }
    return out;
  } catch {
    return [];
  }
}

export async function modelExists(fileName: string): Promise<boolean> {
  try {
    const info = await stat(modelPath(fileName));
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

export async function deleteModelFile(fileName: string): Promise<void> {
  try {
    await unlink(modelPath(fileName));
  } catch {
    /* already gone */
  }
}

/** Trusted download manifest anchor: what an official model artifact must match. */
export interface ModelDownloadExpectations {
  /** Optional exact SHA-256 of the final artifact. Enforced when set. */
  expectedSha256?: string | null;
  /** Optional expected size band in bytes. At least one bound must be set. */
  sizeRangeBytes?: { min: number; max: number } | null;
}

export interface DownloadEvents {
  onProgress: (received: number, total: number | null) => void;
  /** Called with "verifying" once the download finishes and before rename. */
  onStage?: (stage: "downloading" | "verifying") => void;
  signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("Model download cancelled.");
  }
}

async function sha256OfFile(filePath: string, signal?: AbortSignal): Promise<string> {
  const hash: Hash = createHash("sha256");
  const stream = createReadStream(filePath);
  try {
    for await (const chunk of stream) {
      throwIfAborted(signal);
      hash.update(chunk as Buffer);
    }
  } finally {
    stream.destroy();
  }
  return hash.digest("hex");
}

async function verifyDownloadedModel(
  partPath: string,
  expectations: ModelDownloadExpectations,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const info = await stat(partPath);
  const sizeRange = expectations.sizeRangeBytes;

  if (sizeRange) {
    if (sizeRange.min === undefined && sizeRange.max === undefined) {
      throw new Error("Model download verification is misconfigured.");
    }
    if (sizeRange.min !== undefined && info.size < sizeRange.min) {
      throw new Error(
        `Model download looks incomplete: expected at least ${sizeRange.min} bytes, received ${info.size}.`,
      );
    }
    if (sizeRange.max !== undefined && info.size > sizeRange.max) {
      throw new Error(
        `Model download exceeds the expected size: expected at most ${sizeRange.max} bytes, received ${info.size}.`,
      );
    }
  }

  if (expectations.expectedSha256) {
    const actual = await sha256OfFile(partPath, signal);
    if (actual.toLowerCase() !== expectations.expectedSha256.toLowerCase()) {
      throw new Error(
        "Model download failed checksum verification. The file may be corrupt or has been tampered with. Please try again.",
      );
    }
  }
}

export async function downloadModelFile(
  url: string,
  fileName: string,
  events: DownloadEvents,
  expectations: ModelDownloadExpectations = {},
): Promise<void> {
  await mkdir(modelsDir(), { recursive: true });
  const finalPath = modelPath(fileName);
  const partPath = `${finalPath}.${randomUUID()}.part`;

  events.onStage?.("downloading");
  const res = await fetch(url, { redirect: "follow", signal: events.signal });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: HTTP ${res.status}`);
  }
  const totalHeader = res.headers.get("content-length");
  const total = totalHeader ? Number.parseInt(totalHeader, 10) : null;

  let received = 0;
  const nodeBody = Readable.fromWeb(res.body as unknown as NodeReadableStream);
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      const maxBytes = expectations.sizeRangeBytes?.max;
      if (maxBytes !== undefined && received > maxBytes) {
        callback(new Error("Model download exceeds the expected size."));
        return;
      }
      events.onProgress(received, Number.isFinite(total) ? total : null);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(nodeBody, limiter, createWriteStream(partPath, { flags: "wx" }));
  } catch (error) {
    await unlink(partPath).catch(() => {});
    throw error;
  }

  // Integrity checks happen BEFORE the artifact is moved into place.
  events.onStage?.("verifying");
  try {
    await verifyDownloadedModel(partPath, expectations, events.signal);
    throwIfAborted(events.signal);
    await rename(partPath, finalPath);
  } catch (error) {
    await unlink(partPath).catch(() => {});
    throw error;
  }
}
