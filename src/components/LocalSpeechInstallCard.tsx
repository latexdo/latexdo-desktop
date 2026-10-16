import { Download, LoaderCircle, Mic } from "lucide-react";
import {
  formatDownloadSize,
  type LocalSpeechState,
} from "../features/voice/useLocalSpeechInstall";

interface LocalSpeechInstallCardProps {
  state: LocalSpeechState;
  onInstall(): void;
  onUseOpenAi?(): void;
  onDismiss?(): void;
}

/** Offers the local speech download where dictation needs it, with progress. */
export function LocalSpeechInstallCard({
  state,
  onInstall,
  onUseOpenAi,
  onDismiss,
}: LocalSpeechInstallCardProps) {
  if (state.phase === "installing") {
    return (
      <div className="speech-install-card" role="status" aria-live="polite">
        <div className="speech-install-head">
          <LoaderCircle size={14} className="spin" aria-hidden="true" />
          <span>{state.message}</span>
          {state.percent !== null ? <b>{state.percent}%</b> : null}
        </div>
        <div className="speech-install-bar" aria-hidden="true">
          <span style={{ width: `${state.percent ?? 8}%` }} />
        </div>
      </div>
    );
  }
  if (state.phase !== "missing" && state.phase !== "failed") return null;
  const size = formatDownloadSize(state.downloadBytes);
  return (
    <div className="speech-install-card" role="alert">
      <div className="speech-install-head">
        <Mic size={14} aria-hidden="true" />
        <span>
          {state.phase === "failed"
            ? `Local speech could not be installed: ${state.error}`
            : "Local speech is not installed yet. It runs on this computer, so your voice never leaves it."}
        </span>
      </div>
      <div className="speech-install-actions">
        <button type="button" className="speech-install-primary" onClick={onInstall}>
          <Download size={13} />
          {state.phase === "failed" ? "Try again" : "Install local speech"}
          {size ? ` (${size})` : ""}
        </button>
        {onUseOpenAi ? (
          <button type="button" onClick={onUseOpenAi}>
            Use OpenAI instead
          </button>
        ) : null}
        {onDismiss ? (
          <button type="button" onClick={onDismiss}>
            Not now
          </button>
        ) : null}
      </div>
    </div>
  );
}
