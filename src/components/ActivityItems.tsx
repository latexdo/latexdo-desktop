import { Children, isValidElement, useState, type ReactNode } from "react";

const storageKey = "latexdo.activity-order.v1";

export function ActivityItems({ children }: { children: ReactNode }) {
  const [order, setOrder] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      return Array.isArray(saved)
        ? saved.filter((id): id is string => typeof id === "string")
        : [];
    } catch {
      return [];
    }
  });
  const [dragged, setDragged] = useState<string | null>(null);
  const items = Children.toArray(children).filter(isValidElement<{ title: string }>);
  const ids = [...new Set([...order, ...items.map((item) => item.props.title)])];
  const sorted = [...items].sort(
    (a, b) => ids.indexOf(a.props.title) - ids.indexOf(b.props.title),
  );
  const move = (from: string, to: string) => {
    if (from === to) return;
    const next = ids.filter((id) => id !== from);
    next.splice(ids.indexOf(to), 0, from);
    setOrder(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* Session order still works. */
    }
  };
  return (
    <div className="activity-items">
      {sorted.map((item, index) => (
        <div
          key={item.props.title}
          draggable
          className={dragged === item.props.title ? "activity-dragging" : ""}
          onDragStart={(event) => {
            setDragged(item.props.title);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", item.props.title);
          }}
          onDragEnd={() => setDragged(null)}
          onDragOver={(event) => {
            if (dragged) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (dragged) move(dragged, item.props.title);
            setDragged(null);
          }}
          onKeyDown={(event) => {
            if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
            const target = sorted[index + (event.key === "ArrowUp" ? -1 : 1)];
            if (!target) return;
            event.preventDefault();
            // Moving down means inserting the next item before the focused item.
            if (event.key === "ArrowDown") move(target.props.title, item.props.title);
            else move(item.props.title, target.props.title);
          }}
          title={`${item.props.title} — drag to reorder, or use Alt+Up/Down`}
        >
          {item}
        </div>
      ))}
    </div>
  );
}
