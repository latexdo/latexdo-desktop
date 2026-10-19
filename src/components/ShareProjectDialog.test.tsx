import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CollaborationState } from "../types";
import { ShareProjectDialog, type ShareProjectDialogProps } from "./ShareProjectDialog";

const owner = { clientId: "me", name: "Me", role: "admin" as const, isCurrent: true };

function props(overrides: Partial<ShareProjectDialogProps> = {}): ShareProjectDialogProps {
  return {
    open: true,
    state: { enabled: false, users: [] },
    copied: false,
    busy: false,
    joinToken: "",
    joining: false,
    joinError: "",
    displayName: "Me",
    permissions: [owner],
    isAdmin: true,
    currentUserRole: "admin",
    onCopy: vi.fn(),
    onJoinTokenChange: vi.fn(),
    onJoin: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

const liveHost: CollaborationState = {
  enabled: true,
  hosted: true,
  users: [],
  inviteCode: "plain-invite",
  host: { active: true, mode: "local", phase: "ready" },
};

describe("ShareProjectDialog", () => {
  it("ignores keys other than Escape", () => {
    const p = props();
    render(<ShareProjectDialog {...p} />);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(p.onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(p.onClose).not.toHaveBeenCalled();
  });

  it("warns about a missing name without a Profile shortcut", () => {
    render(<ShareProjectDialog {...props({ displayName: "  " })} />);
    expect(screen.getByText(/Collaborators will see you as Guest/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add your name" })).toBeNull();
  });

  it("shows the default progress text while hosting starts", () => {
    render(
      <ShareProjectDialog
        {...props({
          state: {
            enabled: false,
            hosted: true,
            users: [],
            host: { active: false, mode: "internet", phase: "starting" },
          },
        })}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("Starting…");
    const link = screen.getByLabelText("Share link") as HTMLInputElement;
    expect(link.placeholder).toBe("Your link appears here");
    const copy = screen.getByRole("button", { name: "Copy link" }) as HTMLButtonElement;
    expect(copy.disabled).toBe(true);
    fireEvent.click(copy);
    // No join form while the link is being prepared.
    expect(screen.queryByLabelText("Join collaboration token")).toBeNull();
  });

  it("lets an admin copy the live link, select it, and change approval", () => {
    const onRequireApprovalChange = vi.fn();
    const onSaveToFolder = vi.fn();
    const onStopSharing = vi.fn();
    const p = props({
      state: { ...liveHost, requireApproval: false },
      copied: true,
      onRequireApprovalChange,
      onSaveToFolder,
      onStopSharing,
    });
    render(<ShareProjectDialog {...p} />);
    expect(screen.getByRole("status").textContent).toContain("Sharing is on.");
    const link = screen.getByLabelText("Share link") as HTMLInputElement;
    const select = vi.spyOn(link, "select");
    fireEvent.focus(link);
    expect(select).toHaveBeenCalled();
    expect(screen.getByText(/Paste it under Join in LatexDo/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copied" }));
    expect(p.onCopy).toHaveBeenCalledWith("plain-invite");
    const approval = screen.getByRole("checkbox") as HTMLInputElement;
    expect(approval.checked).toBe(false);
    fireEvent.click(approval);
    expect(onRequireApprovalChange).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("button", { name: /New link/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Save to my folder/ }));
    fireEvent.click(screen.getByRole("button", { name: /Stop sharing/ }));
    expect(onSaveToFolder).toHaveBeenCalled();
    expect(onStopSharing).toHaveBeenCalled();
  });

  it("hides admin-only controls from a non-admin host view", () => {
    render(
      <ShareProjectDialog
        {...props({ state: liveHost, isAdmin: false, currentUserRole: "editor" })}
      />,
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
  });

  it("offers only the folder action that is available on a stopped shared copy", () => {
    const onReturnToFolder = vi.fn();
    const { rerender } = render(
      <ShareProjectDialog
        {...props({
          state: { enabled: false, hosted: true, users: [] },
          onReturnToFolder,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Back to my folder/ }));
    expect(onReturnToFolder).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Save to my folder/ })).toBeNull();

    const onSaveToFolder = vi.fn();
    rerender(
      <ShareProjectDialog
        {...props({ state: { enabled: false, hosted: true, users: [] }, onSaveToFolder })}
      />,
    );
    expect(screen.queryByRole("button", { name: /Back to my folder/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Save to my folder/ }));
    expect(onSaveToFolder).toHaveBeenCalled();
  });

  it("starts internet sharing even without a handler and shows a failed host message", () => {
    render(
      <ShareProjectDialog
        {...props({
          hostingAvailable: true,
          state: {
            enabled: false,
            users: [],
            host: { active: false, mode: null, phase: "failed", message: "Port blocked" },
          },
        })}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe("Port blocked");
    fireEvent.click(screen.getByRole("button", { name: /Create link/ }));
    expect(screen.getByLabelText<HTMLInputElement>("Join collaboration token").placeholder).toBe(
      "Paste an invite to join",
    );
  });

  it("shows link creation progress while busy", () => {
    render(<ShareProjectDialog {...props({ hostingAvailable: true, busy: true })} />);
    const create = screen.getByRole("button", { name: /Creating link…/ }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
  });

  it("names an unnamed project generically for a guest", () => {
    render(
      <ShareProjectDialog
        {...props({
          isAdmin: false,
          state: { enabled: true, apiBaseUrl: "https://collab", users: [] },
        })}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("You joined this project");
  });

  it("copies the share URL and shows a waiting join without cancel", () => {
    const p = props({
      state: {
        enabled: true,
        token: "tok",
        shareUrl: "https://share/tok",
        users: [],
      },
      copied: true,
      joinToken: "abc",
      joinWaitingMessage: "Waiting for the owner",
      joinError: "Denied",
    });
    render(<ShareProjectDialog {...p} />);
    const copyButtons = screen.getAllByRole("button", { name: /Copied/ });
    fireEvent.click(copyButtons[1]);
    expect(p.onCopy).toHaveBeenCalledWith("https://share/tok");
    expect(screen.getByText("Waiting for the owner")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.getByText("Denied")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Join collaboration token"), {
      target: { value: "xyz" },
    });
    expect(p.onJoinTokenChange).toHaveBeenCalledWith("xyz");
  });

  it("does not copy an empty token or share URL", () => {
    const p = props({ state: { enabled: false, users: [] } });
    render(<ShareProjectDialog {...p} />);
    for (const button of screen.getAllByRole("button", { name: "Copy" })) {
      fireEvent.click(button);
    }
    expect(p.onCopy).not.toHaveBeenCalled();
    expect(screen.getByLabelText<HTMLInputElement>("Collaboration token").placeholder).toBe(
      "Open a project to generate",
    );
  });

  it("resolves pending requests even without a handler", () => {
    render(
      <ShareProjectDialog
        {...props({
          state: {
            ...liveHost,
            pending: [{ clientId: "c1", name: "Guest One" } as never],
          },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(screen.getByText("Guest One")).toBeTruthy();
  });
});
