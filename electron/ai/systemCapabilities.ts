import os from "node:os";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statfsSync } from "node:fs";
import { modelsDir } from "./models.js";

export interface AiSystemCapabilities {
  totalRamBytes: number;
  freeRamBytes: number;
  totalStorageBytes: number | null;
  freeStorageBytes: number | null;
  modelStoragePath: string | null;
  platform: NodeJS.Platform;
  arch: string;
  cpuCount: number;
  localAiAvailable: boolean;
}

function parsePositiveNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function parseDarwinVmStatAvailableBytes(output: string): number | null {
  const pageSize = parsePositiveNumber(
    output.match(/page size of\s+(\d+)\s+bytes/i)?.[1],
  );
  if (!pageSize) return null;

  const pageCounts = new Map<string, number>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*"?([^":]+)"?:\s+([\d,]+)\./.exec(line);
    const value = parsePositiveNumber(match?.[2]);
    if (!match || value === null) continue;
    pageCounts.set(match[1].trim().toLowerCase(), value);
  }

  const reclaimablePages =
    (pageCounts.get("pages free") ?? 0) +
    (pageCounts.get("pages speculative") ?? 0) +
    (pageCounts.get("pages purgeable") ?? 0) +
    (pageCounts.get("file-backed pages") ?? 0);

  return reclaimablePages > 0 ? reclaimablePages * pageSize : null;
}

export function parseLinuxMemAvailableBytes(output: string): number | null {
  const kb = parsePositiveNumber(output.match(/^MemAvailable:\s+([\d,]+)\s+kB/im)?.[1]);
  return kb === null ? null : kb * 1024;
}

function clampAvailableMemory(bytes: number, totalRamBytes: number): number {
  return Math.max(0, Math.min(totalRamBytes, Math.floor(bytes)));
}

function readDarwinAvailableMemoryBytes(): number | null {
  try {
    return parseDarwinVmStatAvailableBytes(
      execFileSync("vm_stat", {
        encoding: "utf8",
        timeout: 1000,
      }),
    );
  } catch {
    return null;
  }
}

function readLinuxAvailableMemoryBytes(): number | null {
  try {
    return parseLinuxMemAvailableBytes(readFileSync("/proc/meminfo", "utf8"));
  } catch {
    return null;
  }
}

function availableMemoryBytes(
  totalRamBytes: number,
  fallbackFreeBytes: number,
): number {
  const platformAvailable =
    process.platform === "darwin"
      ? readDarwinAvailableMemoryBytes()
      : process.platform === "linux"
        ? readLinuxAvailableMemoryBytes()
        : null;
  return clampAvailableMemory(
    Math.max(fallbackFreeBytes, platformAvailable ?? 0),
    totalRamBytes,
  );
}

function modelStorageCapabilities(): Pick<
  AiSystemCapabilities,
  "totalStorageBytes" | "freeStorageBytes" | "modelStoragePath"
> {
  const directory = modelsDir();
  try {
    mkdirSync(directory, { recursive: true });
    const info = statfsSync(directory);
    const blockSize = Number(info.bsize);
    return {
      totalStorageBytes: Math.max(0, Number(info.blocks) * blockSize),
      freeStorageBytes: Math.max(0, Number(info.bavail) * blockSize),
      modelStoragePath: directory,
    };
  } catch {
    return {
      totalStorageBytes: null,
      freeStorageBytes: null,
      modelStoragePath: directory,
    };
  }
}

export function getAiSystemCapabilities(): AiSystemCapabilities {
  const totalRamBytes = os.totalmem();
  const rawFreeBytes = os.freemem();
  const storage = modelStorageCapabilities();
  return {
    totalRamBytes,
    freeRamBytes: availableMemoryBytes(totalRamBytes, rawFreeBytes),
    ...storage,
    platform: process.platform,
    arch: process.arch,
    cpuCount: os.cpus().length,
    localAiAvailable: true,
  };
}
