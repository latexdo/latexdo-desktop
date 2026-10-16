import { useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

export interface WorkspaceTab {
  id: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  dirty?: boolean;
  onSelect: () => void;
  onClose: () => void;
}

/** One tab strip for documents and workspace tools. Order is independent of content. */
export function WorkspaceTabs({ tabs }: { tabs: WorkspaceTab[] }) {
  const [order, setOrder] = useState<string[]>([]);
  const dragged = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const ids = [
    ...order.filter((id) => tabs.some((tab) => tab.id === id)),
    ...tabs.map((tab) => tab.id).filter((id) => !order.includes(id)),
  ];
  const move = (id: string, target: string) => {
    if (id === target || !ids.includes(id) || !ids.includes(target)) return;
    const next = ids.filter((item) => item !== id);
    next.splice(ids.indexOf(target), 0, id);
    setOrder(next);
  };
  return (
    <div className="document-tabs" role="tablist" aria-label="Workspace tabs">
      {ids.map((id, index) => {
        const tab = tabs.find((item) => item.id === id)!;
        return (
          <div
            key={id}
            className={`workspace-tab-shell ${dropTarget === id ? "drop-target" : ""}`}
            draggable
            onDragStart={(event) => {
              dragged.current = id;
              event.dataTransfer.setData("application/x-latexdo-tab", id);
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => {
              if (!dragged.current) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDropTarget(id);
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (dragged.current) move(dragged.current, id);
              dragged.current = null;
              setDropTarget(null);
            }}
            onDragEnd={() => {
              dragged.current = null;
              setDropTarget(null);
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab.active}
              className={`document-tab ${tab.active ? "active" : ""}`}
              onClick={tab.onSelect}
              title={`${tab.label} — drag to reorder; Alt+Shift+Arrow to move`}
              onKeyDown={(event) => {
                const direction =
                  event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
                if (direction && event.altKey && event.shiftKey) {
                  event.preventDefault();
                  move(id, ids[index + direction] ?? id);
                } else if (direction) {
                  event.preventDefault();
                  const next = tabs.find(
                    (item) =>
                      item.id === ids[(index + direction + ids.length) % ids.length],
                  );
                  next?.onSelect();
                  const buttons = event.currentTarget
                    .closest('[role="tablist"]')
                    ?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                  buttons?.[(index + direction + ids.length) % ids.length]?.focus();
                }
              }}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
            <button
              type="button"
              className={`workspace-tab-close tab-close ${tab.dirty ? "dirty" : ""}`}
              aria-label={`Close ${tab.label}`}
              title={tab.dirty ? `Close ${tab.label} (unsaved)` : `Close ${tab.label}`}
              onClick={tab.onClose}
            >
              {tab.dirty && <span className="dirty-dot" />}
              <X className="tab-close-icon" size={13} />
            </button>
          </div>
        );
      })}
      <div className="tabs-fill" />
    </div>
  );
}
