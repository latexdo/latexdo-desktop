/*
 * A quick pick in the style of Visual Studio Code's quick input: a box at the
 * top of the window with a filter field and a list, or a single input with a
 * prompt. Used by Source Control for branches, names and questions.
 *
 * Interaction model from Visual Studio Code (MIT License,
 * Copyright (c) Microsoft Corporation).
 */

import React from "react";

export interface QuickPickItemButton {
  id: string;
  /** Accessible name and tooltip. */
  label: string;
  icon: React.ReactNode;
}

export interface QuickPickItem {
  id: string;
  label: string;
  description?: string;
  detail?: string;
  icon?: React.ReactNode;
  /** A labelled line between items; not selectable. */
  separator?: boolean;
  /** Inline actions shown on the row, like Visual Studio Code's item buttons. */
  buttons?: QuickPickItemButton[];
}

export interface QuickPickRequest {
  title?: string;
  placeholder: string;
  /** Without items the quick pick asks for text. */
  items?: QuickPickItem[];
  value?: string;
  /** For text input: a message while the value is not acceptable. */
  validate?: (value: string) => string | null;
  /** Right-clicking an item presses its inline button with this id. */
  contextButton?: string;
  /** `button` is set when one of the item's inline buttons was pressed. */
  onAccept: (item: QuickPickItem | null, value: string, button?: string) => void;
  onCancel: () => void;
}

function matches(item: QuickPickItem, filter: string): boolean {
  if (!filter) return true;
  const needle = filter.toLowerCase();
  return `${item.label} ${item.description ?? ""}`.toLowerCase().includes(needle);
}

export function QuickPick({ request }: { request: QuickPickRequest }) {
  const [value, setValue] = React.useState(request.value ?? "");
  const [highlight, setHighlight] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const isInput = !request.items;

  React.useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [request]);

  const visible = React.useMemo(() => {
    if (!request.items) return [];
    const shown = request.items.filter(
      (item) => item.separator || matches(item, value),
    );
    // Drop separators with nothing under them.
    return shown.filter(
      (item, index) =>
        !item.separator || (shown[index + 1] && !shown[index + 1].separator),
    );
  }, [request.items, value]);
  const selectable = visible.filter((item) => !item.separator);
  const current = selectable[Math.min(highlight, selectable.length - 1)];
  const validation = isInput && request.validate ? request.validate(value) : null;

  React.useEffect(() => setHighlight(0), [value]);
  React.useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [highlight]);

  const accept = (item: QuickPickItem | null) => {
    if (isInput) {
      if (validation) return;
      request.onAccept(null, value);
    } else if (item) {
      request.onAccept(item, value);
    }
  };

  return (
    <div className="quick-pick-backdrop" onMouseDown={request.onCancel}>
      <div
        className="quick-pick"
        role="dialog"
        aria-label={request.title ?? request.placeholder}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {request.title ? <div className="quick-pick-title">{request.title}</div> : null}
        <input
          ref={inputRef}
          className={`quick-pick-input ${validation ? "invalid" : ""}`}
          value={value}
          placeholder={request.placeholder}
          aria-label={request.placeholder}
          role={isInput ? undefined : "combobox"}
          aria-expanded={isInput ? undefined : true}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              request.onCancel();
            } else if (event.key === "Enter") {
              event.preventDefault();
              accept(current ?? null);
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              setHighlight((index) =>
                selectable.length
                  ? (index + step + selectable.length) % selectable.length
                  : 0,
              );
            }
          }}
        />
        {isInput ? (
          <div className={`quick-pick-message ${validation ? "invalid" : ""}`}>
            {validation ?? "Press 'Enter' to confirm your input or 'Escape' to cancel"}
          </div>
        ) : (
          <div className="quick-pick-list" role="listbox" ref={listRef}>
            {visible.map((item) =>
              item.separator ? (
                <div key={item.id} className="quick-pick-separator">
                  {item.label}
                </div>
              ) : (
                <div
                  key={item.id}
                  role="option"
                  aria-selected={item === current}
                  className={`quick-pick-item ${item === current ? "selected" : ""}`}
                  onMouseEnter={() => setHighlight(selectable.indexOf(item))}
                  onClick={() => accept(item)}
                  onContextMenu={(event) => {
                    const button = request.contextButton;
                    if (!button || !item.buttons?.some((b) => b.id === button)) return;
                    event.preventDefault();
                    request.onAccept(item, value, button);
                  }}
                >
                  {item.icon ? (
                    <span className="quick-pick-icon">{item.icon}</span>
                  ) : null}
                  <span className="quick-pick-label">{item.label}</span>
                  {item.description ? (
                    <span className="quick-pick-description">{item.description}</span>
                  ) : null}
                  {item.detail ? (
                    <span className="quick-pick-detail">{item.detail}</span>
                  ) : null}
                  {item.buttons?.length ? (
                    <span className="quick-pick-buttons">
                      {item.buttons.map((button) => (
                        <button
                          key={button.id}
                          type="button"
                          className="quick-pick-button"
                          aria-label={`${button.label} ${item.label}`}
                          title={button.label}
                          onClick={(event) => {
                            event.stopPropagation();
                            request.onAccept(item, value, button.id);
                          }}
                        >
                          {button.icon}
                        </button>
                      ))}
                    </span>
                  ) : null}
                </div>
              ),
            )}
            {!selectable.length ? (
              <div className="quick-pick-empty">No matching results</div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
