import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCloudCredential } from "../ai/cloudCredentials";
import { toWhisperWav } from "./wavEncoding";
import { defaultAiConfig, type AiConfig } from "../ai/aiConfig";
import {
  OpenAiTranscriptionProvider,
  TranscriptionError,
  audioExtensionForType,
  createTranscriptionProvider,
  openAiVoiceCredentialId,
} from "./transcription";

vi.mock("../ai/cloudCredentials", () => ({
  loadCloudCredential: vi.fn(),
}));

vi.mock("./wavEncoding", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./wavEncoding")>();
  return { ...actual, toWhisperWav: vi.fn(actual.toWhisperWav) };
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
    async json() {
      return body;
    },
  } as unknown as Response;
}

const fetchMock =
  vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function provider(
  opts: Partial<{ baseUrl: string; model: string; credentialId: string }> = {},
) {
  return new OpenAiTranscriptionProvider({
    baseUrl: opts.baseUrl,
    model: opts.model,
    credentialId: opts.credentialId ?? "credential-openai-primary",
  });
}

function audio(size = 100): Blob {
  return new Blob([new Uint8Array(size)], { type: "audio/webm" });
}

describe("transcription provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadCloudCredential).mockResolvedValue("sk-test");
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (globalThis as { aiApi?: unknown }).aiApi;
  });

  it("sends a multipart request to the transcription endpoint with the vaulted key", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { text: "Hello world." }));

    const result = await provider().transcribe({
      audio: audio(),
      language: "en",
    });

    expect(result.text).toBe("Hello world.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.openai.com/v1/audio/transcriptions");

    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-test");
    expect(headers["content-type"]).toBeUndefined(); // multipart managed by FormData

    const body = init?.body as FormData;
    expect(body.get("model")).toBe("whisper-1");
    expect(body.get("response_format")).toBe("json");
    expect(body.get("language")).toBe("en");
    expect(body.get("temperature")).toBe("0");
    const file = body.get("file") as File;
    expect(file).toBeInstanceOf(Blob);
    expect(file.name).toBe("recording.webm");
  });

  it("honours a custom base URL and model", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { text: "hi" }));
    await provider({
      baseUrl: "https://gateway.example.com/v1",
      model: "whisper-1",
    }).transcribe({ audio: audio() });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://gateway.example.com/v1/audio/transcriptions");
    expect((init?.body as FormData).get("model")).toBe("whisper-1");
  });

  it("uses the vaulted credential resolution (no key in renderer state)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { text: "ok" }));
    const result = await provider().transcribe({ audio: audio() });
    expect(result.text).toBe("ok");
    expect(loadCloudCredential).toHaveBeenCalledWith("credential-openai-primary");
  });

  it("reports an unavailable credential, not a microphone denial", async () => {
    vi.mocked(loadCloudCredential).mockResolvedValueOnce(null);
    await expect(provider().transcribe({ audio: audio() })).rejects.toMatchObject({
      code: "credential-unavailable",
      message: expect.stringContaining("API key"),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows keyless local speech servers when opted in", async () => {
    // Local whisper servers usually need no Authorization header.
    vi.mocked(loadCloudCredential).mockResolvedValue(null);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { text: "local" }));

    const result = await new OpenAiTranscriptionProvider({
      credentialId: "credential-voice-stt-primary",
      baseUrl: "http://localhost:8080/v1",
      model: "whisper-large-v3",
      allowKeyless: true,
    }).transcribe({ audio: audio() });

    expect(result.text).toBe("local");
    expect(loadCloudCredential).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://localhost:8080/v1/audio/transcriptions");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  it("asks the desktop bridge to start bundled local speech before transcription", async () => {
    vi.mocked(loadCloudCredential).mockResolvedValue(null);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { text: "local" }));
    const ensureSpeechServer = vi.fn().mockResolvedValue({
      ok: true,
      baseUrl: "http://localhost:8080/v1",
      model: "whisper-1",
      alreadyRunning: false,
      bundled: true,
    });
    (globalThis as { aiApi?: unknown }).aiApi = { ensureSpeechServer };

    await new OpenAiTranscriptionProvider({
      credentialId: "credential-voice-stt-primary",
      baseUrl: "http://localhost:8080/v1",
      model: "whisper-1",
      allowKeyless: true,
    }).transcribe({ audio: audio() });

    expect(ensureSpeechServer).toHaveBeenCalledWith({
      baseUrl: "http://localhost:8080/v1",
      model: "whisper-1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces bundled speech startup failures without posting audio", async () => {
    vi.mocked(loadCloudCredential).mockResolvedValue(null);
    (globalThis as { aiApi?: unknown }).aiApi = {
      ensureSpeechServer: vi.fn().mockResolvedValue({
        ok: false,
        code: "missing-runtime",
        error: "This LatexDo build is missing the bundled local speech runtime.",
      }),
    };

    await expect(
      new OpenAiTranscriptionProvider({
        credentialId: "credential-voice-stt-primary",
        baseUrl: "http://localhost:8080/v1",
        model: "whisper-1",
        allowKeyless: true,
      }).transcribe({ audio: audio() }),
    ).rejects.toMatchObject({
      code: "transcription-failed",
      message: "This LatexDo build is missing the bundled local speech runtime.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps provider HTTP errors to transcription-failed", async () => {
    vi.mocked(loadCloudCredential).mockResolvedValueOnce("sk-testa");
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, "unauthorized \u0000\ninvalid key"),
    );
    const err = await provider()
      .transcribe({ audio: audio() })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(TranscriptionError);
    expect((err as TranscriptionError).code).toBe("transcription-failed");
    expect((err as TranscriptionError).message).toContain("401");
  });

  it("maps an empty transcript to empty-recording", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { text: "   " }));
    await expect(provider().transcribe({ audio: audio() })).rejects.toMatchObject({
      code: "empty-recording",
    });
  });

  it("aborts the network request when the signal is aborted", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(new DOMException("aborted", "AbortError"));
            return;
          }
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    controller.abort();
    await expect(
      provider().transcribe({ audio: audio(), signal: controller.signal }),
    ).rejects.toMatchObject({ code: "cancelled" });
  });

  it("derives the file extension from the recorded MIME type", () => {
    expect(audioExtensionForType("audio/webm;codecs=opus")).toBe("webm");
    expect(audioExtensionForType("audio/mp4")).toBe("m4a");
    expect(audioExtensionForType("audio/ogg")).toBe("ogg");
    expect(audioExtensionForType("audio/wav")).toBe("wav");
    expect(audioExtensionForType(undefined)).toBe("webm");
  });
});

describe("createTranscriptionProvider resolution", () => {
  it("prefers an explicit standalone endpoint, even for non-cloud setups", () => {
    // Anthropic-only cloud + no STT endpoint → unsupported.
    const anthropic: AiConfig = {
      ...defaultAiConfig,
      provider: "cloud",
      cloud: {
        ...defaultAiConfig.cloud,
        vendor: "anthropic",
        credentialConfigured: true,
      },
    };
    expect(createTranscriptionProvider(anthropic)).toBeNull();

    // Add a standalone local OpenAI-compatible speech endpoint: now dictation
    // works while the chat provider stays Anthropic.
    const provider = createTranscriptionProvider(anthropic, {
      baseUrl: "http://localhost:8080/v1",
      credentialId: "credential-voice-stt-primary",
      model: "whisper-large-v3",
    });
    expect(provider).toBeInstanceOf(OpenAiTranscriptionProvider);
  });

  it("does not fall back to the configured OpenAI cloud provider", () => {
    const openai: AiConfig = {
      ...defaultAiConfig,
      provider: "cloud",
      cloud: {
        ...defaultAiConfig.cloud,
        vendor: "openai",
        credentialConfigured: true,
        credentialId: "credential-openai-primary",
      },
    };
    expect(createTranscriptionProvider(openai, { model: "x" })).toBeNull();
    expect(
      createTranscriptionProvider(openai, {
        baseUrl: "http://localhost:8080/v1",
        model: "x",
      }),
    ).toBeInstanceOf(OpenAiTranscriptionProvider);
  });

  it("creates an explicit OpenAI cloud speech provider when requested", async () => {
    const provider = createTranscriptionProvider(defaultAiConfig, {
      mode: "openai",
      model: "gpt-transcribe",
    });
    expect(provider).toBeInstanceOf(OpenAiTranscriptionProvider);

    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(loadCloudCredential).mockResolvedValueOnce("sk-openai");
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { text: "from cloud" }));

    try {
      await expect(provider?.transcribe({ audio: audio() })).resolves.toMatchObject({
        text: "from cloud",
      });
      expect(loadCloudCredential).toHaveBeenCalledWith(openAiVoiceCredentialId);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe("https://api.openai.com/v1/audio/transcriptions");
      expect((init?.body as FormData).get("model")).toBe("gpt-transcribe");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses non-local speech endpoints", () => {
    expect(
      createTranscriptionProvider(defaultAiConfig, {
        baseUrl: "https://api.openai.com/v1",
        model: "whisper-1",
      }),
    ).toBeNull();
  });

  it("does not fall back through Anthropic or no-credential cloud configs", () => {
    expect(
      createTranscriptionProvider({
        ...defaultAiConfig,
        provider: "cloud",
        cloud: { ...defaultAiConfig.cloud, vendor: "anthropic" },
      }),
    ).toBeNull();
    expect(
      createTranscriptionProvider({
        ...defaultAiConfig,
        provider: "off",
      }),
    ).toBeNull();
  });
});

describe("transcription provider failure modes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadCloudCredential).mockResolvedValue("sk-test");
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as { aiApi?: unknown }).aiApi;
  });

  const local = (maxErrorChars?: number) =>
    new OpenAiTranscriptionProvider({
      credentialId: "credential-voice-stt-primary",
      baseUrl: "http://127.0.0.1:8080/v1",
      allowKeyless: true,
      maxErrorChars,
    });

  it("converts to a voice dictation error with its code and cause", () => {
    const error = new TranscriptionError("cancelled", "stop", "why");
    expect(error.toVoiceDictationError()).toMatchObject({
      code: "cancelled",
      message: "stop",
    });
  });

  it("maps mp3 audio", () => {
    expect(audioExtensionForType("audio/mpeg; mp3")).toBe("mp3");
  });

  it("cancels when aborted while the local speech server starts", async () => {
    const controller = new AbortController();
    (globalThis as { aiApi?: unknown }).aiApi = {
      ensureSpeechServer: vi.fn(async () => {
        controller.abort();
        return {
          ok: true,
          baseUrl: "",
          model: "",
          alreadyRunning: true,
          bundled: true,
        };
      }),
    };
    await expect(
      local().transcribe({ audio: audio(), signal: controller.signal }),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explains unreachable local and cloud services", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));
    await expect(local().transcribe({ audio: audio() })).rejects.toMatchObject({
      code: "transcription-failed",
      message:
        "LatexDo could not reach the bundled local speech service. Restart LatexDo and try again.",
    });
    await expect(provider().transcribe({ audio: audio() })).rejects.toMatchObject({
      message: "Voice transcription failed. Your existing text was not changed.",
    });
  });

  it("sanitises and truncates provider error bodies, tolerating unreadable bodies", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(500, "bad\u0001\u007f thing happened"),
    );
    const error = (await local(5)
      .transcribe({ audio: audio() })
      .catch((e: unknown) => e)) as TranscriptionError;
    expect(error.cause).toBe("bad t…");

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: () => Promise.reject(new Error("stream")),
    } as unknown as Response);
    const unreadable = (await provider()
      .transcribe({ audio: audio() })
      .catch((e: unknown) => e)) as TranscriptionError;
    expect(unreadable.message).toContain("502");
    expect(unreadable.cause).toBe("");
  });

  it("rejects invalid JSON and server-reported errors", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError("json")),
    } as unknown as Response);
    await expect(provider().transcribe({ audio: audio() })).rejects.toMatchObject({
      code: "transcription-failed",
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { error: "  model missing  " }));
    await expect(provider().transcribe({ audio: audio() })).rejects.toMatchObject({
      message: "The speech service could not transcribe the recording (model missing).",
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, null));
    await expect(provider().transcribe({ audio: audio() })).rejects.toMatchObject({
      code: "empty-recording",
    });
  });

  it("sends the original recording when WAV conversion fails", async () => {
    vi.mocked(toWhisperWav).mockRejectedValueOnce(new Error("no AudioContext"));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { text: "raw" }));
    const recording = audio();
    await local().transcribe({ audio: recording });
    const file = (fetchMock.mock.calls[0][1]?.body as FormData).get("file") as File;
    expect(file.name).toBe("recording.webm");
    expect(file.size).toBe(recording.size);
  });

  it("returns the detected language", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { text: "Bonjour", language: "fr" }),
    );
    await expect(provider().transcribe({ audio: audio() })).resolves.toEqual({
      text: "Bonjour",
      language: "fr",
    });
  });

  it("only treats http(s) loopback hosts as local", () => {
    expect(
      createTranscriptionProvider(defaultAiConfig, { baseUrl: "ftp://localhost/v1" }),
    ).toBeNull();
    expect(
      createTranscriptionProvider(defaultAiConfig, { baseUrl: "not a url" }),
    ).toBeNull();
    expect(
      createTranscriptionProvider(defaultAiConfig, { baseUrl: "http://[::1]:9000/v1" }),
    ).toBeInstanceOf(OpenAiTranscriptionProvider);
  });

  it("uses default model and credential for OpenAI mode", async () => {
    vi.mocked(loadCloudCredential).mockResolvedValueOnce("sk-openai");
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { text: "ok" }));
    const cloud = createTranscriptionProvider(defaultAiConfig, { mode: "openai" })!;
    await cloud.transcribe({ audio: audio() });
    expect(loadCloudCredential).toHaveBeenCalledWith(openAiVoiceCredentialId);
    expect((fetchMock.mock.calls[0][1]?.body as FormData).get("model")).toBeTruthy();
  });
});
