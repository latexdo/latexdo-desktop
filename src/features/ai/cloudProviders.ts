// Cloud provider catalog facade. Provider presets are generated from the public
// AI catalog during the build.

import { aiCatalog } from "./aiCatalog.generated";
import type { CloudProviderPreset } from "./aiCatalog";

export type { ApiShape, CloudProviderPreset } from "./aiCatalog";

export const cloudProviders: readonly CloudProviderPreset[] = aiCatalog.cloudProviders;
export const defaultCloudProviderId = aiCatalog.defaultCloudProviderId;

export function findCloudProvider(id: string): CloudProviderPreset | undefined {
  return cloudProviders.find((provider) => provider.id === id);
}
