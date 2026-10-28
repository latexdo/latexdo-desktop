import React from "react";
import {
  Check,
  Columns2,
  FileText,
  Maximize,
  PanelBottom,
  PanelLeft,
  Pencil,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import type { ViewLayoutMode } from "../app/useAppViewLayout";

const isMac =
  typeof navigator !== "undefined" &&
  /mac/i.test(`${navigator.platform} ${navigator.userAgent}`);

/** Keep in step with the View > Layout accelerators in electron/main.ts. */
const shortcut = (key: string) => (isMac ? `⌃⌘${key}` : `Ctrl+Alt+Shift+${key}`);

const modes: { id: ViewLayoutMode; label: string; icon: LucideIcon; keys: string }[] = [
  { id: "split", label: "Split view", icon: Columns2, keys: shortcut("↓") },
  { id: "editor", label: "Editor only", icon: Pencil, keys: shortcut("←") },
  { id: "pdf", label: "PDF only", icon: FileText, keys: shortcut("→") },
];

interface LayoutMenuProps {
  mode: ViewLayoutMode;
  focusMode: boolean;
  sidebarVisible: boolean;
  panelVisible: boolean;
  onSelectMode: (mode: ViewLayoutMode) => void;
  onToggleFocusMode: () => void;
  onToggleSidebar: () => void;
  onTogglePanel: () => void;
  onResetSizes: () => void;
}

export const LayoutMenu: React.FC<LayoutMenuProps> = ({
  mode,
  focusMode,
  sidebarVisible,
  panelVisible,
  onSelectMode,
  onToggleFocusMode,
  onToggleSidebar,
  onTogglePanel,
  onResetSizes,
}) => {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    menuRef.current
      ?.querySelector<HTMLButtonElement>('[aria-checked="true"], [role^="menuitem"]')
      ?.focus();
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutside);
    return () => window.removeEventListener("pointerdown", closeOnOutside);
  }, [open]);

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? [],
    );
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(index + step + items.length) % items.length]?.focus();
  };

  const toggleItem = (
    label: string,
    Icon: LucideIcon,
    checked: boolean,
    onToggle: () => void,
    keys?: string,
  ) => (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      className={checked ? "checked" : undefined}
      onClick={() => run(onToggle)}
    >
      <Icon size={15} aria-hidden="true" />
      <span className="layout-menu-label">{label}</span>
      {keys ? <kbd>{keys}</kbd> : null}
    </button>
  );

  return (
    <div className="layout-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`title-history-button ${open ? "active" : ""}`}
        onClick={() => setOpen((value) => !value)}
        title="Layout options"
        aria-label="Layout options"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Columns2 size={15} aria-hidden="true" />
        <span>Layout</span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          className="layout-menu-popup"
          role="menu"
          aria-label="Layout options"
          onKeyDown={handleMenuKeyDown}
        >
          <div className="layout-menu-heading">Layout options</div>
          {modes.map(({ id, label, icon: Icon, keys }) => (
            <button
              key={id}
              type="button"
              role="menuitemradio"
              aria-checked={mode === id}
              className={mode === id ? "checked" : undefined}
              onClick={() => run(() => onSelectMode(id))}
            >
              {mode === id ? (
                <Check size={15} aria-hidden="true" />
              ) : (
                <Icon size={15} aria-hidden="true" />
              )}
              <span className="layout-menu-label">{label}</span>
              <kbd>{keys}</kbd>
            </button>
          ))}
          <hr />
          {toggleItem("Focus mode", Maximize, focusMode, onToggleFocusMode, shortcut("↑"))}
          {toggleItem("Sidebar", PanelLeft, sidebarVisible, onToggleSidebar, isMac ? "⌘B" : "Ctrl+B")}
          {toggleItem("Bottom panel", PanelBottom, panelVisible, onTogglePanel, isMac ? "⌘J" : "Ctrl+J")}
          <hr />
          <button type="button" role="menuitem" onClick={() => run(onResetSizes)}>
            <RotateCcw size={15} aria-hidden="true" />
            <span className="layout-menu-label">Reset pane sizes</span>
          </button>
          <p className="layout-menu-hint">
            Drag the edge between two panes to resize them. Double-click it to reset.
          </p>
        </div>
      ) : null}
    </div>
  );
};
