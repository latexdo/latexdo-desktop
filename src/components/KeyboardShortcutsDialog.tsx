import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";

interface MenuShortcut {
  menu: string;
  label: string;
  keys: string;
  editorOnly: boolean;
}

export interface KeyboardShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Every shortcut in the application menu, read from the menu itself so the
 * list cannot drift from what the keys actually do.
 */
export function KeyboardShortcutsDialog({
  open,
  onClose,
}: KeyboardShortcutsDialogProps) {
  const [shortcuts, setShortcuts] = useState<MenuShortcut[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setQuery("");
    let cancelled = false;
    void window.latexdo
      .getMenuShortcuts()
      .then((list) => {
        if (!cancelled) setShortcuts(list);
      })
      .catch(() => {
        if (!cancelled) setShortcuts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Capture phase, so the editor underneath cannot swallow the key first.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const seen = new Set<string>();
    const byMenu = new Map<string, MenuShortcut[]>();
    for (const shortcut of shortcuts ?? []) {
      // The same command can sit in two menus; list it once.
      const key = `${shortcut.label}\u0000${shortcut.keys}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (
        needle &&
        !`${shortcut.menu} ${shortcut.label} ${shortcut.keys}`
          .toLowerCase()
          .includes(needle)
      ) {
        continue;
      }
      byMenu.set(shortcut.menu, [...(byMenu.get(shortcut.menu) ?? []), shortcut]);
    }
    return [...byMenu.entries()];
  }, [query, shortcuts]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="modal-panel shortcuts-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-dialog-title"
      >
        <header className="modal-header">
          <h2 id="shortcuts-dialog-title">Keyboard Shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </header>
        <div className="shortcuts-search">
          <Search size={14} aria-hidden="true" />
          <input
            autoFocus
            value={query}
            placeholder="Search shortcuts"
            aria-label="Search shortcuts"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="shortcuts-list">
          {shortcuts === null ? (
            <p className="shortcuts-empty">Loading…</p>
          ) : shortcuts.length === 0 ? (
            <p className="shortcuts-empty">
              Keyboard shortcuts come with the desktop app&apos;s menu bar.
            </p>
          ) : groups.length === 0 ? (
            <p className="shortcuts-empty">No shortcut matches “{query}”.</p>
          ) : (
            groups.map(([menu, items]) => (
              <section key={menu} className="shortcuts-group">
                <h3>{menu}</h3>
                <ul>
                  {items.map((item) => (
                    <li key={`${item.label}-${item.keys}`}>
                      <span>
                        {item.label}
                        {item.editorOnly ? (
                          <small className="shortcuts-scope">in editor</small>
                        ) : null}
                      </span>
                      <kbd>{item.keys}</kbd>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
