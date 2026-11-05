import { useCallback, useRef } from "react";
import type { ImportedProjectEntry, ProjectEntry } from "../../types";
import {
  figureBytesToDataUrl,
  figurePreviewCandidatePaths,
  figurePreviewMimeType,
} from "../../figurePreview";
import {
  flattenEntries,
  isImagePath,
  latexFigureCode,
  latexReferenceForProjectFile,
} from "../../features/project/projectUtils";
import { VisualLatexEditor, type LoadedImage } from "../VisualLatexEditor";

export interface ProjectVisualEditorProps {
  projectId: string | null;
  documentPath: string;
  content: string;
  readOnly: boolean;
  projectEntries: ProjectEntry[];
  onChange: (content: string) => void;
  importExternalFilePaths: (
    sourcePaths: string[],
    destinationDirectory: string,
  ) => Promise<ImportedProjectEntry[]>;
}

/** The visual editor connected to the open project's files. */
export function ProjectVisualEditor({
  projectId,
  documentPath,
  content,
  readOnly,
  projectEntries,
  onChange,
  importExternalFilePaths,
}: ProjectVisualEditorProps) {
  const images = useRef(new Map<string, LoadedImage | null>());
  const entriesRef = useRef(projectEntries);
  entriesRef.current = projectEntries;
  const importRef = useRef(importExternalFilePaths);
  importRef.current = importExternalFilePaths;

  const loadImage = useCallback(
    async (rawPath: string): Promise<LoadedImage | null> => {
      if (!projectId) return null;
      const cacheKey = `${documentPath}\n${rawPath}`;
      if (images.current.has(cacheKey)) return images.current.get(cacheKey) ?? null;
      for (const candidate of figurePreviewCandidatePaths(rawPath, documentPath)) {
        const mimeType = figurePreviewMimeType(candidate);
        if (!mimeType) continue;
        try {
          const bytes = new Uint8Array(
            await window.latexdo.readAsset(projectId, candidate),
          );
          const loaded: LoadedImage =
            mimeType === "application/pdf"
              ? { kind: "pdf", data: bytes }
              : { kind: "image", url: figureBytesToDataUrl(bytes, mimeType) };
          images.current.set(cacheKey, loaded);
          return loaded;
        } catch {
          // Try the next place the image could be.
        }
      }
      return null;
    },
    [documentPath, projectId],
  );

  const importImages = useCallback(
    async (files: File[]): Promise<string[]> => {
      if (!projectId) return [];
      const paths = window.latexdo.getDroppedFilePaths(files);
      if (!paths.length) return [];
      await window.latexdo.createFolder(projectId, "figures").catch(() => undefined);
      const imported = await importRef.current(paths, "figures");
      return imported
        .filter((entry) => entry.type === "file" && isImagePath(entry.relativePath))
        .map((entry) => entry.relativePath);
    },
    [projectId],
  );

  const latexForProjectFile = useCallback((dragged: string) => {
    const entry = flattenEntries(entriesRef.current).find(
      (candidate) => candidate.type === "file" && candidate.path === dragged,
    );
    return entry ? latexReferenceForProjectFile(entry.relativePath) : null;
  }, []);

  return (
    <VisualLatexEditor
      content={content}
      readOnly={readOnly}
      onChange={onChange}
      loadImage={projectId ? loadImage : undefined}
      importImages={projectId ? importImages : undefined}
      latexForProjectFile={latexForProjectFile}
      figureSource={latexFigureCode}
    />
  );
}
