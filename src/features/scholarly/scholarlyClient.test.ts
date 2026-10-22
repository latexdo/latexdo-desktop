import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ScholarlyHttpError,
  abortError,
  defaultProviderCooldownMs,
  desktopScholarlyFetcher,
  doiToUrl,
  fetchJson,
  isAbortError,
  lookupCrossrefByDoi,
  lookupOpenAlexByDoi,
  normalizeDoi,
  normalizeTitle,
  paperFromCrossref,
  paperFromOpenAlex,
  providerErrorLabel,
  providerOnCooldown,
  rememberProviderFailure,
  requestUrl,
  scholarlyFetcher,
  searchCrossref,
  searchOpenAlex,
} from "./scholarlyClient";

type Win = { latexdo?: unknown };

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

afterEach(() => {
  delete (window as unknown as Win).latexdo;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("small helpers", () => {
  it.each([
    "\t HTTPS://DOI.ORG/10.1234/Example \n",
    "\n http://dx.doi.org/10.1234/Example\t",
    "  DOI: 10.1234/Example  ",
    "  10.1234/Example  ",
  ])("normalizes pasted DOI %j before building its link", (input) => {
    expect(normalizeDoi(input)).toBe("10.1234/example");
    expect(doiToUrl(input)).toBe("https://doi.org/10.1234/example");
  });

  it("normalises DOIs and titles", () => {
    expect(normalizeDoi(" https://dx.doi.org/10.1/AB ")).toBe("10.1/ab");
    expect(normalizeDoi("doi:10.2/x")).toBe("10.2/x");
    expect(normalizeDoi(undefined)).toBe("");
    expect(doiToUrl("10.1/x")).toBe("https://doi.org/10.1/x");
    expect(doiToUrl("")).toBeUndefined();
    expect(normalizeTitle("The \\emph{Art} of an Edit!")).toBe("art of edit");
    expect(normalizeTitle(undefined)).toBe("");
  });

  it("reads request URLs of every input kind", () => {
    expect(requestUrl("https://a.test/x")).toBe("https://a.test/x");
    expect(requestUrl(new URL("https://b.test/y"))).toBe("https://b.test/y");
    expect(requestUrl(new Request("https://c.test/z"))).toBe("https://c.test/z");
  });

  it("recognises abort errors", () => {
    expect(isAbortError(abortError())).toBe(true);
    expect(isAbortError(Object.assign(new Error("x"), { name: "AbortError" }))).toBe(
      true,
    );
    expect(isAbortError(new Error("x"))).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
  });

  it("labels provider errors", () => {
    expect(providerErrorLabel("Crossref", new Error("boom"))).toBe("Crossref: boom");
    expect(providerErrorLabel("OpenAlex", "?")).toBe("OpenAlex: request failed");
  });

  it("puts a provider on cooldown only after HTTP 429", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    rememberProviderFailure("OpenAlex", new Error("plain"));
    rememberProviderFailure("OpenAlex", new ScholarlyHttpError("x", true, 500));
    expect(providerOnCooldown("OpenAlex")).toBe(false);
    rememberProviderFailure("OpenAlex", new ScholarlyHttpError("x", false, 429, 1000));
    expect(providerOnCooldown("OpenAlex")).toBe(true);
    vi.setSystemTime(1001);
    expect(providerOnCooldown("OpenAlex")).toBe(false);
    rememberProviderFailure("Crossref", new ScholarlyHttpError("x", false, 429));
    vi.setSystemTime(defaultProviderCooldownMs);
    expect(providerOnCooldown("Crossref")).toBe(true);
    vi.setSystemTime(defaultProviderCooldownMs + 1002);
    expect(providerOnCooldown("Crossref")).toBe(false);
  });
});

describe("desktopScholarlyFetcher", () => {
  it("is unavailable without the desktop bridge", () => {
    expect(desktopScholarlyFetcher()).toBeUndefined();
    (window as unknown as Win).latexdo = {};
    expect(desktopScholarlyFetcher()).toBeUndefined();
  });

  it("wraps bridge envelopes and raw JSON in responses", async () => {
    const bridge = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: { a: 1 } })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        retryAfterMs: 50,
        error: "slow",
      })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ plain: true });
    (window as unknown as Win).latexdo = { fetchScholarlyJson: bridge };
    const fetcher = desktopScholarlyFetcher()!;

    const ok = await fetcher(new URL("https://api.test/1"));
    expect(bridge).toHaveBeenCalledWith("https://api.test/1");
    expect(await ok.json()).toEqual({ a: 1 });

    const limited = await fetcher("https://api.test/2");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("x-latexdo-retry-after-ms")).toBe("50");
    expect(await limited.json()).toEqual({ error: "slow" });

    const failed = await fetcher("https://api.test/3");
    expect(failed.status).toBe(502);
    expect(failed.headers.get("x-latexdo-retry-after-ms")).toBeNull();
    expect(await failed.json()).toEqual({ error: "Request failed" });

    expect(await (await fetcher("https://api.test/4")).json()).toEqual({ plain: true });
  });

  it("honours abort signals before and during the request", async () => {
    let resolve!: (value: unknown) => void;
    const bridge = vi.fn(() => new Promise((r) => (resolve = r)));
    (window as unknown as Win).latexdo = { fetchScholarlyJson: bridge };
    const fetcher = desktopScholarlyFetcher()!;

    const aborted = new AbortController();
    aborted.abort();
    await expect(fetcher("https://x.test", { signal: aborted.signal })).rejects.toThrow(
      "aborted",
    );
    expect(bridge).not.toHaveBeenCalled();

    const controller = new AbortController();
    const pending = fetcher("https://x.test", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    const completes = new AbortController();
    const done = fetcher("https://x.test", { signal: completes.signal });
    resolve({ ok: true, json: [1] });
    expect(await (await done).json()).toEqual([1]);
  });

  it("fails when the bridge does not return a request", async () => {
    (window as unknown as Win).latexdo = { fetchScholarlyJson: () => undefined };
    await expect(desktopScholarlyFetcher()!("https://x.test")).rejects.toThrow(
      "Scholarly metadata API is unavailable.",
    );
  });
});

describe("scholarlyFetcher", () => {
  it("prefers a custom fetcher, then the bridge, then global fetch", () => {
    const custom = vi.fn() as unknown as typeof fetch;
    expect(scholarlyFetcher(custom)).toBe(custom);
    const globalFetch = vi.fn(() => Promise.resolve(json({})));
    vi.stubGlobal("fetch", globalFetch);
    const bound = scholarlyFetcher()!;
    void bound("https://x.test");
    expect(globalFetch).toHaveBeenCalled();
    (window as unknown as Win).latexdo = { fetchScholarlyJson: vi.fn() };
    expect(scholarlyFetcher()).not.toBe(bound);
    delete (window as unknown as Win).latexdo;
    vi.stubGlobal("fetch", undefined);
    expect(scholarlyFetcher()).toBeUndefined();
  });
});

describe("fetchJson", () => {
  beforeEach(() => vi.stubGlobal("fetch", undefined));

  it("fails without any fetcher", async () => {
    await expect(fetchJson("https://x.test")).rejects.toThrow(
      "Scholarly metadata fetch is unavailable.",
    );
  });

  it("retries a server error once and reports the last failure", async () => {
    const fetcher = vi.fn(async () => json({}, 503));
    await expect(
      fetchJson("https://api.host.test/x", { fetcher, retryDelayMs: 0 }),
    ).rejects.toMatchObject({ status: 503, message: "HTTP 503 from api.host.test" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not retry client errors and keeps the retry-after hint", async () => {
    const fetcher = vi.fn(async () =>
      json({}, 429, { "x-latexdo-retry-after-ms": "1500" }),
    );
    await expect(fetchJson("https://x.test", { fetcher })).rejects.toMatchObject({
      retryable: false,
      retryAfterMs: 1500,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries a network error after waiting, then succeeds", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(json({ ok: 1 }));
    const result = fetchJson("https://x.test", { fetcher, retryDelayMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toEqual({ ok: 1 });
  });

  it("wraps non-Error failures", async () => {
    const fetcher = vi.fn().mockRejectedValue("bad");
    await expect(
      fetchJson("https://x.test", { fetcher, retryDelayMs: 0 }),
    ).rejects.toThrow("Scholarly metadata request failed");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rethrows aborts immediately and aborts during the retry wait", async () => {
    const abortingFetcher = vi.fn().mockRejectedValue(abortError());
    await expect(
      fetchJson("https://x.test", { fetcher: abortingFetcher }),
    ).rejects.toThrow("aborted");
    expect(abortingFetcher).toHaveBeenCalledTimes(1);

    const outer = new AbortController();
    const failing = vi.fn(async () => {
      outer.abort();
      throw new TypeError("network");
    });
    await expect(
      fetchJson("https://x.test", { fetcher: failing, signal: outer.signal }),
    ).rejects.toThrow("network");

    vi.useFakeTimers();
    const waiting = new AbortController();
    const result = fetchJson("https://x.test", {
      fetcher: vi.fn().mockRejectedValue(new TypeError("net")),
      signal: waiting.signal,
      retryDelayMs: 1000,
    });
    const settled = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(10);
    waiting.abort();
    await settled;
  });

  it("times out a hanging request through its own controller", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(abortError()));
        }),
    ) as unknown as typeof fetch;
    const result = fetchJson("https://x.test", { fetcher, timeoutMs: 50 });
    const settled = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(50);
    await settled;
  });
});

describe("OpenAlex", () => {
  it("maps works and skips invalid, retracted, paratext and untitled ones", () => {
    expect(paperFromOpenAlex(null)).toBeNull();
    expect(paperFromOpenAlex({ display_name: "x", is_retracted: true })).toBeNull();
    expect(paperFromOpenAlex({ display_name: "x", is_paratext: true })).toBeNull();
    expect(paperFromOpenAlex({ display_name: "  " })).toBeNull();
    expect(
      paperFromOpenAlex({
        id: "https://openalex.org/W1",
        title: "Fuzzy &amp; <i>crisp</i> &#x41;&#66; &bogus; &#xZZ; &#a;",
        authorships: [
          { author: { display_name: "Ada" } },
          { author: null },
          "nope",
          { author: { display_name: " " } },
        ],
        publication_year: 2020,
        best_oa_location: {
          landing_page_url: "https://oa.test",
          pdf_url: "https://oa.test/p.pdf",
          source: { display_name: "OA Venue" },
        },
        cited_by_count: 4,
        relevance_score: 9.5,
      }),
    ).toEqual({
      provider: "OpenAlex",
      sourceId: "https://openalex.org/W1",
      title: "Fuzzy & crisp AB &bogus; &#xZZ; &#a;",
      authors: ["Ada"],
      year: 2020,
      venue: "OA Venue",
      doi: undefined,
      url: "https://oa.test",
      pdfUrl: "https://oa.test/p.pdf",
      citationCount: 4,
      providerScore: 9.5,
    });
  });

  it("falls back through venues and landing URLs", () => {
    const hostVenue = paperFromOpenAlex({
      display_name: "T",
      id: "https://openalex.org/W2",
      host_venue: { display_name: "Host" },
      primary_location: { source: null },
      best_oa_location: { source: "x" },
    });
    expect(
      paperFromOpenAlex({
        display_name: "T",
        primary_location: { source: { display_name: "Primary" } },
        best_oa_location: { source: { display_name: "OA" } },
      })?.venue,
    ).toBe("Primary");
    expect(hostVenue).toMatchObject({ venue: "Host", url: "https://openalex.org/W2" });
    const primary = paperFromOpenAlex({
      display_name: "T",
      doi: "https://doi.org/10.9/z",
      primary_location: {
        landing_page_url: "https://p.test",
        pdf_url: "https://p.pdf",
      },
    });
    expect(primary).toMatchObject({
      url: "https://doi.org/10.9/z",
      doi: "10.9/z",
      pdfUrl: "https://p.pdf",
      venue: undefined,
      year: null,
      authors: [],
    });
    expect(
      paperFromOpenAlex({
        display_name: "T",
        primary_location: { landing_page_url: "https://p.test" },
      })?.url,
    ).toBe("https://p.test");
  });

  it("searches and looks up DOIs, ignoring malformed responses", async () => {
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      urls.push(url);
      return urls.length === 1
        ? json({ results: [{ display_name: "One" }, null] })
        : json({ nothing: true });
    }) as unknown as typeof fetch;
    expect((await searchOpenAlex("graphs", { fetcher })).map((p) => p.title)).toEqual([
      "One",
    ]);
    expect(await lookupOpenAlexByDoi("https://doi.org/10.1/A", { fetcher })).toEqual(
      [],
    );
    expect(new URL(urls[0]).searchParams.get("per-page")).toBe("5");
    expect(new URL(urls[1]).searchParams.get("filter")).toBe("doi:10.1/a");
  });
});

describe("Crossref", () => {
  it("maps items and skips untitled ones", () => {
    expect(paperFromCrossref([])).toBeNull();
    expect(paperFromCrossref({ title: [] })).toBeNull();
    expect(paperFromCrossref({ title: 5 })).toBeNull();
    expect(
      paperFromCrossref({
        title: ["", "Systems &lt;2&gt;"],
        DOI: "10.5/ABC",
        type: "journal-article",
        "container-title": "Journal",
        author: [{ given: "Ada", family: "Lovelace" }, { family: "Solo" }, {}, 3],
        issued: { "date-parts": [[2021, 4]] },
        "is-referenced-by-count": 7,
        score: 12,
      }),
    ).toEqual({
      provider: "Crossref",
      sourceId: "10.5/abc",
      title: "Systems <2>",
      authors: ["Ada Lovelace", "Solo"],
      year: 2021,
      venue: "Journal",
      doi: "10.5/abc",
      url: "https://doi.org/10.5/abc",
      citationCount: 7,
      providerScore: 12,
      sourceType: "journal-article",
    });
  });

  it("uses the item URL without a DOI and tolerates missing dates", () => {
    expect(
      paperFromCrossref({ title: "Plain", URL: "https://item.test", issued: {} }),
    ).toMatchObject({
      sourceId: "https://item.test",
      url: "https://item.test",
      year: null,
      venue: undefined,
      doi: undefined,
    });
    expect(
      paperFromCrossref({ title: "Plain", issued: { "date-parts": ["x"] } })?.year,
    ).toBeNull();
  });

  it("searches and looks up DOIs, ignoring malformed responses", async () => {
    const urls: string[] = [];
    const responses = [
      json({ message: { items: [{ title: ["One"] }, { title: [] }] } }),
      json({ message: "nope" }),
      json([]),
    ];
    const fetcher = vi.fn(async (url: string) => {
      urls.push(url);
      return responses.shift()!;
    }) as unknown as typeof fetch;
    expect(
      await searchCrossref("graphs", { fetcher, perProviderLimit: 3 }),
    ).toHaveLength(1);
    expect(await lookupCrossrefByDoi("10.1/B", { fetcher })).toEqual([]);
    expect(await searchCrossref("x", { fetcher })).toEqual([]);
    expect(new URL(urls[0]).searchParams.get("rows")).toBe("3");
    expect(new URL(urls[1]).searchParams.get("filter")).toBe("doi:10.1/b");
    expect(new URL(urls[2]).searchParams.get("rows")).toBe("5");
  });
});
