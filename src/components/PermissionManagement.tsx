import { useState, useCallback } from "react";
import { Crown, User, Pencil, Eye, Trash2, Loader2 } from "lucide-react";
import { presenceDescription, presenceState } from "../collaboration/presence";
import type {
  CollaboratorPermission,
  CollaboratorPresence,
  CollaboratorRole,
  PermissionUpdate,
} from "../types";

export interface PermissionManagementProps {
  permissions: CollaboratorPermission[];
  isAdmin: boolean;
  currentUserRole: CollaboratorRole;
  /** Who is connected right now, shown next to their name. */
  presence?: CollaboratorPresence[];
  onUpdatePermission: (update: PermissionUpdate) => Promise<void>;
  onRemoveCollaborator: (clientId: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  /** Admins other than the owner may hand over their own admin role. */
  canTransferAdmin?: boolean;
  onWithdrawAdminOffer?: (clientId: string) => Promise<void>;
}

/** What the role menu can do: set a role, or hand over my admin role. */
type RoleChoice = CollaboratorRole | "transfer";

const roleLabels: Record<CollaboratorRole, string> = {
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

const roleIcons: Record<CollaboratorRole, React.ReactNode> = {
  admin: <Crown size={14} />,
  editor: <Pencil size={14} />,
  viewer: <Eye size={14} />,
};

const roleColors: Record<CollaboratorRole, string> = {
  admin: "#f59e0b",
  editor: "#10b981",
  viewer: "#6b7280",
};

export function PermissionManagement({
  permissions,
  isAdmin,
  currentUserRole,
  presence = [],
  onUpdatePermission,
  onRemoveCollaborator,
  onRefresh,
  canTransferAdmin = false,
  onWithdrawAdminOffer,
}: PermissionManagementProps) {
  const [loading, setLoading] = useState<{
    action: "update" | "remove";
    clientId: string;
  } | null>(null);
  const [error, setError] = useState<string>("");
  const [notice, setNotice] = useState<string>("");

  const handleRoleChange = useCallback(
    async (permission: CollaboratorPermission, choice: RoleChoice) => {
      if (!isAdmin) {
        setError("Only admin can change permissions");
        return;
      }
      const { clientId, name } = permission;
      const transfer = choice === "transfer";
      if (
        transfer &&
        !window.confirm(
          `Hand over your admin role to ${name}? Once they accept, you become an editor.`,
        )
      ) {
        return;
      }

      setLoading({ action: "update", clientId });
      setError("");
      setNotice("");

      try {
        await onUpdatePermission(
          transfer
            ? { clientId, role: "admin", transfer: true }
            : { clientId, role: choice },
        );
        // Admin rights are offered: the person becomes admin once they accept.
        if (transfer || (choice === "admin" && permission.role !== "admin")) {
          setNotice(
            `Invitation sent. ${name} becomes admin once they accept it in LatexDo.`,
          );
        }
        await onRefresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update permission");
      } finally {
        setLoading(null);
      }
    },
    [isAdmin, onUpdatePermission, onRefresh],
  );

  const handleWithdraw = useCallback(
    async (clientId: string) => {
      if (!onWithdrawAdminOffer) return;
      setLoading({ action: "update", clientId });
      setError("");
      setNotice("");
      try {
        await onWithdrawAdminOffer(clientId);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not withdraw the invitation",
        );
      } finally {
        setLoading(null);
      }
    },
    [onWithdrawAdminOffer],
  );

  const handleRemove = useCallback(
    async (clientId: string) => {
      if (!isAdmin) {
        setError("Only admin can remove collaborators");
        return;
      }

      if (
        !window.confirm(
          "Are you sure you want to remove this collaborator from the project?",
        )
      ) {
        return;
      }

      setLoading({ action: "remove", clientId });
      setError("");

      try {
        await onRemoveCollaborator(clientId);
        await onRefresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to remove collaborator");
      } finally {
        setLoading(null);
      }
    },
    [isAdmin, onRemoveCollaborator, onRefresh],
  );

  const getAvailableRoles = useCallback(
    (isCurrent: boolean): CollaboratorRole[] => {
      if (!isAdmin) {
        return [];
      }

      if (isCurrent) {
        return ["admin"];
      }

      return ["admin", "editor", "viewer"];
    },
    [isAdmin],
  );

  if (!isAdmin) {
    return (
      <div className="permission-management info">
        <p>
          <User size={14} /> You are a {roleLabels[currentUserRole]} on this project.
        </p>
      </div>
    );
  }

  return (
    <div className="permission-management">
      <h4>People with access</h4>

      {error ? <div className="permission-error">{error}</div> : null}
      {notice ? (
        <div className="permission-notice" role="status">
          {notice}
        </div>
      ) : null}

      {permissions.length === 0 ? (
        <p className="permission-empty">
          No collaborators yet. Share the project to add some.
        </p>
      ) : (
        <table className="permission-table">
          <tbody>
            {permissions.map((perm) => {
              const isCurrent = perm.isCurrent === true;
              const online = presence.find((user) => user.clientId === perm.clientId);
              return (
                <tr key={perm.clientId}>
                  <td>
                    <span className="permission-person">
                      <span className="collaborator-avatar" aria-hidden="true">
                        {perm.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="permission-person-text">
                        <span className="collaborator-name">
                          {perm.name}
                          {isCurrent ? <small> (you)</small> : null}
                        </span>
                        {online ? (
                          <small
                            className="permission-online"
                            data-presence={presenceState(online)}
                            title={presenceDescription(
                              presenceState(online),
                              online.currentFile,
                            )}
                          >
                            <span
                              className="presence-dot"
                              data-presence={presenceState(online)}
                              aria-hidden="true"
                            />
                            {presenceState(online) === "away"
                              ? "Away"
                              : online.currentFile
                                ? online.currentFile.split("/").pop()
                                : "Active now"}
                          </small>
                        ) : null}
                        {perm.adminOffer ? (
                          <small className="permission-admin-offer">
                            <Crown size={11} aria-hidden="true" />
                            {perm.adminOffer.transfer
                              ? "Admin hand-over waiting for their answer"
                              : "Admin invitation waiting for their answer"}
                            {onWithdrawAdminOffer ? (
                              <button
                                type="button"
                                onClick={() => void handleWithdraw(perm.clientId)}
                                disabled={loading?.clientId === perm.clientId}
                              >
                                Withdraw
                              </button>
                            ) : null}
                          </small>
                        ) : null}
                      </span>
                    </span>
                  </td>
                  <td>
                    {isAdmin && !isCurrent ? (
                      <select
                        value={perm.role}
                        aria-label={`Role of ${perm.name}`}
                        onChange={(e) => {
                          void handleRoleChange(perm, e.target.value as RoleChoice);
                        }}
                        disabled={
                          loading?.action === "update" &&
                          loading.clientId === perm.clientId
                        }
                      >
                        {getAvailableRoles(isCurrent).map((role) => (
                          <option key={role} value={role}>
                            {role === "admin" && perm.role !== "admin"
                              ? "Admin (invite)"
                              : roleLabels[role]}
                          </option>
                        ))}
                        {canTransferAdmin && perm.role !== "admin" ? (
                          <option value="transfer">Hand over my admin role</option>
                        ) : null}
                      </select>
                    ) : (
                      <span
                        className="role-badge"
                        style={{ color: roleColors[perm.role] }}
                      >
                        {roleIcons[perm.role]}
                        {roleLabels[perm.role]}
                      </span>
                    )}
                  </td>
                  {isAdmin ? (
                    <td>
                      {!isCurrent ? (
                        <button
                          type="button"
                          onClick={() => void handleRemove(perm.clientId)}
                          disabled={
                            loading?.action === "remove" &&
                            loading.clientId === perm.clientId
                          }
                          title="Remove collaborator"
                          className="remove-btn"
                        >
                          {loading?.action === "remove" &&
                          loading.clientId === perm.clientId ? (
                            <Loader2 size={14} className="spin" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
