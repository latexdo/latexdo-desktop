import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  FolderDown,
  Globe,
  KeyRound,
  Link,
  Loader2,
  LogIn,
  RefreshCw,
  Square,
  UserRound,
  Wifi,
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
  onDisplayNameChange: (value: string) => void;
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

const modeLabels: Record<HostSharingMode, string> = {
  internet: "over the internet",
  local: "on your local network",
};

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
  onDisplayNameChange,
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
  const [mode, setMode] = useState<HostSharingMode>("internet");
  const [webLinkCopied, setWebLinkCopied] = useState(false);
  const webLink = webLinkForInvite(state.inviteCode);
  useEffect(() => {
    if (!webLinkCopied) return;
    const timer = setTimeout(() => setWebLinkCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [webLinkCopied]);

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
        <div className="share-section">
          <h4 className="share-heading share-flush">Your name</h4>
          <div className="share-name-row">
            <UserRound size={15} aria-hidden="true" />
            <input
              value={displayName}
              placeholder="How collaborators will see you"
              aria-label="Collaboration display name"
              onChange={(event) => onDisplayNameChange(event.target.value)}
              maxLength={80}
            />
          </div>
        </div>

        {hostFlow && (hostLive || hostStarting) ? (
          <div className="share-section">
            <p className="share-status" role="status">
              {hostLive ? (
                <span className="share-status-dot" aria-hidden="true" />
              ) : (
                <Loader2 size={14} className="spin" aria-hidden="true" />
              )}
              {hostLive
                ? `Sharing is on, ${modeLabels[host?.mode ?? "internet"]}.`
                : (host?.message ?? "Starting…")}
            </p>
            <div className="share-link-row share-flush">
              <KeyRound size={15} />
              <input
                readOnly
                value={state.inviteCode ?? ""}
                placeholder={
                  hostLive ? "Preparing invite…" : "Your invite appears here"
                }
                aria-label="Invite"
                onFocus={(event) => event.target.select()}
              />
              <button
                type="button"
                onClick={() => state.inviteCode && onCopy(state.inviteCode)}
                disabled={!state.inviteCode}
              >
                {copied && !webLinkCopied ? <Check size={15} /> : <Copy size={15} />}
                {copied && !webLinkCopied ? "Copied" : "Copy invite"}
              </button>
            </div>
            {webLink ? (
              <div className="share-link-row share-flush">
                <Globe size={15} />
                <input
                  readOnly
                  value={webLink}
                  aria-label="Web link"
                  onFocus={(event) => event.target.select()}
                />
                <button
                  type="button"
                  onClick={() => {
                    onCopy(webLink);
                    setWebLinkCopied(true);
                  }}
                >
                  {webLinkCopied ? <Check size={15} /> : <Copy size={15} />}
                  {webLinkCopied ? "Copied" : "Copy web link"}
                </button>
              </div>
            ) : null}
            <p className="share-hint">
              {webLink
                ? "Send the web link: your collaborators edit in their browser, with no account or install. People with LatexDo can paste the invite or the link under Join. The project stays online when you close LatexDo."
                : "Send the invite to your collaborators. They open Share in their LatexDo and paste it under Join. It works while LatexDo stays open on this computer."}
            </p>
            {isAdmin ? (
              <label className="share-check">
                <input
                  type="checkbox"
                  checked={Boolean(state.requireApproval)}
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
                  title="Make a new invite. The current one stops working for new people."
                >
                  <RefreshCw size={14} />
                  New invite
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
                <h4>Share this project</h4>
                <p className="share-hint">
                  {state.hosted
                    ? "This is the shared copy of your project. Sharing is off."
                    : "No account needed. Choose how people reach the project."}
                </p>
                {startError || (host?.phase === "failed" && host.message) ? (
                  <div className="share-error share-flush" role="alert">
                    {startError || host?.message}
                  </div>
                ) : null}
                <div
                  className="share-modes"
                  role="radiogroup"
                  aria-label="How to share"
                >
                  <label
                    className={`share-mode ${mode === "internet" ? "selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="share-mode"
                      className="share-mode-radio"
                      checked={mode === "internet"}
                      onChange={() => setMode("internet")}
                    />
                    <span className="share-mode-icon" aria-hidden="true">
                      <Globe size={16} />
                    </span>
                    <span className="share-mode-text">
                      <strong>Over the internet</strong>
                      <small>
                        Works from anywhere and stays online when your computer is off.
                        The invite never expires.
                      </small>
                    </span>
                  </label>
                  <label className={`share-mode ${mode === "local" ? "selected" : ""}`}>
                    <input
                      type="radio"
                      name="share-mode"
                      className="share-mode-radio"
                      checked={mode === "local"}
                      onChange={() => setMode("local")}
                    />
                    <span className="share-mode-icon" aria-hidden="true">
                      <Wifi size={16} />
                    </span>
                    <span className="share-mode-text">
                      <strong>Same network only</strong>
                      <small>
                        Shared from this computer, no internet needed. Not encrypted, so
                        use a network you trust.
                      </small>
                    </span>
                  </label>
                </div>
                <div className="share-actions share-actions-stacked">
                  <button
                    type="button"
                    className="share-primary"
                    onClick={() => onStartSharing?.(mode)}
                    disabled={busy}
                  >
                    {busy ? <Loader2 size={14} className="spin" /> : <Link size={14} />}
                    {busy ? "Starting…" : "Start sharing"}
                  </button>
                  {state.hosted && onReturnToFolder ? (
                    <button type="button" onClick={onReturnToFolder} disabled={busy}>
                      <FolderDown size={14} />
                      Back to my folder
                    </button>
                  ) : null}
                  {state.hosted && onSaveToFolder ? (
                    <button type="button" onClick={onSaveToFolder} disabled={busy}>
                      <FolderDown size={14} />
                      Save to my folder
                    </button>
                  ) : null}
                </div>
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
            {hostFlow || joinedAsGuest ? (
              <h4 className="share-heading">Join a project</h4>
            ) : null}
            <div className="share-link-row">
              <LogIn size={15} />
              <input
                value={joinToken}
                placeholder={
                  hostingAvailable ? "Paste an invite" : "Paste token or share link"
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

        {showPeople ? <CollaboratorsList users={state.users} /> : null}
        {showPeople &&
        onUpdatePermission &&
        onRemoveCollaborator &&
        onRefreshPermissions ? (
          <PermissionManagement
            permissions={permissions}
            isAdmin={isAdmin}
            currentUserRole={currentUserRole as "admin" | "editor" | "viewer"}
            onUpdatePermission={onUpdatePermission}
            onRemoveCollaborator={onRemoveCollaborator}
            onRefresh={onRefreshPermissions}
          />
        ) : null}
      </section>
    </div>
  );
}
