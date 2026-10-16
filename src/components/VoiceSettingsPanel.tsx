// Voice dictation settings, shown in the AI tab of Settings.
//
// Lets the user point speech-to-text at a local OpenAI-compatible endpoint
// (whisper.cpp, LM Studio, faster-whisper, …) or OpenAI, independent of the
// chat provider. Changes save as soon as a field is committed.

import React from "react";
import type { AiConfig } from "../features/ai/aiConfig";
import { LocalSpeechInstallCard } from "./LocalSpeechInstallCard";
import { createTranscriptCleanup } from "../features/voice/transcriptCleanup";
import { useVoiceSettings } from "../features/voice/useVoiceSettings";
import { useLocalSpeechInstall } from "../features/voice/useLocalSpeechInstall";
import { Check, PlugZap } from "lucide-react";
import {
  detectLocalTranscriptionServers,
  type LocalTranscriptionServer,
} from "../features/voice/localTranscriptionDetection";
import {
  normalizeVoiceSettings,
  type VoiceSettings,
} from "../features/voice/voiceSettings";

interface VoiceSettingsPanelProps {
  settings: VoiceSettings;
  onSave(next: VoiceSettings): void;
  aiEnhancementAvailable?: boolean;
}

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

  return (
    <div className="voice-settings-panel">
      <div className="settings-section-heading">
        <strong>🎙️ Voice</strong>
        <span>Talk to the AI instead of typing.</span>
      </div>

      <div className="settings-row">
        <span>
          <strong>Speech engine</strong>
          <small>
            {local
              ? "Runs on this computer. Nothing leaves your machine."
              : "Sends recordings to OpenAI. Uses your OpenAI key."}
          </small>
        </span>
        <div className="voice-settings-mode" role="group" aria-label="Speech engine">
          <button
            type="button"
            className={local ? "active" : ""}
            aria-pressed={local}
            onClick={() => save({ sttMode: "local" })}
          >
            💻 Local
          </button>
          <button
            type="button"
            className={!local ? "active" : ""}
            aria-pressed={!local}
            onClick={() => save({ sttMode: "openai" })}
          >
            ☁️ OpenAI
          </button>
        </div>
      </div>

      {local ? (
        <>
          {localSpeech.state.phase === "installed" ? null : (
            <LocalSpeechInstallCard
              state={localSpeech.state}
              onInstall={() => void localSpeech.install()}
            />
          )}

          <label className="settings-row">
            <span>
              <strong>Speech server</strong>
              <small>
                {localSpeech.state.phase === "installed" ? (
                  <>
                    <Check size={11} /> Installed. Starts when you dictate.
                  </>
                ) : (
                  "Local OpenAI-compatible endpoint."
                )}
              </small>
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
                placeholder="http://localhost:8080/v1"
                spellCheck={false}
              />
              <button
                type="button"
                className="dialog-cancel"
                onClick={() => void runDetection()}
                disabled={detecting}
                title="Find a running speech server"
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
              No speech server is running. LatexDo starts the installed one when you
              dictate.
            </p>
          ) : null}

          <label className="settings-row">
            <span>
              <strong>Speech model</strong>
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
        </>
      ) : (
        <label className="settings-row">
          <span>
            <strong>Speech model</strong>
          </span>
          <select
            aria-label="OpenAI speech model"
            value={settings.cloudTranscriptionModel}
            onChange={(e) => save({ cloudTranscriptionModel: e.target.value })}
          >
            <option value="gpt-transcribe">gpt-transcribe</option>
            <option value="gpt-4o-transcribe">gpt-4o-transcribe</option>
            <option value="gpt-4o-mini-transcribe">gpt-4o-mini-transcribe</option>
            <option value="whisper-1">whisper-1</option>
          </select>
        </label>
      )}

      <label className="settings-row settings-toggle">
        <span>
          <strong>✨ Clean up what I say</strong>
          <small>
            {aiEnhancementAvailable
              ? "Fixes punctuation and filler words with your local AI."
              : "Pick a local LatexDo AI model to turn this on."}
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
