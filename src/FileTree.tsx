import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode2,
  FileImage,
  Folder,
  FolderOpen,
  MoreHorizontal,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { ProjectEntry } from "./types";
import { pathForDisplay } from "./pathDisplay";

interface FileTreeProps {
  entries: ProjectEntry[];
  activePath?: string;
  depth?: number;
  onOpen: (entry: ProjectEntry) => void;
  onCompileFile?: (entry: ProjectEntry) => void;
  onSetRootFile?: (entry: ProjectEntry) => void;
  onMoveEntry?: (sourcePath: string, destination: ProjectEntry | null) => void;
  onImportExternalFiles?: (files: File[], destination: ProjectEntry | null) => void;
  onChooseImportFilesInDirectory?: (entry: ProjectEntry | null) => void;
  onCreateFileInDirectory?: (entry: ProjectEntry) => void;
  onCreateFolderInDirectory?: (entry: ProjectEntry) => void;
  onCopyRelativePath?: (entry: ProjectEntry) => void;
  onInsertFileReference?: (entry: ProjectEntry) => void;
  onRevealFile?: (entry: ProjectEntry) => void;
  onCopyPath?: (entry: ProjectEntry) => void;
  onRenameEntry?: (entry: ProjectEntry, newName: string) => void;
  onDeleteEntry?: (entry: ProjectEntry) => void;
  onDuplicateEntry?: (entry: ProjectEntry) => void;
  onPasteEntry?: (
    sourcePath: string,
    mode: "copy" | "cut",
    destination: ProjectEntry,
  ) => void;
  clipboard?: TreeClipboard | null;
  onClipboardChange?: (clipboard: TreeClipboard | null) => void;
  menuPath?: string | null;
  onToggleMenu?: (path: string | null) => void;
  draggedPath?: string | null;
  onDragStartPath?: (path: string | null) => void;
}

export interface TreeClipboard {
  path: string;
  mode: "copy" | "cut";
}

interface TreeRowProps extends Omit<
  FileTreeProps,
  | "entries"
  | "menuPath"
  | "onToggleMenu"
  | "draggedPath"
  | "onDragStartPath"
  | "clipboard"
  | "onClipboardChange"
> {
  entry: ProjectEntry;
  clipboard: TreeClipboard | null;
  onClipboardChange: (clipboard: TreeClipboard | null) => void;
  menuPath: string | null;
  onToggleMenu: (path: string | null) => void;
  draggedPath: string | null;
  onDragStartPath: (path: string | null) => void;
}

function FileIcon({ name }: { name: string }) {
  const extension = name.split(".").pop()?.toLowerCase();

  if (extension === "tex" || extension === "bib" || extension === "sty") {
    return <FileCode2 size={15} className={`file-icon file-${extension}`} />;
  }

  if (["png", "jpg", "jpeg", "svg", "pdf"].includes(extension ?? "")) {
    return <FileImage size={15} className="file-icon file-image" />;
  }

  return <File size={15} className="file-icon" />;
}

const revealLabel = (() => {
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  if (/mac/i.test(platform)) return "Reveal in Finder";
  if (/win/i.test(platform)) return "Reveal in File Explorer";
  return "Open Containing Folder";
})();

type TreeMenuItem =
  | { label: string; run: () => void; disabled?: boolean; danger?: boolean }
  | "separator";

/** A plain, text-only context menu; empty groups and repeated separators collapse. */
function TreeMenu({ items, onClose }: { items: TreeMenuItem[]; onClose: () => void }) {
  const visible = items.filter(
    (item, index) =>
      item !== "separator" ||
      (index > 0 && items[index - 1] !== "separator" && index < items.length - 1),
  );
  return (
    <div
      className="tree-row-menu"
      role="menu"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      {visible.map((item, index) =>
        item === "separator" ? (
          <div key={`separator-${index}`} className="tree-row-menu-separator" />
        ) : (
          <button
            key={item.label}
            type="button"
            className={`tree-row-menu-item ${item.danger ? "danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}

function RenameInput({
  entry,
  onCommit,
  onCancel,
}: {
  entry: ProjectEntry;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // Select the name without its extension, as Finder and VS Code do.
    const dot = entry.type === "file" ? entry.name.lastIndexOf(".") : -1;
    input.setSelectionRange(0, dot > 0 ? dot : entry.name.length);
  }, [entry.name, entry.type]);
  return (
    <input
      ref={inputRef}
      className="tree-rename-input"
      defaultValue={entry.name}
      aria-label={`Rename ${entry.name}`}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") onCommit(event.currentTarget.value);
        if (event.key === "Escape") onCancel();
      }}
      onBlur={(event) => onCommit(event.currentTarget.value)}
    />
  );
}

function isTexFile(entry: ProjectEntry): boolean {
  return entry.type === "file" && entry.name.toLowerCase().endsWith(".tex");
}

function normalizeTreePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/+$/, "");
}

function parentTreePath(value: string): string {
  const normalized = normalizeTreePath(value);
  return normalized.slice(0, Math.max(0, normalized.lastIndexOf("/")));
}

function canDropIntoDirectory(
  draggedPath: string | null,
  destinationPath: string,
): boolean {
  if (!draggedPath) {
    return false;
  }

  const source = normalizeTreePath(draggedPath);
  const destination = normalizeTreePath(destinationPath);
  return (
    source !== destination &&
    parentTreePath(source) !== destination &&
    !destination.startsWith(`${source}/`)
  );
}

function findEntryByPath(
  entries: ProjectEntry[],
  targetPath: string,
): ProjectEntry | null {
  for (const entry of entries) {
    if (entry.path === targetPath) {
      return entry;
    }
    const child = entry.children ? findEntryByPath(entry.children, targetPath) : null;
    if (child) {
      return child;
    }
  }
  return null;
}

function TreeRow({
  entry,
  activePath,
  depth = 0,
  onOpen,
  onCompileFile,
  onSetRootFile,
  onMoveEntry,
  onImportExternalFiles,
  onChooseImportFilesInDirectory,
  onCreateFileInDirectory,
  onCreateFolderInDirectory,
  onCopyRelativePath,
  onInsertFileReference,
  onRevealFile,
  onCopyPath,
  onRenameEntry,
  onDeleteEntry,
  onDuplicateEntry,
  onPasteEntry,
  clipboard,
  onClipboardChange,
  menuPath,
  onToggleMenu,
  draggedPath,
  onDragStartPath,
}: TreeRowProps) {
  const [expanded, setExpanded] = useState(depth < 1);
  const [dropActive, setDropActive] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const expandTimerRef = useRef<number | null>(null);
  const toggleMenu = onToggleMenu ?? (() => {});
  const menuOpen = menuPath === entry.path;
  const isDropTarget =
    entry.type === "directory" && canDropIntoDirectory(draggedPath, entry.path);
  const isImageFile =
    entry.type === "file" &&
    ["png", "jpg", "jpeg", "pdf", "svg"].includes(
      entry.name.split(".").pop()?.toLowerCase() ?? "",
    );
  const displayName = pathForDisplay(entry.name);
  const displayRelativePath = pathForDisplay(entry.relativePath);
  const isCut = clipboard?.mode === "cut" && clipboard.path === entry.path;
  const closeMenu = () => toggleMenu(null);
  const commitRename = (name: string) => {
    setRenaming(false);
    const trimmed = name.trim();
    if (trimmed && trimmed !== entry.name) onRenameEntry?.(entry, trimmed);
  };
  const sharedMenuItems: TreeMenuItem[] = [
    "separator",
    ...(onRevealFile ? [{ label: revealLabel, run: () => onRevealFile(entry) }] : []),
    "separator",
    { label: "Cut", run: () => onClipboardChange({ path: entry.path, mode: "cut" }) },
    { label: "Copy", run: () => onClipboardChange({ path: entry.path, mode: "copy" }) },
    ...(entry.type === "directory" && onPasteEntry
      ? [
          {
            label: "Paste",
            disabled: !clipboard,
            run: () => {
              if (!clipboard) return;
              onPasteEntry(clipboard.path, clipboard.mode, entry);
              if (clipboard.mode === "cut") onClipboardChange(null);
            },
          },
        ]
      : []),
    "separator",
    ...(onCopyPath ? [{ label: "Copy Path", run: () => onCopyPath(entry) }] : []),
    ...(onCopyRelativePath
      ? [{ label: "Copy Relative Path", run: () => onCopyRelativePath(entry) }]
      : []),
    "separator",
    ...(entry.type === "file" && onDuplicateEntry
      ? [{ label: "Duplicate", run: () => onDuplicateEntry(entry) }]
      : []),
    ...(onRenameEntry ? [{ label: "Rename…", run: () => setRenaming(true) }] : []),
    ...(onDeleteEntry
      ? [{ label: "Delete", danger: true, run: () => onDeleteEntry(entry) }]
      : []),
  ];

  const droppedFiles = (event: DragEvent<HTMLElement>): File[] =>
    Array.from(event.dataTransfer.files ?? []);
  const hasExternalFiles = (event: DragEvent<HTMLElement>): boolean =>
    Array.from(event.dataTransfer.types).includes("Files");

  const clearExpandTimer = () => {
    if (expandTimerRef.current !== null) {
      window.clearTimeout(expandTimerRef.current);
      expandTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (!activePath || entry.type !== "directory") {
      return;
    }

    const normalizedEntry = `${entry.path}/`;
    if (activePath.startsWith(normalizedEntry)) {
      setExpanded(true);
    }
  }, [activePath, entry.path, entry.type]);

  useEffect(() => clearExpandTimer, []);

  const rowPadding = useMemo(
    () => (entry.type === "directory" ? 8 + depth * 12 : 25 + depth * 12),
    [depth, entry.type],
  );

  if (entry.limited) {
    return (
      <div className="tree-file-row tree-limit-row">
        <div
          className="tree-row tree-limit-message"
          style={{ paddingLeft: rowPadding }}
          title={entry.name}
        >
          <File size={15} className="file-icon" />
          <span>{entry.name}</span>
        </div>
      </div>
    );
  }

  if (entry.type === "directory") {
    return (
      <div className="tree-directory-row">
        <button
          className={`tree-row ${dropActive ? "drop-target" : ""} ${isCut ? "cut" : ""}`}
          style={{ paddingLeft: rowPadding }}
          onClick={() => {
            if (!renaming) setExpanded((current) => !current);
          }}
          onKeyDown={(event) => {
            if (event.key === "F2" && onRenameEntry) {
              event.preventDefault();
              setRenaming(true);
            }
          }}
          title={displayRelativePath}
          onContextMenu={(event) => {
            event.preventDefault();
            toggleMenu(menuOpen ? null : entry.path);
          }}
          draggable
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", entry.path);
            onDragStartPath?.(entry.path);
          }}
          onDragEnd={() => {
            clearExpandTimer();
            setDropActive(false);
            onDragStartPath?.(null);
          }}
          onDragOver={(event) => {
            if (hasExternalFiles(event) && onImportExternalFiles) {
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = "copy";
              setDropActive(true);
              if (!expanded && expandTimerRef.current === null) {
                expandTimerRef.current = window.setTimeout(() => {
                  setExpanded(true);
                  expandTimerRef.current = null;
                }, 450);
              }
              return;
            }
            if (draggedPath) {
              event.stopPropagation();
            }
            if (!isDropTarget) {
              return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDropActive(true);
            if (!expanded && expandTimerRef.current === null) {
              expandTimerRef.current = window.setTimeout(() => {
                setExpanded(true);
                expandTimerRef.current = null;
              }, 450);
            }
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
              return;
            }
            clearExpandTimer();
            setDropActive(false);
          }}
          onDrop={(event) => {
            const files = droppedFiles(event);
            if (files.length > 0 && onImportExternalFiles) {
              event.preventDefault();
              event.stopPropagation();
              clearExpandTimer();
              setDropActive(false);
              onImportExternalFiles(files, entry);
              return;
            }
            if (draggedPath) {
              event.stopPropagation();
            }
            clearExpandTimer();
            if (!onMoveEntry || !draggedPath || !isDropTarget) {
              setDropActive(false);
              return;
            }
            event.preventDefault();
            setDropActive(false);
            const sourcePath = event.dataTransfer.getData("text/plain");
            if (!sourcePath || sourcePath === entry.path) {
              return;
            }
            onMoveEntry(sourcePath, entry);
            onDragStartPath(null);
          }}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {expanded ? (
            <FolderOpen size={15} className="folder-icon" />
          ) : (
            <Folder size={15} className="folder-icon" />
          )}
          {renaming ? (
            <RenameInput
              entry={entry}
              onCommit={commitRename}
              onCancel={() => setRenaming(false)}
            />
          ) : (
            <span>{displayName}</span>
          )}
        </button>
        <div className="tree-row-actions">
          <button
            type="button"
            className={`tree-row-menu-button ${menuOpen ? "active" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              toggleMenu(menuOpen ? null : entry.path);
            }}
            title={`Actions for ${displayName}`}
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen ? (
            <TreeMenu
              onClose={closeMenu}
              items={[
                ...(onCreateFileInDirectory
                  ? [{ label: "New File…", run: () => onCreateFileInDirectory(entry) }]
                  : []),
                ...(onCreateFolderInDirectory
                  ? [
                      {
                        label: "New Folder…",
                        run: () => onCreateFolderInDirectory(entry),
                      },
                    ]
                  : []),
                ...(onChooseImportFilesInDirectory
                  ? [
                      {
                        label: "Import Files Here…",
                        run: () => onChooseImportFilesInDirectory(entry),
                      },
                    ]
                  : []),
                ...sharedMenuItems,
              ]}
            />
          ) : null}
        </div>
        {expanded && entry.children ? (
          <FileTree
            entries={entry.children}
            activePath={activePath}
            depth={depth + 1}
            onOpen={onOpen}
            onCompileFile={onCompileFile}
            onSetRootFile={onSetRootFile}
            onMoveEntry={onMoveEntry}
            onImportExternalFiles={onImportExternalFiles}
            onChooseImportFilesInDirectory={onChooseImportFilesInDirectory}
            onCreateFileInDirectory={onCreateFileInDirectory}
            onCreateFolderInDirectory={onCreateFolderInDirectory}
            onCopyRelativePath={onCopyRelativePath}
            onInsertFileReference={onInsertFileReference}
            onRevealFile={onRevealFile}
            onCopyPath={onCopyPath}
            onRenameEntry={onRenameEntry}
            onDeleteEntry={onDeleteEntry}
            onDuplicateEntry={onDuplicateEntry}
            onPasteEntry={onPasteEntry}
            clipboard={clipboard}
            onClipboardChange={onClipboardChange}
            menuPath={menuPath}
            onToggleMenu={onToggleMenu}
            draggedPath={draggedPath}
            onDragStartPath={onDragStartPath}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="tree-file-row">
      <div
        className={`tree-row ${activePath === entry.path ? "active" : ""} ${
          isCut ? "cut" : ""
        }`}
        style={{ paddingLeft: rowPadding }}
        onClick={() => {
          if (!renaming) onOpen(entry);
        }}
        title={displayRelativePath}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", entry.path);
          onDragStartPath?.(entry.path);
        }}
        onDragEnd={() => onDragStartPath?.(null)}
        onContextMenu={(event) => {
          event.preventDefault();
          toggleMenu(menuOpen ? null : entry.path);
        }}
      >
        {isImageFile && onRevealFile ? (
          <button
            type="button"
            className="tree-file-icon-button"
            onClick={(event) => {
              event.stopPropagation();
              onRevealFile(entry);
            }}
            title={`Reveal ${displayName} in file manager`}
            aria-label={`Reveal ${displayName} in file manager`}
          >
            <FileIcon name={entry.name} />
          </button>
        ) : (
          <FileIcon name={entry.name} />
        )}
        {renaming ? (
          <RenameInput
            entry={entry}
            onCommit={commitRename}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <span>{displayName}</span>
        )}
      </div>
      <div className="tree-row-actions">
        <button
          type="button"
          className={`tree-row-menu-button ${menuOpen ? "active" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            toggleMenu(menuOpen ? null : entry.path);
          }}
          title={`Actions for ${displayName}`}
        >
          <MoreHorizontal size={14} />
        </button>
        {menuOpen ? (
          <TreeMenu
            onClose={closeMenu}
            items={[
              { label: "Open", run: () => onOpen(entry) },
              ...(isTexFile(entry) && onCompileFile
                ? [{ label: "Compile to PDF", run: () => onCompileFile(entry) }]
                : []),
              ...(isTexFile(entry) && onSetRootFile
                ? [{ label: "Set as Main File", run: () => onSetRootFile(entry) }]
                : []),
              ...(isImageFile && onInsertFileReference
                ? [
                    {
                      label: "Insert Image Code",
                      run: () => onInsertFileReference(entry),
                    },
                  ]
                : []),
              ...sharedMenuItems,
            ]}
          />
        ) : null}
      </div>
    </div>
  );
}

export default function FileTree({
  entries,
  activePath,
  depth = 0,
  onOpen,
  onCompileFile,
  onSetRootFile,
  onMoveEntry,
  onImportExternalFiles,
  onChooseImportFilesInDirectory,
  onCreateFileInDirectory,
  onCreateFolderInDirectory,
  onCopyRelativePath,
  onInsertFileReference,
  onRevealFile,
  onCopyPath,
  onRenameEntry,
  onDeleteEntry,
  onDuplicateEntry,
  onPasteEntry,
  clipboard: controlledClipboard,
  onClipboardChange: controlledSetClipboard,
  menuPath: controlledMenuPath,
  onToggleMenu: controlledToggleMenu,
  draggedPath: controlledDraggedPath,
  onDragStartPath: controlledSetDraggedPath,
}: FileTreeProps) {
  const [menuPathState, setMenuPathState] = useState<string | null>(null);
  const [clipboardState, setClipboardState] = useState<TreeClipboard | null>(null);
  const clipboard =
    controlledClipboard !== undefined ? controlledClipboard : clipboardState;
  const setClipboard = controlledSetClipboard ?? setClipboardState;
  const [draggedPathState, setDraggedPathState] = useState<string | null>(null);
  const [rootDropActive, setRootDropActive] = useState(false);
  const menuPath = controlledMenuPath ?? menuPathState;
  const toggleMenu = controlledToggleMenu ?? setMenuPathState;
  const draggedPath = controlledDraggedPath ?? draggedPathState;
  const setDraggedPath = controlledSetDraggedPath ?? setDraggedPathState;
  const draggedEntry =
    depth === 0 && draggedPath ? findEntryByPath(entries, draggedPath) : null;
  const canDropAtRoot = Boolean(
    draggedEntry && normalizeTreePath(draggedEntry.relativePath).includes("/"),
  );

  useEffect(() => {
    const closeMenu = () => toggleMenu(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [toggleMenu]);

  useEffect(() => {
    if (!draggedPath) {
      setRootDropActive(false);
    }
  }, [draggedPath]);

  const rows = (
    <>
      {entries.map((entry) => (
        <TreeRow
          key={entry.path}
          entry={entry}
          activePath={activePath}
          depth={depth}
          onOpen={onOpen}
          onCompileFile={onCompileFile}
          onSetRootFile={onSetRootFile}
          onMoveEntry={onMoveEntry}
          onImportExternalFiles={onImportExternalFiles}
          onChooseImportFilesInDirectory={onChooseImportFilesInDirectory}
          onCreateFileInDirectory={onCreateFileInDirectory}
          onCreateFolderInDirectory={onCreateFolderInDirectory}
          onCopyRelativePath={onCopyRelativePath}
          onInsertFileReference={onInsertFileReference}
          onRevealFile={onRevealFile}
          onCopyPath={onCopyPath}
          onRenameEntry={onRenameEntry}
          onDeleteEntry={onDeleteEntry}
          onDuplicateEntry={onDuplicateEntry}
          onPasteEntry={onPasteEntry}
          clipboard={clipboard}
          onClipboardChange={setClipboard}
          menuPath={menuPath}
          onToggleMenu={toggleMenu}
          draggedPath={draggedPath}
          onDragStartPath={setDraggedPath}
        />
      ))}
    </>
  );

  if (depth > 0) {
    return rows;
  }

  return (
    <div
      className={`file-tree-drop-surface ${
        draggedPath ? "dragging" : ""
      } ${canDropAtRoot ? "root-available" : ""} ${
        rootDropActive ? "root-drop-target" : ""
      }`}
      onDragOver={(event) => {
        if (
          Array.from(event.dataTransfer.types).includes("Files") &&
          onImportExternalFiles
        ) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setRootDropActive(true);
          return;
        }
        if (!canDropAtRoot) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setRootDropActive(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setRootDropActive(false);
        }
      }}
      onDrop={(event) => {
        setRootDropActive(false);
        const files = Array.from(event.dataTransfer.files ?? []);
        if (files.length > 0 && onImportExternalFiles) {
          event.preventDefault();
          onImportExternalFiles(files, null);
          return;
        }
        if (!onMoveEntry || !canDropAtRoot) {
          return;
        }
        event.preventDefault();
        const sourcePath = event.dataTransfer.getData("text/plain");
        if (!sourcePath) {
          return;
        }
        onMoveEntry(sourcePath, null);
        setDraggedPath(null);
      }}
    >
      {rows}
      {draggedPath && canDropAtRoot ? (
        <div className="file-tree-root-hint">
          Drop in this space to move to the project root
        </div>
      ) : rootDropActive ? (
        <div className="file-tree-root-hint">
          Drop files here to import into the project root
        </div>
      ) : null}
    </div>
  );
}
