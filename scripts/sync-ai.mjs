import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const configuredAiSourceRoot = process.env.LATEXDO_AI_SOURCE_PATH
  ? path.resolve(projectRoot, process.env.LATEXDO_AI_SOURCE_PATH)
  : null;
const localCatalogPath = path.join(projectRoot, "catalog/latexdo-ai-catalog.v1.json");
const catalogOutputPath = path.join(
  projectRoot,
  "src/features/ai/aiCatalog.generated.ts",
);

const modelTiers = new Set(["recommended", "balanced", "light", "inline"]);
const apiShapes = new Set(["anthropic", "openai"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value) {
  return typeof value === "string";
}

function requireString(errors, owner, value, key) {
  if (!isString(value[key])) errors.push(`${owner}.${key} must be a string`);
}

function requireStringArray(errors, owner, value, key) {
  if (!Array.isArray(value[key]) || !value[key].every(isString)) {
    errors.push(`${owner}.${key} must be an array of strings`);
  }
}

function requireUrl(errors, owner, value, key, allowEmpty = false) {
  const raw = value[key];
  if (allowEmpty && raw === "") return;
  if (!isString(raw)) {
    errors.push(`${owner}.${key} must be a URL string`);
    return;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") errors.push(`${owner}.${key} must use https`);
  } catch {
    errors.push(`${owner}.${key} must be a valid URL`);
  }
}

function assertUniqueIds(errors, name, values) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value.id)) errors.push(`${name} contains duplicate id ${value.id}`);
    seen.add(value.id);
  }
}

function validateLocalModel(errors, model, index) {
  const owner = `localModels[${index}]`;
  if (!isObject(model)) {
    errors.push(`${owner} must be an object`);
    return;
  }
  for (const key of [
    "id",
    "name",
    "description",
    "params",
    "downloadSize",
    "ramEstimate",
    "quant",
    "fileName",
  ]) {
    requireString(errors, owner, model, key);
  }
  if (!modelTiers.has(model.tier)) {
    errors.push(`${owner}.tier must be one of ${[...modelTiers].join(", ")}`);
  }
  if (typeof model.minSystemRamGb !== "number" || model.minSystemRamGb < 0) {
    errors.push(`${owner}.minSystemRamGb must be a non-negative number`);
  }
  if (typeof model.minAvailableRamGb !== "number" || model.minAvailableRamGb < 0) {
    errors.push(`${owner}.minAvailableRamGb must be a non-negative number`);
  }
  if (typeof model.supportsTools !== "boolean") {
    errors.push(`${owner}.supportsTools must be a boolean`);
  }
  requireUrl(errors, owner, model, "downloadUrl");
  requireStringArray(errors, owner, model, "strengths");
}

function validateCloudProvider(errors, provider, index) {
  const owner = `cloudProviders[${index}]`;
  if (!isObject(provider)) {
    errors.push(`${owner} must be an object`);
    return;
  }
  for (const key of ["id", "label", "baseUrl", "defaultModel", "apiKeyUrl"]) {
    requireString(errors, owner, provider, key);
  }
  if (!apiShapes.has(provider.apiShape)) {
    errors.push(`${owner}.apiShape must be one of ${[...apiShapes].join(", ")}`);
  }
  requireStringArray(errors, owner, provider, "models");
  requireUrl(errors, owner, provider, "baseUrl", true);
  requireUrl(errors, owner, provider, "apiKeyUrl", true);
  if (provider.custom !== undefined && typeof provider.custom !== "boolean") {
    errors.push(`${owner}.custom must be a boolean when present`);
  }
}

function validateCatalog(catalog) {
  const errors = [];
  if (!isObject(catalog)) return ["catalog must be an object"];
  if (catalog.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  requireString(errors, "catalog", catalog, "catalogVersion");
  requireString(errors, "catalog", catalog, "defaultLocalModelId");
  requireString(errors, "catalog", catalog, "defaultInlineModelId");
  requireString(errors, "catalog", catalog, "defaultCloudProviderId");
  if (!Array.isArray(catalog.localModels) || catalog.localModels.length === 0) {
    errors.push("localModels must be a non-empty array");
  } else {
    catalog.localModels.forEach((model, index) =>
      validateLocalModel(errors, model, index),
    );
    assertUniqueIds(errors, "localModels", catalog.localModels);
    const modelIds = new Set(catalog.localModels.map((model) => model.id));
    if (!modelIds.has(catalog.defaultLocalModelId)) {
      errors.push("defaultLocalModelId must reference a local model");
    }
    if (!modelIds.has(catalog.defaultInlineModelId)) {
      errors.push("defaultInlineModelId must reference a local model");
    }
  }
  if (!Array.isArray(catalog.cloudProviders) || catalog.cloudProviders.length === 0) {
    errors.push("cloudProviders must be a non-empty array");
  } else {
    catalog.cloudProviders.forEach((provider, index) =>
      validateCloudProvider(errors, provider, index),
    );
    assertUniqueIds(errors, "cloudProviders", catalog.cloudProviders);
    const providerIds = new Set(catalog.cloudProviders.map((provider) => provider.id));
    if (!providerIds.has(catalog.defaultCloudProviderId)) {
      errors.push("defaultCloudProviderId must reference a cloud provider");
    }
  }
  return errors;
}

function validateRelativePath(label, value) {
  if (!isString(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  if (path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) {
    throw new Error(`${label} must stay inside its repository: ${value}`);
  }
  return value;
}

function validateSyncManifest(value) {
  if (!isObject(value)) throw new Error("AI sync manifest must be an object");
  if (value.schemaVersion !== 1) {
    throw new Error("AI sync manifest schemaVersion must be 1");
  }
  if (!Array.isArray(value.files)) {
    throw new Error("AI sync manifest files must be an array");
  }
  const files = value.files.map((entry, index) => {
    if (!isObject(entry)) {
      throw new Error(`AI sync manifest files[${index}] must be an object`);
    }
    return {
      from: validateRelativePath(`files[${index}].from`, entry.from),
      to: validateRelativePath(`files[${index}].to`, entry.to),
    };
  });
  const styleFragments = Array.isArray(value.styleFragments)
    ? value.styleFragments.map((entry, index) => {
        if (!isObject(entry)) {
          throw new Error(`styleFragments[${index}] must be an object`);
        }
        if (!isString(entry.startMarker) || !isString(entry.endMarker)) {
          throw new Error(
            `styleFragments[${index}] startMarker/endMarker must be strings`,
          );
        }
        return {
          from: validateRelativePath(`styleFragments[${index}].from`, entry.from),
          to: validateRelativePath(`styleFragments[${index}].to`, entry.to),
          startMarker: entry.startMarker,
          endMarker: entry.endMarker,
        };
      })
    : [];
  return { files, styleFragments };
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function syncFile(sourceRoot, entry) {
  const source = path.join(sourceRoot, entry.from);
  const target = path.join(projectRoot, entry.to);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, await readFile(source));
}

async function syncStyleFragment(sourceRoot, entry) {
  const source = path.join(sourceRoot, entry.from);
  const target = path.join(projectRoot, entry.to);
  const fragment = (await readFile(source, "utf8")).trimEnd();
  const targetText = await readFile(target, "utf8");
  const start = targetText.indexOf(entry.startMarker);
  const end = targetText.indexOf(entry.endMarker);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Could not find AI style markers in ${entry.to}`);
  }
  const nextText = `${targetText.slice(0, start)}${fragment}\n\n${targetText.slice(end)}`;
  await writeFile(target, nextText);
}

async function syncRuntimeSource() {
  if (!configuredAiSourceRoot) return false;
  if (configuredAiSourceRoot === projectRoot) return false;

  const syncManifestPath = path.join(configuredAiSourceRoot, "latexdo-sync.json");
  if (!(await fileExists(syncManifestPath))) {
    throw new Error(`No AI source manifest found at ${syncManifestPath}`);
  }

  const manifest = validateSyncManifest(await readJson(syncManifestPath));
  for (const entry of manifest.files) {
    await syncFile(configuredAiSourceRoot, entry);
  }
  for (const entry of manifest.styleFragments) {
    await syncStyleFragment(configuredAiSourceRoot, entry);
  }
  console.log(
    `[ai-sync] Synced ${manifest.files.length} AI files and ${manifest.styleFragments.length} style fragment(s) from ${path.relative(projectRoot, configuredAiSourceRoot)}.`,
  );
  return true;
}

async function readCatalogFromFile(filePath) {
  const catalog = await readJson(filePath);
  return { catalog, sourceLabel: path.relative(projectRoot, filePath) };
}

async function readCatalogFromUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while reading ${url}`);
  }
  return { catalog: await response.json(), sourceLabel: url };
}

async function loadCatalog() {
  if (process.env.LATEXDO_AI_CATALOG_URL) {
    return readCatalogFromUrl(process.env.LATEXDO_AI_CATALOG_URL);
  }

  const configuredPath = process.env.LATEXDO_AI_CATALOG_PATH
    ? path.resolve(projectRoot, process.env.LATEXDO_AI_CATALOG_PATH)
    : null;
  const catalogPath =
    configuredPath ??
    (configuredAiSourceRoot
      ? path.join(configuredAiSourceRoot, "catalog/latexdo-ai-catalog.v1.json")
      : localCatalogPath);

  if (await fileExists(catalogPath)) {
    return readCatalogFromFile(catalogPath);
  }

  const message = `No AI catalog found at ${catalogPath}`;
  if (
    process.env.LATEXDO_AI_CATALOG_REQUIRED === "1" ||
    process.env.LATEXDO_AI_CATALOG_PATH
  ) {
    throw new Error(message);
  }
  console.warn(`[ai-sync] ${message}; keeping checked-in generated catalog.`);
  return null;
}

async function generatedCatalogModule(catalog, sourceLabel) {
  const code = `// Generated by scripts/sync-ai.mjs from ${sourceLabel}.
// Do not edit manually; update the catalog source and run npm run ai:sync.

import type { AiCatalog } from "./aiCatalog";

export const aiCatalog = ${JSON.stringify(catalog, null, 2)} as const satisfies AiCatalog;
`;
  try {
    const prettier = await import("prettier");
    const config = (await prettier.resolveConfig(catalogOutputPath)) ?? {};
    return prettier.format(code, { ...config, parser: "typescript" });
  } catch {
    return code;
  }
}

async function syncCatalog() {
  const loaded = await loadCatalog();
  if (!loaded) return false;

  const errors = validateCatalog(loaded.catalog);
  if (errors.length > 0) {
    throw new Error(
      `Invalid LatexDo AI catalog at ${loaded.sourceLabel}:\n- ${errors.join("\n- ")}`,
    );
  }
  await mkdir(path.dirname(catalogOutputPath), { recursive: true });
  await writeFile(
    catalogOutputPath,
    await generatedCatalogModule(loaded.catalog, loaded.sourceLabel),
  );
  console.log(
    `[ai-sync] Synced catalog ${loaded.catalog.catalogVersion} from ${loaded.sourceLabel}.`,
  );
  return true;
}

await syncRuntimeSource();
await syncCatalog();
