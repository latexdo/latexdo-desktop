import type React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollaboratorPermission } from "../types";
import { PermissionManagement } from "./PermissionManagement";

const people: CollaboratorPermission[] = [
  { clientId: "me", name: "ada", role: "admin", isCurrent: true },
  { clientId: "c1", name: "grace", role: "editor" },
  { clientId: "c2", name: "linus", role: "viewer" },
];

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(overrides: Partial<React.ComponentProps<typeof PermissionManagement>> = {}) {
  const props = {
    permissions: people,
    isAdmin: true,
    currentUserRole: "admin" as const,
    onUpdatePermission: vi.fn(async () => {}),
    onRemoveCollaborator: vi.fn(async () => {}),
    onRefresh: vi.fn(async () => {}),
    ...overrides,
  };
  render(<PermissionManagement {...props} />);
  return props;
}

function row(name: string) {
  return screen.getByText(name).closest("tr")!;
}

afterEach(() => vi.restoreAllMocks());

describe("PermissionManagement", () => {
  it("only tells non-admins their own role", () => {
    setup({ isAdmin: false, currentUserRole: "viewer" });
    expect(screen.getByText(/You are a Viewer on this project/)).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows an empty state", () => {
    setup({ permissions: [] });
    expect(screen.getByText(/No collaborators yet/)).toBeVisible();
  });

  it("lists people with their presence and lets the admin manage others only", () => {
    setup({
      presence: [
        { clientId: "c1", name: "grace", currentFile: "chapters/intro.tex", lastSeen: 1 },
        { clientId: "c2", name: "linus", currentFile: null, lastSeen: 1 },
      ],
    });
    const me = row("ada");
    expect(within(me).getByText("(you)")).toBeVisible();
    expect(within(me).getByText("Admin")).toBeVisible();
    expect(within(me).queryByRole("combobox")).toBeNull();
    expect(within(me).queryByTitle("Remove collaborator")).toBeNull();

    const grace = row("grace");
    expect(within(grace).getByTitle("chapters/intro.tex").textContent).toBe("intro.tex");
    expect(within(grace).getByRole("combobox")).toHaveValue("editor");
    expect(within(grace).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Admin",
      "Editor",
      "Viewer",
    ]);
    expect(within(row("linus")).getByText("Online")).toBeVisible();
    expect(screen.getByText("G")).toBeInTheDocument();
  });

  it("changes a role, disabling the picker while saving, then refreshes", async () => {
    const pending = deferred();
    const props = setup({ onUpdatePermission: vi.fn(() => pending.promise) });
    const select = within(row("grace")).getByRole("combobox");
    fireEvent.change(select, { target: { value: "viewer" } });
    expect(props.onUpdatePermission).toHaveBeenCalledWith({ clientId: "c1", role: "viewer" });
    expect(select).toBeDisabled();
    expect(within(row("linus")).getByRole("combobox")).not.toBeDisabled();
    await act(async () => pending.resolve());
    expect(props.onRefresh).toHaveBeenCalledOnce();
    expect(select).not.toBeDisabled();
  });

  it.each([
    [new Error("Server said no"), "Server said no"],
    ["boom", "Failed to update permission"],
  ])("reports a failed role change (%s)", async (failure, message) => {
    const props = setup({ onUpdatePermission: vi.fn(async () => Promise.reject(failure)) });
    await act(async () => {
      fireEvent.change(within(row("grace")).getByRole("combobox"), {
        target: { value: "admin" },
      });
    });
    expect(screen.getByText(message)).toBeVisible();
    expect(props.onRefresh).not.toHaveBeenCalled();
  });

  it("does nothing when removal is not confirmed", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const props = setup();
    fireEvent.click(within(row("grace")).getByTitle("Remove collaborator"));
    expect(props.onRemoveCollaborator).not.toHaveBeenCalled();
  });

  it("removes a collaborator with a spinner while pending", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const pending = deferred();
    const props = setup({ onRemoveCollaborator: vi.fn(() => pending.promise) });
    const button = within(row("grace")).getByTitle("Remove collaborator");
    fireEvent.click(button);
    expect(props.onRemoveCollaborator).toHaveBeenCalledWith("c1");
    expect(button).toBeDisabled();
    expect(button.querySelector(".spin")).not.toBeNull();
    expect(within(row("linus")).getByTitle("Remove collaborator")).not.toBeDisabled();
    await act(async () => pending.resolve());
    expect(props.onRefresh).toHaveBeenCalledOnce();
    expect(button).not.toBeDisabled();
  });

  it.each([
    [new Error("Gone"), "Gone"],
    [42, "Failed to remove collaborator"],
  ])("reports a failed removal (%s)", async (failure, message) => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    setup({ onRemoveCollaborator: vi.fn(async () => Promise.reject(failure)) });
    await act(async () => {
      fireEvent.click(within(row("linus")).getByTitle("Remove collaborator"));
    });
    expect(screen.getByText(message)).toBeVisible();
  });
});
