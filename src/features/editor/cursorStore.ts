import { useSyncExternalStore } from "react";

export interface CursorPosition {
  line: number;
  column: number;
}

// Kept outside React state: the cursor moves on every keystroke, and only the
// status bar item needs to re-render for it.
let position: CursorPosition = { line: 1, column: 1 };
const listeners = new Set<() => void>();

export function setCursorPosition(line: number, column: number): void {
  if (position.line === line && position.column === column) return;
  position = { line, column };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCursorPosition(): CursorPosition {
  return useSyncExternalStore(subscribe, () => position);
}
