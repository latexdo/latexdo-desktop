import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

export const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;
const NULL_BYTE_PREFIX_SCAN_BYTES = 8192;

interface ReadSafeTextFileOptions {
  maxBytes?: number;
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.ceil(bytes / 1024)} KiB`;
  }
  return `${Math.ceil(bytes / (1024 * 1024))} MiB`;
}

/** Bibliographies are only scanned, never kept in an editor, so they may be larger. */
export const MAX_BIBLIOGRAPHY_FILE_BYTES = 64 * 1024 * 1024;

function looksLikeUtf16(sample: Buffer, zeroOffset: 0 | 1): boolean {
  // ASCII-range text in UTF-16 has a zero in every other byte.
  const pairs = Math.floor(sample.length / 2);
  if (pairs < 2) return false;
  let zeros = 0;
  let otherZeros = 0;
  for (let index = 0; index < pairs * 2; index += 2) {
    if (sample[index + zeroOffset] === 0) zeros += 1;
    if (sample[index + 1 - zeroOffset] === 0) otherZeros += 1;
  }
  return zeros / pairs > 0.6 && otherZeros / pairs < 0.05;
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export const NOT_UTF8_MESSAGE =
  "This file is not UTF-8 text (it may use Latin-1 or Windows-1252). LatexDo did not open it so its accented characters are not damaged on save. Convert it to UTF-8, then open it again.";

// Saves always write UTF-8, so a lossy decode here (invalid bytes become
// U+FFFD) would permanently destroy the original characters on the next save.
function decodeUtf8(buffer: Buffer): string {
  try {
    return strictUtf8.decode(buffer);
  } catch {
    throw new Error(NOT_UTF8_MESSAGE);
  }
}

/**
 * Decodes a text file. Windows tools often write UTF-16, which contains zero
 * bytes and used to be refused as "binary"; it is decoded instead. Only data
 * that is neither UTF-8 nor UTF-16 is treated as binary, and 8-bit legacy
 * encodings are refused rather than decoded lossily.
 */
export function decodeTextBuffer(buffer: Buffer): string {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return decodeUtf8(buffer.subarray(3));
  }
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString("utf16le");
  }
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    return Buffer.from(buffer.subarray(2)).swap16().toString("utf16le");
  }
  if (!buffer.includes(0)) {
    return decodeUtf8(buffer);
  }
  const sample = buffer.subarray(0, NULL_BYTE_PREFIX_SCAN_BYTES);
  if (looksLikeUtf16(sample, 1)) return buffer.toString("utf16le");
  if (looksLikeUtf16(sample, 0)) {
    const even = buffer.subarray(0, buffer.length - (buffer.length % 2));
    return Buffer.from(even).swap16().toString("utf16le");
  }
  throw new Error("File appears to be binary.");
}

export async function readSafeTextFile(
  projectPath: string,
  filePath: string,
  _relativePath: string,
  options: ReadSafeTextFileOptions = {},
): Promise<string> {
  const [canonicalProjectPath, canonicalFilePath] = await Promise.all([
    realpath(projectPath),
    realpath(filePath),
  ]);
  if (!isInside(canonicalProjectPath, canonicalFilePath)) {
    throw new Error("The requested path is outside the open project.");
  }

  const fileStats = await stat(canonicalFilePath);
  if (!fileStats.isFile()) {
    throw new Error("Only regular text files can be opened.");
  }

  const maxBytes = options.maxBytes ?? MAX_TEXT_FILE_BYTES;
  if (fileStats.size > maxBytes) {
    throw new Error(
      `File is too large. Maximum text file size is ${formatBytes(maxBytes)}.`,
    );
  }

  return decodeTextBuffer(await readFile(canonicalFilePath));
}
