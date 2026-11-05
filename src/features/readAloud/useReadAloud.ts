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
  type ReadAloudSettings,
} from "./readAloudSettings";
import { pickVoice, rankVoices } from "./voices";

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
    timer: undefined as number | undefined,
    watchdog: undefined as number | undefined,
    utterance: null as SpeechSynthesisUtterance | null,
    loaded: null as { data: Uint8Array; key: string } | null,
    loading: null as Promise<PaperSentence[]> | null,
  });

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
    window.clearTimeout(state.timer);
    window.clearInterval(state.watchdog);
    state.utterance = null;
    if (speechSupported()) window.speechSynthesis.cancel();
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

  const speakFrom = React.useCallback(
    (start: number) => {
      const state = live.current;
      silence();
      const run = state.run;
      const list = state.sentences;
      if (start >= list.length) {
        setIndexLive(Math.max(0, list.length - 1));
        setStatusLive("finished");
        return;
      }
      setIndexLive(start);
      setStatusLive("playing");
      setError("");
      const sentence = list[start];
      const { settings: current } = state;
      const parts = speechParts(sentence.spoken, current.pauseStyle);
      const voice = pickVoice(state.voices, current.voiceURI);
      let part = 0;

      const advance = () => {
        if (run !== state.run) return;
        window.clearInterval(state.watchdog);
        part += 1;
        const rate = state.settings.rate;
        if (part < parts.length) {
          state.timer = window.setTimeout(speakPart, clausePause / rate);
          return;
        }
        // The list may have been rebuilt (recompile) while this sentence played.
        const from = state.sentences === list ? start : state.index;
        const nextList = state.sentences;
        const pause = pauseBefore(
          nextList[from + 1],
          nextList[from],
          state.settings.pauseStyle,
        );
        state.timer = window.setTimeout(
          () => {
            if (run === state.run) speakFrom(from + 1);
          },
          pause / Math.max(0.75, rate),
        );
      };

      const speakPart = () => {
        if (run !== state.run) return;
        const utterance = new SpeechSynthesisUtterance(parts[part]);
        if (voice) {
          utterance.voice = voice;
          utterance.lang = voice.lang;
        }
        utterance.rate = state.settings.rate;
        utterance.pitch = state.settings.pitch;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          advance();
        };
        utterance.onend = finish;
        utterance.onerror = (event) => {
          if (run !== state.run || done) return;
          if (event.error === "interrupted" || event.error === "canceled") return;
          done = true;
          silence();
          setError(
            event.error === "voice-unavailable" ||
              event.error === "language-unavailable"
              ? "This voice is not available. Choose another voice."
              : "The speech engine stopped unexpectedly.",
          );
          setStatusLive("error");
        };
        // Keep a reference: an utterance that is garbage-collected never ends.
        state.utterance = utterance;
        window.speechSynthesis.speak(utterance);
        // Some engines drop the end event; notice when speech has gone quiet.
        let quiet = 0;
        window.clearInterval(state.watchdog);
        state.watchdog = window.setInterval(() => {
          const synth = window.speechSynthesis;
          quiet = synth.speaking || synth.pending ? 0 : quiet + 1;
          if (quiet >= 3) finish();
        }, 500);
      };

      // A short gap after cancel() — some engines ignore a speak() right after it.
      state.timer = window.setTimeout(speakPart, 40);
    },
    [setIndexLive, setStatusLive, silence],
  );

  const play = React.useCallback(async () => {
    const state = live.current;
    if (!speechSupported()) {
      setError("Speech is not available on this system.");
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
    speakFrom(Math.min(start, list.length - 1));
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
      if (state.status === "playing") {
        speakFrom(clamped);
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

  const preview = React.useCallback(
    (voice: SpeechSynthesisVoice | null) => {
      if (!speechSupported()) return;
      const wasPlaying = live.current.status === "playing";
      silence();
      if (wasPlaying) setStatusLive("paused");
      const utterance = new SpeechSynthesisUtterance(
        "This is how your paper will sound, with natural pauses at commas, sentences, and new sections.",
      );
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      }
      utterance.rate = live.current.settings.rate;
      utterance.pitch = live.current.settings.pitch;
      live.current.utterance = utterance;
      window.setTimeout(() => window.speechSynthesis.speak(utterance), 40);
    },
    [setStatusLive, silence],
  );

  // A new voice, speed or pitch is heard at once: restart the current sentence.
  const voiceKey = `${settings.voiceURI}|${settings.rate}|${settings.pitch}|${settings.pauseStyle}`;
  const lastVoiceKey = React.useRef(voiceKey);
  React.useEffect(() => {
    if (lastVoiceKey.current === voiceKey) return;
    lastVoiceKey.current = voiceKey;
    if (live.current.status === "playing") speakFrom(live.current.index);
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
          speakFrom(live.current.index);
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
