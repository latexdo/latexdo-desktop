import { useState, useCallback } from "react";
import { Crown, User, Pencil, Eye, Trash2, Loader2 } from "lucide-react";
import type {
  CollaboratorPermission,
  CollaboratorRole,
  PermissionUpdate,
} from "../types";

export interface PermissionManagementProps {
  permissions: CollaboratorPermission[];
  isAdmin: boolean;
  currentUserRole: CollaboratorRole;
  onUpdatePermission: (update: PermissionUpdate) => Promise<void>;
  onRemoveCollaborator: (clientId: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}

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
  onUpdatePermission,
  onRemoveCollaborator,
  onRefresh,
}: PermissionManagementProps) {
  const [loading, setLoading] = useState<{
    action: "update" | "remove";
    clientId: string;
  } | null>(null);
  const [error, setError] = useState<string>("");

  const handleRoleChange = useCallback(
    async (clientId: string, newRole: CollaboratorRole) => {
      if (!isAdmin) {
        setError("Only admin can change permissions");
        return;
      }

      setLoading({ action: "update", clientId });
      setError("");

      try {
        await onUpdatePermission({ clientId, role: newRole });
        await onRefresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update permission");
      } finally {
        setLoading(null);
      }
    },
    [isAdmin, onUpdatePermission, onRefresh],
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
      <h4>
        <Crown size={14} /> Project Permissions
      </h4>

      {error ? <div className="permission-error">{error}</div> : null}

      {permissions.length === 0 ? (
        <p className="permission-empty">
          No collaborators yet. Share the project to add some.
        </p>
      ) : (
        <table className="permission-table">
          <thead>
            <tr>
              <th>Collaborator</th>
              <th>Role</th>
              {isAdmin ? <th>Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {permissions.map((perm) => {
              const isCurrent = perm.isCurrent === true;
              return (
                <tr key={perm.clientId}>
                  <td>
                    <span className="collaborator-name">{perm.name}</span>
                  </td>
                  <td>
                    {isAdmin && !isCurrent ? (
                      <select
                        value={perm.role}
                        onChange={(e) => {
                          void handleRoleChange(
                            perm.clientId,
                            e.target.value as CollaboratorRole,
                          );
                        }}
                        disabled={
                          loading?.action === "update" &&
                          loading.clientId === perm.clientId
                        }
                      >
                        {getAvailableRoles(isCurrent).map((role) => (
                          <option key={role} value={role}>
                            {roleLabels[role]}
                          </option>
                        ))}
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
