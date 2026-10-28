import { supportLatexDoUrl } from "../../features/settings/settings";
import { Check, Download, Heart, LoaderCircle, RefreshCw } from "lucide-react";
import { defaultSettings } from "../../features/settings/settings";
import type { AppCtx } from "../appContext";
import mitLicense from "../../../LICENSE?raw";

export function renderSettingsSectionHeading11(ctx: AppCtx) {
  const { setSettings, settings } = ctx;
  return (
    <>
      <div className="settings-section-heading">
        <strong>PDF Compliance Report</strong>
        <span>
          Check compiled PDF against conference guidelines and best practices.
        </span>
      </div>

      <label className="settings-row settings-toggle">
        <span>
          <strong>Enable PDF compliance checks</strong>
          <small>Run compliance checks after each compilation.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.pdfComplianceEnabled}
          onChange={(event) =>
            setSettings((c) => ({
              ...c,
              pdfComplianceEnabled: event.target.checked,
            }))
          }
        />
      </label>

      <div className="settings-section-subheading">Page count</div>

      <label className="settings-row settings-toggle">
        <span>
          <strong>Check page count</strong>
          <small>Warn if the PDF exceeds the page limit.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.checkPageCount}
          onChange={(event) =>
            setSettings((c) => ({
              ...c,
              checkPageCount: event.target.checked,
            }))
          }
        />
      </label>

      <label className="settings-row">
        <span>
          <strong>Maximum pages</strong>
          <small>Conference page limit.</small>
        </span>
        <input
          type="number"
          className="settings-number-input"
          min={1}
          max={100}
          value={settings.maxPages}
          onChange={(event) =>
            setSettings((c) => ({
              ...c,
              maxPages: parseInt(event.target.value, 10) || 8,
            }))
          }
        />
      </label>

      <div className="settings-section-subheading">Figures</div>

      <label className="settings-row settings-toggle">
        <span>
          <strong>Check unreferenced figures</strong>
          <small>Detect figures that have no \\ref{} in text.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.checkUnreferencedFigures}
          onChange={(event) =>
            setSettings((c) => ({
              ...c,
              checkUnreferencedFigures: event.target.checked,
            }))
          }
        />
      </label>

      <div className="settings-section-subheading">Citations</div>

      <label className="settings-row settings-toggle">
        <span>
          <strong>Check uncited citations</strong>
          <small>Detect bibliography entries never cited in text.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.checkUncitedCitations}
          onChange={(event) =>
            setSettings((c) => ({
              ...c,
              checkUncitedCitations: event.target.checked,
            }))
          }
        />
      </label>

      <label className="settings-row settings-toggle">
        <span>
          <strong>Check sections with no citations</strong>
          <small>Flag sections that lack any citations.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.checkSectionsWithNoCitations}
          onChange={(event) =>
            setSettings((c) => ({
              ...c,
              checkSectionsWithNoCitations: event.target.checked,
            }))
          }
        />
      </label>

      <div className="settings-section-subheading">Fonts</div>

      <label className="settings-row settings-toggle">
        <span>
          <strong>Check for Type 3 fonts</strong>
          <small>Warn if the PDF uses bitmap fonts.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.checkType3Fonts}
          onChange={(event) =>
            setSettings((c) => ({
              ...c,
              checkType3Fonts: event.target.checked,
            }))
          }
        />
      </label>

      <div className="settings-section-subheading">Abstract</div>

      <label className="settings-row settings-toggle">
        <span>
          <strong>Check abstract word count</strong>
          <small>Warn if abstract exceeds the recommended limit.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.checkAbstractWordCount}
          onChange={(event) =>
            setSettings((c) => ({
              ...c,
              checkAbstractWordCount: event.target.checked,
            }))
          }
        />
      </label>

      <label className="settings-row">
        <span>
          <strong>Max abstract words</strong>
          <small>Recommended abstract word limit.</small>
        </span>
        <input
          type="number"
          className="settings-number-input"
          min={50}
          max={500}
          value={settings.maxAbstractWords}
          onChange={(event) =>
            setSettings((c) => ({
              ...c,
              maxAbstractWords: parseInt(event.target.value, 10) || 250,
            }))
          }
        />
      </label>
    </>
  );
}

export function renderSettingsSectionHeading12(ctx: AppCtx) {
  const {
    openExternalLink,
    checkForUpdates,
    checkingUpdates,
    updateNow,
    updateProgressActive,
    updatingNow,
  } = ctx;
  const updateInfo = ctx.updateInfo!;
  const updateProgressLabel = ctx.updateProgressLabel!;
  const updateProgressPercent = ctx.updateProgressPercent!;
  const updateAvailable = Boolean(updateInfo?.updateAvailable);
  const busy = checkingUpdates || updatingNow;
  const status =
    updateProgressActive && updateProgressLabel
      ? updateProgressLabel
      : (updateInfo?.error ??
        (updateInfo ? `LatexDo ${updateInfo.currentVersion}` : null));
  return (
    <>
      <div className="settings-section-heading">
        <strong>About LatexDo</strong>
        <span>A focused workspace for LaTeX writing and research.</span>
      </div>

      <section className="settings-about-card" aria-label="Ownership and licence">
        <h3>Built and maintained by the LatexDo Association</h3>
        <p>
          LatexDo is developed, maintained, and owned by the LatexDo Association, a
          French nonprofit association dedicated to supporting scientific writing and
          research.
        </p>
        <p className="settings-about-copyright">
          © 2026 LatexDo Association. Released under the MIT License.
        </p>
        <p>
          LatexDo is free and open-source software. You may use, copy, modify, and
          distribute it, including for commercial purposes, under the terms of the MIT
          License below. Third-party components remain the property of their respective
          copyright holders and are subject to their own licences.
        </p>
        <details className="settings-about-license">
          <summary>Read the MIT License</summary>
          <pre>{mitLicense.trim()}</pre>
        </details>
      </section>

      <div className="settings-section-heading">
        <strong>Updates</strong>
      </div>

      <div className="settings-row update-row">
        <span>
          <strong>
            {updateAvailable
              ? `Version ${updateInfo.latestVersion} is available`
              : "LatexDo updates"}
          </strong>
          {status ? <small>{status}</small> : null}
          {updateProgressActive ? (
            <div
              className={`update-progress-bar settings-update-progress ${
                updateProgressPercent === null ? "is-indeterminate" : ""
              }`}
              role="progressbar"
              aria-label="Update download progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={
                updateProgressPercent === null
                  ? undefined
                  : Math.round(updateProgressPercent)
              }
            >
              <span
                style={
                  updateProgressPercent === null
                    ? undefined
                    : { width: `${updateProgressPercent}%` }
                }
              />
            </div>
          ) : null}
        </span>
        <div className="settings-update-actions">
          <button
            type="button"
            className={updateAvailable ? "dialog-submit" : "dialog-cancel"}
            onClick={() => void (updateAvailable ? updateNow() : checkForUpdates())}
            disabled={busy}
            title={updateAvailable ? undefined : "Check again"}
          >
            {busy ? (
              <LoaderCircle size={13} className="spin" />
            ) : updateAvailable ? (
              <Download size={13} />
            ) : updateInfo && !updateInfo.error ? (
              <Check size={13} />
            ) : (
              <RefreshCw size={13} />
            )}
            {updatingNow
              ? "Updating…"
              : checkingUpdates
                ? "Checking…"
                : updateAvailable
                  ? "Update"
                  : updateInfo && !updateInfo.error
                    ? "You’re up to date"
                    : "Check for updates"}
          </button>
          <button
            type="button"
            className="dialog-cancel"
            onClick={() => openExternalLink(supportLatexDoUrl)}
          >
            <Heart size={13} />
            Donate
          </button>
        </div>
      </div>
    </>
  );
}

export function renderSettingsFooter(ctx: AppCtx) {
  const { setEngine, setSettings, setSettingsOpen } = ctx;
  return (
    <div className="settings-footer">
      <button
        type="button"
        className="dialog-cancel"
        onClick={() => {
          setSettings((current) => ({
            ...defaultSettings,
            legalAccepted: current.legalAccepted,
            legalAcceptedAt: current.legalAcceptedAt,
            legalPolicyVersion: current.legalPolicyVersion,
          }));
          setEngine(defaultSettings.defaultEngine);
        }}
      >
        Reset defaults
      </button>
      <button
        type="button"
        className="dialog-submit"
        onClick={() => setSettingsOpen(false)}
      >
        Done
      </button>
    </div>
  );
}
