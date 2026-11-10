import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearNotifications,
  getNotifications,
  notify,
} from "../features/notifications/notifications";
import { NotificationCenter } from "./NotificationCenter";

beforeEach(() => {
  clearNotifications();
  localStorage.removeItem("latexdo.notificationMode");
});

describe("NotificationCenter", () => {
  it.each([
    ["do-not-disturb", false, false, false],
    ["writing", true, false, true],
    ["reviewing", true, true, true],
    ["reading", false, false, true],
  ] as const)(
    "applies %s mode and retains history",
    (mode, errorToast, warningToast, badge) => {
      render(<NotificationCenter />);
      fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
      fireEvent.change(screen.getByLabelText("Mode"), { target: { value: mode } });
      fireEvent.click(screen.getByRole("button", { name: "Close notifications" }));
      act(() => {
        notify("Compile failed", { severity: "error" });
        notify("Missing citation", { severity: "warning" });
      });
      expect(Boolean(screen.queryByText("Compile failed"))).toBe(errorToast);
      expect(Boolean(screen.queryByText("Missing citation"))).toBe(warningToast);
      expect(
        screen.getByRole("button", {
          name: badge ? "Notifications, 2 unread" : "Notifications",
        }),
      ).toBeVisible();
      expect(getNotifications()).toHaveLength(2);
      expect(localStorage.getItem("latexdo.notificationMode")).toBe(mode);
      fireEvent.click(screen.getByRole("button", { name: /^Notifications/ }));
      expect(screen.getByText("Compile failed")).toBeVisible();
      expect(screen.getByText("Missing citation")).toBeVisible();
    },
  );

  it("restores the mode without replaying suppressed notifications when changed", () => {
    localStorage.setItem("latexdo.notificationMode", "do-not-disturb");
    const view = render(<NotificationCenter />);
    act(() => {
      notify("Compile failed");
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByLabelText("Mode")).toHaveValue("do-not-disturb");
    fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "writing" } });
    fireEvent.click(screen.getByRole("button", { name: "Close notifications" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    act(() => {
      notify("New error");
    });
    expect(screen.getByRole("alert")).toHaveTextContent("New error");
    view.unmount();
    render(<NotificationCenter />);
    fireEvent.click(screen.getByRole("button", { name: /^Notifications/ }));
    expect(screen.getByLabelText("Mode")).toHaveValue("writing");
  });

  it("toasts errors, counts them on the bell and lists everything", () => {
    render(<NotificationCenter />);
    act(() => {
      notify("Saved main.tex");
      notify("Compile failed: missing \\end{document}");
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Compile failed");
    const bell = screen.getByRole("button", { name: "Notifications, 1 unread" });

    fireEvent.click(bell);
    const panel = screen.getByRole("dialog", { name: "Notifications" });
    expect(within(panel).getByText("Saved main.tex")).toBeVisible();
    expect(within(panel).getByText(/Compile failed/)).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notifications" })).toBeVisible();

    fireEvent.click(
      within(panel).getByRole("button", { name: "Clear all notifications" }),
    );
    expect(within(panel).getByText("No notifications yet.")).toBeVisible();
  });

  it("deletes only the selected notification and shows the empty state after the last", () => {
    render(<NotificationCenter />);
    act(() => {
      notify("First message");
      notify("Second message");
    });
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Delete notification: First message" }),
    );
    expect(screen.queryByText("First message")).not.toBeInTheDocument();
    expect(screen.getByText("Second message")).toBeVisible();
    expect(getNotifications().map((entry) => entry.message)).toEqual([
      "Second message",
    ]);
    fireEvent.click(
      screen.getByRole("button", { name: "Delete notification: Second message" }),
    );
    expect(screen.getByText("No notifications yet.")).toBeVisible();
  });

  it("deletes a toast from the log and updates the unread count", () => {
    render(<NotificationCenter />);
    act(() => {
      notify("Compile failed");
      notify("Missing bibliography");
    });
    expect(
      screen.getByRole("button", { name: "Notifications, 2 unread" }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Delete notification: Compile failed" }),
    );
    expect(screen.queryByText("Compile failed")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Notifications, 1 unread" }));
    expect(screen.getByText("Missing bibliography")).toBeVisible();
    expect(screen.queryByText("Compile failed")).not.toBeInTheDocument();
  });

  it("records uncaught errors as system notifications", () => {
    render(<NotificationCenter />);
    act(() => {
      window.dispatchEvent(
        new ErrorEvent("error", { error: new Error("Renderer exploded") }),
      );
    });
    fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    expect(screen.getByText("Renderer exploded")).toBeVisible();
    expect(screen.getByText(/Error · System/)).toBeVisible();
  });
});
