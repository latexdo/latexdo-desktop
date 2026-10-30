/*
 * Notification center (#260): a status-bar bell with an unread count, a panel
 * listing everything LatexDo reported this session, and short-lived toasts
 * for errors and warnings. Uncaught renderer errors are recorded too.
 */

import React from "react";
import { AlertTriangle, Bell, CircleAlert, Info, Trash2, X } from "lucide-react";
import {
  clearNotifications,
  deleteNotification,
  markAllNotificationsRead,
  notify,
  useNotifications,
  type AppNotification,
  type NotificationSeverity,
} from "../features/notifications/notifications";

const toastLifetimeMs = 8_000;
const maxToasts = 3;

const severityLabel: Record<NotificationSeverity, string> = {
  error: "Error",
  warning: "Warning",
  info: "Info",
};

function SeverityIcon({ severity }: { severity: NotificationSeverity }) {
  if (severity === "error") return <CircleAlert size={14} aria-hidden="true" />;
  if (severity === "warning") return <AlertTriangle size={14} aria-hidden="true" />;
  return <Info size={14} aria-hidden="true" />;
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function errorText(value: unknown): string {
  if (value instanceof Error) return value.message || value.name;
  if (typeof value === "string") return value;
  return "An unexpected error occurred.";
}

export function NotificationCenter() {
  const notifications = useNotifications();
  const [open, setOpen] = React.useState(false);
  const [toastIds, setToastIds] = React.useState<number[]>([]);
  const seen = React.useRef(new Set<number>());
  const timers = React.useRef<number[]>([]);

  // Uncaught problems in the window are part of "what went wrong".
  React.useEffect(() => {
    const onError = (event: ErrorEvent) =>
      notify(errorText(event.error ?? event.message), {
        severity: "error",
        source: "System",
      });
    const onRejection = (event: PromiseRejectionEvent) =>
      notify(errorText(event.reason), { severity: "error", source: "System" });
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  // New errors and warnings pop up as toasts.
  React.useEffect(() => {
    const fresh = notifications.filter(
      (entry) => !seen.current.has(entry.id) && entry.severity !== "info",
    );
    for (const entry of notifications) seen.current.add(entry.id);
    if (!fresh.length || open) return;
    setToastIds((current) =>
      [...fresh.map((entry) => entry.id), ...current].slice(0, maxToasts),
    );
    for (const entry of fresh) {
      timers.current.push(
        window.setTimeout(
          () => setToastIds((current) => current.filter((id) => id !== entry.id)),
          toastLifetimeMs,
        ),
      );
    }
  }, [notifications, open]);

  React.useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer);
    },
    [],
  );

  React.useEffect(() => {
    if (!open) return;
    markAllNotificationsRead();
    setToastIds([]);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, notifications]);

  const unread = notifications.filter(
    (entry) => !entry.read && entry.severity !== "info",
  ).length;
  const toasts = toastIds
    .map((id) => notifications.find((entry) => entry.id === id))
    .filter((entry): entry is AppNotification => Boolean(entry));

  return (
    <>
      <button
        type="button"
        className={`statusbar-item notification-bell ${unread ? "has-unread" : ""}`}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        title="Notifications"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={12} aria-hidden="true" />
        {unread ? <span className="notification-count">{unread}</span> : null}
      </button>

      {open ? (
        <section
          className="notification-center"
          role="dialog"
          aria-label="Notifications"
        >
          <header className="notification-center-header">
            <span>Notifications</span>
            <button
              type="button"
              className="small-icon"
              title="Clear all notifications"
              aria-label="Clear all notifications"
              onClick={clearNotifications}
              disabled={!notifications.length}
            >
              <Trash2 size={13} />
            </button>
            <button
              type="button"
              className="small-icon"
              title="Close"
              aria-label="Close notifications"
              onClick={() => setOpen(false)}
            >
              <X size={14} />
            </button>
          </header>
          {notifications.length ? (
            <ul className="notification-list">
              {notifications.map((entry) => (
                <li key={entry.id} className={`notification-item ${entry.severity}`}>
                  <SeverityIcon severity={entry.severity} />
                  <div className="notification-body">
                    <p>{entry.message}</p>
                    <span>
                      {severityLabel[entry.severity]} · {entry.source} ·{" "}
                      {formatTime(entry.at)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="small-icon notification-delete"
                    title="Delete notification"
                    aria-label={`Delete notification: ${entry.message}`}
                    onClick={() => deleteNotification(entry.id)}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="notification-empty">No notifications yet.</p>
          )}
        </section>
      ) : null}

      {!open && toasts.length ? (
        <div className="notification-toasts" aria-live="polite">
          {toasts.map((entry) => (
            <div
              key={entry.id}
              className={`notification-toast ${entry.severity}`}
              role={entry.severity === "error" ? "alert" : undefined}
            >
              <SeverityIcon severity={entry.severity} />
              <button
                type="button"
                className="notification-toast-message"
                onClick={() => setOpen(true)}
                title="Show all notifications"
              >
                {entry.message}
              </button>
              <button
                type="button"
                className="small-icon notification-delete"
                title="Delete notification"
                aria-label={`Delete notification: ${entry.message}`}
                onClick={() => deleteNotification(entry.id)}
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
