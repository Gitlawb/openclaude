// src/integrations/index.ts
// Single loader entrypoint for descriptor modules.
// Runtime and tests must import this file before reading registry state.

import type { AnthropicProxyDescriptor } from './descriptors.js'
import {
  ANTHROPIC_PROXY_DESCRIPTORS,
  BRAND_DESCRIPTORS,
  GATEWAY_DESCRIPTORS,
  MODEL_DESCRIPTOR_GROUPS,
  VENDOR_DESCRIPTORS,
  type ProviderPreset,
} from './generated/integrationArtifacts.generated.js'
import {
  getAllAnthropicProxies,
  getAllBrands,
  getAllGateways,
  getAllModels,
  getAllVendors,
  getAnthropicProxy,
  getBrand,
  getBrandsForVendor,
  getCatalogEntriesForRoute,
  getCatalogForGateway,
  getCatalogForVendor,
  getGateway,
  getModel,
  getModelsForBrand,
  getModelsForGateway,
  getModelsForVendor,
  getVendor,
  registerAnthropicProxy,
  registerBrand,
  registerGateway,
  registerModel,
  registerVendor,
  validateIntegrationRegistry,
  _clearRegistryForTesting,
} from './registry.js'

export function ensureIntegrationsLoaded(): void {
  for (const vendor of VENDOR_DESCRIPTORS) {
    if (!getVendor(vendor.id)) {
      registerVendor(vendor)
    }
  }

  for (const gateway of GATEWAY_DESCRIPTORS) {
    if (!getGateway(gateway.id)) {
      registerGateway(gateway)
    }
  }

  for (const anthropicProxy of ANTHROPIC_PROXY_DESCRIPTORS as unknown as AnthropicProxyDescriptor[]) {
    if (!getAnthropicProxy(anthropicProxy.id)) {
      registerAnthropicProxy(anthropicProxy)
    }
  }

  for (const brand of BRAND_DESCRIPTORS) {
    if (!getBrand(brand.id)) {
      registerBrand(brand)
    }
  }

  for (const modelGroup of MODEL_DESCRIPTOR_GROUPS) {
    for (const model of modelGroup) {
      if (!getModel(model.id)) {
        registerModel(model)
      }
    }
  }
}

ensureIntegrationsLoaded()

export {
  registerBrand,
  registerVendor,
  registerGateway,
  registerAnthropicProxy,
  registerModel,
  getBrand,
  getVendor,
  getGateway,
  getAnthropicProxy,
  getModel,
  getAllBrands,
  getAllVendors,
  getAllGateways,
  getAllAnthropicProxies,
  getAllModels,
  getCatalogForGateway,
  getCatalogForVendor,
  getCatalogEntriesForRoute,
  getModelsForBrand,
  getModelsForGateway,
  getModelsForVendor,
  getBrandsForVendor,
  validateIntegrationRegistry,
  _clearRegistryForTesting,
}

export { routeForPreset, vendorIdForPreset, gatewayIdForPreset } from './compatibility.js'
export { resolveProfileRoute } from './profileResolver.js'
export type { ResolvedProfileRoute } from './profileResolver.js'
export type { ProviderPreset }
export { PROVIDER_PRESET_MANIFEST } from './generated/integrationArtifacts.generated.js'
export {
  getRouteDefaultBaseUrl,
  getRouteDefaultModel,
  getRouteDescriptor,
  getRouteLabel,
  getRouteProviderTypeLabel,
  getTransportKindForRoute,
  normalizeXiaomiMimoBaseUrl,
  resolveActiveRouteIdFromEnv,
  resolveRouteIdFromBaseUrl,
  routeSupportsApiFormatSelection,
  routeSupportsAuthHeaders,
  routeSupportsCustomHeaders,
  routeShowsAuthHeader,
  routeShowsAuthHeaderValue,
  routeShowsCustomHeaders,
} from './routeMetadata.js'
export {
  getProviderPresetUiMetadata,
  ORDERED_PROVIDER_PRESETS,
} from './providerUiMetadata.js'
