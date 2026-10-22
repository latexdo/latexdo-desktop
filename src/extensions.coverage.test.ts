import { afterEach, describe, expect, it, vi } from "vitest";
import {
  categoryLabel,
  contributionSummary,
  extensionStoreCatalogUrl,
  fallbackExtensionCatalog,
  fetchExtensionCatalog,
  hasFigureToTikzExtension,
  validateExtensionCatalog,
  type LatexDoExtensionManifest,
} from "./extensions";

const template = {
  id: "my-template",
  name: "My Template",
  summary: "A template that is long enough.",
  files: "main.tex",
  mainTex: "\\documentclass{article}\\begin{document}\\end{document}",
};

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    id: "community.pack",
    name: "Community Pack",
    version: "2.0.0-beta.1",
    description: "A community pack with all contribution kinds.",
    author: "Community",
    category: "workflow",
    tags: ["ok", "", "x".repeat(29), 5, "a", "b", "c", "d", "e", "f", "g"],
    contributes: { featureFlags: { suggestFixes: "yes" } },
    ...overrides,
  };
}

function catalogOf(...extensions: unknown[]) {
  return {
    schemaVersion: 1,
    product: "LatexDo",
    updatedAt: "2026-10-01T00:00:00.000Z",
    extensions,
  };
}

describe("extension helpers", () => {
  it("labels every category", () => {
    expect(
      [
        "bibliography",
        "checking",
        "graphics",
        "templates",
        "workflow",
        "writing",
        "other",
      ].map((category) => categoryLabel(category as never)),
    ).toEqual([
      "Bibliography",
      "Checking",
      "Graphics",
      "Templates",
      "Workflow",
      "Writing",
      "Writing",
    ]);
  });

  it("summarises contributions with singular and plural counts", () => {
    const base = fallbackExtensionCatalog.extensions[0];
    expect(contributionSummary({ ...base, contributes: {} })).toEqual([]);
    expect(
      contributionSummary({
        ...base,
        contributes: {
          featureFlags: { suggestFixes: true },
          snippets: [{ label: "a", insertText: "a" }],
          templates: [template],
        },
      }),
    ).toEqual(["1 feature toggle", "1 snippet", "1 template"]);
    expect(
      contributionSummary({
        ...base,
        contributes: {
          featureFlags: { suggestFixes: true, explainErrors: true },
          snippets: [
            { label: "a", insertText: "a" },
            { label: "b", insertText: "b" },
          ],
          templates: [template, template],
        },
      }),
    ).toEqual(["2 feature toggles", "2 snippets", "2 templates"]);
  });

  it("detects the Figure to TikZ converter among installed extensions", () => {
    expect(hasFigureToTikzExtension(fallbackExtensionCatalog.extensions)).toBe(true);
    expect(hasFigureToTikzExtension([] as LatexDoExtensionManifest[])).toBe(false);
  });
});

describe("validateExtensionCatalog", () => {
  it.each([
    null,
    [],
    { ...catalogOf(), schemaVersion: 2 },
    { ...catalogOf(), product: "Other" },
    { ...catalogOf(), updatedAt: 1 },
    { ...catalogOf(), extensions: {} },
  ])("rejects a malformed catalog %#", (value) => {
    expect(validateExtensionCatalog(value)).toBeNull();
  });

  it("normalises a full manifest", () => {
    const catalog = validateExtensionCatalog(
      catalogOf(
        manifest({
          name: "  Community Pack  ",
          kind: "template",
          homepage: "https://example.org/pack",
          repository: "  https://github.com/x/y  ",
          screenshots: [
            "nope",
            { url: "https://evil.example/a.png" },
            { url: "http://latexdo.org/a.png" },
            { url: "https://latexdo.org/a.png", caption: "  Shot  " },
            { url: "https://www.latexdo.org/b.gif", caption: "" },
          ],
          contributes: {
            featureFlags: { suggestFixes: true, explainErrors: "yes", bogus: true },
            snippets: [
              {
                label: " claim ",
                insertText: "x",
                detail: " d ",
                documentation: " doc ",
              },
              { label: "plain", insertText: "y", detail: "", documentation: 3 },
              { label: "x", insertText: "too short label" },
              "nope",
            ],
            templates: [
              { ...template, bibTex: "@book{a,}" },
              { ...template, id: "second", bibTex: "" },
              { ...template, id: "Bad Id" },
              { ...template, mainTex: "short" },
              null,
            ],
          },
        }),
        manifest(),
      ),
    );
    expect(catalog?.extensions).toHaveLength(1);
    const [pack] = catalog!.extensions;
    expect(pack).toMatchObject({
      id: "community.pack",
      name: "Community Pack",
      kind: "template",
      homepage: "https://example.org/pack",
      repository: "https://github.com/x/y",
      screenshots: [
        { url: "https://latexdo.org/a.png", caption: "Shot" },
        { url: "https://www.latexdo.org/b.gif" },
      ],
    });
    expect(pack.tags).toEqual(["ok", "a", "b", "c", "d", "e", "f", "g"]);
    expect(pack.contributes.featureFlags).toEqual({
      suggestFixes: true,
      explainErrors: false,
    });
    expect(pack.contributes.snippets).toEqual([
      { label: "claim", insertText: "x", detail: "d", documentation: "doc" },
      { label: "plain", insertText: "y" },
    ]);
    expect(pack.contributes.templates).toEqual([
      { ...template, bibTex: "@book{a,}" },
      { ...template, id: "second" },
    ]);
  });

  it("defaults the kind to extension and drops invalid URLs and screenshot lists", () => {
    const catalog = validateExtensionCatalog(
      catalogOf(
        manifest({
          homepage: "not a url at all",
          repository: "short",
          screenshots: { url: "https://latexdo.org/a.png" },
        }),
      ),
    );
    const [pack] = catalog!.extensions;
    expect(pack.kind).toBe("extension");
    expect(pack.homepage).toBeUndefined();
    expect(pack.repository).toBeUndefined();
    expect(pack.screenshots).toBeUndefined();
    expect(pack.contributes).toEqual({ featureFlags: { suggestFixes: false } });
  });

  it.each([
    ["not a record", "x"],
    ["a wrong schema", manifest({ schemaVersion: 2 })],
    ["a bad version", manifest({ version: "v1" })],
    ["a short description", manifest({ description: "short" })],
    ["an unknown category", manifest({ category: "games" })],
    ["non-array tags", manifest({ tags: "a" })],
    ["no contributes record", manifest({ contributes: [] })],
    [
      "no usable contributions",
      manifest({ contributes: { featureFlags: [], snippets: {}, templates: "x" } }),
    ],
  ])("drops a manifest with %s", (_label, value) => {
    expect(validateExtensionCatalog(catalogOf(value))!.extensions).toEqual([]);
  });
});

describe("fetchExtensionCatalog default loader", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    Reflect.deleteProperty(window, "latexdo");
  });

  it("asks the desktop runtime for the store catalog and merges it with the bundled one", async () => {
    const runtimeFetch = vi
      .fn()
      .mockResolvedValue(catalogOf(manifest({ name: "Aaa Pack" })));
    Object.defineProperty(window, "latexdo", {
      configurable: true,
      value: { fetchExtensionCatalog: runtimeFetch },
    });
    const result = await fetchExtensionCatalog();
    expect(runtimeFetch).toHaveBeenCalled();
    expect(result.source).toBe("remote");
    expect(result.catalog.extensions[0].name).toBe("Aaa Pack");
    expect(result.catalog.extensions).toHaveLength(
      fallbackExtensionCatalog.extensions.length + 1,
    );
  });

  it("fetches other catalog URLs over HTTP", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(catalogOf(manifest())), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchExtensionCatalog("https://store.example/catalog.json");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://store.example/catalog.json",
      expect.objectContaining({
        cache: "no-store",
        headers: { Accept: "application/json" },
      }),
    );
    expect(result.source).toBe("remote");
  });

  it("uses HTTP for the store URL when the runtime has no catalog bridge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 503 })),
    );
    const result = await fetchExtensionCatalog(extensionStoreCatalogUrl);
    expect(result).toMatchObject({
      source: "fallback",
      error: "Store catalog returned HTTP 503",
    });
  });

  it("reports an invalid catalog body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("[]", { status: 200 })),
    );
    const result = await fetchExtensionCatalog("https://store.example/c.json");
    expect(result.error).toBe(
      "Store catalog is not a valid LatexDo extension catalog.",
    );
  });

  it("uses a generic message for non-Error failures", async () => {
    const result = await fetchExtensionCatalog("https://x", () =>
      Promise.reject("nope"),
    );
    expect(result.error).toBe("Could not load the LatexDo extension catalog.");
  });

  it("aborts a request that takes longer than 4.5 seconds", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        signal = init.signal!;
        return new Promise((_resolve, reject) =>
          signal!.addEventListener("abort", () => reject(new Error("aborted"))),
        );
      }),
    );
    const pending = fetchExtensionCatalog("https://slow.example/c.json");
    await vi.advanceTimersByTimeAsync(4500);
    await expect(pending).resolves.toMatchObject({
      source: "fallback",
      error: "aborted",
    });
    expect(signal?.aborted).toBe(true);
  });
});
