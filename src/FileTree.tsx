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
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { topLevelTreeEntries } from "./features/project/treeSelection";
import type { ProjectEntry } from "./types";
import { pathForDisplay } from "./pathDisplay";

interface FileTreeProps {
  entries: ProjectEntry[];
  activePath?: string;
  depth?: number;
  onOpen: (entry: ProjectEntry) => void;
  onCompileFile?: (entry: ProjectEntry) => void;
  onSetRootFile?: (entry: ProjectEntry) => void;
  onMoveEntry?: (
    sourcePath: string,
    destination: ProjectEntry | null,
  ) => void | boolean | Promise<void | boolean>;
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
  onDeleteEntries?: (entries: ProjectEntry[]) => void | Promise<void>;
  onDuplicateEntry?: (entry: ProjectEntry) => void;
  onPasteEntry?: (
    sourcePath: string,
    mode: "copy" | "cut",
    destination: ProjectEntry,
  ) => void | boolean | Promise<void | boolean>;
  clipboard?: TreeClipboard | null;
  onClipboardChange?: (clipboard: TreeClipboard | null) => void;
  menuPath?: string | null;
  onToggleMenu?: (path: string | null) => void;
  draggedPath?: string | null;
  onDragStartPath?: (path: string | null) => void;
}

export interface TreeClipboard {
  path: string;
  paths?: string[];
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

interface SelectionState {
  paths: Set<string>;
  select: (
    path: string,
    element: HTMLElement,
    modifiers?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean },
  ) => void;
  all: (element: HTMLElement) => void;
  entriesFor: (entry: ProjectEntry) => ProjectEntry[];
  deleteEntries?: FileTreeProps["onDeleteEntries"];
  movingPaths: (path: string) => string[];
  move: (path: string, destination: ProjectEntry | null) => Promise<void>;
}
const TreeSelection = createContext<SelectionState | null>(null);

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
  const selection = useContext(TreeSelection);
  const selected = selection?.paths.has(entry.path) ?? false;
  const selectedEntries = selection?.entriesFor(entry) ?? [entry];
  const multiple = selectedEntries.length > 1;
  const copySelection = (mode: "copy" | "cut") => {
    const paths = topLevelTreeEntries(selectedEntries).map((item) => item.path);
    onClipboardChange({ path: paths[0], ...(paths.length > 1 ? { paths } : {}), mode });
  };
  const deleteSelection = () => {
    if (multiple && selection?.deleteEntries)
      void selection.deleteEntries(selectedEntries);
    else if (!multiple && selectedEntries[0]) onDeleteEntry?.(selectedEntries[0]);
  };
  const pasteBusy = useRef(false);
  const pasteSelection = async () => {
    if (!clipboard || !onPasteEntry || pasteBusy.current) return;
    pasteBusy.current = true;
    const sources = clipboard.paths ?? [clipboard.path];
    try {
      for (let index = 0; index < sources.length; index += 1) {
        const result = onPasteEntry(sources[index], clipboard.mode, entry);
        const succeeded = result instanceof Promise ? await result : result;
        if (succeeded === false) return;
        if (clipboard.mode === "cut") {
          const remaining = sources.slice(index + 1);
          onClipboardChange(
            remaining.length
              ? { path: remaining[0], paths: remaining, mode: "cut" }
              : null,
          );
        }
      }
    } finally {
      pasteBusy.current = false;
    }
  };
  const selectContextRow = (element: HTMLElement) => {
    if (!selected) selection?.select(entry.path, element);
  };
  const [expanded, setExpanded] = useState(depth < 1);
  const [dropActive, setDropActive] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const expandTimerRef = useRef<number | null>(null);
  const toggleMenu = onToggleMenu ?? (() => {});
  const menuOpen = menuPath === entry.path;
  const isDropTarget =
    entry.type === "directory" &&
    Boolean(draggedPath) &&
    (selection?.movingPaths(draggedPath!) ?? [draggedPath!]).every((path) =>
      canDropIntoDirectory(path, entry.path),
    );
  const isImageFile =
    entry.type === "file" &&
    ["png", "jpg", "jpeg", "pdf", "svg"].includes(
      entry.name.split(".").pop()?.toLowerCase() ?? "",
    );
  const displayName = pathForDisplay(entry.name);
  const displayRelativePath = pathForDisplay(entry.relativePath);
  const isCut =
    clipboard?.mode === "cut" &&
    (clipboard.paths ?? [clipboard.path]).includes(entry.path);
  const closeMenu = () => toggleMenu(null);
  const commitRename = (name: string) => {
    setRenaming(false);
    const trimmed = name.trim();
    if (trimmed && trimmed !== entry.name) onRenameEntry?.(entry, trimmed);
  };
  const handleRowKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // Shortcuts belong to the focused row, never a rename field or icon button.
    if (
      event.target !== event.currentTarget ||
      renaming ||
      event.nativeEvent.isComposing
    )
      return;
    const command = event.metaKey || event.ctrlKey;
    const plain = !command && !event.altKey && !event.shiftKey;
    let run: (() => void) | undefined;
    if (
      onDeleteEntry &&
      !event.altKey &&
      !event.shiftKey &&
      ((event.key === "Backspace" && event.metaKey && !event.ctrlKey) ||
        (event.key === "Delete" && !command))
    ) {
      run = deleteSelection;
    } else if (plain && event.key === "F2" && onRenameEntry && !multiple) {
      run = () => setRenaming(true);
    } else if (
      command &&
      !event.altKey &&
      !event.shiftKey &&
      ["c", "x"].includes(event.key.toLowerCase())
    ) {
      run = () => copySelection(event.key.toLowerCase() === "x" ? "cut" : "copy");
    } else if (
      command &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "v" &&
      entry.type === "directory" &&
      clipboard &&
      onPasteEntry
    ) {
      run = () => {
        void pasteSelection();
      };
    } else if (command && !event.altKey && event.key.toLowerCase() === "a") {
      run = () => selection?.all(event.currentTarget);
    } else if (
      !command &&
      !event.altKey &&
      ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
    ) {
      const rows = Array.from(
        event.currentTarget
          .closest(".file-tree-drop-surface")
          ?.querySelectorAll<HTMLElement>("[data-tree-entry]") ?? [],
      );
      const index = rows.indexOf(event.currentTarget);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? rows.length - 1
            : index + (event.key === "ArrowDown" ? 1 : -1);
      run = () => {
        const target = rows[Math.max(0, Math.min(next, rows.length - 1))];
        if (!target) return;
        selection?.select(target.dataset.treeEntry!, target, {
          shiftKey: event.shiftKey,
        });
        target.focus();
      };
    } else if (
      plain &&
      entry.type === "directory" &&
      ["ArrowLeft", "ArrowRight"].includes(event.key)
    ) {
      run = () => setExpanded(event.key === "ArrowRight");
    } else if (plain && entry.type === "file" && ["Enter", " "].includes(event.key)) {
      run = () => onOpen(entry);
    }
    if (!run) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) run();
  };

  const sharedMenuItems: TreeMenuItem[] = [
    "separator",
    ...(onRevealFile ? [{ label: revealLabel, run: () => onRevealFile(entry) }] : []),
    "separator",
    { label: "Cut", run: () => copySelection("cut") },
    { label: "Copy", run: () => copySelection("copy") },
    ...(entry.type === "directory" && onPasteEntry
      ? [
          {
            label: "Paste",
            disabled: !clipboard,
            run: () => {
              void pasteSelection();
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
    ...(onRenameEntry && !multiple
      ? [{ label: "Rename…", run: () => setRenaming(true) }]
      : []),
    ...(onDeleteEntry && (!multiple || selection?.deleteEntries)
      ? [
          {
            label: multiple ? `Delete ${selectedEntries.length} Items` : "Delete",
            danger: true,
            run: deleteSelection,
          },
        ]
      : []),
  ];

  const multiMenuItems: TreeMenuItem[] = [
    { label: `Copy ${selectedEntries.length} Items`, run: () => copySelection("copy") },
    { label: `Cut ${selectedEntries.length} Items`, run: () => copySelection("cut") },
    ...(selection?.deleteEntries
      ? [
          {
            label: `Delete ${selectedEntries.length} Items`,
            danger: true,
            run: deleteSelection,
          },
        ]
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
          className={`tree-row ${dropActive ? "drop-target" : ""} ${isCut ? "cut" : ""} ${selected ? "selected" : ""}`}
          style={{ paddingLeft: rowPadding }}
          data-tree-entry={entry.path}
          aria-selected={selected}
          role="treeitem"
          aria-expanded={expanded}
          onClick={(event) => {
            if (!renaming) {
              event.currentTarget.focus();
              selection?.select(entry.path, event.currentTarget, event);
              if (!event.metaKey && !event.ctrlKey && !event.shiftKey)
                setExpanded((current) => !current);
            }
          }}
          onKeyDown={handleRowKeyDown}
          title={displayRelativePath}
          onContextMenu={(event) => {
            event.preventDefault();
            selectContextRow(event.currentTarget);
            toggleMenu(menuOpen ? null : entry.path);
          }}
          draggable
          onDragStart={(event) => {
            event.stopPropagation();
            selectContextRow(event.currentTarget);
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
            if (selection) void selection.move(sourcePath, entry);
            else void onMoveEntry(sourcePath, entry);
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
              selectContextRow(event.currentTarget);
              toggleMenu(menuOpen ? null : entry.path);
            }}
            title={`Actions for ${displayName}`}
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen ? (
            <TreeMenu
              onClose={closeMenu}
              items={
                multiple
                  ? multiMenuItems
                  : [
                      ...(onCreateFileInDirectory
                        ? [
                            {
                              label: "New File…",
                              run: () => onCreateFileInDirectory(entry),
                            },
                          ]
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
                    ]
              }
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
        } ${selected ? "selected" : ""}`}
        style={{ paddingLeft: rowPadding }}
        role="treeitem"
        tabIndex={0}
        data-tree-entry={entry.path}
        aria-selected={selected}
        onKeyDown={handleRowKeyDown}
        onClick={(event) => {
          if (!renaming) {
            event.currentTarget.focus();
            selection?.select(entry.path, event.currentTarget, event);
            if (!event.metaKey && !event.ctrlKey && !event.shiftKey) onOpen(entry);
          }
        }}
        title={displayRelativePath}
        draggable
        onDragStart={(event) => {
          selectContextRow(event.currentTarget);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", entry.path);
          onDragStartPath?.(entry.path);
        }}
        onDragEnd={() => onDragStartPath?.(null)}
        onContextMenu={(event) => {
          event.preventDefault();
          selectContextRow(event.currentTarget);
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
            selectContextRow(event.currentTarget);
            toggleMenu(menuOpen ? null : entry.path);
          }}
          title={`Actions for ${displayName}`}
        >
          <MoreHorizontal size={14} />
        </button>
        {menuOpen ? (
          <TreeMenu
            onClose={closeMenu}
            items={
              multiple
                ? multiMenuItems
                : [
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
                  ]
            }
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
  onDeleteEntries,
  onDuplicateEntry,
  onPasteEntry,
  clipboard: controlledClipboard,
  onClipboardChange: controlledSetClipboard,
  menuPath: controlledMenuPath,
  onToggleMenu: controlledToggleMenu,
  draggedPath: controlledDraggedPath,
  onDragStartPath: controlledSetDraggedPath,
}: FileTreeProps) {
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const anchorRef = useRef<string | null>(null);
  const visiblePaths = (element: HTMLElement) =>
    Array.from(
      element
        .closest(".file-tree-drop-surface")
        ?.querySelectorAll<HTMLElement>("[data-tree-entry]") ?? [],
    ).map((row) => row.dataset.treeEntry!);
  const selection: SelectionState = {
    paths: selectedPaths,
    select: (path, element, modifiers = {}) => {
      if (modifiers.shiftKey && anchorRef.current) {
        const visible = visiblePaths(element);
        const start = visible.indexOf(anchorRef.current);
        const end = visible.indexOf(path);
        if (start >= 0 && end >= 0) {
          const range = visible.slice(Math.min(start, end), Math.max(start, end) + 1);
          setSelectedPaths(
            new Set(
              modifiers.metaKey || modifiers.ctrlKey
                ? [...selectedPaths, ...range]
                : range,
            ),
          );
          return;
        }
      }
      anchorRef.current = path;
      if (modifiers.metaKey || modifiers.ctrlKey) {
        const next = new Set(selectedPaths);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        setSelectedPaths(next);
      } else setSelectedPaths(new Set([path]));
    },
    all: (element) => {
      const paths = visiblePaths(element);
      anchorRef.current = paths[0] ?? null;
      setSelectedPaths(new Set(paths));
    },
    entriesFor: (entry) => {
      const selected = [...selectedPaths]
        .map((path) => findEntryByPath(entries, path))
        .filter((item): item is ProjectEntry => Boolean(item && !item.limited));
      return selected.length ? selected : [entry];
    },
    deleteEntries: onDeleteEntries,
    movingPaths: (path) => {
      const entry = findEntryByPath(entries, path);
      return entry && selectedPaths.has(path)
        ? topLevelTreeEntries(selection.entriesFor(entry)).map((item) => item.path)
        : [path];
    },
    move: async (path, destination) => {
      if (!onMoveEntry) return;
      for (const source of selection.movingPaths(path)) {
        const result = onMoveEntry(source, destination);
        if ((result instanceof Promise ? await result : result) === false) break;
      }
    },
  };
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
    draggedEntry &&
    selection.movingPaths(draggedEntry.path).every((path) => {
      const entry = findEntryByPath(entries, path);
      return entry && normalizeTreePath(entry.relativePath).includes("/");
    }),
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
    <TreeSelection.Provider value={selection}>
      <div
        role="tree"
        aria-label="Project files"
        aria-multiselectable="true"
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
          void selection.move(sourcePath, null);
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
    </TreeSelection.Provider>
  );
}
