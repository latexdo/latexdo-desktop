import { User, Crown, Pencil, Eye } from "lucide-react";
import type { CollaboratorPresence } from "../types";

const roleIcons: Record<string, React.ReactNode> = {
  admin: <Crown size={12} />,
  editor: <Pencil size={12} />,
  viewer: <Eye size={12} />,
};

export function CollaboratorsList({ users }: { users: CollaboratorPresence[] }) {
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
      {users.map((user) => (
        <li key={user.clientId}>
          <span className="collaborator-avatar" aria-hidden="true">
            {user.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="collaborator-meta">
            <strong>{user.name}</strong>
            {user.currentFile ? <small>{user.currentFile}</small> : null}
            {user.role ? (
              <span className="collaborator-role" title={user.role}>
                {roleIcons[user.role] ?? <User size={12} />}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
