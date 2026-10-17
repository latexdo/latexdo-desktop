import React from "react";
import { Check, ChevronDown, Settings2 } from "lucide-react";
import type { ChatModelOption } from "../features/ai/chatModelOptions";

interface ModelPickerProps {
  label: string;
  options: readonly ChatModelOption[];
  onSelect: (id: string) => void;
  onManage: () => void;
  /** Opens above the button (the composer) or below it (the header). */
  placement?: "up" | "down";
  className?: string;
  disabled?: boolean;
}

const menuWidth = 280;

/** The chat's model menu: every model the person can switch to, by group. */
export const ModelPicker: React.FC<ModelPickerProps> = ({
  label,
  options,
  onSelect,
  onManage,
  placement = "down",
  className = "",
  disabled = false,
}) => {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  // The menu floats above the page so the chat panel's edges never cut it;
  // it is kept inside the window.
  const [position, setPosition] = React.useState<React.CSSProperties>({});

  React.useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const width = Math.min(menuWidth, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    setPosition(
      placement === "up"
        ? { left, width, bottom: window.innerHeight - rect.top + 8 }
        : { left, width, top: rect.bottom + 6 },
    );
  }, [open, placement]);

  React.useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const groups = options.reduce<{ name: string; items: ChatModelOption[] }[]>(
    (all, option) => {
      const group = all.find((entry) => entry.name === option.group);
      if (group) group.items.push(option);
      else all.push({ name: option.group, items: [option] });
      return all;
    },
    [],
  );

  return (
    <div className={`model-picker ${placement} ${className}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="model-picker-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Model: ${label}. Change model`}
        disabled={disabled}
      >
        <span className="model-picker-label">{label}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open ? (
        <div
          className="model-picker-menu"
          role="menu"
          aria-label="Choose a model"
          style={position}
        >
          {groups.map((group) => (
            <div
              key={group.name}
              className="model-picker-group"
              role="group"
              aria-label={group.name}
            >
              <div className="model-picker-group-title">{group.name}</div>
              {group.items.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={option.active}
                  className={`model-picker-item ${option.active ? "active" : ""}`}
                  disabled={!option.available}
                  title={option.reason}
                  onClick={() => {
                    onSelect(option.id);
                    setOpen(false);
                  }}
                >
                  <span className="model-picker-item-text">
                    <span>{option.label}</span>
                    {option.reason ? <small>{option.reason}</small> : null}
                  </span>
                  {option.active ? <Check size={14} aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          ))}
          {groups.length === 0 ? (
            <p className="model-picker-empty">No model is set up yet.</p>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="model-picker-manage"
            onClick={() => {
              setOpen(false);
              onManage();
            }}
          >
            <Settings2 size={14} aria-hidden="true" />
            Manage models…
          </button>
        </div>
      ) : null}
    </div>
  );
};
