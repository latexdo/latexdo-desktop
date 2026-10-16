import type { EditOrigin } from "../features/editor/nextEdit/nextEditTypes";

export class EditorMutationOrigin {
  private readonly stack: EditOrigin[] = [];

  run<T>(origin: EditOrigin, fn: () => T): T {
    const release = this.enter(origin);
    try {
      return fn();
    } finally {
      release();
    }
  }

  enter(origin: EditOrigin): () => void {
    this.stack.push(origin);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = this.stack.pop();
      if (current !== origin) {
        this.stack.length = 0;
      }
    };
  }

  current(): EditOrigin | null {
    return this.stack[this.stack.length - 1] ?? null;
  }
}
