import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fallbackExtensionCatalog,
  fetchExtensionCatalog,
  type ExtensionCategory,
  type LatexDoExtensionManifest,
} from "../../extensions";
import {
  extensionTemplateToWelcomeTemplate,
  defaultSettings,
  installedExtensionsStorageKey,
  loadInstalledExtensionIds,
  loadSettings,
  matchesExtensionQuery,
  settingsStorageKey,
  welcomeTemplates,
  type AppSettings,
} from "./settings";

const extensionCatalogStartupDelayMs = import.meta.env.MODE === "test" ? 0 : 1_500;

export function useSettings(onStatusMessage: (message: string) => void) {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("editor");
  const [extensionCatalog, setExtensionCatalog] = useState(fallbackExtensionCatalog);
  const [extensionCatalogSource, setExtensionCatalogSource] = useState<
    "remote" | "fallback"
  >("fallback");
  const [extensionCatalogLoading, setExtensionCatalogLoading] = useState(false);
  const [extensionCatalogError, setExtensionCatalogError] = useState("");
  const [extensionQuery, setExtensionQuery] = useState("");
  const [extensionCategoryFilter, setExtensionCategoryFilter] = useState<
    ExtensionCategory | "all"
  >("all");
  const [installedExtensionIds, setInstalledExtensionIds] = useState<string[]>(
    loadInstalledExtensionIds,
  );

  const updateSetting = useCallback(
    <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      setSettings((current) => ({
        ...current,
        [key]: value,
      }));
    },
    [],
  );

  const resetSetting = useCallback(<K extends keyof AppSettings>(key: K) => {
    setSettings((current) => ({
      ...current,
      [key]: defaultSettings[key],
    }));
  }, []);

  const installedExtensionIdSet = useMemo(
    () => new Set(installedExtensionIds),
    [installedExtensionIds],
  );
  const installedExtensions = useMemo(
    () =>
      extensionCatalog.extensions.filter((extension) =>
        installedExtensionIdSet.has(extension.id),
      ),
    [extensionCatalog.extensions, installedExtensionIdSet],
  );
  const installedExtensionSnippets = useMemo(
    () =>
      installedExtensions.flatMap((extension) => extension.contributes.snippets ?? []),
    [installedExtensions],
  );
  const installedExtensionTemplates = useMemo(
    () =>
      installedExtensions.flatMap((extension) =>
        (extension.contributes.templates ?? []).map((template) =>
          extensionTemplateToWelcomeTemplate(extension, template),
        ),
      ),
    [installedExtensions],
  );
  const availableWelcomeTemplates = useMemo(
    () => [...welcomeTemplates, ...installedExtensionTemplates],
    [installedExtensionTemplates],
  );
  const filteredExtensions = useMemo(
    () =>
      extensionCatalog.extensions.filter(
        (extension) =>
          (extensionCategoryFilter === "all" ||
            extension.category === extensionCategoryFilter) &&
          matchesExtensionQuery(extension, extensionQuery),
      ),
    [extensionCatalog.extensions, extensionCategoryFilter, extensionQuery],
  );

  const refreshExtensionCatalog = useCallback(async () => {
    setExtensionCatalogLoading(true);
    try {
      const result = await fetchExtensionCatalog();
      setExtensionCatalog(result.catalog);
      setExtensionCatalogSource(result.source);
      setExtensionCatalogError(result.error ?? "");
    } finally {
      setExtensionCatalogLoading(false);
    }
  }, []);

  const installExtension = useCallback(
    (extension: LatexDoExtensionManifest) => {
      setInstalledExtensionIds((current) =>
        current.includes(extension.id) ? current : [...current, extension.id],
      );

      if (extension.contributes.featureFlags) {
        setSettings(
          (current) =>
            ({
              ...current,
              ...extension.contributes.featureFlags,
            }) as AppSettings,
        );
      }

      onStatusMessage(`Installed ${extension.name}`);
    },
    [onStatusMessage],
  );

  const uninstallExtension = useCallback(
    (extension: LatexDoExtensionManifest) => {
      const remainingExtensions = installedExtensions.filter(
        (installedExtension) => installedExtension.id !== extension.id,
      );
      const featureFlagsToDisable = Object.keys(
        extension.contributes.featureFlags ?? {},
      ).filter(
        (flag) =>
          !remainingExtensions.some((installedExtension) => {
            const featureFlags = installedExtension.contributes.featureFlags as
              | Record<string, boolean>
              | undefined;
            return featureFlags?.[flag] === true;
          }),
      );

      setInstalledExtensionIds((current) =>
        current.filter((extensionId) => extensionId !== extension.id),
      );

      if (featureFlagsToDisable.length) {
        setSettings((current) => {
          const next = { ...current } as AppSettings;
          const writableNext = next as unknown as Record<string, boolean>;

          for (const flag of featureFlagsToDisable) {
            if (typeof writableNext[flag] === "boolean") {
              writableNext[flag] = false;
            }
          }

          return next;
        });
      }

      onStatusMessage(`Uninstalled ${extension.name}`);
    },
    [installedExtensions, onStatusMessage],
  );

  useEffect(() => {
    window.localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    window.localStorage.setItem(
      installedExtensionsStorageKey,
      JSON.stringify(installedExtensionIds),
    );
  }, [installedExtensionIds]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshExtensionCatalog();
    }, extensionCatalogStartupDelayMs);
    return () => window.clearTimeout(timer);
  }, [refreshExtensionCatalog]);

  return {
    settings,
    setSettings,
    updateSetting,
    resetSetting,
    settingsOpen,
    setSettingsOpen,
    settingsTab,
    setSettingsTab,
    extensionCatalog,
    extensionCatalogSource,
    extensionCatalogLoading,
    extensionCatalogError,
    extensionQuery,
    setExtensionQuery,
    extensionCategoryFilter,
    setExtensionCategoryFilter,
    installedExtensionIdSet,
    installedExtensions,
    installedExtensionSnippets,
    availableWelcomeTemplates,
    filteredExtensions,
    refreshExtensionCatalog,
    installExtension,
    uninstallExtension,
  };
}
