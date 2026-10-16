import type { VoiceErrorCode } from "../../voice/types";

export type ProductEvent =
  | { type: "editor:selection-created" }
  | { type: "ai:reformulation-applied" }
  | { type: "ai:selection-attached" }
  | { type: "ai:file-context-attached"; path: string }
  | { type: "ai:command-selected"; command: string }
  | { type: "citation:inserted"; key?: string }
  | { type: "compile:succeeded" }
  | { type: "compile:failed" }
  | { type: "synctex:navigated" }
  | { type: "format:applied" }
  | { type: "problems:opened" }
  | { type: "voice:started" }
  | { type: "voice:completed" }
  | { type: "voice:cancelled" }
  | { type: "voice:failed"; code: VoiceErrorCode }
  | { type: "voice:inserted" };

type ProductEventListener = (event: ProductEvent) => void;

const listeners = new Set<ProductEventListener>();

export function emitProductEvent(event: ProductEvent): void {
  for (const listener of listeners) {
    listener(event);
  }
}

export function subscribeProductEvents(listener: ProductEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
