import { useEffect, useRef, useState, type DragEvent } from "react";
import type { AppCtx } from "./appContext";
import { isTextDocument } from "./appShared";
import { pathForDisplay } from "../pathDisplay";

export function useFolderDrop(ctx: AppCtx) {
  const [paths, setPaths] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (paths.length) dialogRef.current?.showModal();
    else if (dialogRef.current?.open) dialogRef.current.close();
  }, [paths]);

  const onDropCapture = (event: DragEvent<HTMLDivElement>) => {
    const items = Array.from(event.dataTransfer.items ?? []);
    const directories = items.filter((item) => item.webkitGetAsEntry?.()?.isDirectory);
    if (!directories.length) return;
    // Capture before the editor and file tree can import the directory.
    event.preventDefault();
    event.stopPropagation();
    if (busyRef.current || ctx.requireLegalAcceptance()) return;
    if (window.latexdo.runtime !== "desktop") {
      ctx.setStatusMessage("Open local folders in the LatexDo desktop app.");
      return;
    }
    const files = directories
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    const droppedPaths = window.latexdo.getDroppedFilePaths(files);
    if (!droppedPaths.length) {
      ctx.setStatusMessage(
        "Could not read the dropped folder. Try Open Folder instead.",
      );
      return;
    }
    setError("");
    setPaths(droppedPaths);
  };

  const open = async (disposition: "space" | "window") => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      if (disposition === "space") {
        for (const document of ctx.documentsRef.current) {
          if (isTextDocument(document) && document.content !== document.savedContent) {
            await ctx.saveDocument(document);
          }
        }
      }
      const project = await window.latexdo.openDroppedFolders(
        paths,
        ctx.projectIdRef.current || null,
        disposition,
      );
      if (project) {
        await ctx.loadProject(project, true, false);
        ctx.setSidebarVisible(true);
        ctx.setActiveSidebar("explorer");
        ctx.setWelcomeOpen(false);
        ctx.setStatusMessage("Folders added to Research Space");
      }
      setPaths([]);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not open the dropped folders.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const dialog = (
    <dialog
      ref={dialogRef}
      className="folder-drop-dialog"
      aria-labelledby="folder-drop-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) setPaths([]);
      }}
    >
      <h2 id="folder-drop-title">Open {paths.length === 1 ? "folder" : "folders"}</h2>
      <p>{paths.map((path) => pathForDisplay(path).split(/[\\/]/).pop()).join(", ")}</p>
      <p>
        Add to a research space, or open{" "}
        {paths.length === 1 ? "it in a new window" : "each folder in its own window"}.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <div className="folder-drop-actions">
        <button
          type="button"
          className="dialog-submit"
          disabled={busy}
          onClick={() => void open("space")}
        >
          Add to Research Space
        </button>
        <button
          type="button"
          className="dialog-cancel"
          disabled={busy}
          onClick={() => void open("window")}
        >
          Open in New {paths.length > 1 ? "Windows" : "Window"}
        </button>
        <button
          type="button"
          className="dialog-cancel"
          disabled={busy}
          onClick={() => setPaths([])}
        >
          Cancel
        </button>
      </div>
      {busy ? <p role="status">Opening folders…</p> : null}
    </dialog>
  );
  return { onDropCapture, dialog };
}
