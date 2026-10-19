import { useEffect } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  FolderDown,
  KeyRound,
  Link,
  Loader2,
  LogIn,
  RefreshCw,
  Square,
  UserRound,
  X,
} from "lucide-react";
import { CollaboratorsList } from "./CollaboratorsList";
import { webLinkForInvite } from "../collaboration/webLink";
import { PermissionManagement } from "./PermissionManagement";
import type {
  CollaborationState,
  CollaboratorPermission,
  HostSharingMode,
  PermissionUpdate,
} from "../types";

export interface ShareProjectDialogProps {
  open: boolean;
  state: CollaborationState;
  copied: boolean;
  busy: boolean;
  joinToken: string;
  joining: boolean;
  joinError: string;
  /** Why sharing could not start, e.g. a file that is too large. */
  startError?: string;
  displayName: string;
  permissions: CollaboratorPermission[];
  isAdmin: boolean;
  currentUserRole: string;
  /** True when this app shares projects straight from the user's computer. */
  hostingAvailable?: boolean;
  hasProject?: boolean;
  /** Shown while the owner has not yet let this person in. */
  joinWaitingMessage?: string;
  onCopy: (value: string) => void;
  onJoinTokenChange: (value: string) => void;
  /** Opens Profile, where the name collaborators see is set. */
  onEditName?: () => void;
  onJoin: () => void;
  onCancelJoin?: () => void;
  onRegenerate?: () => void;
  onStartSharing?: (mode: HostSharingMode) => void;
  onStopSharing?: () => void;
  onSaveToFolder?: () => void;
  /** Leaves the shared copy and reopens the owner's own folder. */
  onReturnToFolder?: () => void;
  onRequireApprovalChange?: (requireApproval: boolean) => void;
  onResolveRequest?: (clientId: string, approve: boolean) => void;
  onClose: () => void;
  onUpdatePermission?: (update: PermissionUpdate) => Promise<void>;
  onRemoveCollaborator?: (clientId: string) => Promise<void>;
  onRefreshPermissions?: () => Promise<void>;
}

export function ShareProjectDialog({
  open,
  state,
  copied,
  busy,
  joinToken,
  joining,
  joinError,
  startError,
  displayName,
  permissions,
  isAdmin,
  currentUserRole,
  hostingAvailable = false,
  hasProject = true,
  joinWaitingMessage = "",
  onCopy,
  onJoinTokenChange,
  onEditName,
  onJoin,
  onCancelJoin,
  onRegenerate,
  onStartSharing,
  onStopSharing,
  onSaveToFolder,
  onReturnToFolder,
  onRequireApprovalChange,
  onResolveRequest,
  onClose,
  onUpdatePermission,
  onRemoveCollaborator,
  onRefreshPermissions,
}: ShareProjectDialogProps) {
  // One link to send: the browser link when the project is on the server,
  // otherwise the invite (Join accepts both).
  const webLink = webLinkForInvite(state.inviteCode);
  const shareLink = webLink ?? state.inviteCode ?? "";

  useEffect(() => {
    if (!open) return;
    // Capture phase, so the editor underneath cannot swallow the key first.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const host = state.host;
  // A project served from this computer is only shared while it is reachable.
  const hostStarting = Boolean(state.hosted && host?.phase === "starting");
  const hostLive = Boolean(state.hosted && state.enabled && host?.active);
  const joinedAsGuest = Boolean(state.enabled && state.apiBaseUrl && !state.hosted);
  const hostFlow =
    !joinedAsGuest && (state.hosted || (hostingAvailable && !state.enabled));
  const pending = isAdmin ? (state.pending ?? []) : [];
  const showPeople =
    (!hostFlow && !joinedAsGuest) ||
    (state.enabled && (!state.hosted || hostLive || hostStarting));
  // Before anyone else joins, the online list and the permissions table would
  // both just show the owner.
  const onlyOwner = isAdmin && permissions.length <= 1 && state.users.length <= 1;
  // Admins get one list of people: access, role and who is online.
  const managePeople = Boolean(
    isAdmin && onUpdatePermission && onRemoveCollaborator && onRefreshPermissions,
  );

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="modal-panel share-project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-project-title"
      >
        <header className="modal-header">
          <h2 id="share-project-title">Share Project</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </header>
        {!displayName.trim() ? (
          <div className="share-section">
            <p className="share-hint share-name-missing">
              <UserRound size={14} aria-hidden="true" />
              Collaborators will see you as Guest.
              {onEditName ? (
                <button type="button" onClick={onEditName}>
                  Add your name
                </button>
              ) : null}
            </p>
          </div>
        ) : null}

        {hostFlow && (hostLive || hostStarting) ? (
          <div className="share-section">
            <p className="share-status" role="status">
              {hostLive ? (
                <span className="share-status-dot" aria-hidden="true" />
              ) : (
                <Loader2 size={14} className="spin" aria-hidden="true" />
              )}
              {hostLive ? "Sharing is on." : (host?.message ?? "Starting…")}
            </p>
            <div className="share-link-field">
              <Link size={15} aria-hidden="true" />
              <input
                readOnly
                value={shareLink}
                placeholder={hostLive ? "Preparing link…" : "Your link appears here"}
                aria-label="Share link"
                onFocus={(event) => event.target.select()}
              />
              <button
                type="button"
                className="share-copy"
                onClick={() => shareLink && onCopy(shareLink)}
                disabled={!shareLink}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
            <p className="share-hint">
              {webLink
                ? "Anyone with the link can edit in a browser. Stays online when LatexDo is closed."
                : "Paste it under Join in LatexDo. Works while LatexDo stays open."}
            </p>
            {isAdmin ? (
              <label className="share-check">
                <input
                  type="checkbox"
                  checked={state.requireApproval !== false}
                  onChange={(event) => onRequireApprovalChange?.(event.target.checked)}
                />
                Ask me before someone new joins
              </label>
            ) : null}
            <div className="share-actions">
              {isAdmin && onRegenerate ? (
                <button
                  type="button"
                  onClick={onRegenerate}
                  disabled={busy || !state.inviteCode}
                  title="Make a new link. The current one stops working for new people."
                >
                  <RefreshCw size={14} />
                  New link
                </button>
              ) : null}
              {onSaveToFolder ? (
                <button type="button" onClick={onSaveToFolder} disabled={busy}>
                  <FolderDown size={14} />
                  Save to my folder
                </button>
              ) : null}
              {onStopSharing ? (
                <button
                  type="button"
                  className="share-danger"
                  onClick={onStopSharing}
                  disabled={busy}
                >
                  <Square size={13} />
                  Stop sharing
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {hostFlow && !hostLive && !hostStarting ? (
          <div className="share-section">
            {!hasProject ? (
              <p className="share-hint">
                Open a project to share it, or join someone else&apos;s below.
              </p>
            ) : (
              <>
                {state.hosted ? (
                  <p className="share-hint">
                    Shared copy of your project. Sharing is off.
                  </p>
                ) : null}
                {startError || (host?.phase === "failed" && host.message) ? (
                  <div className="share-error share-flush" role="alert">
                    {startError || host?.message}
                  </div>
                ) : null}
                <div className="share-actions share-actions-stacked">
                  <button
                    type="button"
                    className="share-primary"
                    onClick={() => onStartSharing?.("internet")}
                    disabled={busy}
                  >
                    {busy ? <Loader2 size={14} className="spin" /> : <Link size={14} />}
                    {busy ? "Creating link…" : "Create link"}
                  </button>
                </div>
                {state.hosted && (onReturnToFolder || onSaveToFolder) ? (
                  <div className="share-links">
                    {onReturnToFolder ? (
                      <button type="button" onClick={onReturnToFolder} disabled={busy}>
                        <ArrowLeft size={13} />
                        Back to my folder
                      </button>
                    ) : null}
                    {onSaveToFolder ? (
                      <button type="button" onClick={onSaveToFolder} disabled={busy}>
                        <FolderDown size={13} />
                        Save to my folder
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {joinedAsGuest ? (
          <div className="share-section">
            <p className="share-status" role="status">
              <span className="share-status-dot" aria-hidden="true" />
              You joined
              {state.projectName ? ` “${state.projectName}”` : " this project"}. It
              stays available while the owner keeps sharing.
            </p>
          </div>
        ) : null}

        {!hostFlow && !joinedAsGuest ? (
          <>
            <div className="share-link-row">
              <KeyRound size={15} />
              <input
                readOnly
                value={state.token ?? ""}
                placeholder={
                  busy ? "Generating token..." : "Open a project to generate"
                }
                aria-label="Collaboration token"
              />
              <button
                type="button"
                onClick={() => state.token && onCopy(state.token)}
                disabled={busy || !state.token}
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? "Copied" : "Copy"}
              </button>
              {isAdmin && onRegenerate && state.token ? (
                <button
                  type="button"
                  className="share-regenerate-button"
                  onClick={onRegenerate}
                  disabled={busy}
                  title="Generate a new link and invalidate the current one"
                >
                  <RefreshCw size={15} />
                  Regenerate
                </button>
              ) : null}
            </div>
            <div className="share-link-row">
              <Link size={15} />
              <input
                readOnly
                value={state.shareUrl ?? ""}
                placeholder="Share link"
                aria-label="Share link"
              />
              <button
                type="button"
                onClick={() => state.shareUrl && onCopy(state.shareUrl)}
                disabled={busy || !state.shareUrl}
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </>
        ) : null}

        {pending.length ? (
          <div className="share-section share-requests">
            <h4>Waiting to join</h4>
            <ul>
              {pending.map((request) => (
                <li key={request.clientId}>
                  <span>{request.name}</span>
                  <button
                    type="button"
                    className="share-primary"
                    onClick={() => onResolveRequest?.(request.clientId, true)}
                  >
                    Allow
                  </button>
                  <button
                    type="button"
                    onClick={() => onResolveRequest?.(request.clientId, false)}
                  >
                    Deny
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!hostLive && !hostStarting ? (
          <form
            className={`share-token-form ${hostFlow || joinedAsGuest ? "share-divided" : ""}`}
            onSubmit={(event) => {
              event.preventDefault();
              onJoin();
            }}
          >
            <div className="share-link-row">
              <LogIn size={15} />
              <input
                value={joinToken}
                placeholder={
                  hostingAvailable
                    ? "Paste an invite to join"
                    : "Paste token or share link"
                }
                aria-label="Join collaboration token"
                onChange={(event) => onJoinTokenChange(event.target.value)}
              />
              <button type="submit" disabled={joining || !joinToken.trim()}>
                {joining ? "Joining..." : "Join"}
              </button>
            </div>
            {joinWaitingMessage ? (
              <div className="share-waiting" role="status">
                <Loader2 size={14} className="spin" aria-hidden="true" />
                <span>{joinWaitingMessage}</span>
                {onCancelJoin ? (
                  <button type="button" onClick={onCancelJoin}>
                    Cancel
                  </button>
                ) : null}
              </div>
            ) : null}
            {joinError ? <div className="share-error">{joinError}</div> : null}
          </form>
        ) : null}

        {showPeople && onlyOwner ? (
          <p className="share-hint share-people-empty">
            Only you so far. Send the link to invite people.
          </p>
        ) : null}
        {showPeople && !onlyOwner && !managePeople ? (
          <div className="share-section">
            <h4>Online now</h4>
            <CollaboratorsList users={state.users} />
          </div>
        ) : null}
        {showPeople &&
        !onlyOwner &&
        onUpdatePermission &&
        onRemoveCollaborator &&
        onRefreshPermissions ? (
          <PermissionManagement
            permissions={permissions}
            isAdmin={isAdmin}
            currentUserRole={currentUserRole as "admin" | "editor" | "viewer"}
            presence={state.users}
            onUpdatePermission={onUpdatePermission}
            onRemoveCollaborator={onRemoveCollaborator}
            onRefresh={onRefreshPermissions}
          />
        ) : null}
      </section>
    </div>
  );
}
