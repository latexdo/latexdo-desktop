import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectLocalTranscriptionServers,
  looksLikeSpeechModel,
} from "./localTranscriptionDetection";

const fetchMock =
  vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function modelsResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    },
  } as unknown as Response;
}

function failResponse(): Response {
  return {
    ok: false,
    status: 500,
    async json() {
      return {};
    },
  } as unknown as Response;
}

describe("localTranscriptionDetection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("classifies speech model names", () => {
    expect(looksLikeSpeechModel("whisper-large-v3")).toBe(true);
    expect(looksLikeSpeechModel("openai/whisper-1")).toBe(true);
    expect(looksLikeSpeechModel("gpt-4o-mini-transcribe")).toBe(true);
    expect(looksLikeSpeechModel("qwen2.5-coder")).toBe(false);
    expect(looksLikeSpeechModel("llama-3.2-3b")).toBe(false);
  });

  it("reports servers that answer with their speech model", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes(":1234")) {
        return modelsResponse({
          data: [{ id: "llama-3.2-3b" }, { id: "whisper-large-v3" }],
        });
      }
      if (url.includes(":8080")) return modelsResponse({ models: [] });
      return failResponse();
    });

    const servers = await detectLocalTranscriptionServers();

    expect(fetchMock).toHaveBeenCalled();
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    for (const url of urls) {
      expect(url).toMatch(/^http:\/\/localhost:\d+\/v1\/models$/);
    }

    expect(servers.map((s) => s.baseUrl)).toEqual(
      expect.arrayContaining(["http://localhost:1234/v1", "http://localhost:8080/v1"]),
    );
    const lm = servers.find((s) => s.baseUrl.includes(":1234"));
    expect(lm?.speechModel).toBe("whisper-large-v3");
  });

  it("never probes non-loopback addresses", async () => {
    await detectLocalTranscriptionServers({ allowNonLoopback: false });
    for (const call of fetchMock.mock.calls) {
      expect(new URL(String(call[0])).hostname).toBe("localhost");
    }
  });

  it("skips servers that error, hang, or answer with the wrong body", async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError("connection refused");
    });

    const servers = await detectLocalTranscriptionServers({ timeoutMs: 50 });
    expect(servers).toEqual([]);
  });
});
