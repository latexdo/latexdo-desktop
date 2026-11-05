import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReadAloudBar, usePdfReadAloud, type PdfReadAloud } from "./ReadAloudBar";
import { defaultReadAloudSettings } from "../features/readAloud/readAloudSettings";
import type { PaperSentence } from "../features/readAloud/paperText";

const bridge = vi.hoisted(() => ({
  cloudKeyConfigured: vi.fn(),
  fetchCloudVoices: vi.fn(),
  saveCloudKey: vi.fn(),
  removeCloudKey: vi.fn(),
}));
vi.mock("../features/readAloud/cloudSpeech", async (original) => ({
  ...(await original<typeof import("../features/readAloud/cloudSpeech")>()),
  ...bridge,
}));
const hooks = vi.hoisted(() => ({
  controller: null as PdfReadAloud["controller"] | null,
  settings: null as PdfReadAloud["settings"] | null,
  setSettings: vi.fn(),
  options: null as { currentPage: () => number } | null,
}));
vi.mock("../features/readAloud/useReadAloud", () => ({
  engineUnavailable: () => "",
  useReadAloud: (options: { currentPage: () => number }) => {
    hooks.options = options;
    return hooks.controller;
  },
  useReadAloudSettings: () => [hooks.settings, hooks.setSettings],
  useSpeechVoices: () => [],
}));
const sentence = (text = "A sentence."): PaperSentence => ({
  text,
  spoken: text,
  page: 1,
  kind: "text",
  paragraphStart: false,
  rects: [{ page: 1, x: 0.1, y: 0.8, width: 0.5, height: 0.05 }],
});
function model(): PdfReadAloud {
  return {
    settings: { ...defaultReadAloudSettings },
    setSettings: vi.fn(),
    overlays: [],
    voices: [
      {
        name: "Ava (Premium)",
        lang: "en-US",
        voiceURI: "ava",
        localService: true,
        default: true,
      },
      {
        name: "Samantha",
        lang: "en-US",
        voiceURI: "sam",
        localService: true,
        default: false,
      },
      {
        name: "Thomas",
        lang: "fr-FR",
        voiceURI: "thomas",
        localService: true,
        default: false,
      },
    ],
    controller: {
      status: "paused",
      sentences: [sentence(), sentence("Another sentence.")],
      index: 0,
      current: sentence(),
      error: "",
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      stop: vi.fn(),
      seek: vi.fn(),
      skip: vi.fn(),
      skipSection: vi.fn(),
      preview: vi.fn().mockResolvedValue(undefined),
    },
    cloud: {
      keys: { openai: false, elevenlabs: false },
      saveKey: vi.fn().mockResolvedValue(true),
      removeKey: vi.fn().mockResolvedValue(undefined),
      elevenLabsVoices: [],
      elevenLabsVoicesState: "idle",
      elevenLabsVoicesError: "",
      reloadElevenLabsVoices: vi.fn(),
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  bridge.cloudKeyConfigured.mockResolvedValue(true);
  bridge.fetchCloudVoices.mockResolvedValue([
    { id: "v1", name: "Reader", description: "Calm" },
  ]);
  bridge.saveCloudKey.mockResolvedValue(true);
  bridge.removeCloudKey.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("listening controls", () => {
  it("handles transport, seeking, speed, voice selection and keyboard shortcuts", () => {
    const read = model();
    const close = vi.fn();
    const { rerender } = render(<ReadAloudBar readAloud={read} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(read.controller.play).toHaveBeenCalled();
    for (const [name, delta] of [
      ["Previous sentence", -1],
      ["Next sentence", 1],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(read.controller.skip).toHaveBeenCalledWith(delta);
    }
    fireEvent.click(screen.getByRole("button", { name: "Previous section" }));
    fireEvent.click(screen.getByRole("button", { name: "Next section" }));
    expect(read.controller.skipSection).toHaveBeenCalledWith(-1);
    expect(read.controller.skipSection).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(read.controller.stop).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Reading position"), {
      target: { value: "1" },
    });
    expect(read.controller.seek).toHaveBeenCalledWith(1);
    fireEvent.change(screen.getByLabelText("Speed"), { target: { value: "1.5" } });
    expect(read.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ rate: 1.5 }),
    );
    fireEvent.change(screen.getByLabelText("Voice"), { target: { value: "sam" } });
    expect(read.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ voiceURI: "sam" }),
    );
    const region = screen.getByRole("region");
    for (const key of [" ", "k", "ArrowLeft", "ArrowRight"])
      fireEvent.keyDown(region, { key });
    expect(read.controller.play).toHaveBeenCalledTimes(3);
    fireEvent.keyDown(screen.getByLabelText("Voice"), { key: "k" });
    expect(read.controller.play).toHaveBeenCalledTimes(3);
    read.controller.status = "playing";
    rerender(<ReadAloudBar readAloud={read} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(read.controller.pause).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Listening options" }));
    fireEvent.keyDown(region, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.keyDown(region, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close listening" }));
    expect(close).toHaveBeenCalledTimes(2);
  });
  it("updates listening preferences and renders voice names as text", () => {
    const read = model();
    read.voices[0] = {
      ...read.voices[0],
      name: '<img src=x onerror="alert(1)"> Online (Natural)',
    };
    const { container } = render(<ReadAloudBar readAloud={read} onClose={vi.fn()} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByLabelText("Voice").textContent).toContain(
      '<img src=x onerror="alert(1)">',
    );
    fireEvent.click(screen.getByRole("button", { name: "Listening options" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: "Study" }));
    expect(read.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ pauseStyle: "deliberate" }),
    );
    fireEvent.click(within(dialog).getByRole("radio", { name: "From the start" }));
    expect(read.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ startFrom: "beginning" }),
    );
    for (const checkbox of within(dialog).getAllByRole("checkbox"))
      fireEvent.click(checkbox);
    expect(read.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ followAlong: false }),
    );
    fireEvent.change(within(dialog).getByRole("slider"), { target: { value: "0.9" } });
    expect(read.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ pitch: 0.9 }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Preview" }));
    expect(read.controller.preview).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close listening options" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("configures OpenAI voices, delivery, model and API key", async () => {
    const read = model();
    read.settings.engine = "openai";
    read.cloud.saveKey = vi.fn().mockResolvedValue(false);
    const { rerender } = render(<ReadAloudBar readAloud={read} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Listening options" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Preview" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Voice"), {
      target: { value: "sage" },
    });
    expect(read.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ openaiVoice: "sage" }),
    );
    fireEvent.click(within(dialog).getByRole("radio", { name: "Lecturer" }));
    expect(read.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ openaiStyle: "lecture" }),
    );
    fireEvent.change(within(dialog).getByLabelText("Model"), {
      target: { value: "tts-1" },
    });
    expect(read.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ openaiModel: "tts-1" }),
    );
    fireEvent.change(screen.getByLabelText("OpenAI API key"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("The key could not be saved securely on this computer.");
    expect(read.cloud.saveKey).toHaveBeenCalledWith("openai", "secret");
    expect(screen.getByLabelText("OpenAI API key")).toHaveValue("");
    read.cloud.keys.openai = true;
    read.settings.openaiModel = "tts-1";
    read.settings.openaiVoice = "sage";
    rerender(<ReadAloudBar readAloud={read} onClose={vi.fn()} />);
    expect(within(dialog).getByLabelText("Voice")).toHaveValue("alloy");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(read.cloud.removeKey).toHaveBeenCalledWith("openai");
    fireEvent.click(within(dialog).getByRole("radio", { name: "ElevenLabs" }));
    expect(read.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ engine: "elevenlabs" }),
    );
  });
  it("shows ElevenLabs loading, errors, voices and reload controls", () => {
    const read = model();
    read.settings.engine = "elevenlabs";
    read.cloud.keys.elevenlabs = null;
    const { rerender } = render(<ReadAloudBar readAloud={read} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Listening options" }));
    expect(screen.getByText(/Checking for your ElevenLabs/)).toBeInTheDocument();
    read.cloud.keys.elevenlabs = true;
    read.cloud.elevenLabsVoicesState = "loading";
    rerender(<ReadAloudBar readAloud={read} onClose={vi.fn()} />);
    expect(screen.getAllByText("Loading voices…")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Reload ElevenLabs voices" }));
    expect(read.cloud.reloadElevenLabsVoices).toHaveBeenCalled();
    read.cloud.elevenLabsVoicesState = "error";
    read.cloud.elevenLabsVoicesError = "Network unavailable";
    rerender(<ReadAloudBar readAloud={read} onClose={vi.fn()} />);
    expect(screen.getByText("Network unavailable")).toBeInTheDocument();
    read.cloud.elevenLabsVoices = [{ id: "v1", name: "Reader", description: "Calm" }];
    read.settings.elevenLabsVoice = "v1";
    rerender(<ReadAloudBar readAloud={read} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Voice"), {
      target: { value: "v1" },
    });
    expect(read.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ elevenLabsVoice: "v1" }),
    );
    fireEvent.change(within(dialog).getByLabelText("Model"), {
      target: { value: "eleven_v3" },
    });
    expect(read.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ elevenLabsModel: "eleven_v3" }),
    );
  });
  it.each(["idle", "preparing", "finished", "error"] as const)(
    "shows %s status",
    (status) => {
      const read = model();
      read.controller.status = status;
      read.controller.error = "Speech failed";
      render(<ReadAloudBar readAloud={read} onClose={vi.fn()} />);
      const captions = {
        idle: /Press play to listen/,
        preparing: /Preparing the paper/,
        finished: /Finished reading/,
        error: /Speech failed/,
      };
      expect(screen.getByText(captions[status])).toBeInTheDocument();
    },
  );
});

describe("PDF listening integration", () => {
  it("loads cloud voices, selects a valid voice, saves and removes keys", async () => {
    const read = model();
    hooks.settings = { ...read.settings, engine: "elevenlabs" };
    hooks.controller = read.controller;
    const { result, rerender } = renderHook(usePdfReadAloud, {
      initialProps: {
        pdfData: new Uint8Array([1]),
        surfaceRef: { current: null },
        rotation: 0,
        open: true,
      },
    });
    await waitFor(() =>
      expect(result.current.cloud.elevenLabsVoicesState).toBe("ready"),
    );
    expect(hooks.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ elevenLabsVoice: "v1" }),
    );
    expect(hooks.options?.currentPage()).toBe(1);
    await act(async () => {
      expect(await result.current.cloud.saveKey("elevenlabs", "key")).toBe(true);
    });
    expect(bridge.saveCloudKey).toHaveBeenCalledWith("elevenlabs", "key");
    await act(async () => {
      await result.current.cloud.removeKey("elevenlabs");
    });
    expect(result.current.cloud.keys.elevenlabs).toBe(false);
    expect(result.current.cloud.elevenLabsVoices).toEqual([]);
    rerender({
      pdfData: new Uint8Array([2]),
      surfaceRef: { current: null },
      rotation: 0,
      open: false,
    });
    expect(read.controller.stop).toHaveBeenCalled();
    expect(result.current.overlays).toEqual([]);
  });
  it("reports voice list failure and retries", async () => {
    const read = model();
    hooks.settings = { ...read.settings, engine: "elevenlabs" };
    hooks.controller = read.controller;
    bridge.fetchCloudVoices.mockRejectedValueOnce(new Error("Offline"));
    const { result } = renderHook(() =>
      usePdfReadAloud({
        pdfData: null,
        surfaceRef: { current: null },
        rotation: 0,
        open: true,
      }),
    );
    await waitFor(() =>
      expect(result.current.cloud.elevenLabsVoicesError).toBe("Offline"),
    );
    act(() => result.current.cloud.reloadElevenLabsVoices());
    await waitFor(() =>
      expect(result.current.cloud.elevenLabsVoicesState).toBe("ready"),
    );
    expect(result.current.cloud.elevenLabsVoicesError).toBe("");
  });
  it("highlights and scrolls the current sentence while respecting user scrolling", () => {
    const read = model();
    hooks.settings = read.settings;
    hooks.controller = read.controller;
    const surface = document.createElement("div");
    surface.innerHTML = '<div class="pdf-page" data-page-number="1"></div>';
    Object.defineProperty(surface, "clientHeight", { value: 500 });
    surface.getBoundingClientRect = () =>
      ({ top: 0, bottom: 500, height: 500 }) as DOMRect;
    surface.firstElementChild!.getBoundingClientRect = () =>
      ({ top: 0, bottom: 1000, height: 1000 }) as DOMRect;
    surface.scrollTo = vi.fn();
    const surfaceRef = { current: surface };
    const { result, rerender } = renderHook(usePdfReadAloud, {
      initialProps: { pdfData: null, surfaceRef, rotation: 0, open: true },
    });
    expect(hooks.options?.currentPage()).toBe(1);
    expect(result.current.overlays[0]).toMatchObject({
      pageNumber: 1,
      className: "pdf-read-aloud-highlight",
    });
    expect(surface.scrollTo).toHaveBeenCalledWith({ top: 650, behavior: "smooth" });
    fireEvent.wheel(surface);
    vi.mocked(surface.scrollTo).mockClear();
    rerender({ pdfData: null, surfaceRef, rotation: 90, open: true });
    expect(surface.scrollTo).not.toHaveBeenCalled();
  });
});
