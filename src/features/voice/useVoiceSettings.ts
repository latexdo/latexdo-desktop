import React from "react";
import {
  loadVoiceSettings,
  normalizeVoiceSettings,
  saveVoiceSettings,
  voiceSettingsChangedEvent,
  type VoiceSettings,
} from "./voiceSettings";

/** Voice settings kept in sync between Settings and the AI composer. */
export function useVoiceSettings(): [VoiceSettings, (next: VoiceSettings) => void] {
  const [settings, setSettings] = React.useState(loadVoiceSettings);

  React.useEffect(() => {
    const reload = () => setSettings(loadVoiceSettings());
    window.addEventListener(voiceSettingsChangedEvent, reload);
    return () => window.removeEventListener(voiceSettingsChangedEvent, reload);
  }, []);

  const save = React.useCallback((next: VoiceSettings) => {
    const normalized = normalizeVoiceSettings(next);
    saveVoiceSettings(normalized);
    setSettings(normalized);
  }, []);

  return [settings, save];
}
