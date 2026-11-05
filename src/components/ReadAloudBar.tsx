import {
  ChevronsLeft,
  KeyRound,
  RefreshCw,
  ChevronsRight,
  LoaderCircle,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Square,
  Volume2,
  X,
} from "lucide-react";
import React from "react";
import type { PdfPreviewOverlay } from "../PdfPreview";
import { rotateRect, type PaperSentence } from "../features/readAloud/paperText";
import {
  elevenLabsModels,
  maxReadAloudPitch,
  minReadAloudPitch,
  openAiClassicVoices,
  openAiModels,
  openAiVoices,
  readAloudCloudStyles,
  readAloudEngines,
  readAloudPauseStyles,
  readAloudRates,
  type ReadAloudSettings,
} from "../features/readAloud/readAloudSettings";
import {
  cloudKeyConfigured,
  fetchCloudVoices,
  removeCloudKey,
  saveCloudKey,
  type CloudProvider,
  type CloudVoice,
} from "../features/readAloud/cloudSpeech";
import { publishReadAloudStatus } from "../features/readAloud/readAloudStatus";
import {
  engineUnavailable,
  useReadAloud,
  useReadAloudSettings,
  useSpeechVoices,
} from "../features/readAloud/useReadAloud";
import {
  pickVoice,
  voiceDisplayName,
  voiceQuality,
  voiceQualityLabel,
  voiceRegion,
} from "../features/readAloud/voices";

type Controller = ReturnType<typeof useReadAloud>;

export interface PdfReadAloud {
  controller: Controller;
  settings: ReadAloudSettings;
  setSettings: (next: ReadAloudSettings) => void;
  voices: SpeechSynthesisVoice[];
  overlays: PdfPreviewOverlay[];
  cloud: CloudState;
}

interface CloudState {
  /** null while unknown. */
  keys: Record<CloudProvider, boolean | null>;
  saveKey: (provider: CloudProvider, key: string) => Promise<boolean>;
  removeKey: (provider: CloudProvider) => Promise<void>;
  elevenLabsVoices: CloudVoice[];
  elevenLabsVoicesState: "idle" | "loading" | "ready" | "error";
  elevenLabsVoicesError: string;
  reloadElevenLabsVoices: () => void;
}

/** A short name for the current voice, shown in the bar. */
function voiceSummary(readAloud: PdfReadAloud): string {
  const { settings, voices, cloud } = readAloud;
  if (settings.engine === "openai") {
    const voice = openAiVoices.find((option) => option.id === settings.openaiVoice);
    return `${voice?.label ?? settings.openaiVoice} · OpenAI`;
  }
  if (settings.engine === "elevenlabs") {
    const voice = cloud.elevenLabsVoices.find(
      (option) => option.id === settings.elevenLabsVoice,
    );
    return voice ? `${voice.name} · ElevenLabs` : "ElevenLabs";
  }
  const voice = pickVoice(voices, settings.voiceURI);
  return voice ? voiceDisplayName(voice) : "";
}

function useCloudVoices(
  settings: ReadAloudSettings,
  setSettings: (next: ReadAloudSettings) => void,
  open: boolean,
): CloudState {
  const [keys, setKeys] = React.useState<Record<CloudProvider, boolean | null>>({
    openai: null,
    elevenlabs: null,
  });
  const [elevenLabsVoices, setElevenLabsVoices] = React.useState<CloudVoice[]>([]);
  const [elevenLabsVoicesState, setVoicesState] =
    React.useState<CloudState["elevenLabsVoicesState"]>("idle");
  const [elevenLabsVoicesError, setVoicesError] = React.useState("");
  const [reloadToken, setReloadToken] = React.useState(0);
  const cloudEngine = settings.engine !== "system" ? settings.engine : null;

  React.useEffect(() => {
    if (!open || !cloudEngine) return;
    let cancelled = false;
    void cloudKeyConfigured(cloudEngine).then((configured) => {
      if (!cancelled) setKeys((current) => ({ ...current, [cloudEngine]: configured }));
    });
    return () => {
      cancelled = true;
    };
  }, [cloudEngine, open]);

  const needVoices = open && cloudEngine === "elevenlabs" && keys.elevenlabs === true;
  const latest = React.useRef({ settings, setSettings });
  React.useEffect(() => {
    latest.current = { settings, setSettings };
  });
  React.useEffect(() => {
    if (!needVoices) return;
    let cancelled = false;
    setVoicesState("loading");
    fetchCloudVoices("elevenlabs")
      .then((list) => {
        if (cancelled) return;
        setElevenLabsVoices(list);
        setVoicesState("ready");
        setVoicesError("");
        // Pick the first voice when none (or a deleted one) is selected.
        const { settings: now, setSettings: save } = latest.current;
        if (list.length && !list.some((voice) => voice.id === now.elevenLabsVoice)) {
          save({ ...now, elevenLabsVoice: list[0].id });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setVoicesState("error");
        setVoicesError(
          error instanceof Error ? error.message : "Could not load ElevenLabs voices.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [needVoices, reloadToken]);

  const saveKey = React.useCallback(async (provider: CloudProvider, key: string) => {
    const saved = await saveCloudKey(provider, key);
    if (saved) {
      setKeys((current) => ({ ...current, [provider]: true }));
      setReloadToken((token) => token + 1);
    }
    return saved;
  }, []);
  const removeKey = React.useCallback(async (provider: CloudProvider) => {
    await removeCloudKey(provider);
    setKeys((current) => ({ ...current, [provider]: false }));
    if (provider === "elevenlabs") {
      setElevenLabsVoices([]);
      setVoicesState("idle");
    }
  }, []);

  return {
    keys,
    saveKey,
    removeKey,
    elevenLabsVoices,
    elevenLabsVoicesState,
    elevenLabsVoicesError,
    reloadElevenLabsVoices: () => setReloadToken((token) => token + 1),
  };
}

function visiblePage(surface: HTMLElement | null): number {
  if (!surface) return 1;
  const bounds = surface.getBoundingClientRect();
  const line = bounds.top + surface.clientHeight * 0.25;
  for (const page of surface.querySelectorAll<HTMLElement>(".pdf-page")) {
    if (page.getBoundingClientRect().bottom > line) {
      return Number(page.dataset.pageNumber) || 1;
    }
  }
  return 1;
}

/** Listening state for the PDF preview, plus the highlight it draws on the pages. */
export function usePdfReadAloud({
  pdfData,
  surfaceRef,
  rotation,
  open,
}: {
  pdfData: Uint8Array | null;
  surfaceRef: React.RefObject<HTMLElement | null>;
  rotation: number;
  open: boolean;
}): PdfReadAloud {
  const [settings, setSettings] = useReadAloudSettings();
  const voices = useSpeechVoices();
  const currentPage = React.useCallback(
    () => visiblePage(surfaceRef.current),
    [surfaceRef],
  );
  const controller = useReadAloud({ pdfData, settings, voices, currentPage });
  const cloud = useCloudVoices(settings, setSettings, open);
  const { current, status, stop, play, pause } = controller;

  React.useEffect(() => {
    if (!open) stop();
  }, [open, stop]);

  // Tell the status bar, which colors itself while a paper is being read.
  const togglePlayback = React.useCallback(() => {
    if (status === "playing" || status === "preparing") pause();
    else void play();
  }, [pause, play, status]);
  const voiceSource =
    readAloudEngines.find((engine) => engine.id === settings.engine)?.label ?? "";
  React.useEffect(() => {
    publishReadAloudStatus(
      open
        ? { status, page: current?.page ?? null, voiceSource, toggle: togglePlayback }
        : null,
    );
  }, [current?.page, open, status, togglePlayback, voiceSource]);
  React.useEffect(() => () => publishReadAloudStatus(null), []);

  // Hands off the page while the reader scrolls on their own.
  const userScrolledAt = React.useRef(0);
  React.useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const mark = () => {
      userScrolledAt.current = Date.now();
    };
    surface.addEventListener("wheel", mark, { passive: true });
    surface.addEventListener("touchmove", mark, { passive: true });
    surface.addEventListener("keydown", mark);
    return () => {
      surface.removeEventListener("wheel", mark);
      surface.removeEventListener("touchmove", mark);
      surface.removeEventListener("keydown", mark);
    };
  }, [surfaceRef, pdfData]);

  const active = open && status !== "idle" && settings.followAlong;
  React.useEffect(() => {
    const surface = surfaceRef.current;
    const first = current?.rects[0];
    if (!active || !surface || !first) return;
    if (Date.now() - userScrolledAt.current < 4000) return;
    const page = surface.querySelector<HTMLElement>(
      `.pdf-page[data-page-number="${first.page}"]`,
    );
    if (!page) return;
    const rect = rotateRect(first, rotation);
    const pageBox = page.getBoundingClientRect();
    const surfaceBox = surface.getBoundingClientRect();
    const top =
      pageBox.top - surfaceBox.top + surface.scrollTop + rect.y * pageBox.height;
    const bottom = top + rect.height * pageBox.height;
    const view = surface.clientHeight;
    if (
      top < surface.scrollTop + view * 0.12 ||
      bottom > surface.scrollTop + view * 0.72
    ) {
      surface.scrollTo({ top: Math.max(0, top - view * 0.3), behavior: "smooth" });
    }
  }, [active, current, rotation, surfaceRef]);

  const overlays = React.useMemo<PdfPreviewOverlay[]>(() => {
    if (!active || !current) return [];
    const byPage = new Map<number, PdfPreviewOverlay>();
    for (const rect of current.rects) {
      const overlay = byPage.get(rect.page) ?? {
        id: "read-aloud",
        pageNumber: rect.page,
        rects: [],
        className: "pdf-read-aloud-highlight",
      };
      overlay.rects.push(rotateRect(rect, rotation));
      byPage.set(rect.page, overlay);
    }
    return [...byPage.values()];
  }, [active, current, rotation]);

  return { controller, settings, setSettings, voices, overlays, cloud };
}

const wordsPerMinute = 165;

function remainingLabel(
  sentences: PaperSentence[],
  index: number,
  rate: number,
): string {
  let words = 0;
  for (let i = index; i < sentences.length; i += 1) {
    words += sentences[i].spoken.split(/\s+/).length;
  }
  const minutes = Math.round(words / (wordsPerMinute * rate));
  if (minutes < 1) return "under a minute left";
  if (minutes < 60) return `${minutes} min left`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min left`;
}

function voiceHelp(): string {
  const platform = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Mac/i.test(platform)) {
    return "For the most natural sound, add Premium or Enhanced voices in System Settings → Accessibility → Spoken Content → System voice → Manage Voices, then reopen this panel.";
  }
  if (/Windows/i.test(platform)) {
    return "For more natural voices, add voices in Settings → Time & language → Speech → Manage voices.";
  }
  return "More voices can be installed through your system's speech settings (for example speech-dispatcher voices).";
}

function VoiceSelect({
  voices,
  value,
  onChange,
}: {
  voices: SpeechSynthesisVoice[];
  value: string;
  onChange: (voiceURI: string) => void;
}) {
  const preferredBase = (voices[0]?.lang ?? "en").split(/[-_]/)[0];
  const groups = [
    {
      label: "Recommended",
      voices: voices.filter(
        (voice) =>
          voice.lang.startsWith(preferredBase) && voiceQuality(voice) !== "standard",
      ),
    },
    {
      label: "More voices",
      voices: voices.filter(
        (voice) =>
          voice.lang.startsWith(preferredBase) && voiceQuality(voice) === "standard",
      ),
    },
    {
      label: "Other languages",
      voices: voices.filter((voice) => !voice.lang.startsWith(preferredBase)),
    },
  ].filter((group) => group.voices.length);

  return (
    <select
      className="read-aloud-voice"
      aria-label="Voice"
      title="Voice"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={!voices.length}
    >
      {!voices.length ? <option value="">No voices installed</option> : null}
      {groups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.voices.map((voice) => {
            const quality = voiceQuality(voice);
            return (
              <option key={voice.voiceURI} value={voice.voiceURI}>
                {voiceDisplayName(voice)} · {voiceRegion(voice)}
                {quality !== "standard" ? ` · ${voiceQualityLabel[quality]}` : ""}
              </option>
            );
          })}
        </optgroup>
      ))}
    </select>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="read-aloud-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
    </label>
  );
}

function CloudKeyField({
  provider,
  readAloud,
}: {
  provider: CloudProvider;
  readAloud: PdfReadAloud;
}) {
  const { cloud } = readAloud;
  const [draft, setDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const name = provider === "openai" ? "OpenAI" : "ElevenLabs";
  const configured = cloud.keys[provider];

  if (configured === null) {
    return <p className="read-aloud-help">Checking for your {name} API key…</p>;
  }
  if (configured) {
    return (
      <div className="read-aloud-key is-saved">
        <KeyRound size={13} aria-hidden="true" />
        <span>{name} API key saved in your system keychain.</span>
        <button
          type="button"
          className="read-aloud-link"
          onClick={() => void cloud.removeKey(provider)}
        >
          Remove
        </button>
      </div>
    );
  }
  return (
    <form
      className="read-aloud-key"
      onSubmit={(event) => {
        event.preventDefault();
        if (!draft.trim()) return;
        setSaving(true);
        void cloud.saveKey(provider, draft).then((saved) => {
          setSaving(false);
          setDraft("");
          setMessage(
            saved ? "" : "The key could not be saved securely on this computer.",
          );
        });
      }}
    >
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder={`${name} API key`}
        aria-label={`${name} API key`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button
        type="submit"
        className="read-aloud-secondary"
        disabled={!draft.trim() || saving}
      >
        Save
      </button>
      {message ? <p className="read-aloud-help is-error">{message}</p> : null}
    </form>
  );
}

function OpenAiVoiceSelect({
  settings,
  onChange,
}: {
  settings: ReadAloudSettings;
  onChange: (voice: string) => void;
}) {
  const steerable = settings.openaiModel.startsWith("gpt-");
  const options = openAiVoices.filter(
    (voice) => steerable || openAiClassicVoices.has(voice.id),
  );
  const value = options.some((voice) => voice.id === settings.openaiVoice)
    ? settings.openaiVoice
    : "alloy";
  return (
    <select
      className="read-aloud-voice"
      aria-label="Voice"
      title="Voice"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((voice) => (
        <option key={voice.id} value={voice.id}>
          {voice.label} · {voice.hint}
        </option>
      ))}
    </select>
  );
}

function ElevenLabsVoiceSelect({
  readAloud,
  onChange,
}: {
  readAloud: PdfReadAloud;
  onChange: (voice: string) => void;
}) {
  const { cloud, settings } = readAloud;
  const voices = cloud.elevenLabsVoices;
  return (
    <select
      className="read-aloud-voice"
      aria-label="Voice"
      title="Voice"
      value={settings.elevenLabsVoice}
      onChange={(event) => onChange(event.target.value)}
      disabled={!voices.length}
    >
      {!voices.length ? (
        <option value={settings.elevenLabsVoice}>
          {cloud.elevenLabsVoicesState === "loading"
            ? "Loading voices…"
            : cloud.keys.elevenlabs
              ? "No voices"
              : "Add your API key"}
        </option>
      ) : null}
      {voices.map((voice) => (
        <option key={voice.id} value={voice.id}>
          {voice.name}
          {voice.description ? ` · ${voice.description}` : ""}
        </option>
      ))}
    </select>
  );
}

/** The voice picker that fits the chosen voice source. */
function CurrentVoiceSelect({ readAloud }: { readAloud: PdfReadAloud }) {
  const { settings, setSettings, voices } = readAloud;
  if (settings.engine === "openai") {
    return (
      <OpenAiVoiceSelect
        settings={settings}
        onChange={(openaiVoice) => setSettings({ ...settings, openaiVoice })}
      />
    );
  }
  if (settings.engine === "elevenlabs") {
    return (
      <ElevenLabsVoiceSelect
        readAloud={readAloud}
        onChange={(elevenLabsVoice) => setSettings({ ...settings, elevenLabsVoice })}
      />
    );
  }
  return (
    <VoiceSelect
      voices={voices}
      value={pickVoice(voices, settings.voiceURI)?.voiceURI ?? ""}
      onChange={(voiceURI) => setSettings({ ...settings, voiceURI })}
    />
  );
}

function VoiceSourceSection({ readAloud }: { readAloud: PdfReadAloud }) {
  const { settings, setSettings, controller, cloud } = readAloud;
  const update = (patch: Partial<ReadAloudSettings>) =>
    setSettings({ ...settings, ...patch });
  const engine = readAloudEngines.find((option) => option.id === settings.engine);
  const cloudEngine = settings.engine !== "system" ? settings.engine : null;
  const keyMissing = cloudEngine ? cloud.keys[cloudEngine] === false : false;

  return (
    <section>
      <h4>Voice</h4>
      <div className="read-aloud-segmented" role="radiogroup" aria-label="Voice source">
        {readAloudEngines.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={settings.engine === option.id}
            onClick={() => update({ engine: option.id })}
          >
            {option.label}
          </button>
        ))}
      </div>
      {engine ? (
        <p className={`read-aloud-help ${cloudEngine ? "is-cloud" : ""}`}>
          {engine.description}
        </p>
      ) : null}

      {cloudEngine ? (
        <CloudKeyField provider={cloudEngine} readAloud={readAloud} />
      ) : null}

      {settings.engine === "openai" ? (
        <label className="read-aloud-field">
          <span>Model</span>
          <select
            value={settings.openaiModel}
            onChange={(event) => update({ openaiModel: event.target.value })}
          >
            {openAiModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {settings.engine === "elevenlabs" ? (
        <label className="read-aloud-field">
          <span>Model</span>
          <select
            value={settings.elevenLabsModel}
            onChange={(event) => update({ elevenLabsModel: event.target.value })}
          >
            {elevenLabsModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="read-aloud-row">
        <CurrentVoiceSelect readAloud={readAloud} />
        {settings.engine === "elevenlabs" && cloud.keys.elevenlabs ? (
          <button
            type="button"
            onClick={cloud.reloadElevenLabsVoices}
            title="Reload voices from your ElevenLabs account"
            aria-label="Reload ElevenLabs voices"
          >
            <RefreshCw
              size={13}
              className={cloud.elevenLabsVoicesState === "loading" ? "spin" : undefined}
            />
          </button>
        ) : null}
        <button
          type="button"
          className="read-aloud-secondary"
          onClick={() => void controller.preview()}
          disabled={keyMissing}
        >
          <Volume2 size={13} /> Preview
        </button>
      </div>
      {settings.engine === "elevenlabs" && cloud.elevenLabsVoicesState === "error" ? (
        <p className="read-aloud-help is-error">{cloud.elevenLabsVoicesError}</p>
      ) : null}

      {settings.engine === "openai" && settings.openaiModel.startsWith("gpt-") ? (
        <label className="read-aloud-field">
          <span>Delivery</span>
          <div className="read-aloud-segmented" role="radiogroup" aria-label="Delivery">
            {readAloudCloudStyles.map((style) => (
              <button
                key={style.id}
                type="button"
                role="radio"
                aria-checked={settings.openaiStyle === style.id}
                onClick={() => update({ openaiStyle: style.id })}
              >
                {style.label}
              </button>
            ))}
          </div>
        </label>
      ) : null}

      {settings.engine === "system" ? (
        <>
          <label className="read-aloud-slider">
            <span>Tone</span>
            <input
              type="range"
              min={minReadAloudPitch}
              max={maxReadAloudPitch}
              step={0.05}
              value={settings.pitch}
              onChange={(event) => update({ pitch: Number(event.target.value) })}
              aria-valuetext={
                settings.pitch === 1 ? "Normal" : settings.pitch.toFixed(2)
              }
            />
            <output>
              {settings.pitch === 1
                ? "Normal"
                : settings.pitch < 1
                  ? "Deeper"
                  : "Brighter"}
            </output>
          </label>
          <p className="read-aloud-help">{voiceHelp()}</p>
        </>
      ) : (
        <p className="read-aloud-help">
          Audio for each sentence is downloaded once and reused, so going back does not
          cost again.
        </p>
      )}
    </section>
  );
}

function ReadAloudOptions({
  readAloud,
  onClose,
}: {
  readAloud: PdfReadAloud;
  onClose: () => void;
}) {
  const { settings, setSettings } = readAloud;
  const update = (patch: Partial<ReadAloudSettings>) =>
    setSettings({ ...settings, ...patch });
  const pauseStyle = readAloudPauseStyles.find(
    (style) => style.id === settings.pauseStyle,
  );

  return (
    <div className="read-aloud-options" role="dialog" aria-label="Listening options">
      <div className="read-aloud-options-head">
        <strong>Listening options</strong>
        <button type="button" onClick={onClose} aria-label="Close listening options">
          <X size={14} />
        </button>
      </div>

      <VoiceSourceSection readAloud={readAloud} />

      <section>
        <h4>Pauses</h4>
        <div className="read-aloud-segmented" role="radiogroup" aria-label="Pauses">
          {readAloudPauseStyles.map((style) => (
            <button
              key={style.id}
              type="button"
              role="radio"
              aria-checked={settings.pauseStyle === style.id}
              onClick={() => update({ pauseStyle: style.id })}
            >
              {style.label}
            </button>
          ))}
        </div>
        {pauseStyle ? (
          <p className="read-aloud-help">{pauseStyle.description}</p>
        ) : null}
      </section>

      <section>
        <h4>Start reading</h4>
        <div
          className="read-aloud-segmented"
          role="radiogroup"
          aria-label="Start reading"
        >
          {(
            [
              ["page", "From this page"],
              ["beginning", "From the start"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={settings.startFrom === id}
              onClick={() => update({ startFrom: id })}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h4>What to read</h4>
        <Toggle
          label="Skip citation markers"
          hint="[12], (Smith et al., 2020)"
          checked={settings.skipCitations}
          onChange={(skipCitations) => update({ skipCitations })}
        />
        <Toggle
          label="Stop at the references"
          checked={settings.skipReferences}
          onChange={(skipReferences) => update({ skipReferences })}
        />
        <Toggle
          label="Skip equations and number tables"
          checked={settings.skipEquations}
          onChange={(skipEquations) => update({ skipEquations })}
        />
        <Toggle
          label="Say abbreviations in full"
          hint="e.g. → “for example”, Fig. → “Figure”"
          checked={settings.expandAbbreviations}
          onChange={(expandAbbreviations) => update({ expandAbbreviations })}
        />
        <Toggle
          label="Highlight and follow along"
          checked={settings.followAlong}
          onChange={(followAlong) => update({ followAlong })}
        />
      </section>
    </div>
  );
}

export function ReadAloudBar({
  readAloud,
  onClose,
}: {
  readAloud: PdfReadAloud;
  onClose: () => void;
}) {
  const { controller, settings, setSettings } = readAloud;
  const { status, sentences, index, current, error } = controller;
  const [optionsOpen, setOptionsOpen] = React.useState(false);
  const playing = status === "playing";
  const preparing = status === "preparing";
  const hasText = sentences.length > 0;
  const unavailable = engineUnavailable(settings);

  const toggle = () => {
    if (playing || preparing) controller.pause();
    else void controller.play();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const typing = /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(target.tagName);
    if (event.key === "Escape") {
      event.preventDefault();
      if (optionsOpen) setOptionsOpen(false);
      else onClose();
    } else if (!typing && (event.key === " " || event.key === "k")) {
      event.preventDefault();
      toggle();
    } else if (!typing && event.key === "ArrowLeft") {
      event.preventDefault();
      controller.skip(-1);
    } else if (!typing && event.key === "ArrowRight") {
      event.preventDefault();
      controller.skip(1);
    }
  };

  let caption: React.ReactNode;
  if (status === "error") {
    caption = error;
  } else if (unavailable && status === "idle") {
    caption = unavailable;
  } else if (preparing) {
    caption =
      settings.engine === "system" || !hasText
        ? "Preparing the paper…"
        : `Getting the ${voiceSummary(readAloud)} voice ready…`;
  } else if (status === "finished") {
    caption = "Finished reading. Press play to start again.";
  } else if (current && status !== "idle") {
    caption = current.text;
  } else {
    caption =
      settings.startFrom === "page"
        ? "Press play to listen from the page you are viewing."
        : "Press play to listen from the start of the paper.";
  }

  return (
    <div
      className="read-aloud-bar"
      data-status={status}
      role="region"
      aria-label="Listen to paper"
      onKeyDown={onKeyDown}
    >
      {optionsOpen ? (
        <ReadAloudOptions readAloud={readAloud} onClose={() => setOptionsOpen(false)} />
      ) : null}
      <div className="read-aloud-controls">
        <div className="read-aloud-transport">
          <button
            type="button"
            onClick={() => controller.skipSection(-1)}
            disabled={!hasText}
            title="Previous section"
            aria-label="Previous section"
          >
            <ChevronsLeft size={15} />
          </button>
          <button
            type="button"
            onClick={() => controller.skip(-1)}
            disabled={!hasText}
            title="Previous sentence (←)"
            aria-label="Previous sentence"
          >
            <SkipBack size={14} />
          </button>
          <button
            type="button"
            className="read-aloud-play"
            onClick={toggle}
            title={playing ? "Pause (Space)" : "Listen (Space)"}
            aria-label={playing || preparing ? "Pause" : "Play"}
          >
            {preparing ? (
              <LoaderCircle size={15} className="spin" />
            ) : playing ? (
              <Pause size={15} />
            ) : (
              <Play size={15} />
            )}
          </button>
          <button
            type="button"
            onClick={() => controller.skip(1)}
            disabled={!hasText}
            title="Next sentence (→)"
            aria-label="Next sentence"
          >
            <SkipForward size={14} />
          </button>
          <button
            type="button"
            onClick={() => controller.skipSection(1)}
            disabled={!hasText}
            title="Next section"
            aria-label="Next section"
          >
            <ChevronsRight size={15} />
          </button>
          <button
            type="button"
            onClick={controller.stop}
            disabled={status === "idle"}
            title="Stop"
            aria-label="Stop"
          >
            <Square size={12} />
          </button>
        </div>

        <div className="read-aloud-progress">
          <input
            type="range"
            min={0}
            max={Math.max(0, sentences.length - 1)}
            value={hasText ? index : 0}
            onChange={(event) => controller.seek(Number(event.target.value))}
            disabled={!hasText}
            aria-label="Reading position"
            aria-valuetext={
              current
                ? `Page ${current.page}, sentence ${index + 1} of ${sentences.length}`
                : ""
            }
          />
          <span className="read-aloud-meta">
            {hasText && current
              ? `p. ${current.page} · ${remainingLabel(sentences, index, settings.rate)}`
              : voiceSummary(readAloud)}
          </span>
        </div>

        <div className="read-aloud-settings">
          <select
            className="read-aloud-rate"
            aria-label="Speed"
            title="Speed"
            value={settings.rate}
            onChange={(event) =>
              setSettings({ ...settings, rate: Number(event.target.value) })
            }
          >
            {readAloudRates.map((rate) => (
              <option key={rate} value={rate}>
                {rate}×
              </option>
            ))}
          </select>
          <CurrentVoiceSelect readAloud={readAloud} />
          <button
            type="button"
            onClick={() => setOptionsOpen((value) => !value)}
            aria-expanded={optionsOpen}
            title="Listening options"
            aria-label="Listening options"
          >
            <SlidersHorizontal size={14} />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close listening"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <p
        className={`read-aloud-caption ${status === "error" ? "is-error" : ""}`}
        aria-live={status === "error" ? "assertive" : "off"}
      >
        {caption}
      </p>
    </div>
  );
}
