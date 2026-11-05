import React from "react";
import {
  paperSentences,
  type PaperPage,
  type PaperSentence,
  type PaperTextOptions,
} from "./paperText";
import {
  clausePause,
  loadReadAloudSettings,
  normalizeReadAloudSettings,
  pauseBefore,
  readAloudSettingsChangedEvent,
  saveReadAloudSettings,
  speechParts,
  openAiClassicVoices,
  type ReadAloudSettings,
} from "./readAloudSettings";
import { pickVoice, rankVoices } from "./voices";
import {
  CloudSpeechPlayer,
  cloudSpeechAvailable,
  type CloudSpeechConfig,
} from "./cloudSpeech";

export type ReadAloudStatus =
  | "idle"
  | "preparing"
  | "playing"
  | "paused"
  | "finished"
  | "error";

export function speechSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance === "function"
  );
}

export function useReadAloudSettings(): [
  ReadAloudSettings,
  (next: ReadAloudSettings) => void,
] {
  const [settings, setSettings] = React.useState(loadReadAloudSettings);
  React.useEffect(() => {
    const reload = () => setSettings(loadReadAloudSettings());
    window.addEventListener(readAloudSettingsChangedEvent, reload);
    return () => window.removeEventListener(readAloudSettingsChangedEvent, reload);
  }, []);
  const save = React.useCallback((next: ReadAloudSettings) => {
    const normalized = normalizeReadAloudSettings(next);
    setSettings(normalized);
    saveReadAloudSettings(normalized);
  }, []);
  return [settings, save];
}

/** Installed voices, best first; the list fills in once the system reports it. */
export function useSpeechVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = React.useState<SpeechSynthesisVoice[]>(() =>
    speechSupported() ? window.speechSynthesis.getVoices() : [],
  );
  React.useEffect(() => {
    if (!speechSupported()) return;
    const synth = window.speechSynthesis;
    const update = () => setVoices(synth.getVoices());
    update();
    synth.addEventListener("voiceschanged", update);
    // Some engines never fire voiceschanged; ask again shortly after.
    const retry = window.setTimeout(update, 600);
    return () => {
      synth.removeEventListener("voiceschanged", update);
      window.clearTimeout(retry);
    };
  }, []);
  const preferred =
    typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";
  return React.useMemo(() => rankVoices(voices, preferred), [voices, preferred]);
}

async function loadPaperPages(data: Uint8Array): Promise<PaperPage[]> {
  const [{ GlobalWorkerOptions, getDocument }, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  if (!GlobalWorkerOptions.workerSrc) GlobalWorkerOptions.workerSrc = worker.default;
  const document = await getDocument({ data: data.slice() }).promise;
  try {
    const pages: PaperPage[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push({
        pageNumber,
        viewBox: page.view as [number, number, number, number],
        items: content.items.flatMap((item) =>
          "str" in item
            ? [
                {
                  str: item.str,
                  transform: item.transform as number[],
                  width: item.width,
                  height: item.height,
                  hasEOL: item.hasEOL,
                },
              ]
            : [],
        ),
      });
    }
    return pages;
  } finally {
    void document.destroy();
  }
}

const previewSentence =
  "This is how your paper will sound, with natural pauses at commas, sentences, and new sections.";

const sleep = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, Math.max(0, ms)));

/** The cloud voice to use, or null for the computer's own voices. */
export function cloudConfig(settings: ReadAloudSettings): CloudSpeechConfig | null {
  if (settings.engine === "openai") {
    const steerable = settings.openaiModel.startsWith("gpt-");
    return {
      provider: "openai",
      model: settings.openaiModel,
      // The older tts-1 models know only the classic voices.
      voice:
        steerable || openAiClassicVoices.has(settings.openaiVoice)
          ? settings.openaiVoice
          : "alloy",
      style: settings.openaiStyle,
    };
  }
  if (settings.engine === "elevenlabs" && settings.elevenLabsVoice) {
    return {
      provider: "elevenlabs",
      model: settings.elevenLabsModel,
      voice: settings.elevenLabsVoice,
      style: settings.openaiStyle,
    };
  }
  return null;
}

/** Why the chosen voice cannot read right now, if it cannot. */
export function engineUnavailable(settings: ReadAloudSettings): string {
  if (settings.engine === "system") {
    return speechSupported() ? "" : "Speech is not available on this system.";
  }
  if (!cloudSpeechAvailable()) return "Cloud voices need the LatexDo desktop app.";
  if (settings.engine === "elevenlabs" && !settings.elevenLabsVoice) {
    return "Choose an ElevenLabs voice in Listening options.";
  }
  return "";
}

const textOptionsKey = (settings: PaperTextOptions) =>
  [
    settings.skipCitations,
    settings.skipReferences,
    settings.skipEquations,
    settings.expandAbbreviations,
  ].join("|");

/** Where a reader was in an older sentence list, found again in a new one. */
export function remapPosition(
  previous: PaperSentence | undefined,
  next: PaperSentence[],
): number {
  if (!previous || !next.length) return 0;
  const exact = next.findIndex(
    (sentence) => sentence.page === previous.page && sentence.text === previous.text,
  );
  if (exact >= 0) return exact;
  const anywhere = next.findIndex((sentence) => sentence.text === previous.text);
  if (anywhere >= 0) return anywhere;
  const samePage = next.findIndex((sentence) => sentence.page >= previous.page);
  return samePage >= 0 ? samePage : next.length - 1;
}

interface ReadAloudOptions {
  pdfData: Uint8Array | null;
  settings: ReadAloudSettings;
  voices: SpeechSynthesisVoice[];
  /** The page the reader is looking at, for "start from current page". */
  currentPage: () => number;
}

export function useReadAloud({
  pdfData,
  settings,
  voices,
  currentPage,
}: ReadAloudOptions) {
  const [status, setStatus] = React.useState<ReadAloudStatus>("idle");
  const [sentences, setSentences] = React.useState<PaperSentence[]>([]);
  const [index, setIndex] = React.useState(0);
  const [error, setError] = React.useState("");

  const live = React.useRef({
    settings,
    voices,
    currentPage,
    status: "idle" as ReadAloudStatus,
    sentences: [] as PaperSentence[],
    index: 0,
    run: 0,
    utterance: null as SpeechSynthesisUtterance | null,
    loaded: null as { data: Uint8Array; key: string } | null,
    loading: null as Promise<PaperSentence[]> | null,
  });
  const playerRef = React.useRef<CloudSpeechPlayer | null>(null);
  const player = React.useCallback(
    () => (playerRef.current ??= new CloudSpeechPlayer()),
    [],
  );

  React.useEffect(() => {
    live.current.settings = settings;
    live.current.voices = voices;
    live.current.currentPage = currentPage;
  });

  const setStatusLive = React.useCallback((next: ReadAloudStatus) => {
    live.current.status = next;
    setStatus(next);
  }, []);
  const setIndexLive = React.useCallback((next: number) => {
    live.current.index = next;
    setIndex(next);
  }, []);
  const setSentencesLive = React.useCallback((next: PaperSentence[]) => {
    live.current.sentences = next;
    setSentences(next);
  }, []);

  const silence = React.useCallback(() => {
    const state = live.current;
    state.run += 1;
    state.utterance = null;
    if (speechSupported()) window.speechSynthesis.cancel();
    playerRef.current?.stop();
  }, []);

  const load = React.useCallback(async (): Promise<PaperSentence[]> => {
    const state = live.current;
    if (!pdfData) return [];
    const key = textOptionsKey(state.settings);
    if (state.loaded?.data === pdfData && state.loaded.key === key)
      return state.sentences;
    if (state.loading) return state.loading;
    state.loading = loadPaperPages(pdfData)
      .then((pages) => {
        const list = paperSentences(pages, state.settings);
        const previous = state.sentences[state.index];
        state.loaded = { data: pdfData, key };
        setSentencesLive(list);
        if (previous) setIndexLive(remapPosition(previous, list));
        return list;
      })
      .finally(() => {
        state.loading = null;
      });
    return state.loading;
  }, [pdfData, setIndexLive, setSentencesLive]);

  /** Speaks one piece with a system voice; resolves when it ends or is stopped. */
  const speakSystem = React.useCallback(
    (text: string, run: number) =>
      new Promise<void>((resolve, reject) => {
        const state = live.current;
        const voice = pickVoice(state.voices, state.settings.voiceURI);
        const utterance = new SpeechSynthesisUtterance(text);
        if (voice) {
          utterance.voice = voice;
          utterance.lang = voice.lang;
        }
        utterance.rate = state.settings.rate;
        utterance.pitch = state.settings.pitch;
        let done = false;
        const timers = { watchdog: 0 };
        const finish = () => {
          if (done) return;
          done = true;
          window.clearInterval(timers.watchdog);
          resolve();
        };
        utterance.onend = finish;
        utterance.onerror = (event) => {
          if (event.error === "interrupted" || event.error === "canceled") {
            finish();
            return;
          }
          if (done) return;
          done = true;
          window.clearInterval(timers.watchdog);
          reject(
            new Error(
              event.error === "voice-unavailable" ||
                event.error === "language-unavailable"
                ? "This voice is not available. Choose another voice."
                : "The speech engine stopped unexpectedly.",
            ),
          );
        };
        // Keep a reference: an utterance that is garbage-collected never ends.
        state.utterance = utterance;
        window.speechSynthesis.speak(utterance);
        // Some engines drop the end event; notice when speech has gone quiet.
        let quiet = 0;
        timers.watchdog = window.setInterval(() => {
          const synth = window.speechSynthesis;
          if (run !== state.run) return finish();
          quiet = synth.speaking || synth.pending ? 0 : quiet + 1;
          if (quiet >= 3) finish();
        }, 500);
      }),
    [],
  );

  const speakFrom = React.useCallback(
    async (start: number) => {
      const state = live.current;
      silence();
      const run = state.run;
      const active = () => run === state.run;
      let list = state.sentences;
      let at = start;
      setError("");
      setStatusLive("playing");
      try {
        // A short gap after cancel(): some engines ignore a speak() right after it.
        await sleep(40);
        let first = true;
        while (active()) {
          if (at >= list.length) {
            setIndexLive(Math.max(0, list.length - 1));
            setStatusLive("finished");
            return;
          }
          setIndexLive(at);
          const current = state.settings;
          const sentence = list[at];
          const parts = speechParts(sentence.spoken, current.pauseStyle);
          const cloud = cloudConfig(current);
          const next = list[at + 1];
          for (let part = 0; part < parts.length; part += 1) {
            if (!active()) return;
            if (cloud) {
              const context = {
                previousText: parts[part - 1] ?? list[at - 1]?.spoken,
                nextText: parts[part + 1] ?? next?.spoken,
              };
              if (first) {
                // The first clip takes a moment to arrive; show it is coming.
                setStatusLive("preparing");
                await player().load(parts[part], cloud, context);
                if (!active()) return;
                setStatusLive("playing");
                first = false;
              }
              // Ask for what comes next while this plays, so there is no gap.
              const upcoming =
                parts[part + 1] ??
                (next ? speechParts(next.spoken, current.pauseStyle)[0] : undefined);
              if (upcoming) {
                player().prefetch(upcoming, cloud, {
                  previousText: parts[part],
                  nextText: parts[part + 2] ?? list[at + 2]?.spoken,
                });
              }
              await player().speak(parts[part], cloud, current.rate, context);
            } else {
              await speakSystem(parts[part], run);
            }
            if (!active()) return;
            if (part < parts.length - 1) await sleep(clausePause / current.rate);
          }
          // The list may have been rebuilt (recompile) while this sentence played.
          const from = state.sentences === list ? at : state.index;
          list = state.sentences;
          const pause = pauseBefore(
            list[from + 1],
            list[from],
            state.settings.pauseStyle,
          );
          await sleep(pause / Math.max(0.75, state.settings.rate));
          at = from + 1;
        }
      } catch (error) {
        if (!active()) return;
        silence();
        setError(
          error instanceof Error ? error.message : "Reading stopped unexpectedly.",
        );
        setStatusLive("error");
      }
    },
    [player, setIndexLive, setStatusLive, silence, speakSystem],
  );

  const play = React.useCallback(async () => {
    const state = live.current;
    const unavailable = engineUnavailable(state.settings);
    if (unavailable) {
      setError(unavailable);
      setStatusLive("error");
      return;
    }
    if (state.status === "playing" || state.status === "preparing") return;
    const resume = state.status === "paused" || state.status === "error";
    setStatusLive("preparing");
    let list: PaperSentence[];
    try {
      list = await load();
    } catch {
      setError("The text of this PDF could not be read.");
      setStatusLive("error");
      return;
    }
    if (live.current.status !== "preparing") return;
    if (!list.length) {
      setError("This PDF has no readable text.");
      setStatusLive("error");
      return;
    }
    let start = resume ? state.index : 0;
    if (!resume && state.settings.startFrom === "page") {
      const page = state.currentPage();
      const found = list.findIndex((sentence) => sentence.page >= page);
      start = found >= 0 ? found : 0;
    }
    void speakFrom(Math.min(start, list.length - 1));
  }, [load, setStatusLive, speakFrom]);

  const pause = React.useCallback(() => {
    if (live.current.status !== "playing" && live.current.status !== "preparing")
      return;
    silence();
    setStatusLive("paused");
  }, [setStatusLive, silence]);

  const stop = React.useCallback(() => {
    silence();
    setIndexLive(0);
    setStatusLive("idle");
  }, [setIndexLive, setStatusLive, silence]);

  const seek = React.useCallback(
    (target: number) => {
      const state = live.current;
      const clamped = Math.max(0, Math.min(state.sentences.length - 1, target));
      if (!state.sentences.length) return;
      if (state.status === "playing" || state.status === "preparing") {
        void speakFrom(clamped);
      } else {
        setIndexLive(clamped);
        if (state.status === "idle" || state.status === "finished")
          setStatusLive("paused");
      }
    },
    [setIndexLive, setStatusLive, speakFrom],
  );

  const skip = React.useCallback(
    (delta: number) => seek(live.current.index + delta),
    [seek],
  );

  /** Jump to the previous or next heading. */
  const skipSection = React.useCallback(
    (direction: 1 | -1) => {
      const { sentences: list, index: at } = live.current;
      if (direction > 0) {
        const next = list.findIndex(
          (sentence, i) => i > at && sentence.kind === "heading",
        );
        seek(next >= 0 ? next : list.length - 1);
      } else {
        let i = at - 1;
        // From inside a section, go back to its heading; from a heading, to the one before.
        while (i > 0 && list[i].kind !== "heading") i -= 1;
        seek(Math.max(0, i));
      }
    },
    [seek],
  );

  /** A sample sentence in the chosen voice, so the reader can compare. */
  const preview = React.useCallback(async () => {
    const state = live.current;
    const unavailable = engineUnavailable(state.settings);
    if (unavailable) {
      setError(unavailable);
      setStatusLive("error");
      return;
    }
    const wasActive = state.status === "playing" || state.status === "preparing";
    silence();
    if (wasActive) setStatusLive("paused");
    const run = state.run;
    const cloud = cloudConfig(state.settings);
    try {
      await sleep(40);
      if (cloud) await player().speak(previewSentence, cloud, state.settings.rate);
      else await speakSystem(previewSentence, run);
    } catch (error) {
      if (run !== state.run) return;
      setError(error instanceof Error ? error.message : "The preview could not play.");
      setStatusLive("error");
    }
  }, [player, setStatusLive, silence, speakSystem]);

  // A new voice, speed or pitch is heard at once: restart the current sentence.
  const voiceKey = [
    settings.engine,
    settings.voiceURI,
    settings.openaiVoice,
    settings.openaiModel,
    settings.openaiStyle,
    settings.elevenLabsVoice,
    settings.elevenLabsModel,
    settings.rate,
    settings.pitch,
    settings.pauseStyle,
  ].join("|");
  const lastVoiceKey = React.useRef(voiceKey);
  React.useEffect(() => {
    if (lastVoiceKey.current === voiceKey) return;
    lastVoiceKey.current = voiceKey;
    if (live.current.status === "playing") void speakFrom(live.current.index);
  }, [speakFrom, voiceKey]);

  // New text options or a recompiled PDF: rebuild the sentences and keep the place.
  const textKey = textOptionsKey(settings);
  React.useEffect(() => {
    const state = live.current;
    if (!pdfData) {
      silence();
      state.loaded = null;
      setSentencesLive([]);
      setIndexLive(0);
      setStatusLive("idle");
      return;
    }
    if (!state.loaded) return;
    if (state.loaded.data === pdfData && state.loaded.key === textKey) return;
    const wasPlaying = state.status === "playing";
    const optionsChanged = state.loaded.key !== textKey;
    void load()
      .then(() => {
        // Skipping options change which sentences exist; start the found one over.
        if (wasPlaying && optionsChanged && live.current.status === "playing") {
          void speakFrom(live.current.index);
        }
      })
      .catch(() => undefined);
  }, [
    load,
    pdfData,
    setIndexLive,
    setSentencesLive,
    setStatusLive,
    silence,
    speakFrom,
    textKey,
  ]);

  React.useEffect(() => () => silence(), [silence]);

  return {
    status,
    sentences,
    index,
    current: sentences[index] as PaperSentence | undefined,
    error,
    play,
    pause,
    stop,
    seek,
    skip,
    skipSection,
    preview,
  };
}
