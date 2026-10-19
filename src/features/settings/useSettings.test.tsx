import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LatexDoExtensionCatalog,
  LatexDoExtensionManifest,
} from "../../extensions";

const fetchExtensionCatalog = vi.hoisted(() => vi.fn());
vi.mock("../../extensions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../extensions")>()),
  fetchExtensionCatalog,
}));

import { useSettings } from "./useSettings";
import {
  defaultSettings,
  installedExtensionsStorageKey,
  settingsStorageKey,
  welcomeTemplates,
} from "./settings";

function manifest(
  id: string,
  overrides: Partial<LatexDoExtensionManifest> = {},
): LatexDoExtensionManifest {
  return {
    schemaVersion: 1,
    id,
    kind: "extension",
    name: `Ext ${id}`,
    version: "1.0.0",
    description: `Description of ${id}`,
    author: "Tester",
    category: "writing",
    tags: [],
    contributes: {},
    ...overrides,
  };
}

const tikz = manifest("tikz", {
  category: "graphics",
  contributes: {
    featureFlags: { tikzConverterEnabled: true, autoFixCommon: true },
    snippets: [{ label: "snip", insertText: "\\snip" }],
    templates: [
      { id: "t1", name: "Template One", summary: "s", files: "main.tex", mainTex: "x" },
    ],
  },
});
const tikzToo = manifest("tikz-too", {
  category: "graphics",
  contributes: { featureFlags: { tikzConverterEnabled: true } },
});
const ghost = manifest("ghost", {
  contributes: {
    featureFlags: { notARealSetting: true } as never,
  },
});
const plain = manifest("plain", { name: "Plain Writer" });

const remoteCatalog: LatexDoExtensionCatalog = {
  schemaVersion: 1,
  product: "LatexDo",
  updatedAt: "2026-10-01T00:00:00.000Z",
  extensions: [tikz, tikzToo, ghost, plain],
};

describe("useSettings", () => {
  beforeEach(() => {
    window.localStorage.clear();
    fetchExtensionCatalog.mockReset();
    fetchExtensionCatalog.mockResolvedValue({ catalog: remoteCatalog, source: "remote" });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("loads the remote catalog on start-up and persists settings changes", async () => {
    const onStatus = vi.fn();
    const { result } = renderHook(() => useSettings(onStatus));
    expect(result.current.extensionCatalogSource).toBe("fallback");
    await waitFor(() => expect(result.current.extensionCatalogSource).toBe("remote"));
    expect(result.current.extensionCatalogLoading).toBe(false);
    expect(result.current.extensionCatalogError).toBe("");
    expect(result.current.extensionCatalog).toBe(remoteCatalog);

    act(() => result.current.updateSetting("fontSize", 21));
    expect(result.current.settings.fontSize).toBe(21);
    expect(JSON.parse(window.localStorage.getItem(settingsStorageKey)!).fontSize).toBe(21);
    act(() => result.current.resetSetting("fontSize"));
    expect(result.current.settings.fontSize).toBe(defaultSettings.fontSize);

    act(() => {
      result.current.setSettingsOpen(true);
      result.current.setSettingsTab("ai");
    });
    expect(result.current.settingsOpen).toBe(true);
    expect(result.current.settingsTab).toBe("ai");
  });

  it("records the catalog error and clears loading even when the fetch throws", async () => {
    fetchExtensionCatalog.mockResolvedValueOnce({
      catalog: remoteCatalog,
      source: "fallback",
      error: "offline",
    });
    const { result } = renderHook(() => useSettings(vi.fn()));
    await waitFor(() => expect(result.current.extensionCatalogError).toBe("offline"));

    fetchExtensionCatalog.mockRejectedValueOnce(new Error("boom"));
    let refresh: Promise<void> | undefined;
    act(() => {
      refresh = result.current.refreshExtensionCatalog();
    });
    await act(async () => {
      await expect(refresh).rejects.toThrow("boom");
    });
    expect(result.current.extensionCatalogLoading).toBe(false);
  });

  it("filters extensions by category and query", async () => {
    const { result } = renderHook(() => useSettings(vi.fn()));
    await waitFor(() => expect(result.current.extensionCatalogSource).toBe("remote"));
    expect(result.current.filteredExtensions).toHaveLength(4);
    act(() => result.current.setExtensionCategoryFilter("graphics"));
    expect(result.current.filteredExtensions.map((e) => e.id)).toEqual(["tikz", "tikz-too"]);
    act(() => {
      result.current.setExtensionCategoryFilter("all");
      result.current.setExtensionQuery("plain writer");
    });
    expect(result.current.extensionQuery).toBe("plain writer");
    expect(result.current.extensionCategoryFilter).toBe("all");
    expect(result.current.filteredExtensions.map((e) => e.id)).toEqual(["plain"]);
  });

  it("installs extensions once, applying their feature flags and contributions", async () => {
    const onStatus = vi.fn();
    const { result } = renderHook(() => useSettings(onStatus));
    await waitFor(() => expect(result.current.extensionCatalogSource).toBe("remote"));
    act(() => result.current.updateSetting("autoFixCommon", false));

    act(() => result.current.installExtension(tikz));
    act(() => result.current.installExtension(tikz));
    act(() => result.current.installExtension(plain));
    expect(onStatus).toHaveBeenCalledWith("Installed Ext tikz");
    expect(onStatus).toHaveBeenCalledWith("Installed Plain Writer");
    expect(result.current.installedExtensions.map((e) => e.id)).toEqual(["tikz", "plain"]);
    expect(result.current.installedExtensionIdSet.has("tikz")).toBe(true);
    expect(result.current.settings.autoFixCommon).toBe(true);
    expect(result.current.installedExtensionSnippets).toEqual([
      { label: "snip", insertText: "\\snip" },
    ]);
    expect(result.current.availableWelcomeTemplates).toHaveLength(
      welcomeTemplates.length + 1,
    );
    expect(result.current.availableWelcomeTemplates.at(-1)).toMatchObject({
      id: "tikz:t1",
      name: "Template One",
    });
    expect(JSON.parse(window.localStorage.getItem(installedExtensionsStorageKey)!)).toEqual([
      "tikz",
      "plain",
    ]);
  });

  it("disables only the flags no other installed extension still provides", async () => {
    const onStatus = vi.fn();
    const { result } = renderHook(() => useSettings(onStatus));
    await waitFor(() => expect(result.current.extensionCatalogSource).toBe("remote"));
    act(() => {
      result.current.installExtension(tikz);
      result.current.installExtension(tikzToo);
      result.current.installExtension(ghost);
    });
    expect(result.current.settings.tikzConverterEnabled).toBe(true);

    act(() => result.current.uninstallExtension(tikz));
    expect(onStatus).toHaveBeenLastCalledWith("Uninstalled Ext tikz");
    expect(result.current.settings.tikzConverterEnabled).toBe(true);
    expect(result.current.settings.autoFixCommon).toBe(false);

    // A flag that is not a boolean setting (here removed after install) is left alone.
    expect(
      (result.current.settings as unknown as Record<string, unknown>).notARealSetting,
    ).toBe(true);
    act(() =>
      result.current.setSettings((current) => {
        const next = { ...current } as unknown as Record<string, unknown>;
        delete next.notARealSetting;
        return next as unknown as typeof current;
      }),
    );
    act(() => result.current.uninstallExtension(ghost));
    expect("notARealSetting" in result.current.settings).toBe(false);

    act(() => result.current.uninstallExtension(tikzToo));
    expect(result.current.settings.tikzConverterEnabled).toBe(false);

    const before = result.current.settings;
    act(() => result.current.uninstallExtension(plain));
    expect(result.current.settings).toBe(before);
    expect(result.current.installedExtensions).toEqual([]);
  });

  it("waits before fetching the catalog outside the test build", async () => {
    vi.stubEnv("MODE", "production");
    vi.resetModules();
    vi.useFakeTimers();
    try {
      const fresh = await import("./useSettings");
      const { unmount } = renderHook(() => fresh.useSettings(vi.fn()));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_499);
      });
      expect(fetchExtensionCatalog).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(fetchExtensionCatalog).toHaveBeenCalledTimes(1);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
