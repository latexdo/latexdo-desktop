import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { clearNotifications, notify } from "../features/notifications/notifications";
import { NotificationCenter } from "./NotificationCenter";

beforeEach(() => clearNotifications());

describe("NotificationCenter", () => {
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
