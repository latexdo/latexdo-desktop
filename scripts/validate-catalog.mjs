import { readFile } from "node:fs/promises";

const catalogPath = process.argv[2] ?? "catalog/latexdo-ai-catalog.v1.json";
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

const raw = await readFile(catalogPath, "utf8");
const catalog = JSON.parse(raw);
const errors = validateCatalog(catalog);
if (errors.length > 0) {
  console.error(`Invalid LatexDo AI catalog at ${catalogPath}:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Validated LatexDo AI catalog ${catalog.catalogVersion} at ${catalogPath}.`,
);
