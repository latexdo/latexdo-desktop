const previewableFigureExtensions = ["png", "jpg", "jpeg", "svg", "pdf"] as const;
const previewableFigureExtensionSet = new Set<string>(previewableFigureExtensions);

const figureMimeTypes: Record<string, string> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
};

export interface IncludeGraphicsTarget {
  rawPath: string;
  path: string;
  startColumn: number;
  endColumn: number;
}

function normalizeFigurePath(filePath: string): string {
  return filePath
    .trim()
    .replace(/^["']|["']$/g, "")
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/")
    .replace(/(^|\/)\.\//g, "$1")
    .replace(/^\/+/, "");
}

function safeProjectRelativePath(filePath: string): boolean {
  if (
    !filePath ||
    filePath.startsWith("/") ||
    /^[A-Za-z]:/.test(filePath) ||
    /^[a-z][a-z0-9+.-]*:/i.test(filePath)
  ) {
    return false;
  }

  return filePath
    .split("/")
    .every((segment) => segment && segment !== "." && segment !== "..");
}

function directoryName(filePath: string): string {
  const normalized = normalizeFigurePath(filePath);
  const segments = normalized.split("/");
  segments.pop();
  return segments.join("/");
}

function joinRelativePath(directory: string, filePath: string): string {
  return normalizeFigurePath(directory ? `${directory}/${filePath}` : filePath);
}

export function figurePreviewMimeType(filePath: string): string | null {
  const extension = filePath.split(".").pop()?.toLowerCase();
  return extension ? (figureMimeTypes[extension] ?? null) : null;
}

export function figureCanRenderInline(filePath: string): boolean {
  const mimeType = figurePreviewMimeType(filePath);
  return Boolean(mimeType && mimeType !== "application/pdf");
}

export function figureBytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

export function figurePreviewCandidatePaths(
  rawPath: string,
  texRelativePath: string,
): string[] {
  const trimmedPath = rawPath.trim().replace(/^["']|["']$/g, "");
  if (
    trimmedPath.startsWith("/") ||
    /^[A-Za-z]:/.test(trimmedPath) ||
    /^[a-z][a-z0-9+.-]*:/i.test(trimmedPath)
  ) {
    return [];
  }

  const figurePath = normalizeFigurePath(rawPath);
  if (!safeProjectRelativePath(figurePath)) {
    return [];
  }

  const extension = figurePath.split(".").pop()?.toLowerCase();
  const pathVariants =
    extension && previewableFigureExtensionSet.has(extension)
      ? [figurePath]
      : previewableFigureExtensions.map((candidateExtension) =>
          normalizeFigurePath(`${figurePath}.${candidateExtension}`),
        );
  const texDirectory = directoryName(texRelativePath);
  const candidates = new Set<string>();

  for (const pathVariant of pathVariants) {
    if (texDirectory) {
      candidates.add(joinRelativePath(texDirectory, pathVariant));
    }
    candidates.add(pathVariant);
  }

  return [...candidates].filter(safeProjectRelativePath);
}

export function parseIncludeGraphicsAtPosition(
  lineContent: string,
  column: number,
): IncludeGraphicsTarget | null {
  const includeGraphicsPattern =
    /\\includegraphics\*?\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}/g;

  for (const match of lineContent.matchAll(includeGraphicsPattern)) {
    const startColumn = match.index + 1;
    const endColumn = match.index + match[0].length + 1;
    if (column < startColumn || column > endColumn) {
      continue;
    }

    const rawPath = match[1];
    const path = normalizeFigurePath(rawPath);
    if (!path) {
      return null;
    }

    return {
      rawPath,
      path,
      startColumn,
      endColumn,
    };
  }

  return null;
}
