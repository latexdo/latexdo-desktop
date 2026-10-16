function decodePathSegment(segment: string): string {
  if (!segment.includes("%")) {
    return segment;
  }

  try {
    return decodeURIComponent(segment);
  } catch {
    return segment.replace(/%20/gi, " ");
  }
}

export function pathForDisplay(path: string): string {
  return path
    .split(/([/\\])/)
    .map((segment) =>
      segment === "/" || segment === "\\" ? segment : decodePathSegment(segment),
    )
    .join("");
}

export function fileNameForDisplay(filePath: string): string {
  return pathForDisplay(filePath.split(/[/\\]/).pop() ?? filePath);
}
