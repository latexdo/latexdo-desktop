import {
  AlertTriangle,
  Check,
  CircleAlert,
  ExternalLink,
  KeyRound,
  LoaderCircle,
} from "lucide-react";
import { layoutPresetInfo } from "../../features/ai/aiConfig";
import type { Engine } from "../../types";
import {
  boundedInteger,
  defaultSettings,
  maxProjectTreeDepth,
  maxProjectTreeEntries,
  minProjectTreeDepth,
  minProjectTreeEntries,
  parseProjectTreeIgnoredNamesText,
} from "../../features/settings/settings";
import { supportsProofreading } from "../../features/proofreading/proofreading";
import { WorkspaceLayoutPreview } from "../appShared";
import { ThemePicker } from "../../components/ThemePicker";
import type { AppCtx } from "../appContext";

export function renderCloudForm(ctx: AppCtx) {
  const {
    aiConfig,
    clearSettingsCloudKey,
    cloudConnectionMessage,
    cloudConnectionState,
    openExternalLink,
    patchCloudConfig,
    saveSettingsCloudKey,
    setSettingsCloudKey,
    setSettingsCloudKeyError,
    settingsCloudKey,
    settingsCloudKeyError,
    settingsCloudKeySaving,
    showCloudBaseUrl,
    testCloudConnection,
  } = ctx;
  const selectedCloudProvider = ctx.selectedCloudProvider!;
  return (
    <div className="cloud-form ai-provider-form ai-provider-settings">
      <div className="cloud-form-field">
        <span>API key</span>
        {aiConfig.cloud.credentialConfigured && !settingsCloudKey ? (
          <div className="cloud-form-saved">
            <KeyRound size={13} />
            <span>Stored in the OS credential store</span>
            <button
              type="button"
              className="cloud-form-link"
              onClick={() => void clearSettingsCloudKey()}
            >
              Remove
            </button>
          </div>
        ) : (
          <div className="cloud-form-key-row">
            <input
              type="password"
              placeholder="Paste your API key"
              aria-label="API key"
              value={settingsCloudKey}
              autoComplete="off"
              onChange={(event) => {
                setSettingsCloudKey(event.target.value);
                setSettingsCloudKeyError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void saveSettingsCloudKey();
                }
              }}
            />
            {settingsCloudKey ? (
              <button
                type="button"
                className="ai-wizard-ghost"
                onClick={() => void saveSettingsCloudKey()}
                disabled={settingsCloudKeySaving}
              >
                {settingsCloudKeySaving ? (
                  <LoaderCircle size={13} className="spin" />
                ) : (
                  <Check size={13} />
                )}
                Save
              </button>
            ) : null}
          </div>
        )}
      </div>
      {settingsCloudKeyError ? (
        <span className="cloud-form-error">
          <AlertTriangle size={13} /> {settingsCloudKeyError}
        </span>
      ) : null}
      {selectedCloudProvider?.apiKeyUrl ? (
        <button
          type="button"
          className="cloud-form-link"
          onClick={() => openExternalLink(selectedCloudProvider.apiKeyUrl)}
        >
          <ExternalLink size={12} /> Get API key
        </button>
      ) : null}
      {showCloudBaseUrl ? (
        <label className="cloud-form-field">
          <span>Base URL</span>
          <input
            type="text"
            value={aiConfig.cloud.baseUrl}
            onChange={(event) => patchCloudConfig({ baseUrl: event.target.value })}
          />
        </label>
      ) : null}
      <div className="cloud-form-test">
        <button
          type="button"
          className="ai-wizard-ghost"
          onClick={() => void testCloudConnection()}
          disabled={
            (!aiConfig.cloud.credentialConfigured && !settingsCloudKey.trim()) ||
            !aiConfig.cloud.model ||
            cloudConnectionState === "testing"
          }
        >
          {cloudConnectionState === "testing" ? (
            <>
              <LoaderCircle size={13} className="spin" /> Testing
            </>
          ) : (
            <>
              <Check size={13} /> Test
            </>
          )}
        </button>
        {cloudConnectionMessage && (
          <span
            className={
              cloudConnectionState === "error" ? "cloud-form-error" : "cloud-form-ok"
            }
          >
            {cloudConnectionMessage}
          </span>
        )}
      </div>
    </div>
  );
}

export function renderCloudForm2(ctx: AppCtx) {
  const { aiConfig, ollamaModelFetchMessage, ollamaModelFetchState, setAiConfig } = ctx;
  return (
    <div className="cloud-form ai-provider-form ai-provider-settings">
      <label className="cloud-form-field">
        <span>Base URL</span>
        <input
          type="url"
          value={aiConfig.ollamaBaseUrl}
          onChange={(event) =>
            setAiConfig((c) => ({
              ...c,
              ollamaBaseUrl: event.target.value,
              selection: {
                mode: "custom",
                custom: {
                  kind: "ollama",
                  baseUrl: event.target.value,
                  model: c.ollamaModel,
                },
              },
            }))
          }
        />
      </label>
      {ollamaModelFetchMessage && (
        <span
          className={
            ollamaModelFetchState === "unavailable"
              ? "cloud-form-error"
              : "cloud-form-ok"
          }
        >
          {ollamaModelFetchMessage}
        </span>
      )}
    </div>
  );
}

export function renderSettingsSectionHeading(ctx: AppCtx) {
  const {
    aiConfig,
    chooseWorkspacePreset,
    resolvedAppearance,
    setEngine,
    setSettings,
    settings,
  } = ctx;
  return (
    <>
      <div className="settings-section-heading">
        <strong>Appearance</strong>
        <span>How the whole app looks: windows, panels, the editor and dialogs.</span>
      </div>

      <div className="settings-row settings-row-stack">
        <span>
          <strong>Theme</strong>
          <small>Each theme is a complete look for the app and the editor.</small>
        </span>
        <ThemePicker
          colorTheme={settings.colorTheme}
          appearance={resolvedAppearance}
          onChoose={(colorTheme, appearanceMode) =>
            setSettings((current) => ({ ...current, colorTheme, appearanceMode }))
          }
        />
      </div>

      <div className="settings-row settings-row-stack">
        <span>
          <strong>Workspace layout</strong>
          <small>Apply the same Focus, Balanced, or Power workspace from setup.</small>
        </span>
        <div
          className="settings-workspace-grid"
          role="radiogroup"
          aria-label="Workspace layout"
        >
          {layoutPresetInfo.map((preset) => {
            const selected = aiConfig.layoutPreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                className={`settings-workspace-card ${selected ? "active" : ""}`}
                onClick={() => chooseWorkspacePreset(preset.id)}
                role="radio"
                aria-checked={selected}
              >
                <WorkspaceLayoutPreview preset={preset.id} />
                <span className="settings-workspace-card-copy">
                  <strong>{preset.name}</strong>
                  <small>{preset.description}</small>
                </span>
                {selected ? (
                  <span className="settings-workspace-selected">
                    <Check size={12} /> Active
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="settings-section-heading">
        <strong>Editor and compiler</strong>
        <span>Configure how LaTeX source is edited and built.</span>
      </div>

      <label className="settings-row">
        <span>
          <strong>Default compiler</strong>
          <small>Used for the current and future projects.</small>
        </span>
        <select
          value={settings.defaultEngine}
          onChange={(event) => {
            const defaultEngine = event.target.value as Engine;
            setSettings((current) => ({
              ...current,
              defaultEngine,
            }));
            setEngine(defaultEngine);
          }}
        >
          <option value="pdflatex">pdfLaTeX</option>
          <option value="xelatex">XeLaTeX</option>
          <option value="lualatex">LuaLaTeX</option>
        </select>
      </label>

      <label className="settings-row settings-toggle">
        <span>
          <strong>Live preview</strong>
          <small>Compile automatically after source edits.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.livePreview}
          onChange={(event) =>
            setSettings((current) => ({
              ...current,
              livePreview: event.target.checked,
            }))
          }
        />
      </label>

      <label className="settings-row">
        <span>
          <strong>Editor font size</strong>
          <small className="settings-value">{settings.editorFontSize}px</small>
        </span>
        <input
          type="range"
          min="11"
          max="22"
          step="0.5"
          value={settings.editorFontSize}
          onChange={(event) =>
            setSettings((current) => ({
              ...current,
              editorFontSize: Number(event.target.value),
            }))
          }
        />
      </label>

      <label className="settings-row settings-toggle">
        <span>
          <strong>Word wrap</strong>
          <small>Wrap long source lines inside the editor.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.wordWrap}
          onChange={(event) =>
            setSettings((current) => ({
              ...current,
              wordWrap: event.target.checked,
            }))
          }
        />
      </label>

      <label className="settings-row settings-toggle">
        <span>
          <strong>Word completion</strong>
          <small>
            Suggest words as you type, from your project first and then common English
            words. Tab or Enter accepts.
          </small>
        </span>
        <input
          type="checkbox"
          checked={settings.wordCompletion}
          onChange={(event) =>
            setSettings((current) => ({
              ...current,
              wordCompletion: event.target.checked,
            }))
          }
        />
      </label>

      <label className="settings-row settings-toggle">
        <span>
          <strong>Intelligent completion</strong>
          <small>
            AI text that continues your sentence and predictions of repeat edits. Off by
            default; needs an AI model.
          </small>
        </span>
        <input
          type="checkbox"
          checked={settings.intelligentCompletion}
          onChange={(event) =>
            setSettings((current) => ({
              ...current,
              intelligentCompletion: event.target.checked,
            }))
          }
        />
      </label>

      <label className="settings-row settings-toggle">
        <span>
          <strong>Minimap</strong>
          <small>Show the source overview beside the editor.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.minimap}
          onChange={(event) =>
            setSettings((current) => ({
              ...current,
              minimap: event.target.checked,
            }))
          }
        />
      </label>

      <label className="settings-row settings-toggle">
        <span>
          <strong>Inline Git blame</strong>
          <small>
            Show who last changed the current line, with commit details on hover.
          </small>
        </span>
        <input
          type="checkbox"
          checked={settings.inlineBlame}
          onChange={(event) =>
            setSettings((current) => ({
              ...current,
              inlineBlame: event.target.checked,
            }))
          }
        />
      </label>

      <label className="settings-row settings-toggle">
        <span>
          <strong>Show raw LaTeX source</strong>
          <small>
            When off, LaTeX commands are faded so only document text is visible.
          </small>
        </span>
        <input
          type="checkbox"
          checked={settings.showRawLatex}
          onChange={(event) =>
            setSettings((current) => ({
              ...current,
              showRawLatex: event.target.checked,
            }))
          }
        />
      </label>

      <div className="settings-section-heading">
        <strong>Project tree</strong>
        <span>Control which folders are scanned when opening projects.</span>
      </div>

      <div className="settings-row settings-row-stack">
        <span>
          <strong>Ignored folders and files</strong>
          <small>One name per line. Names apply anywhere in the project tree.</small>
        </span>
        <textarea
          className="settings-textarea project-tree-ignore-input"
          value={settings.projectTreeIgnoredNames.join("\n")}
          onChange={(event) =>
            setSettings((current) => ({
              ...current,
              projectTreeIgnoredNames: parseProjectTreeIgnoredNamesText(
                event.target.value,
              ),
            }))
          }
          spellCheck={false}
          aria-label="Ignored project tree names"
        />
      </div>

      <div className="settings-row settings-row-stack">
        <span>
          <strong>Tree limits</strong>
          <small>Caps prevent huge folders from blocking project listing.</small>
        </span>
        <div className="project-tree-limit-grid">
          <label>
            <span>Max depth</span>
            <input
              type="number"
              className="settings-number-input"
              min={minProjectTreeDepth}
              max={maxProjectTreeDepth}
              value={settings.projectTreeMaxDepth}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  projectTreeMaxDepth: boundedInteger(
                    Number(event.target.value),
                    defaultSettings.projectTreeMaxDepth,
                    minProjectTreeDepth,
                    maxProjectTreeDepth,
                  ),
                }))
              }
            />
          </label>
          <label>
            <span>Max entries</span>
            <input
              type="number"
              className="settings-number-input settings-wide-number-input"
              min={minProjectTreeEntries}
              max={maxProjectTreeEntries}
              step={100}
              value={settings.projectTreeMaxEntries}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  projectTreeMaxEntries: boundedInteger(
                    Number(event.target.value),
                    defaultSettings.projectTreeMaxEntries,
                    minProjectTreeEntries,
                    maxProjectTreeEntries,
                  ),
                }))
              }
            />
          </label>
        </div>
      </div>
    </>
  );
}

export function renderSettingsSectionHeading2(ctx: AppCtx) {
  const {
    addSpellCheckerWord,
    clearSpellCheckerWords,
    filteredSpellCheckerLanguages,
    proofreadingError,
    proofreadingLoading,
    removeSpellCheckerWord,
    runProofreading,
    saveProofreadingSettings,
    setProofreadingSettings,
    setSpellCheckerLanguageQuery,
    setSpellCheckerWordDraft,
    spellCheckerError,
    spellCheckerLanguageQuery,
    spellCheckerLoading,
    spellCheckerSettings,
    spellCheckerWordDraft,
    toggleSpellCheckerEnabled,
    toggleSpellCheckerLanguage,
  } = ctx;
  const activeTextDocument = ctx.activeTextDocument!;
  const proofreadingResult = ctx.proofreadingResult!;
  const proofreadingSettings = ctx.proofreadingSettings!;
  return (
    <>
      <div className="settings-section-heading">
        <strong>Language assistance</strong>
        <span>Spelling, custom vocabulary, grammar, and style.</span>
      </div>

      <label className="settings-row settings-toggle">
        <span>
          <strong>Check spelling while typing</strong>
          <small>Show misspellings directly in editable inputs across the app.</small>
        </span>
        <input
          type="checkbox"
          checked={spellCheckerSettings?.enabled ?? true}
          onChange={(event) => toggleSpellCheckerEnabled(event.target.checked)}
          disabled={spellCheckerLoading || !spellCheckerSettings}
        />
      </label>

      <div className="settings-row settings-row-stack">
        <span>
          <strong>Spell checker languages</strong>
          <small>
            {spellCheckerSettings?.usesSystemLanguage
              ? "macOS uses the native spell checker and automatically detects language."
              : "Choose one or more dictionaries for Windows and Linux spell checking."}
          </small>
        </span>
        {spellCheckerSettings?.usesSystemLanguage ? (
          <div className="spellchecker-note">
            Language selection is controlled by the system spell checker on macOS.
          </div>
        ) : (
          <div className="spellchecker-language-panel">
            <input
              type="text"
              value={spellCheckerLanguageQuery}
              onChange={(event) => setSpellCheckerLanguageQuery(event.target.value)}
              placeholder="Filter languages"
              spellCheck={false}
              disabled={spellCheckerLoading || !spellCheckerSettings}
            />
            <div className="spellchecker-language-list">
              {filteredSpellCheckerLanguages.length ? (
                filteredSpellCheckerLanguages.map((language) => (
                  <label key={language} className="spellchecker-language-option">
                    <input
                      type="checkbox"
                      checked={
                        spellCheckerSettings?.languages.includes(language) ?? false
                      }
                      onChange={() => toggleSpellCheckerLanguage(language)}
                      disabled={spellCheckerLoading || !spellCheckerSettings}
                    />
                    <span>{language}</span>
                  </label>
                ))
              ) : (
                <div className="spellchecker-note compact">
                  No language matches that filter.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="settings-row settings-row-stack">
        <span>
          <strong>Custom words</strong>
          <small>
            Add project-specific terms, package names, and citation keys so they stop
            showing as misspellings. Proofreading and the AI treat them as correctly
            spelled.
          </small>
        </span>
        <form className="spellchecker-word-form" onSubmit={addSpellCheckerWord}>
          <input
            type="text"
            value={spellCheckerWordDraft}
            onChange={(event) => setSpellCheckerWordDraft(event.target.value)}
            placeholder="Add a custom word"
            spellCheck={false}
            disabled={spellCheckerLoading || !spellCheckerSettings}
          />
          <button
            type="submit"
            className="dialog-submit"
            disabled={spellCheckerLoading || !spellCheckerSettings}
          >
            Add word
          </button>
        </form>
        <div className="spellchecker-chip-list">
          {(spellCheckerSettings?.customWords ?? []).length ? (
            (spellCheckerSettings?.customWords ?? []).map((word) => (
              <span key={word} className="spellchecker-chip">
                {word}
                <button
                  type="button"
                  className="spellchecker-chip-remove"
                  onClick={() => removeSpellCheckerWord(word)}
                  disabled={spellCheckerLoading}
                  aria-label={`Remove "${word}" from the dictionary`}
                  title="Remove"
                >
                  ×
                </button>
              </span>
            ))
          ) : (
            <div className="spellchecker-note compact">No custom words added yet.</div>
          )}
        </div>
        {(spellCheckerSettings?.customWords ?? []).length ? (
          <button
            type="button"
            className="spellchecker-clear-words"
            onClick={clearSpellCheckerWords}
            disabled={spellCheckerLoading}
          >
            Remove all
          </button>
        ) : null}
      </div>

      <label className="settings-row settings-toggle">
        <span>
          <strong>Grammar and style checking</strong>
          <small>
            Run LanguageTool-compatible proofreading on natural-language text while
            ignoring LaTeX commands, math, and citations.
          </small>
        </span>
        <input
          type="checkbox"
          checked={proofreadingSettings?.enabled ?? true}
          onChange={(event) => {
            if (!proofreadingSettings) return;
            void saveProofreadingSettings(
              { ...proofreadingSettings, enabled: event.target.checked },
              event.target.checked
                ? "Grammar checker enabled"
                : "Grammar checker disabled",
            );
          }}
          disabled={!proofreadingSettings}
        />
      </label>

      <div className="settings-row settings-row-stack">
        <span>
          <strong>Proofreading service</strong>
          <small>
            Use the public LanguageTool API by default, or point LatexDo to your own
            compatible server.
          </small>
        </span>
        <div className="spellchecker-language-panel">
          <input
            type="text"
            value={proofreadingSettings?.serverUrl ?? ""}
            onChange={(event) => {
              setProofreadingSettings((current) =>
                current ? { ...current, serverUrl: event.target.value } : current,
              );
            }}
            placeholder="https://api.languagetool.org/v2/check"
            spellCheck={false}
            disabled={!proofreadingSettings}
          />
          <div className="spellchecker-grid">
            <label className="spellchecker-field">
              <span>Language</span>
              <select
                value={proofreadingSettings?.language ?? "auto"}
                onChange={(event) => {
                  setProofreadingSettings((current) =>
                    current ? { ...current, language: event.target.value } : current,
                  );
                }}
                disabled={!proofreadingSettings}
              >
                <option value="auto">Automatic</option>
                <option value="en-US">English (US)</option>
                <option value="en-GB">English (UK)</option>
                <option value="fr">French</option>
                <option value="de">German</option>
                <option value="es">Spanish</option>
                <option value="it">Italian</option>
                <option value="pt">Portuguese</option>
              </select>
            </label>
            <label className="spellchecker-field">
              <span>Mother tongue</span>
              <input
                type="text"
                value={proofreadingSettings?.motherTongue ?? ""}
                onChange={(event) => {
                  setProofreadingSettings((current) =>
                    current
                      ? { ...current, motherTongue: event.target.value }
                      : current,
                  );
                }}
                placeholder="Optional, e.g. en"
                spellCheck={false}
                disabled={!proofreadingSettings}
              />
            </label>
          </div>
          <label className="spellchecker-inline-toggle">
            <input
              type="checkbox"
              checked={proofreadingSettings?.picky ?? false}
              onChange={(event) => {
                setProofreadingSettings((current) =>
                  current ? { ...current, picky: event.target.checked } : current,
                );
              }}
              disabled={!proofreadingSettings}
            />
            <span>Enable picky mode for stricter style suggestions</span>
          </label>
          <div className="settings-update-actions">
            <button
              type="button"
              className="dialog-cancel"
              onClick={() => {
                if (!proofreadingSettings) return;
                void saveProofreadingSettings(
                  proofreadingSettings,
                  "Proofreading settings saved",
                );
              }}
              disabled={!proofreadingSettings}
            >
              Save grammar settings
            </button>
            <button
              type="button"
              className="dialog-submit"
              onClick={() => void runProofreading()}
              disabled={
                !proofreadingSettings ||
                !proofreadingSettings.enabled ||
                proofreadingLoading ||
                !activeTextDocument ||
                !supportsProofreading(activeTextDocument.name)
              }
            >
              {proofreadingLoading ? "Checking..." : "Proofread now"}
            </button>
          </div>
          <div className="spellchecker-note compact">
            {!proofreadingSettings?.enabled
              ? "Proofreading is disabled. Enable grammar and style checking to run suggestions."
              : proofreadingResult?.error
                ? proofreadingResult.error
                : proofreadingResult?.output
                  ? proofreadingResult.output
                  : "Suggestions appear inline in the editor and in the Problems panel."}
          </div>
        </div>
      </div>

      {spellCheckerError ? (
        <div className="settings-row settings-row-stack settings-inline-error">
          <div className="dialog-error">
            <CircleAlert size={14} />
            {spellCheckerError}
          </div>
        </div>
      ) : null}
      {proofreadingError ? (
        <div className="settings-row settings-row-stack settings-inline-error">
          <div className="dialog-error">
            <CircleAlert size={14} />
            {proofreadingError}
          </div>
        </div>
      ) : null}
    </>
  );
}
