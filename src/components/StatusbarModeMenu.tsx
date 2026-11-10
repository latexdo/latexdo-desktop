/*
 * The editor mode in the status bar: shows the current mode and, when
 * clicked, lets you switch it. It changes the same mode as the MODE buttons
 * in the editor toolbar, so both always agree.
 */

import React from "react";
import {
  Check,
  ChevronUp,
  History,
  MessageSquare,
  User,
  type LucideIcon,
} from "lucide-react";
import type { EditorMode } from "../types";

export const editorModes: {
  id: EditorMode;
  label: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    id: "author",
    label: "Author",
    description: "Write and edit the paper",
    icon: User,
  },
  {
    id: "reviewer",
    label: "Reviewer",
    description: "Comment on a paper you are reviewing",
    icon: MessageSquare,
  },
  {
    id: "rebuttal",
    label: "Rebuttal",
    description: "Answer the reviewers' comments",
    icon: History,
  },
];

/** Space kept between the menu and the window's edge. */
const edgeGap = 8;

export function StatusbarModeMenu({
  mode,
  onSelect,
}: {
  mode: EditorMode;
  onSelect: (mode: EditorMode) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState<{ left: number; bottom: number }>({
    left: edgeGap,
    bottom: 28,
  });
  const rootRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const current = editorModes.find((item) => item.id === mode) ?? editorModes[0]!;

  // The status bar clips what overflows it, so the menu is placed on the
  // window, just above the button and never past the right edge.
  React.useLayoutEffect(() => {
    if (!open) return;
    const button = buttonRef.current?.getBoundingClientRect();
    const width = menuRef.current?.offsetWidth || 260;
    if (!button) return;
    setPosition({
      left: Math.max(
        edgeGap,
        Math.min(button.left, window.innerWidth - width - edgeGap),
      ),
      bottom: window.innerHeight - button.top + 6,
    });
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const close = () => setOpen(false);
    window.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutside);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [open]);

  const choose = (next: EditorMode) => {
    setOpen(false);
    buttonRef.current?.focus();
    if (next !== mode) onSelect(next);
  };

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ??
        [],
    );
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (event.key === "ArrowDown") next = (index + 1) % items.length;
    else if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next < 0) return;
    event.preventDefault();
    items[next]?.focus();
  };

  return (
    <div className="statusbar-mode-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`statusbar-item statusbar-mode-button ${open ? "active" : ""}`}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        title="Change mode"
        aria-label={`${current.label} mode — change mode`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {current.label} mode
        <ChevronUp size={11} aria-hidden="true" className="statusbar-mode-chevron" />
      </button>
      {open ? (
        <div
          ref={menuRef}
          className="layout-menu-popup statusbar-mode-popup"
          role="menu"
          aria-label="Mode"
          style={{ left: position.left, bottom: position.bottom }}
          onKeyDown={onMenuKeyDown}
        >
          <div className="layout-menu-heading">Mode</div>
          {editorModes.map(({ id, label, description, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="menuitemradio"
              aria-checked={mode === id}
              className={mode === id ? "checked" : undefined}
              onClick={() => choose(id)}
            >
              <Icon size={15} aria-hidden="true" />
              <span className="layout-menu-label statusbar-mode-text">
                <span>{label}</span>
                <small>{description}</small>
              </span>
              {mode === id ? <Check size={15} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
