import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock("electron", () => ({ net: { fetch: vi.fn() } }));
vi.mock("./trustedIpc.js", () => ({
  ipcMain: {
    handle: (channel: string, listener: (...args: unknown[]) => unknown) =>
      handlers.set(channel, listener),
  },
}));
vi.mock("./ai/secretStorage.js", () => ({ getCredential: vi.fn() }));

const {
  cloudSpeechCredentialIds,
  listCloudVoices,
  parseCloudSpeechRequest,
  registerCloudSpeechIpc,
  synthesizeCloudSpeech,
} = await import("./cloudSpeech.js");

const audioResponse = () =>
  new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { "content-type": "audio/mpeg" },
  });

function deps(
  response: Response | Error = audioResponse(),
  key: string | null = "sk-test",
) {
  const fetch = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  const getCredential = vi.fn(async () => key);
  return {
    fetch: fetch as unknown as typeof globalThis.fetch,
    getCredential,
    calls: fetch,
  };
}

const request = {
  provider: "openai",
  text: "Hello, world.",
  voice: "coral",
  model: "gpt-4o-mini-tts",
  style: "lecture",
};

describe("parseCloudSpeechRequest", () => {
  it("accepts a well-formed request and trims context", () => {
    expect(
      parseCloudSpeechRequest({ ...request, previousText: "x".repeat(2000) })
        ?.previousText,
    ).toHaveLength(600);
  });

  it.each([
    null,
    { ...request, provider: "acme" },
    { ...request, text: "   " },
    { ...request, text: "a".repeat(4001) },
    { ...request, voice: "../../etc" },
    { ...request, model: "bad model" },
  ])("rejects %j", (raw) => {
    expect(parseCloudSpeechRequest(raw)).toBeNull();
  });
});

describe("synthesizeCloudSpeech", () => {
  it("calls OpenAI with the stored key and narration instructions", async () => {
    const d = deps();
    const result = await synthesizeCloudSpeech(request, d);
    expect(result).toEqual({
      ok: true,
      audio: new Uint8Array([1, 2, 3]),
      mimeType: "audio/mpeg",
    });
    expect(d.getCredential).toHaveBeenCalledWith(cloudSpeechCredentialIds.openai);
    const [url, init] = d.calls.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer sk-test",
    );
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: "gpt-4o-mini-tts",
      voice: "coral",
      input: "Hello, world.",
    });
    expect(body.instructions).toMatch(/lecturer/);
  });

  it("sends no instructions to the classic models", async () => {
    const d = deps();
    await synthesizeCloudSpeech({ ...request, model: "tts-1-hd", voice: "alloy" }, d);
    const [, init] = d.calls.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).instructions).toBeUndefined();
  });

  it("calls ElevenLabs with neighbouring text for smooth intonation", async () => {
    const d = deps();
    await synthesizeCloudSpeech(
      {
        provider: "elevenlabs",
        text: "Second.",
        voice: "abc123",
        model: "eleven_multilingual_v2",
        previousText: "First.",
        nextText: "Third.",
      },
      d,
    );
    const [url, init] = d.calls.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("https://api.elevenlabs.io/v1/text-to-speech/abc123");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("sk-test");
    expect(JSON.parse(init.body as string)).toMatchObject({
      text: "Second.",
      model_id: "eleven_multilingual_v2",
      previous_text: "First.",
      next_text: "Third.",
    });
  });

  it("explains missing keys, bad keys, quotas and network failures", async () => {
    expect(await synthesizeCloudSpeech(request, deps(undefined, null))).toMatchObject({
      ok: false,
      code: "missing-key",
    });
    expect(
      await synthesizeCloudSpeech(request, deps(new Response("{}", { status: 401 }))),
    ).toMatchObject({ ok: false, code: "auth" });
    expect(
      await synthesizeCloudSpeech(
        request,
        deps(
          new Response(JSON.stringify({ error: { message: "Slow down" } }), {
            status: 429,
          }),
        ),
      ),
    ).toMatchObject({
      ok: false,
      code: "quota",
      error: expect.stringContaining("Slow down"),
    });
    expect(
      await synthesizeCloudSpeech(request, deps(new Error("offline"))),
    ).toMatchObject({
      ok: false,
      code: "network",
    });
    expect(await synthesizeCloudSpeech({ ...request, text: "" }, deps())).toMatchObject(
      {
        ok: false,
        code: "invalid-request",
      },
    );
  });
});

describe("listCloudVoices", () => {
  it("returns the account's ElevenLabs voices", async () => {
    const d = deps(
      new Response(
        JSON.stringify({
          voices: [
            {
              voice_id: "v1",
              name: "Rachel",
              labels: { accent: "american", gender: "female" },
            },
            { voice_id: "bad id!", name: "Broken" },
          ],
        }),
        { status: 200 },
      ),
    );
    expect(await listCloudVoices("elevenlabs", d)).toEqual({
      ok: true,
      voices: [{ id: "v1", name: "Rachel", description: "american · female" }],
    });
    expect(await listCloudVoices("openai", d)).toMatchObject({ ok: false });
  });
});

describe("registerCloudSpeechIpc", () => {
  beforeEach(() => handlers.clear());
  it("registers the speech channels", () => {
    registerCloudSpeechIpc(deps());
    expect([...handlers.keys()]).toEqual(["tts:synthesize", "tts:voices"]);
  });
});
