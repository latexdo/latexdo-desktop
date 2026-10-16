import React, { useEffect, useRef } from "react";
import type { BuildChangeNote, ReleaseNotesDocument } from "../types";

export interface WhatsNewModalProps {
  fromVersion: string | null;
  toVersion: string;
  releases: ReleaseNotesDocument[];
  notesAvailable: boolean;
  /** Changes in this build since the one installed before the update. */
  buildChanges?: BuildChangeNote[];
  onClose: () => void;
  onViewFullNotes: () => void;
}

const buildChangeLabel: Record<BuildChangeNote["kind"], string> = {
  new: "New",
  fixed: "Fixed",
  improved: "Improved",
};

const focusableSelector =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function whatsNewHeaderText(
  fromVersion: string | null,
  releases: ReleaseNotesDocument[],
): string | null {
  if (!fromVersion) return null;
  if (releases.length > 1) {
    return `You've updated from ${fromVersion}. Here's what changed.`;
  }
  return `You've updated from ${fromVersion}.`;
}

export function WhatsNewModal({
  fromVersion,
  toVersion,
  releases,
  notesAvailable,
  buildChanges = [],
  onClose,
  onViewFullNotes,
}: WhatsNewModalProps) {
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((entry) => !entry.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && dialog.contains(active);
      if (!inside && event.shiftKey) {
        event.preventDefault();
        last.focus();
        return;
      }
      if (!inside) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const showNotes = notesAvailable && releases.length > 0;
  const headerText = whatsNewHeaderText(fromVersion, releases);

  return (
    <div
      className="whats-new-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        className="whats-new-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-dialog-title"
        tabIndex={-1}
      >
        <header className="whats-new-header">
          <h2 id="whats-new-dialog-title">What&rsquo;s new in LatexDo {toVersion}</h2>
          {headerText ? <p className="whats-new-subtitle">{headerText}</p> : null}
        </header>
        <div className="whats-new-content">
          {buildChanges.length ? (
            <section className="whats-new-release" aria-label="Changes in this update">
              <h3>In this update</h3>
              <ul className="whats-new-build-changes">
                {buildChanges.map((change, index) => (
                  <li key={`${change.kind}-${index}`}>
                    <span className={`whats-new-change-kind ${change.kind}`}>
                      {buildChangeLabel[change.kind]}
                    </span>
                    <span>{change.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {showNotes ? (
            releases.map((release, index) => (
              <WhatsNewReleaseSection
                key={release.version}
                release={release}
                prominent={index === 0}
              />
            ))
          ) : (
            <div className="whats-new-fallback">
              <p>
                <strong>LatexDo {toVersion} is installed.</strong>
              </p>
              {fromVersion ? (
                <p>You&rsquo;ve successfully updated from {fromVersion}.</p>
              ) : null}
              <p>Release notes aren&rsquo;t available right now.</p>
            </div>
          )}
        </div>
        <footer className="whats-new-footer">
          <button
            type="button"
            className="dialog-cancel"
            onClick={onViewFullNotes}
            disabled={!showNotes}
          >
            View full release notes
          </button>
          <button
            type="button"
            className="dialog-submit whats-new-continue"
            onClick={onClose}
            autoFocus
          >
            Continue
          </button>
        </footer>
      </section>
    </div>
  );
}

function WhatsNewReleaseSection({
  release,
  prominent,
}: {
  release: ReleaseNotesDocument;
  prominent: boolean;
}) {
  return (
    <section className="whats-new-release" aria-label={`Release ${release.version}`}>
      <h3
        className={
          prominent
            ? "whats-new-release-title whats-new-release-title--current"
            : "whats-new-release-title"
        }
      >
        LatexDo {release.version}
      </h3>
      {release.summary ? (
        <p className="whats-new-release-summary">{release.summary}</p>
      ) : null}
      {release.highlights.length > 0 ? (
        <ul className="whats-new-highlights">
          {release.highlights.map((highlight) => (
            <li key={highlight.id} className="whats-new-highlight">
              <strong>{highlight.title}</strong>
              {highlight.description ? <span>{highlight.description}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {release.fixes && release.fixes.length > 0 ? (
        <ul className="whats-new-fixes">
          {release.fixes.map((fix, index) => (
            <li key={`${release.version}-fix-${index}`}>{fix}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
