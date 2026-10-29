// App-wide notification log (#260). Every status message and uncaught renderer
// error is recorded here so the user can see what happened, and errors and
// warnings also surface as toasts. Kept in memory for the session only.

import { useSyncExternalStore } from "react";

export type NotificationSeverity = "error" | "warning" | "info";

export interface AppNotification {
  id: number;
  severity: NotificationSeverity;
  message: string;
  source: string;
  at: number;
  read: boolean;
}

const maxNotifications = 200;
/** The same message repeated this quickly is one event, not several. */
const duplicateWindowMs = 2_000;

let notifications: readonly AppNotification[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

const noProblems = /\b(no|0|zero) (errors?|problems?|warnings?)\b/i;
const errorPattern =
  /\b(fail(ed|s|ure)?|errors?|could ?n[o’']t|cannot|can[’']t|unable|denied|refused|crash(ed)?|timed out|invalid|corrupt(ed)?)\b/i;
const warningPattern =
  /\b(warnings?|not (configured|supported|available|found|installed|ready)|unavailable|offline|missing|skipped)\b/i;

/** Best-effort severity for a free-text status message. */
export function classifyMessage(message: string): NotificationSeverity {
  if (noProblems.test(message)) return "info";
  if (errorPattern.test(message)) return "error";
  if (warningPattern.test(message)) return "warning";
  return "info";
}

export function notify(
  message: string,
  options: { severity?: NotificationSeverity; source?: string; now?: number } = {},
): AppNotification | null {
  const text = message.trim();
  if (!text) return null;
  const at = options.now ?? Date.now();
  const latest = notifications[0];
  if (latest && latest.message === text && at - latest.at < duplicateWindowMs) {
    return null;
  }
  const entry: AppNotification = {
    id: nextId++,
    severity: options.severity ?? classifyMessage(text),
    message: text,
    source: options.source ?? "LatexDo",
    at,
    read: false,
  };
  notifications = [entry, ...notifications].slice(0, maxNotifications);
  emit();
  return entry;
}

export function getNotifications(): readonly AppNotification[] {
  return notifications;
}

export function markAllNotificationsRead(): void {
  if (notifications.every((entry) => entry.read)) return;
  notifications = notifications.map((entry) =>
    entry.read ? entry : { ...entry, read: true },
  );
  emit();
}

export function deleteNotification(id: number): void {
  const remaining = notifications.filter((entry) => entry.id !== id);
  if (remaining.length === notifications.length) return;
  notifications = remaining;
  emit();
}

export function clearNotifications(): void {
  if (!notifications.length) return;
  notifications = [];
  emit();
}

export function subscribeNotifications(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useNotifications(): readonly AppNotification[] {
  return useSyncExternalStore(
    subscribeNotifications,
    getNotifications,
    getNotifications,
  );
}
