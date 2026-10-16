import React from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  FolderDown,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import type { ResearcherProfile } from "../features/ai/researcherProfile";
import {
  generateScholarToken,
  tokenCodename,
  type AcademicTitle,
  type ExternalProviderConnection,
} from "../features/ai/researcherProfile";
import { fetchOrcidProfile, isValidOrcid } from "../features/ai/orcid";

interface ProfileDialogProps {
  profile: ResearcherProfile;
  onChange: (profile: ResearcherProfile) => void;
  onClose: () => void;
  onOpenExternal?: (url: string) => void;
  onImportOverleafProject?: (url: string) => Promise<void>;
}

const academicTitleOptions: AcademicTitle[] = ["", "Dr", "Prof", "Prof. Dr", "Mx"];

function initials(name: string, fallback: string): string {
  const words = (name.trim() || fallback).split(/[\s-]+/).filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

/** The last path segment of an Overleaf Git link, used as the project's label. */
function overleafProjectLabel(url: string): string {
  return url.replace(/\/+$/, "").split("/").pop() || "Overleaf project";
}

export const ProfileDialog: React.FC<ProfileDialogProps> = ({
  profile,
  onChange,
  onClose,
  onOpenExternal,
  onImportOverleafProject,
}) => {
  const orcidLinked = profile.mode === "orcid" && Boolean(profile.orcidId);
  const [orcidOpen, setOrcidOpen] = React.useState(false);
  const [orcidInput, setOrcidInput] = React.useState(profile.orcidId);
  const [fetching, setFetching] = React.useState(false);
  const [error, setError] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const [overleafUrl, setOverleafUrl] = React.useState("");
  const [importing, setImporting] = React.useState<string | null>(null);
  const [overleafMessage, setOverleafMessage] = React.useState("");

  const patch = (part: Partial<ResearcherProfile>) => onChange({ ...profile, ...part });

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  const codename = tokenCodename(profile.token);
  const overleafProjects = (profile.externalProviders ?? []).filter(
    (connection) => connection.provider === "overleaf" && connection.projectFetchUrl,
  );

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(profile.token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const connectOrcid = async (input = orcidInput) => {
    setError("");
    if (!isValidOrcid(input)) {
      setError("Enter a valid ORCID iD, e.g. 0000-0002-1825-0097.");
      return;
    }
    setFetching(true);
    try {
      const result = await fetchOrcidProfile(input);
      const id = input.match(/\d{4}-\d{4}-\d{4}-\d{3}[\dX]/)?.[0] ?? input;
      onChange({
        ...profile,
        mode: "orcid",
        orcidId: id,
        displayName: result.name || profile.displayName,
        papers: result.papers,
        papersFetchedAt: Date.now(),
      });
      setOrcidOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reach ORCID.");
    } finally {
      setFetching(false);
    }
  };

  const unlinkOrcid = () => {
    setOrcidInput("");
    patch({ mode: "anonymous", orcidId: "", papers: [], papersFetchedAt: 0 });
  };

  const importOverleaf = async (url: string) => {
    const trimmed = url.trim();
    setOverleafMessage("");
    if (!/^https?:\/\//i.test(trimmed)) {
      setOverleafMessage("Paste the Git link from Overleaf (Menu → Git).");
      return;
    }
    if (!onImportOverleafProject) {
      setOverleafMessage("Importing from Overleaf needs the desktop app.");
      return;
    }
    setImporting(trimmed);
    try {
      await onImportOverleafProject(trimmed);
      const now = Date.now();
      const connection: ExternalProviderConnection = {
        provider: "overleaf",
        username: overleafProjectLabel(trimmed),
        displayName: profile.displayName,
        title: profile.title,
        confirmed: true,
        connectedAt: now,
        updatedAt: now,
        projectFetchUrl: trimmed,
      };
      patch({
        externalProviders: [
          ...(profile.externalProviders ?? []).filter(
            (item) => item.projectFetchUrl !== trimmed,
          ),
          connection,
        ],
      });
      setOverleafUrl("");
      setOverleafMessage("Project imported and opened.");
    } catch (err) {
      setOverleafMessage(
        err instanceof Error ? err.message : "Could not import the Overleaf project.",
      );
    } finally {
      setImporting(null);
    }
  };

  const forgetOverleafProject = (url: string) =>
    patch({
      externalProviders: (profile.externalProviders ?? []).filter(
        (item) => item.projectFetchUrl !== url,
      ),
    });

  return (
    <div className="ai-wizard-overlay" onClick={onClose}>
      <div
        className="profile-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Account"
      >
        <div className="profile-header">
          <span className="profile-title">Account</span>
          <button className="small-icon" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="profile-card">
          <span className="profile-avatar" aria-hidden="true">
            {initials(profile.displayName, codename)}
          </span>
          <div className="profile-card-main">
            <div className="profile-name-row">
              <select
                aria-label="Title"
                value={profile.title}
                onChange={(e) => patch({ title: e.target.value as AcademicTitle })}
              >
                {academicTitleOptions.map((title) => (
                  <option key={title || "none"} value={title}>
                    {title || "No title"}
                  </option>
                ))}
              </select>
              <input
                type="text"
                aria-label="Your name"
                placeholder="Your name"
                value={profile.displayName}
                onChange={(e) => patch({ displayName: e.target.value })}
              />
            </div>
            <span className="profile-card-sub">
              {orcidLinked
                ? `ORCID ${profile.orcidId} · ${profile.papers.length} paper${
                    profile.papers.length === 1 ? "" : "s"
                  }`
                : "No ORCID record imported. Your work stays on this computer."}
            </span>
          </div>
        </div>

        <div className="profile-rows">
          <div className="profile-row">
            <span className="profile-row-icon orcid" aria-hidden="true">
              iD
            </span>
            <div className="profile-row-text">
              <strong>ORCID</strong>
              <span>
                {orcidLinked
                  ? "Public record imported. Ownership has not been verified."
                  : "Import a public name and paper list for AI personalization. This does not sign you in."}
              </span>
            </div>
            {orcidLinked ? (
              <div className="profile-row-actions">
                <button
                  type="button"
                  className="ai-wizard-ghost"
                  onClick={() => void connectOrcid(profile.orcidId)}
                  disabled={fetching}
                >
                  {fetching ? (
                    <Loader2 size={13} className="spin" />
                  ) : (
                    <RefreshCw size={13} />
                  )}
                  Refresh
                </button>
                <button type="button" className="ai-wizard-ghost" onClick={unlinkOrcid}>
                  Remove record
                </button>
              </div>
            ) : orcidOpen ? null : (
              <button
                type="button"
                className="ai-wizard-primary"
                onClick={() => setOrcidOpen(true)}
              >
                Import ORCID record
              </button>
            )}
          </div>

          {!orcidLinked && orcidOpen ? (
            <div className="profile-row-form">
              <div className="profile-inline-form">
                <input
                  type="text"
                  autoFocus
                  aria-label="ORCID iD"
                  placeholder="0000-0002-1825-0097"
                  value={orcidInput}
                  onChange={(e) => setOrcidInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void connectOrcid()}
                />
                <button
                  className="ai-wizard-primary"
                  onClick={() => void connectOrcid()}
                  disabled={fetching}
                >
                  {fetching ? <Loader2 size={13} className="spin" /> : null}
                  {fetching ? "Importing…" : "Import record"}
                </button>
              </div>
              <button
                type="button"
                className="cloud-form-link"
                onClick={() => onOpenExternal?.("https://orcid.org/register")}
              >
                <ExternalLink size={12} /> No ORCID yet? Create one at orcid.org
              </button>
            </div>
          ) : null}
          {error ? (
            <div className="cloud-form-error">
              <AlertTriangle size={13} /> {error}
            </div>
          ) : null}

          {orcidLinked && profile.papers.length > 0 ? (
            <details className="profile-papers">
              <summary>
                <BookOpen size={13} /> Show my {profile.papers.length} paper
                {profile.papers.length === 1 ? "" : "s"}
              </summary>
              <ul>
                {profile.papers.map((paper, i) => (
                  <li key={i}>
                    {paper.title}
                    {paper.year ? (
                      <span className="profile-paper-year"> ({paper.year})</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="profile-row">
            <span className="profile-row-icon overleaf" aria-hidden="true">
              <FolderDown size={15} />
            </span>
            <div className="profile-row-text">
              <strong>Import from Overleaf</strong>
              <span>Paste a project’s Git link to work on it here, offline.</span>
            </div>
          </div>
          <div className="profile-row-form">
            <div className="profile-inline-form">
              <input
                type="url"
                aria-label="Overleaf Git link"
                placeholder="https://git.overleaf.com/…"
                value={overleafUrl}
                onChange={(e) => setOverleafUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void importOverleaf(overleafUrl)}
              />
              <button
                className="ai-wizard-primary"
                onClick={() => void importOverleaf(overleafUrl)}
                disabled={importing !== null || !overleafUrl.trim()}
              >
                {importing === overleafUrl.trim() ? (
                  <Loader2 size={13} className="spin" />
                ) : null}
                Import
              </button>
            </div>
            {overleafMessage ? (
              <span className="profile-note">{overleafMessage}</span>
            ) : null}
            {overleafProjects.length > 0 ? (
              <ul className="profile-projects">
                {overleafProjects.map((connection) => {
                  const url = connection.projectFetchUrl ?? "";
                  return (
                    <li key={url}>
                      <span title={url}>{overleafProjectLabel(url)}</span>
                      <button
                        type="button"
                        className="cloud-form-link"
                        disabled={importing !== null}
                        onClick={() => void importOverleaf(url)}
                      >
                        {importing === url ? (
                          <Loader2 size={11} className="spin" />
                        ) : null}
                        Fetch again
                      </button>
                      <button
                        type="button"
                        className="cloud-form-link"
                        onClick={() => forgetOverleafProject(url)}
                      >
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>

          <label className="profile-row profile-switch-row">
            <div className="profile-row-text">
              <strong>Personalize the AI</strong>
              <span>Let the assistant know your name and paper titles.</span>
            </div>
            <input
              type="checkbox"
              role="switch"
              className="profile-switch"
              aria-label="Personalize the AI"
              checked={profile.includeInContext}
              onChange={(e) => patch({ includeInContext: e.target.checked })}
            />
          </label>
        </div>

        <div className="profile-footer">
          <span>
            Anonymous ID <code title={profile.token}>{codename}</code>
          </span>
          <button
            type="button"
            className="cloud-form-link"
            onClick={() => void copyToken()}
            aria-label="Copy anonymous ID"
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            className="cloud-form-link"
            onClick={() => patch({ token: generateScholarToken() })}
            aria-label="New anonymous ID"
          >
            <RefreshCw size={11} /> New
          </button>
        </div>
      </div>
    </div>
  );
};
