import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReadAloud, useReadAloudSettings, useSpeechVoices } from "./useReadAloud";
import {
  defaultReadAloudSettings,
  readAloudSettingsStorageKey,
  saveReadAloudSettings,
} from "./readAloudSettings";

const pdf = vi.hoisted(() => ({
  getDocument: vi.fn(),
  destroy: vi.fn(),
  getPage: vi.fn(),
}));
const cloud = vi.hoisted(() => ({
  load: vi.fn(),
  speak: vi.fn(),
  prefetch: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: pdf.getDocument,
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));
vi.mock("./cloudSpeech", () => ({
  cloudSpeechAvailable: () => true,
  CloudSpeechPlayer: class {
    load = cloud.load;
    speak = cloud.speak;
    prefetch = cloud.prefetch;
    stop = cloud.stop;
  },
}));
class Utterance {
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(readonly text: string) {}
}
const utterances: Utterance[] = [];
const voice = {
  name: "Ava (Premium)",
  voiceURI: "ava",
  lang: "en-US",
  localService: true,
  default: true,
};
const synth = {
  speak: vi.fn((u: Utterance) => {
    utterances.push(u);
  }),
  cancel: vi.fn(),
  getVoices: vi.fn(() => [voice]),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  speaking: true,
  pending: false,
};
function props() {
  return {
    pdfData: new Uint8Array([1]) as Uint8Array | null,
    settings: { ...defaultReadAloudSettings },
    voices: [voice],
    currentPage: () => 1,
  };
}
async function tick(ms = 40) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function play(result: { current: ReturnType<typeof useReadAloud> }) {
  await act(async () => {
    await result.current.play();
  });
  await tick();
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  utterances.length = 0;
  synth.speaking = true;
  vi.stubGlobal("speechSynthesis", synth);
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  cloud.load.mockResolvedValue(new Blob());
  cloud.speak.mockResolvedValue(undefined);
  pdf.getDocument.mockImplementation(() => ({
    promise: Promise.resolve({
      numPages: 2,
      getPage: pdf.getPage,
      destroy: pdf.destroy,
    }),
  }));
  pdf.getPage.mockImplementation(async (page: number) => ({
    view: [0, 0, 612, 792],
    getTextContent: async () => ({
      items: [
        {},
        {
          str:
            page === 1
              ? "First sentence is here. Second sentence is here."
              : "Final sentence is here.",
          transform: [10, 0, 0, 10, 72, 700],
          width: 240,
          height: 10,
          hasEOL: true,
        },
      ],
    }),
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("reading controller", () => {
  it("loads PDF text, reads from the visible page, finishes and restarts", async () => {
    const options = { ...props(), currentPage: () => 2 };
    const { result } = renderHook(() => useReadAloud(options));
    await play(result);
    expect(result.current.index).toBe(2);
    expect(utterances[0].text).toBe("Final sentence is here.");
    expect(utterances[0]).toMatchObject({ voice, lang: "en-US", rate: 1, pitch: 1 });
    expect(pdf.destroy).toHaveBeenCalled();
    act(() => utterances[0].onend?.());
    await tick(1);
    expect(result.current.status).toBe("finished");
    await play(result);
    expect(pdf.getDocument).toHaveBeenCalledTimes(1);
    expect(utterances).toHaveLength(2);
  });
  it("pauses, resumes, seeks, skips sections, and stops", async () => {
    const options = props();
    const { result } = renderHook(() => useReadAloud(options));
    act(() => {
      result.current.pause();
      result.current.seek(20);
    });
    await play(result);
    await act(async () => {
      await result.current.play();
    });
    expect(utterances).toHaveLength(1);
    act(() => result.current.pause());
    expect(result.current.status).toBe("paused");
    act(() => result.current.skip(1));
    expect(result.current.index).toBe(1);
    await play(result);
    expect(utterances.at(-1)?.text).toBe("Second sentence is here.");
    act(() => result.current.seek(99));
    await tick();
    expect(result.current.index).toBe(2);
    act(() => result.current.pause());
    act(() => result.current.skipSection(-1));
    expect(result.current.index).toBe(0);
    act(() => result.current.skipSection(1));
    expect(result.current.index).toBe(2);
    act(() => result.current.stop());
    expect(result.current.status).toBe("idle");
    expect(result.current.index).toBe(0);
    act(() => result.current.seek(-2));
    expect(result.current.status).toBe("paused");
  });
  it("advances through sentences and recovers when an engine drops its end event", async () => {
    const options = props();
    const { result } = renderHook(() => useReadAloud(options));
    await play(result);
    act(() => utterances[0].onend?.());
    await tick(150);
    expect(result.current.index).toBe(1);
    synth.speaking = false;
    await tick(2200);
    expect(result.current.index).toBe(2);
    await tick(1600);
    expect(result.current.status).toBe("finished");
  });
  it.each(["voice-unavailable", "language-unavailable", "network"])(
    "reports engine failure %s",
    async (error) => {
      const options = props();
      const { result } = renderHook(() => useReadAloud(options));
      await play(result);
      await act(async () => utterances[0].onerror?.({ error }));
      expect(result.current.status).toBe("error");
      expect(result.current.error).toContain(
        error === "network" ? "unexpectedly" : "Choose another voice",
      );
    },
  );
  it.each(["interrupted", "canceled"])(
    "accepts cancellation %s without reporting failure",
    async (error) => {
      const options = props();
      const { result } = renderHook(() => useReadAloud(options));
      await play(result);
      act(() => result.current.pause());
      await act(async () => utterances[0].onerror?.({ error }));
      expect(result.current.status).toBe("paused");
      expect(result.current.error).toBe("");
    },
  );
  it("reports missing, unreadable, and empty PDFs", async () => {
    const { result, rerender } = renderHook(useReadAloud, {
      initialProps: { ...props(), pdfData: null as Uint8Array | null },
    });
    await play(result);
    expect(result.current.error).toContain("no readable text");
    pdf.getDocument.mockReturnValue({ promise: Promise.reject(new Error("bad pdf")) });
    rerender(props());
    await play(result);
    expect(result.current.error).toContain("could not be read");
    pdf.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 0, destroy: pdf.destroy }),
    });
    rerender(props());
    await play(result);
    expect(result.current.error).toContain("no readable text");
  });
  it("changes voice immediately and preserves position after recompilation", async () => {
    const options = props();
    const { result, rerender } = renderHook(useReadAloud, { initialProps: options });
    await play(result);
    act(() => result.current.seek(1));
    await tick();
    rerender({ ...options, settings: { ...options.settings, rate: 1.5 } });
    await tick();
    expect(utterances.at(-1)).toMatchObject({ rate: 1.5 });
    rerender({
      ...options,
      pdfData: new Uint8Array([2]),
      settings: { ...options.settings, skipCitations: false },
    });
    await tick(80);
    expect(result.current.current?.text).toBe("Second sentence is here.");
    expect(pdf.getDocument).toHaveBeenCalledTimes(2);
    rerender({ ...options, pdfData: null });
    expect(result.current.status).toBe("idle");
    expect(result.current.sentences).toEqual([]);
  });
  it("previews a system voice and pauses active reading", async () => {
    const options = props();
    const { result } = renderHook(() => useReadAloud(options));
    await play(result);
    let preview: Promise<void>;
    act(() => {
      preview = result.current.preview();
    });
    await tick();
    expect(result.current.status).toBe("paused");
    expect(utterances.at(-1)?.text).toContain("This is how your paper");
    await act(async () => {
      utterances.at(-1)?.onend?.();
      await preview;
    });
  });
  it("prefetches cloud audio and finishes without invoking system speech", async () => {
    const options = props();
    options.settings.engine = "openai";
    options.settings.pauseStyle = "deliberate";
    const { result } = renderHook(() => useReadAloud(options));
    await play(result);
    await tick(3000);
    expect(result.current.status).toBe("finished");
    expect(cloud.load).toHaveBeenCalledTimes(1);
    expect(cloud.prefetch).toHaveBeenCalledWith(
      "Second sentence is here.",
      expect.objectContaining({ provider: "openai" }),
      expect.objectContaining({ previousText: "First sentence is here." }),
    );
    expect(cloud.speak).toHaveBeenCalledTimes(3);
    expect(synth.speak).not.toHaveBeenCalled();
  });
  it("reports cloud failures and preview failures", async () => {
    const options = props();
    options.settings.engine = "openai";
    cloud.load.mockRejectedValue(new Error("Quota exceeded"));
    const { result } = renderHook(() => useReadAloud(options));
    await play(result);
    expect(result.current.error).toBe("Quota exceeded");
    cloud.speak.mockRejectedValue(new Error("Playback failed"));
    let preview: Promise<void>;
    act(() => {
      preview = result.current.preview();
    });
    await tick();
    await act(async () => {
      await preview;
    });
    expect(result.current.error).toBe("Playback failed");
  });
});

describe("listening preferences and installed voices", () => {
  it("normalizes, persists, and synchronizes settings", () => {
    localStorage.setItem(readAloudSettingsStorageKey, "invalid json");
    const { result } = renderHook(useReadAloudSettings);
    expect(result.current[0]).toEqual(defaultReadAloudSettings);
    act(() => result.current[1]({ ...defaultReadAloudSettings, rate: 1.5 }));
    expect(
      JSON.parse(localStorage.getItem(readAloudSettingsStorageKey)!),
    ).toMatchObject({ rate: 1.5 });
    act(() => saveReadAloudSettings({ ...defaultReadAloudSettings, pitch: 1.1 }));
    expect(result.current[0].pitch).toBe(1.1);
  });
  it("refreshes installed voices and removes its listener", async () => {
    const { result, unmount } = renderHook(useSpeechVoices);
    expect(result.current).toEqual([voice]);
    expect(synth.addEventListener).toHaveBeenCalledWith(
      "voiceschanged",
      expect.any(Function),
    );
    await tick(600);
    expect(synth.getVoices.mock.calls.length).toBeGreaterThan(2);
    unmount();
    expect(synth.removeEventListener).toHaveBeenCalledWith(
      "voiceschanged",
      expect.any(Function),
    );
  });
});
