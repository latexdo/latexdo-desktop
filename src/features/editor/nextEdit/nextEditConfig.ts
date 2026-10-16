import {
  defaultNextEditConfig,
  nextEditConfigStorageKey,
  type NextEditConfig,
} from "./nextEditTypes";

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeNextEditConfig(raw: unknown): NextEditConfig {
  const saved = (raw ?? {}) as Partial<NextEditConfig>;
  return {
    enabled: bool(saved.enabled, defaultNextEditConfig.enabled),
    semanticEnabled: bool(saved.semanticEnabled, defaultNextEditConfig.semanticEnabled),
    useInlineModel: bool(saved.useInlineModel, defaultNextEditConfig.useInlineModel),
  };
}

export function loadNextEditConfig(): NextEditConfig {
  try {
    return normalizeNextEditConfig(
      JSON.parse(window.localStorage.getItem(nextEditConfigStorageKey) ?? "{}"),
    );
  } catch {
    return defaultNextEditConfig;
  }
}

export function saveNextEditConfig(config: NextEditConfig): void {
  window.localStorage.setItem(
    nextEditConfigStorageKey,
    JSON.stringify(normalizeNextEditConfig(config)),
  );
}
