import {
  access,
  copyFile,
  mkdir,
  open,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  getAiSystemCapabilities,
  type AiSystemCapabilities,
} from "./systemCapabilities.js";
import { modelPath, modelsDir } from "./models.js";

export type ToolSupport = "native" | "prompt-fallback" | "unknown" | "unsupported";

export interface ImportedModelManifest {
  id: string;
  fileName: string;
  fileSizeBytes: number;
  path: string | null;
  downloaded: boolean;
  sizeBytes: number;
  modelName?: string;
  architecture?: string;
  parameterCount?: number;
  contextLength?: number;
  quantization?: string;
  compatibility: {
    state: "compatible" | "memory-pressure" | "unsupported" | "unknown";
    estimatedRamBytes?: number;
    estimatedVramBytes?: number;
    availableRamBytes?: number;
    reason?: string;
    checkedAt: string;
  };
  capabilities: {
    toolUse: ToolSupport;
  };
}

interface GgufMetadata {
  modelName?: string;
  architecture?: string;
  parameterCount?: number;
  contextLength?: number;
  quantization?: string;
}

const MB = 1024 ** 2;
const importedModelIdPrefix = "imported-gguf:";
const manifestFileName = "imported-models.json";

function importedModelId(fileName: string): string {
  return `${importedModelIdPrefix}${fileName}`;
}

function manifestPath(): string {
  return path.join(modelsDir(), manifestFileName);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeManifest(raw: unknown): ImportedModelManifest | null {
  if (!isObject(raw)) return null;
  if (
    typeof raw.fileName !== "string" ||
    !raw.fileName.toLowerCase().endsWith(".gguf")
  ) {
    return null;
  }
  const fileName = path.basename(raw.fileName);
  const fileSizeBytes =
    typeof raw.fileSizeBytes === "number" && Number.isFinite(raw.fileSizeBytes)
      ? raw.fileSizeBytes
      : typeof raw.sizeBytes === "number" && Number.isFinite(raw.sizeBytes)
        ? raw.sizeBytes
        : 0;
  const compatibility = isObject(raw.compatibility)
    ? raw.compatibility
    : { state: "unknown", checkedAt: new Date(0).toISOString() };
  const state =
    compatibility.state === "compatible" ||
    compatibility.state === "memory-pressure" ||
    compatibility.state === "unsupported" ||
    compatibility.state === "unknown"
      ? compatibility.state
      : "unknown";
  const toolUse = isObject(raw.capabilities) ? raw.capabilities.toolUse : "unknown";
  return {
    id:
      typeof raw.id === "string" && raw.id.startsWith(importedModelIdPrefix)
        ? raw.id
        : importedModelId(fileName),
    fileName,
    fileSizeBytes,
    path: typeof raw.path === "string" ? raw.path : null,
    downloaded: raw.downloaded === true,
    sizeBytes: fileSizeBytes,
    modelName: typeof raw.modelName === "string" ? raw.modelName : undefined,
    architecture: typeof raw.architecture === "string" ? raw.architecture : undefined,
    parameterCount:
      typeof raw.parameterCount === "number" && Number.isFinite(raw.parameterCount)
        ? raw.parameterCount
        : undefined,
    contextLength:
      typeof raw.contextLength === "number" && Number.isFinite(raw.contextLength)
        ? raw.contextLength
        : undefined,
    quantization: typeof raw.quantization === "string" ? raw.quantization : undefined,
    compatibility: {
      state,
      estimatedRamBytes:
        typeof compatibility.estimatedRamBytes === "number" &&
        Number.isFinite(compatibility.estimatedRamBytes)
          ? compatibility.estimatedRamBytes
          : undefined,
      estimatedVramBytes:
        typeof compatibility.estimatedVramBytes === "number" &&
        Number.isFinite(compatibility.estimatedVramBytes)
          ? compatibility.estimatedVramBytes
          : undefined,
      availableRamBytes:
        typeof compatibility.availableRamBytes === "number" &&
        Number.isFinite(compatibility.availableRamBytes)
          ? compatibility.availableRamBytes
          : undefined,
      reason:
        typeof compatibility.reason === "string" ? compatibility.reason : undefined,
      checkedAt:
        typeof compatibility.checkedAt === "string"
          ? compatibility.checkedAt
          : new Date(0).toISOString(),
    },
    capabilities: {
      toolUse:
        toolUse === "native" ||
        toolUse === "prompt-fallback" ||
        toolUse === "unsupported"
          ? toolUse
          : "unknown",
    },
  };
}

export async function readImportedModelManifests(): Promise<ImportedModelManifest[]> {
  try {
    const raw = JSON.parse(await readFile(manifestPath(), "utf8")) as unknown[];
    if (!Array.isArray(raw)) return [];
    return raw
      .map(normalizeManifest)
      .filter((item): item is ImportedModelManifest => item !== null);
  } catch {
    return [];
  }
}

async function writeImportedModelManifests(
  manifests: ImportedModelManifest[],
): Promise<void> {
  await mkdir(modelsDir(), { recursive: true });
  await writeFile(manifestPath(), JSON.stringify(manifests, null, 2));
}

export async function saveImportedModelManifest(
  manifest: ImportedModelManifest,
): Promise<void> {
  const manifests = await readImportedModelManifests();
  const merged = new Map(manifests.map((item) => [item.fileName, item]));
  merged.set(manifest.fileName, manifest);
  await writeImportedModelManifests([...merged.values()]);
}

export async function findImportedModelManifest(
  fileName: string,
): Promise<ImportedModelManifest | null> {
  const safeName = path.basename(fileName);
  return (
    (await readImportedModelManifests()).find((item) => item.fileName === safeName) ??
    null
  );
}

function readU64(buffer: Buffer, offset: number): { value: number; offset: number } {
  if (offset + 8 > buffer.length) throw new Error("Unexpected end of GGUF metadata.");
  const raw = buffer.readBigUInt64LE(offset);
  if (raw > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("GGUF metadata value is too large.");
  }
  return { value: Number(raw), offset: offset + 8 };
}

function readString(buffer: Buffer, offset: number): { value: string; offset: number } {
  const length = readU64(buffer, offset);
  const end = length.offset + length.value;
  if (end > buffer.length) throw new Error("GGUF metadata is too large to inspect.");
  return {
    value: buffer.toString("utf8", length.offset, end),
    offset: end,
  };
}

function scalarSize(type: number): number | null {
  switch (type) {
    case 0:
    case 1:
    case 7:
      return 1;
    case 2:
    case 3:
      return 2;
    case 4:
    case 5:
    case 6:
      return 4;
    case 10:
    case 11:
    case 12:
      return 8;
    default:
      return null;
  }
}

function readValue(
  buffer: Buffer,
  offset: number,
  type: number,
): { value: unknown; offset: number } {
  switch (type) {
    case 0:
      return { value: buffer.readUInt8(offset), offset: offset + 1 };
    case 1:
      return { value: buffer.readInt8(offset), offset: offset + 1 };
    case 2:
      return { value: buffer.readUInt16LE(offset), offset: offset + 2 };
    case 3:
      return { value: buffer.readInt16LE(offset), offset: offset + 2 };
    case 4:
      return { value: buffer.readUInt32LE(offset), offset: offset + 4 };
    case 5:
      return { value: buffer.readInt32LE(offset), offset: offset + 4 };
    case 6:
      return { value: buffer.readFloatLE(offset), offset: offset + 4 };
    case 7:
      return { value: buffer.readUInt8(offset) !== 0, offset: offset + 1 };
    case 8:
      return readString(buffer, offset);
    case 10: {
      const next = readU64(buffer, offset);
      return { value: next.value, offset: next.offset };
    }
    case 11: {
      if (offset + 8 > buffer.length)
        throw new Error("Unexpected end of GGUF metadata.");
      return { value: Number(buffer.readBigInt64LE(offset)), offset: offset + 8 };
    }
    case 12:
      return { value: buffer.readDoubleLE(offset), offset: offset + 8 };
    case 9: {
      if (offset + 4 > buffer.length)
        throw new Error("Unexpected end of GGUF metadata.");
      const itemType = buffer.readUInt32LE(offset);
      const count = readU64(buffer, offset + 4);
      const size = scalarSize(itemType);
      if (size !== null) {
        const end = count.offset + count.value * size;
        if (end > buffer.length)
          throw new Error("GGUF metadata is too large to inspect.");
        return { value: undefined, offset: end };
      }
      let nextOffset = count.offset;
      for (let index = 0; index < count.value; index += 1) {
        nextOffset = readValue(buffer, nextOffset, itemType).offset;
      }
      return { value: undefined, offset: nextOffset };
    }
    default:
      throw new Error(`Unsupported GGUF metadata type ${type}.`);
  }
}

function inferQuantization(fileName: string): string | undefined {
  return (
    fileName.match(
      /\b(IQ\d_[A-Z0-9_]+|Q\d(?:_[01]|_K_[A-Z]|_K_[A-Z]+)|F\d+)\b/i,
    )?.[1] ?? undefined
  )?.toUpperCase();
}

async function inspectGguf(filePath: string): Promise<GgufMetadata> {
  const handle = await open(filePath, "r");
  try {
    const info = await handle.stat();
    const length = Math.min(info.size, 2 * MB);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    if (buffer.toString("utf8", 0, 4) !== "GGUF") {
      throw new Error("The selected file is not a valid GGUF model.");
    }
    let offset = 4;
    if (offset + 20 > buffer.length) {
      throw new Error("The selected GGUF model has an incomplete header.");
    }
    offset += 4; // version
    offset = readU64(buffer, offset).offset; // tensor count
    const metadataCount = readU64(buffer, offset);
    offset = metadataCount.offset;
    const metadata = new Map<string, unknown>();
    for (let index = 0; index < metadataCount.value; index += 1) {
      const key = readString(buffer, offset);
      offset = key.offset;
      if (offset + 4 > buffer.length) {
        throw new Error("Unexpected end of GGUF metadata.");
      }
      const type = buffer.readUInt32LE(offset);
      offset += 4;
      const value = readValue(buffer, offset, type);
      offset = value.offset;
      metadata.set(key.value, value.value);
    }
    const architecture = metadata.get("general.architecture");
    const modelName = metadata.get("general.name") ?? metadata.get("general.basename");
    const contextEntry = [...metadata.entries()].find(
      ([key, value]) => key.endsWith(".context_length") && typeof value === "number",
    );
    return {
      architecture: typeof architecture === "string" ? architecture : undefined,
      modelName: typeof modelName === "string" ? modelName : undefined,
      contextLength:
        typeof contextEntry?.[1] === "number" ? contextEntry[1] : undefined,
      quantization: inferQuantization(path.basename(filePath)),
    };
  } finally {
    await handle.close();
  }
}

export function estimateImportedModelRam(fileSizeBytes: number): number {
  return Math.ceil(fileSizeBytes * 1.35 + 512 * MB);
}

export function evaluateImportedModelCompatibility(
  fileSizeBytes: number,
  system: AiSystemCapabilities,
): ImportedModelManifest["compatibility"] {
  const checkedAt = new Date().toISOString();
  if (!system.localAiAvailable) {
    return {
      state: "unsupported",
      reason: "Local AI is not available in this runtime.",
      checkedAt,
    };
  }
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
    return {
      state: "unknown",
      reason: "LatexDo could not determine the GGUF file size.",
      checkedAt,
    };
  }
  const estimatedRamBytes = estimateImportedModelRam(fileSizeBytes);
  if (estimatedRamBytes > system.totalRamBytes) {
    return {
      state: "unsupported",
      estimatedRamBytes,
      reason: "Estimated memory requirement exceeds physical RAM.",
      checkedAt,
    };
  }
  if (estimatedRamBytes > system.freeRamBytes) {
    return {
      state: "memory-pressure",
      estimatedRamBytes,
      availableRamBytes: system.freeRamBytes,
      checkedAt,
    };
  }
  return {
    state: "compatible",
    estimatedRamBytes,
    availableRamBytes: system.freeRamBytes,
    checkedAt,
  };
}

async function copyIntoModelStore(sourcePath: string): Promise<{
  fileName: string;
  path: string;
  sizeBytes: number;
}> {
  if (path.extname(sourcePath).toLowerCase() !== ".gguf") {
    throw new Error("Only GGUF model files can be imported.");
  }
  await mkdir(modelsDir(), { recursive: true });
  const parsed = path.parse(path.basename(sourcePath));
  let fileName = `${parsed.name}${parsed.ext.toLowerCase()}`;
  let targetPath = path.join(modelsDir(), fileName);
  for (let index = 2; ; index += 1) {
    try {
      await access(targetPath);
      fileName = `${parsed.name}-${index}${parsed.ext.toLowerCase()}`;
      targetPath = path.join(modelsDir(), fileName);
    } catch {
      break;
    }
  }
  await copyFile(sourcePath, targetPath);
  const info = await stat(targetPath);
  return { fileName, path: targetPath, sizeBytes: info.size };
}

export async function importGgufModel(
  sourcePath: string,
  system: AiSystemCapabilities = getAiSystemCapabilities(),
): Promise<ImportedModelManifest> {
  const sourceInfo = await stat(sourcePath);
  const preflight = evaluateImportedModelCompatibility(sourceInfo.size, system);
  if (preflight.state === "unsupported") {
    throw new Error(
      preflight.reason ??
        "This GGUF model is not compatible with the current local runtime.",
    );
  }
  const metadata = await inspectGguf(sourcePath);

  const installed = await copyIntoModelStore(sourcePath);
  const manifest: ImportedModelManifest = {
    id: importedModelId(installed.fileName),
    fileName: installed.fileName,
    fileSizeBytes: installed.sizeBytes,
    path: installed.path,
    downloaded: true,
    sizeBytes: installed.sizeBytes,
    modelName: metadata.modelName,
    architecture: metadata.architecture,
    parameterCount: metadata.parameterCount,
    contextLength: metadata.contextLength,
    quantization: metadata.quantization,
    compatibility: evaluateImportedModelCompatibility(installed.sizeBytes, system),
    capabilities: {
      toolUse: "unknown",
    },
  };
  await saveImportedModelManifest(manifest);
  return manifest;
}

export async function inspectInstalledGgufModel(
  fileName: string,
  system: AiSystemCapabilities = getAiSystemCapabilities(),
): Promise<ImportedModelManifest> {
  const safeName = path.basename(fileName);
  const fullPath = modelPath(safeName);
  const info = await stat(fullPath);
  const metadata = await inspectGguf(fullPath);
  const manifest: ImportedModelManifest = {
    id: importedModelId(safeName),
    fileName: safeName,
    fileSizeBytes: info.size,
    path: fullPath,
    downloaded: true,
    sizeBytes: info.size,
    modelName: metadata.modelName,
    architecture: metadata.architecture,
    parameterCount: metadata.parameterCount,
    contextLength: metadata.contextLength,
    quantization: metadata.quantization,
    compatibility: evaluateImportedModelCompatibility(info.size, system),
    capabilities: {
      toolUse: "unknown",
    },
  };
  await saveImportedModelManifest(manifest);
  return manifest;
}
