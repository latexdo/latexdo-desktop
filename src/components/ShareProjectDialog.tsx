import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  Crown,
  FolderDown,
  Globe,
  KeyRound,
  Link,
  Loader2,
  LogIn,
  MoreHorizontal,
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
  /** Takes you to a person's file and cursor (from their emoji). */
  onGoToCollaborator?: (clientId: string) => void;
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
  /** Admins other than the owner may hand over their admin role. */
  canTransferAdmin?: boolean;
  onWithdrawAdminOffer?: (clientId: string) => Promise<void>;
  /** Admin rights offered to this person, waiting for their answer. */
  adminOffer?: { fromName: string; transfer: boolean } | null;
  answeringAdminOffer?: boolean;
  onAnswerAdminOffer?: (accept: boolean) => void;
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
  onGoToCollaborator,
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
  canTransferAdmin = false,
  onWithdrawAdminOffer,
  adminOffer = null,
  answeringAdminOffer = false,
  onAnswerAdminOffer,
}: ShareProjectDialogProps) {
  // One link to send: the browser link when the project is on the server,
  // otherwise the invite (Join accepts both).
  const webLink = webLinkForInvite(state.inviteCode);
  const shareLink = webLink ?? state.inviteCode ?? "";

  // The "⋯" menu with the rarer actions, and its "Stop sharing?" step.
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = () => {
    setMenuOpen(false);
    setConfirmStop(false);
  };

  useEffect(() => {
    if (!open) {
      setMenuOpen(false);
      setConfirmStop(false);
      return;
    }
    // Capture phase, so the editor underneath cannot swallow the key first.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      // Escape closes the open menu first, then the window.
      if (menuOpen) {
        setMenuOpen(false);
        setConfirmStop(false);
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose, menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
        setConfirmStop(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [menuOpen]);

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
  // Sharing is on (or starting): the window reads like a document's Share
  // window: people, who else can get in, then Copy link and Done.
  const sharingLive = hostFlow && (hostLive || hostStarting);
  const canRegenerate = Boolean(isAdmin && onRegenerate);
  // Stop sharing already brings every change home to the folder, so there
  // is no separate "save" while sharing.
  const hasMenu = sharingLive && (canRegenerate || onStopSharing);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`modal-panel share-project-dialog${sharingLive ? " share-live" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-project-title"
      >
        <header className="modal-header">
          <h2 id="share-project-title">Share Project</h2>
          <div className="share-header-actions">
            {hasMenu ? (
              <div className="share-menu-anchor" ref={menuRef}>
                <button
                  type="button"
                  aria-label="More sharing options"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  title="More options"
                  onClick={() => {
                    setConfirmStop(false);
                    setMenuOpen((value) => !value);
                  }}
                >
                  <MoreHorizontal size={16} />
                </button>
                {menuOpen && confirmStop && onStopSharing ? (
                  <div
                    className="share-menu share-confirm"
                    role="alertdialog"
                    aria-label="Stop sharing?"
                  >
                    <strong>Stop sharing?</strong>
                    <p>
                      The link stops working and everyone loses access. Your
                      changes are saved back to your folder.
                    </p>
                    <div className="share-confirm-actions">
                      <button type="button" onClick={closeMenu}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="share-danger-solid"
                        disabled={busy}
                        onClick={() => {
                          closeMenu();
                          onStopSharing();
                        }}
                      >
                        Stop sharing
                      </button>
                    </div>
                  </div>
                ) : menuOpen ? (
                  <div className="share-menu" role="menu">
                    {canRegenerate ? (
                      <button
                        type="button"
                        role="menuitem"
                        disabled={busy || !state.inviteCode}
                        onClick={() => {
                          closeMenu();
                          onRegenerate?.();
                        }}
                      >
                        <RefreshCw size={14} aria-hidden="true" />
                        <span>
                          New link
                          <small>The current link stops working for new people</small>
                        </span>
                      </button>
                    ) : null}
                    {onStopSharing ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="share-menu-danger"
                        disabled={busy}
                        onClick={() => setConfirmStop(true)}
                      >
                        <Square size={13} aria-hidden="true" />
                        <span>Stop sharing…</span>
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              title="Close (Esc)"
            >
              <X size={16} />
            </button>
          </div>
        </header>
        {adminOffer && onAnswerAdminOffer ? (
          <div
            className="share-section share-admin-offer"
            role="region"
            aria-label="Admin invitation"
          >
            <p>
              <Crown size={15} aria-hidden="true" />
              <span>
                {adminOffer.transfer ? (
                  <>
                    <strong>{adminOffer.fromName}</strong> wants to hand over their
                    admin role to you. They will become an editor.
                  </>
                ) : (
                  <>
                    <strong>{adminOffer.fromName}</strong> invited you to become an
                    admin of this project.
                  </>
                )}{" "}
                Admins manage who has access and can delete discussion messages.
              </span>
            </p>
            <div className="share-actions">
              <button
                type="button"
                disabled={answeringAdminOffer}
                onClick={() => onAnswerAdminOffer(false)}
              >
                Decline
              </button>
              <button
                type="button"
                className="share-primary"
                disabled={answeringAdminOffer}
                onClick={() => onAnswerAdminOffer(true)}
              >
                {answeringAdminOffer ? "Saving…" : "Become admin"}
              </button>
            </div>
          </div>
        ) : null}
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

        {hostFlow && !hostLive && !hostStarting ? (
          <div className="share-section">
            <div className="share-choice-heading">
              <h3>Create an invite</h3>
              <p>Share your current project with others.</p>
            </div>
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
            <div className="share-choice-heading share-join-heading">
              <h3>Join a project</h3>
              <p>Have an invite? Paste the link or token below.</p>
            </div>
            <div className="share-link-row share-join-row">
              <LogIn size={15} aria-hidden="true" />
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
            <CollaboratorsList users={state.users} onGoTo={onGoToCollaborator} />
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
            canTransferAdmin={canTransferAdmin}
            onWithdrawAdminOffer={onWithdrawAdminOffer}
            onGoTo={onGoToCollaborator}
          />
        ) : null}

        {sharingLive ? (
          <>
            <div className="share-section share-access">
              <h4>General access</h4>
              <div className="share-access-row">
                <span
                  className={`share-access-icon${hostLive ? " on" : ""}`}
                  aria-hidden="true"
                >
                  {hostLive ? <Globe size={16} /> : <Loader2 size={16} className="spin" />}
                </span>
                <div className="share-access-text">
                  <strong role="status">
                    {!hostLive
                      ? (host?.message ?? "Starting…")
                      : state.requireApproval !== false
                        ? "Anyone with the link can ask to join"
                        : "Anyone with the link has access"}
                  </strong>
                </div>
              </div>
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
            </div>
            <footer className="share-footer">
              <button
                type="button"
                className="share-copy-link"
                onClick={() => shareLink && onCopy(shareLink)}
                disabled={!shareLink}
                title={shareLink || undefined}
              >
                {copied ? <Check size={14} /> : <Link size={14} />}
                {copied ? "Copied" : "Copy link"}
              </button>
              <button type="button" className="share-done" onClick={onClose}>
                Done
              </button>
            </footer>
          </>
        ) : null}
      </section>
    </div>
  );
}
