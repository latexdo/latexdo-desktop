import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollaborationState, CollaboratorPermission } from "../types";
import { CollaborationDialog } from "./CollaborationDialog";
import type { ShareProjectDialogProps } from "./ShareProjectDialog";

const activeState: CollaborationState = {
  enabled: true,
  token: "share-token",
  shareUrl: "https://latexdo.example/share/share-token",
  users: [
    {
      clientId: "client-reviewer",
      name: "Reviewer One",
      currentFile: "reports/main.tex",
      lastSeen: 1,
      role: "editor",
    },
  ],
};

const permissions: CollaboratorPermission[] = [
  {
    clientId: "client-admin",
    name: "Admin User",
    role: "admin",
    isCurrent: true,
  },
  {
    clientId: "client-reviewer",
    name: "Reviewer One",
    role: "editor",
  },
];

function dialogProps(
  overrides: Partial<ShareProjectDialogProps> = {},
): ShareProjectDialogProps {
  return {
    open: true,
    state: activeState,
    copied: false,
    busy: false,
    joinToken: "incoming-token",
    joining: false,
    joinError: "",
    displayName: "Admin User",
    permissions,
    isAdmin: true,
    currentUserRole: "admin",
    onCopy: vi.fn(),
    onJoinTokenChange: vi.fn(),
    onDisplayNameChange: vi.fn(),
    onJoin: vi.fn(),
    onRegenerate: vi.fn(),
    onClose: vi.fn(),
    onUpdatePermission: vi.fn().mockResolvedValue(undefined),
    onRemoveCollaborator: vi.fn().mockResolvedValue(undefined),
    onRefreshPermissions: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("CollaborationDialog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders admin sharing controls and manages collaborator permissions", async () => {
    const props = dialogProps();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<CollaborationDialog {...props} />);

    expect(screen.getByRole("dialog", { name: "Share Project" })).toBeVisible();
    expect(screen.getAllByText("Reviewer One").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("reports/main.tex")).toBeVisible();

    fireEvent.click(screen.getAllByRole("button", { name: "Copy" })[0]);
    expect(props.onCopy).toHaveBeenCalledWith("share-token");

    fireEvent.click(screen.getByRole("button", { name: /Regenerate/i }));
    expect(props.onRegenerate).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("Collaboration display name"), {
      target: { value: "Publisher" },
    });
    expect(props.onDisplayNameChange).toHaveBeenCalledWith("Publisher");

    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(props.onJoin).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByDisplayValue("Editor"), {
      target: { value: "viewer" },
    });
    await waitFor(() => {
      expect(props.onUpdatePermission).toHaveBeenCalledWith({
        clientId: "client-reviewer",
        role: "viewer",
      });
    });
    expect(props.onRefreshPermissions).toHaveBeenCalled();

    fireEvent.click(screen.getByTitle("Remove collaborator"));
    await waitFor(() => {
      expect(props.onRemoveCollaborator).toHaveBeenCalledWith("client-reviewer");
    });
  });

  it("shows empty and non-admin states without collaboration links", () => {
    render(
      <CollaborationDialog
        {...dialogProps({
          state: { enabled: false, users: [] },
          copied: true,
          busy: true,
          joinToken: "",
          joinError: "Invalid token",
          permissions: [],
          isAdmin: false,
          currentUserRole: "viewer",
          onRegenerate: undefined,
        })}
      />,
    );

    expect(screen.getByText("Waiting for collaborators")).toBeVisible();
    expect(screen.getByText("Invalid token")).toBeVisible();
    expect(screen.getByText(/You are a Viewer on this project/i)).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Copied" })[0]).toBeDisabled();
    expect(screen.getByRole("button", { name: "Join" })).toBeDisabled();
  });

  it("lets the owner start sharing from this computer and pick how", () => {
    const props = dialogProps({
      state: { enabled: false, users: [] },
      hostingAvailable: true,
      joinToken: "",
      onStartSharing: vi.fn(),
    });
    render(<CollaborationDialog {...props} />);

    expect(screen.queryByLabelText("Collaboration token")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start sharing" }));
    expect(props.onStartSharing).toHaveBeenLastCalledWith("internet");
    fireEvent.click(screen.getByRole("radio", { name: /Same network only/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start sharing" }));
    expect(props.onStartSharing).toHaveBeenLastCalledWith("local");
    expect(screen.getByPlaceholderText("Paste an invite")).toBeVisible();
  });

  it("shows progress while the internet link starts and the reason when it fails", () => {
    const hosted = { enabled: true, hosted: true, token: "t", users: [] };
    const { rerender } = render(
      <CollaborationDialog
        {...dialogProps({
          hostingAvailable: true,
          state: {
            ...hosted,
            host: {
              active: false,
              mode: "internet",
              phase: "starting",
              message: "Connecting…",
              addresses: [],
            },
          },
        })}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Connecting…");
    expect(screen.getByRole("button", { name: "Copy invite" })).toBeDisabled();

    rerender(
      <CollaborationDialog
        {...dialogProps({
          hostingAvailable: true,
          state: {
            ...hosted,
            host: {
              active: false,
              mode: "internet",
              phase: "failed",
              message: "The internet link was lost.",
              addresses: [],
            },
          },
        })}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("The internet link was lost.");
    expect(screen.getByText(/shared copy of your project/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Start sharing" })).toBeEnabled();
  });

  it("gives the owner the invite, approvals and every way to end access", () => {
    const props = dialogProps({
      hostingAvailable: true,
      state: {
        ...activeState,
        hosted: true,
        inviteCode: "latexdo-invite:abc",
        requireApproval: false,
        pending: [{ clientId: "client-new", name: "New Person", requestedAt: 1 }],
        host: {
          active: true,
          mode: "internet",
          phase: "ready",
          addresses: ["https://calm-green-river.trycloudflare.com"],
        },
      },
      onStopSharing: vi.fn(),
      onSaveToFolder: vi.fn(),
      onRequireApprovalChange: vi.fn(),
      onResolveRequest: vi.fn(),
    });
    render(<CollaborationDialog {...props} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Sharing is on, over the internet.",
    );
    expect(screen.getByLabelText("Invite")).toHaveValue("latexdo-invite:abc");
    fireEvent.click(screen.getByRole("button", { name: "Copy invite" }));
    expect(props.onCopy).toHaveBeenCalledWith("latexdo-invite:abc");
    fireEvent.click(screen.getByLabelText("Ask me before someone new joins"));
    expect(props.onRequireApprovalChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(props.onResolveRequest).toHaveBeenLastCalledWith("client-new", true);
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(props.onResolveRequest).toHaveBeenLastCalledWith("client-new", false);
    fireEvent.click(screen.getByRole("button", { name: "New invite" }));
    expect(props.onRegenerate).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Save to my folder" }));
    expect(props.onSaveToFolder).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Stop sharing" }));
    expect(props.onStopSharing).toHaveBeenCalledOnce();
    // Joining another project is not offered while this one is being shared.
    expect(screen.queryByRole("button", { name: "Join" })).not.toBeInTheDocument();
    expect(screen.getByTitle("Remove collaborator")).toBeVisible();
  });

  it("shows a guest where they are and a waiting state they can cancel", () => {
    const props = dialogProps({
      hostingAvailable: true,
      isAdmin: false,
      currentUserRole: "editor",
      joinWaitingMessage: "Waiting for the project owner to let you in.",
      joining: true,
      onCancelJoin: vi.fn(),
      state: {
        enabled: true,
        token: "t",
        apiBaseUrl: "https://calm-green-river.trycloudflare.com",
        projectName: "Thesis",
        users: [],
        pending: [{ clientId: "x", name: "Hidden", requestedAt: 1 }],
      },
    });
    render(<CollaborationDialog {...props} />);

    expect(screen.getByText(/You joined “Thesis”/)).toBeVisible();
    expect(screen.queryByLabelText("Invite")).not.toBeInTheDocument();
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
    expect(
      screen.getByText("Waiting for the project owner to let you in."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onCancelJoin).toHaveBeenCalledOnce();
  });

  it("asks for a project before offering to share one", () => {
    render(
      <CollaborationDialog
        {...dialogProps({
          hostingAvailable: true,
          hasProject: false,
          state: { enabled: false, users: [] },
        })}
      />,
    );
    expect(screen.getByText(/Open a project to share it/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Start sharing" }),
    ).not.toBeInTheDocument();
  });

  it("does not render when closed", () => {
    const { container } = render(
      <CollaborationDialog {...dialogProps({ open: false })} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
