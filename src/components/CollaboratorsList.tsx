import { User, Crown, Pencil, Eye } from "lucide-react";
import type { CollaboratorPresence } from "../types";
import { presenceLabels, presenceState } from "../collaboration/presence";
import { collaboratorLook } from "../collaboration/collaboratorLook";

const roleIcons: Record<string, React.ReactNode> = {
  admin: <Crown size={12} />,
  editor: <Pencil size={12} />,
  viewer: <Eye size={12} />,
};

export function CollaboratorsList({
  users,
  onGoTo,
}: {
  users: CollaboratorPresence[];
  /** Clicking a person takes you to their file and cursor. */
  onGoTo?: (clientId: string) => void;
}) {
  if (!users.length) {
    return (
      <span className="collaborators-empty">
        <User size={13} />
        Waiting for collaborators
      </span>
    );
  }

  return (
    <ul className="collaborators-list">
      {users.map((user) => {
        const state = presenceState(user);
        const look = collaboratorLook(user.clientId);
        const canGo = Boolean(onGoTo && user.currentFile);
        return (
          <li key={user.clientId} data-presence={state}>
            <button
              type="button"
              className="collaborator-avatar collaborator-emoji"
              style={{ borderColor: look.color, background: `${look.color}33` }}
              disabled={!canGo}
              onClick={() => onGoTo?.(user.clientId)}
              title={
                canGo
                  ? `Go to ${user.name || "Guest"} in ${user.currentFile}`
                  : `${user.name || "Guest"} has no file open`
              }
              aria-label={
                canGo ? `Go to ${user.name || "Guest"}` : `${user.name || "Guest"}`
              }
            >
              {look.emoji}
            </button>
            <span className="collaborator-meta">
              <strong>{user.name}</strong>
              <small className="collaborator-presence" title={presenceLabels[state]}>
                <span
                  className="presence-dot"
                  data-presence={state}
                  aria-hidden="true"
                />
                {state === "away"
                  ? "Away"
                  : (user.currentFile?.split("/").pop() ?? "Active now")}
              </small>
              {user.role ? (
                <span className="collaborator-role" title={user.role}>
                  {roleIcons[user.role] ?? <User size={12} />}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
