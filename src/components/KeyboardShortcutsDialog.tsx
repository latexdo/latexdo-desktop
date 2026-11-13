import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, Search, X } from "lucide-react";
import type { MenuShortcut } from "../../electron/types";

export interface KeyboardShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Every shortcut in the application menu, read from the menu itself so the
 * list cannot drift from what the keys actually do. Commands with an id can
 * be given other keys: click the keys, then press the new ones.
 */
export function KeyboardShortcutsDialog({
  open,
  onClose,
}: KeyboardShortcutsDialogProps) {
  const [shortcuts, setShortcuts] = useState<MenuShortcut[] | null>(null);
  const [query, setQuery] = useState("");
  const [showUnassigned, setShowUnassigned] = useState(false);
  // The command whose new keys are being recorded.
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const recordingRef = useRef<string | null>(null);

  const cancelRecording = useCallback(() => {
    if (!recordingRef.current) return;
    recordingRef.current = null;
    setRecordingId(null);
    void window.latexdo.cancelMenuShortcutRecording?.().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setError(null);
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
      cancelRecording();
    };
  }, [open, cancelRecording]);

  useEffect(() => {
    if (!open) return;
    // Capture phase, so the editor underneath cannot swallow the key first.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (recordingRef.current) {
        cancelRecording();
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose, cancelRecording]);

  const startRecording = useCallback(async (id: string) => {
    const api = window.latexdo;
    if (!api.recordMenuShortcut || !api.setMenuShortcut) return;
    recordingRef.current = id;
    setRecordingId(id);
    setError(null);
    // A press that cannot be a shortcut (a bare letter) keeps listening.
    while (recordingRef.current === id) {
      const result = await api.recordMenuShortcut().catch(() => null);
      if (recordingRef.current !== id) return;
      if (!result || result.status === "cancelled") break;
      if (result.status === "invalid") {
        setError({ id, message: `${result.keys}: ${result.error}` });
        continue;
      }
      const change = await api
        .setMenuShortcut(id, result.accelerator)
        .catch((reason: unknown) => ({
          ok: false as const,
          error: reason instanceof Error ? reason.message : String(reason),
        }));
      if (change.ok) {
        setShortcuts(change.shortcuts);
        setError(null);
      } else {
        setError({ id, message: change.error });
      }
      break;
    }
    if (recordingRef.current === id) {
      recordingRef.current = null;
      setRecordingId(null);
    }
  }, []);

  const removeShortcut = useCallback(async (id: string) => {
    const change = await window.latexdo.setMenuShortcut?.(id, "");
    if (!change) return;
    if (change.ok) setShortcuts(change.shortcuts);
    else setError({ id, message: change.error });
  }, []);

  const resetShortcut = useCallback(async (id: string | null) => {
    const list = await window.latexdo.resetMenuShortcut?.(id);
    if (list) setShortcuts(list);
    setError(null);
  }, []);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const seen = new Set<string>();
    const byMenu = new Map<string, MenuShortcut[]>();
    for (const shortcut of shortcuts ?? []) {
      // Commands without keys show while searching or on request, and always
      // when the user removed a default key, so it can be restored.
      if (
        !shortcut.keys &&
        !needle &&
        !showUnassigned &&
        shortcut.defaultKeys === undefined
      ) {
        continue;
      }
      // The same command can sit in two menus; list it once.
      const key = shortcut.id ?? `${shortcut.label}\u0000${shortcut.keys}`;
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
  }, [query, shortcuts, showUnassigned]);

  const customized = (shortcuts ?? []).some(
    (shortcut) => shortcut.defaultKeys !== undefined,
  );
  const editable = Boolean(window.latexdo.setMenuShortcut);

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
        <div className="shortcuts-toolbar">
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
          {editable && shortcuts?.length ? (
            <div className="shortcuts-options">
              <label>
                <input
                  type="checkbox"
                  checked={showUnassigned}
                  onChange={(event) => setShowUnassigned(event.target.checked)}
                />
                Show commands without a shortcut
              </label>
              {customized ? (
                <button type="button" onClick={() => void resetShortcut(null)}>
                  <RotateCcw size={12} /> Restore all defaults
                </button>
              ) : null}
            </div>
          ) : null}
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
                  {items.map((item) => {
                    const id = item.id;
                    const recording = id !== undefined && recordingId === id;
                    const rowError =
                      id !== undefined && error?.id === id ? error : null;
                    return (
                      <li key={id ?? `${item.label}-${item.keys}`}>
                        <span className="shortcuts-label">
                          {item.label}
                          {item.editorOnly ? (
                            <small className="shortcuts-scope">in editor</small>
                          ) : null}
                          {item.defaultKeys !== undefined ? (
                            <small className="shortcuts-scope">
                              default {item.defaultKeys || "none"}
                            </small>
                          ) : null}
                          {rowError ? (
                            <small className="shortcuts-error" role="alert">
                              {rowError.message}
                            </small>
                          ) : null}
                        </span>
                        <span className="shortcuts-keys">
                          {id !== undefined && editable ? (
                            <>
                              {item.defaultKeys !== undefined && !recording ? (
                                <button
                                  type="button"
                                  className="shortcuts-icon-button"
                                  aria-label={`Restore the default shortcut for ${item.label}`}
                                  title="Restore default"
                                  onClick={() => void resetShortcut(id)}
                                >
                                  <RotateCcw size={12} />
                                </button>
                              ) : null}
                              {item.keys && !recording ? (
                                <button
                                  type="button"
                                  className="shortcuts-icon-button"
                                  aria-label={`Remove the shortcut for ${item.label}`}
                                  title="Remove shortcut"
                                  onClick={() => void removeShortcut(id)}
                                >
                                  <X size={12} />
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className={`shortcuts-key-button ${recording ? "recording" : ""}`}
                                aria-label={
                                  recording
                                    ? `Press the new shortcut for ${item.label}`
                                    : `Change the shortcut for ${item.label}`
                                }
                                title={
                                  recording
                                    ? "Press keys, Esc to cancel"
                                    : "Change shortcut"
                                }
                                onClick={() =>
                                  recording
                                    ? cancelRecording()
                                    : void startRecording(id)
                                }
                              >
                                {recording ? (
                                  <span className="shortcuts-recording">
                                    Press keys…
                                  </span>
                                ) : item.keys ? (
                                  <kbd>{item.keys}</kbd>
                                ) : (
                                  <span className="shortcuts-unset">Add</span>
                                )}
                              </button>
                            </>
                          ) : (
                            <kbd>{item.keys}</kbd>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
