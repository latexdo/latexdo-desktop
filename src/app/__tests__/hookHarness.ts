/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from "vitest";

/** Stateful setter doubles let hook tests inspect the result of functional updates. */
export function hookContext(
  values: Record<string, any>,
  setters: string[],
  callbacks: string[] = [],
) {
  const ctx: Record<string, any> = { ...values };
  const state: Record<string, any> = {};
  for (const name of setters) {
    const key = name[3].toLowerCase() + name.slice(4);
    state[key] = values[key];
    ctx[name] = vi.fn((update: any) => {
      state[key] = typeof update === "function" ? update(state[key]) : update;
    });
  }
  for (const name of callbacks) ctx[name] = vi.fn();
  return { ctx, state };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
