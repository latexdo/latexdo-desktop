// Voice dictation settings, shown in the AI tab of Settings.
//
// One plain choice first (on this computer, or OpenAI), then the few options
// people change. Running your own speech server is tucked under Advanced.
// Changes save as soon as a field is committed.

import React from "react";
import type { AiConfig } from "../features/ai/aiConfig";
import { LocalSpeechInstallCard } from "./LocalSpeechInstallCard";
import { createTranscriptCleanup } from "../features/voice/transcriptCleanup";
import { useVoiceSettings } from "../features/voice/useVoiceSettings";
import { useLocalSpeechInstall } from "../features/voice/useLocalSpeechInstall";
import { Check, Cloud, Laptop, PlugZap } from "lucide-react";
import {
  detectLocalTranscriptionServers,
  type LocalTranscriptionServer,
} from "../features/voice/localTranscriptionDetection";
import {
  defaultLocalTranscriptionBaseUrl,
  normalizeVoiceSettings,
  type VoiceSettings,
} from "../features/voice/voiceSettings";

interface VoiceSettingsPanelProps {
  settings: VoiceSettings;
  onSave(next: VoiceSettings): void;
  aiEnhancementAvailable?: boolean;
}

const cloudModels: Array<[string, string]> = [
  ["gpt-4o-transcribe", "gpt-4o-transcribe — most accurate"],
  ["gpt-4o-mini-transcribe", "gpt-4o-mini-transcribe — faster and cheaper"],
  ["gpt-transcribe", "gpt-transcribe"],
  ["whisper-1", "whisper-1"],
];

export const VoiceSettingsPanel: React.FC<VoiceSettingsPanelProps> = ({
  settings,
  onSave,
  aiEnhancementAvailable = true,
}) => {
  const [endpoint, setEndpoint] = React.useState(settings.sttBaseUrl);
  const [model, setModel] = React.useState(settings.transcriptionModel);
  const [detecting, setDetecting] = React.useState(false);
  const [detected, setDetected] = React.useState<LocalTranscriptionServer[] | null>(
    null,
  );

  React.useEffect(() => {
    setEndpoint(settings.sttBaseUrl);
    setModel(settings.transcriptionModel);
  }, [settings.sttBaseUrl, settings.transcriptionModel]);

  const localSpeech = useLocalSpeechInstall();
  const refreshLocalSpeech = localSpeech.refresh;
  React.useEffect(() => {
    void refreshLocalSpeech();
  }, [refreshLocalSpeech]);

  const save = (patch: Partial<VoiceSettings>) => {
    const next = normalizeVoiceSettings({ ...settings, ...patch });
    onSave(next);
    // Show the normalized value (e.g. a remote URL falls back to local).
    setEndpoint(next.sttBaseUrl);
    setModel(next.transcriptionModel);
  };

  const runDetection = async () => {
    setDetecting(true);
    setDetected(null);
    try {
      setDetected(await detectLocalTranscriptionServers());
    } finally {
      setDetecting(false);
    }
  };

  const local = settings.sttMode === "local";
  const customServer =
    settings.sttBaseUrl.replace(/\/$/, "") !== defaultLocalTranscriptionBaseUrl;
  const phase = localSpeech.state.phase;
  const localStatus =
    phase === "installed"
      ? "Installed"
      : phase === "installing"
        ? "Installing…"
        : phase === "missing" || phase === "failed"
          ? "Not installed"
          : null;

  return (
    <div className="voice-settings-panel">
      <div className="settings-section-heading">
        <strong>Voice dictation</strong>
        <span>
          Talk to the AI instead of typing: press the microphone, speak, then ■ to edit
          the text or ↑ to send it.
        </span>
      </div>

      <div className="voice-settings-group">
        <span className="voice-settings-label" id="voice-engine-label">
          Speech recognition
        </span>
        <div
          className="voice-settings-choices"
          role="group"
          aria-labelledby="voice-engine-label"
        >
          <button
            type="button"
            className={`voice-settings-choice${local ? " active" : ""}`}
            aria-pressed={local}
            onClick={() => !local && save({ sttMode: "local" })}
          >
            <Laptop size={18} aria-hidden="true" />
            <span className="voice-settings-choice-text">
              <strong>
                On this computer
                {localStatus && !customServer ? (
                  <em className={phase === "installed" ? "ok" : undefined}>
                    {phase === "installed" ? (
                      <Check size={11} aria-hidden="true" />
                    ) : null}
                    {localStatus}
                  </em>
                ) : null}
              </strong>
              <small>
                Private and works offline. Your voice never leaves this computer.
              </small>
            </span>
          </button>
          <button
            type="button"
            className={`voice-settings-choice${!local ? " active" : ""}`}
            aria-pressed={!local}
            onClick={() => local && save({ sttMode: "openai" })}
          >
            <Cloud size={18} aria-hidden="true" />
            <span className="voice-settings-choice-text">
              <strong>OpenAI</strong>
              <small>
                Fast on any computer. Recordings are sent to OpenAI with your API key.
              </small>
            </span>
          </button>
        </div>

        {local && !customServer && phase !== "installed" ? (
          <LocalSpeechInstallCard
            state={localSpeech.state}
            onInstall={() => void localSpeech.install()}
          />
        ) : null}

        {!local ? (
          <label className="settings-row">
            <span>
              <strong>Model</strong>
            </span>
            <select
              aria-label="OpenAI speech model"
              value={settings.cloudTranscriptionModel}
              onChange={(e) => save({ cloudTranscriptionModel: e.target.value })}
            >
              {cloudModels.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <label className="settings-row settings-toggle">
        <span>
          <strong>Clean up what I say</strong>
          <small>
            {aiEnhancementAvailable
              ? "Fixes punctuation and removes filler words like “um” with your local AI."
              : "Choose a local LatexDo AI model in AI settings to turn this on."}
          </small>
        </span>
        <input
          type="checkbox"
          aria-label="Clean up what I say"
          checked={settings.transcriptMode === "clean" && aiEnhancementAvailable}
          disabled={!aiEnhancementAvailable}
          onChange={(e) =>
            save({ transcriptMode: e.target.checked ? "clean" : "verbatim" })
          }
        />
      </label>

      {local ? (
        <details className="voice-settings-advanced" open={customServer || undefined}>
          <summary>Advanced: use your own speech server</summary>
          <p className="settings-hint compact">
            For a speech server you run yourself, such as whisper.cpp or faster-whisper,
            with an OpenAI-compatible API on this computer.
          </p>

          <label className="settings-row">
            <span>
              <strong>Server address</strong>
            </span>
            <span className="voice-settings-inline">
              <input
                type="text"
                aria-label="Speech server"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                onBlur={() =>
                  endpoint !== settings.sttBaseUrl && save({ sttBaseUrl: endpoint })
                }
                placeholder={defaultLocalTranscriptionBaseUrl}
                spellCheck={false}
              />
              <button
                type="button"
                className="dialog-cancel"
                onClick={() => void runDetection()}
                disabled={detecting}
                title="Look for a speech server running on this computer"
              >
                <PlugZap size={13} />
                {detecting ? "Finding…" : "Find"}
              </button>
            </span>
          </label>

          {detected && detected.length > 0 ? (
            <div className="voice-settings-detected">
              {detected.map((server) => (
                <button
                  key={server.baseUrl}
                  type="button"
                  className="voice-settings-detected-row"
                  onClick={() =>
                    save({
                      sttBaseUrl: server.baseUrl,
                      transcriptionModel: server.speechModel ?? model,
                    })
                  }
                  title={server.models.length ? server.models.join(", ") : undefined}
                >
                  <Check size={12} />
                  <span>
                    {server.label}
                    {server.speechModel ? ` · ${server.speechModel}` : ""}
                  </span>
                  <span className="voice-settings-detected-use">Use</span>
                </button>
              ))}
            </div>
          ) : null}
          {detected && detected.length === 0 && !detecting ? (
            <p className="settings-hint compact">
              No speech server is running. LatexDo starts its own when you dictate.
            </p>
          ) : null}

          <label className="settings-row">
            <span>
              <strong>Model name</strong>
            </span>
            <input
              type="text"
              aria-label="Speech model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              onBlur={() =>
                model !== settings.transcriptionModel &&
                save({ transcriptionModel: model })
              }
              placeholder="whisper-large-v3"
              spellCheck={false}
            />
          </label>

          {customServer ? (
            <button
              type="button"
              className="dialog-cancel voice-settings-reset"
              onClick={() => save({ sttBaseUrl: defaultLocalTranscriptionBaseUrl })}
            >
              Use LatexDo's built-in speech engine
            </button>
          ) : null}
        </details>
      ) : null}
    </div>
  );
};

/** The Voice section of Settings, wired to the shared voice settings store. */
export const VoiceSettingsSection: React.FC<{ aiConfig: AiConfig }> = ({
  aiConfig,
}) => {
  const [settings, save] = useVoiceSettings();
  return (
    <VoiceSettingsPanel
      settings={settings}
      onSave={save}
      aiEnhancementAvailable={Boolean(createTranscriptCleanup(aiConfig))}
    />
  );
};
