// src/integrations/registry.ts
// Registry implementation: stores descriptors, provides lookup, and validates integrity.

import type {
  AnthropicProxyDescriptor,
  BrandDescriptor,
  GatewayDescriptor,
  ModelCatalogEntry,
  ModelDescriptor,
  RegistryValidationResult,
  VendorDescriptor,
} from './descriptors.js'

const _brands = new Map<string, BrandDescriptor>()
const _vendors = new Map<string, VendorDescriptor>()
const _gateways = new Map<string, GatewayDescriptor>()
const _anthropicProxies = new Map<string, AnthropicProxyDescriptor>()
const _models = new Map<string, ModelDescriptor>()

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerBrand(d: BrandDescriptor): void {
  if (_brands.has(d.id)) {
    throw new Error(`Duplicate brand id: ${d.id}`)
  }
  _brands.set(d.id, d)
}

export function registerVendor(d: VendorDescriptor): void {
  if (_vendors.has(d.id)) {
    throw new Error(`Duplicate vendor id: ${d.id}`)
  }
  _vendors.set(d.id, d)
}

export function registerGateway(d: GatewayDescriptor): void {
  if (_gateways.has(d.id)) {
    throw new Error(`Duplicate gateway id: ${d.id}`)
  }
  _gateways.set(d.id, d)
}

export function registerAnthropicProxy(d: AnthropicProxyDescriptor): void {
  if (_anthropicProxies.has(d.id)) {
    throw new Error(`Duplicate anthropic proxy id: ${d.id}`)
  }
  _anthropicProxies.set(d.id, d)
}

export function registerModel(d: ModelDescriptor): void {
  if (_models.has(d.id)) {
    throw new Error(`Duplicate model id: ${d.id}`)
  }
  _models.set(d.id, d)
}

// ---------------------------------------------------------------------------
// Getters
// ---------------------------------------------------------------------------

export function getBrand(id: string): BrandDescriptor | undefined {
  return _brands.get(id)
}

export function getVendor(id: string): VendorDescriptor | undefined {
  return _vendors.get(id)
}

export function getGateway(id: string): GatewayDescriptor | undefined {
  return _gateways.get(id)
}

export function getAnthropicProxy(id: string): AnthropicProxyDescriptor | undefined {
  return _anthropicProxies.get(id)
}

export function getModel(id: string): ModelDescriptor | undefined {
  return _models.get(id)
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export function getAllBrands(): BrandDescriptor[] {
  return Array.from(_brands.values())
}

export function getAllVendors(): VendorDescriptor[] {
  return Array.from(_vendors.values())
}

export function getAllGateways(): GatewayDescriptor[] {
  return Array.from(_gateways.values())
}

export function getAllAnthropicProxies(): AnthropicProxyDescriptor[] {
  return Array.from(_anthropicProxies.values())
}

export function getAllModels(): ModelDescriptor[] {
  return Array.from(_models.values())
}

// ---------------------------------------------------------------------------
// Catalog helpers
// ---------------------------------------------------------------------------

export function getCatalogForGateway(gatewayId: string): import('./descriptors.js').ModelCatalogConfig | undefined {
  return _gateways.get(gatewayId)?.catalog
}

export function getCatalogForVendor(vendorId: string): import('./descriptors.js').ModelCatalogConfig | undefined {
  return _vendors.get(vendorId)?.catalog
}

export function getCatalogEntriesForRoute(routeId: string): ModelCatalogEntry[] {
  const gateway = _gateways.get(routeId)
  if (gateway?.catalog?.models) {
    return gateway.catalog.models
  }
  const vendor = _vendors.get(routeId)
  if (vendor?.catalog?.models) {
    return vendor.catalog.models
  }
  return []
}

export function getModelsForBrand(brandId: string): ModelDescriptor[] {
  return getAllModels().filter(m => m.brandId === brandId)
}

export function getModelsForGateway(gatewayId: string): ModelDescriptor[] {
  const entries = getCatalogEntriesForRoute(gatewayId)
  return entries
    .map(e => {
      if (e.modelDescriptorId) {
        return getModel(e.modelDescriptorId)
      }
      return undefined
    })
    .filter((m): m is ModelDescriptor => m !== undefined)
}

export function getModelsForVendor(vendorId: string): ModelDescriptor[] {
  const entries = getCatalogEntriesForRoute(vendorId)
  return entries
    .map(e => {
      if (e.modelDescriptorId) {
        return getModel(e.modelDescriptorId)
      }
      return undefined
    })
    .filter((m): m is ModelDescriptor => m !== undefined)
}

export function getBrandsForVendor(vendorId: string): BrandDescriptor[] {
  return getAllBrands().filter(b => b.canonicalVendorId === vendorId)
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateIntegrationRegistry(): RegistryValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const allVendors = getAllVendors()
  const allGateways = getAllGateways()
  const allAnthropicProxies = getAllAnthropicProxies()
  const allRoutes: Array<
    VendorDescriptor | GatewayDescriptor | AnthropicProxyDescriptor
  > = [...allVendors, ...allGateways, ...allAnthropicProxies]

  // Helper: check duplicates within a map
  function checkDuplicates<T extends { id: string }>(
    items: T[],
    kind: string,
  ): void {
    const seen = new Set<string>()
    for (const item of items) {
      if (seen.has(item.id)) {
        errors.push(`Duplicate ${kind} id: ${item.id}`)
      }
      seen.add(item.id)
    }
  }

  checkDuplicates(getAllBrands(), 'brand')
  checkDuplicates(allVendors, 'vendor')
  checkDuplicates(allGateways, 'gateway')
  checkDuplicates(allAnthropicProxies, 'anthropic-proxy')
  checkDuplicates(getAllModels(), 'model')

  const presetOwners = new Map<string, string>()
  const vendorIds = new Set(allVendors.map(vendor => vendor.id))

  for (const route of allRoutes) {
    const preset = route.preset
    if (!preset) {
      continue
    }

    const presetId = preset.id.trim()
    if (!presetId) {
      errors.push(`Route "${route.id}" opted into presets with an empty preset id`)
      continue
    }

    const existingOwner = presetOwners.get(presetId)
    if (existingOwner) {
      errors.push(
        `Duplicate preset id "${presetId}" defined by routes "${existingOwner}" and "${route.id}"`,
      )
    } else {
      presetOwners.set(presetId, route.id)
    }

    if (!preset.description.trim()) {
      errors.push(
        `Route "${route.id}" opted into presets without a preset description`,
      )
    }

    const effectiveApiKeyEnvVars =
      preset.apiKeyEnvVars ?? route.setup.credentialEnvVars ?? []
    if (
      route.setup.requiresAuth &&
      route.setup.authMode === 'api-key' &&
      effectiveApiKeyEnvVars.length === 0
    ) {
      errors.push(
        `Preset route "${route.id}" requires API-key auth but does not declare any credential env vars`,
      )
    }

    const hasDefaultBaseUrl =
      'defaultBaseUrl' in route &&
      typeof route.defaultBaseUrl === 'string' &&
      route.defaultBaseUrl.trim().length > 0
    if (!hasDefaultBaseUrl && !preset.fallbackBaseUrl) {
      errors.push(
        `Preset route "${route.id}" must provide a defaultBaseUrl or preset.fallbackBaseUrl`,
      )
    }

    const defaultModelValue =
      'defaultModel' in route ? route.defaultModel : undefined
    const hasCatalogDefaultModel =
      (route.catalog?.models?.find(model => model.default) ??
        route.catalog?.models?.[0]) !== undefined
    const hasDefaultModel =
      typeof defaultModelValue === 'string'
        ? defaultModelValue.trim().length > 0
        : hasCatalogDefaultModel
    if (!hasDefaultModel && !preset.fallbackModel) {
      errors.push(
        `Preset route "${route.id}" must provide a defaultModel or preset.fallbackModel`,
      )
    }

    if (!vendorIds.has(route.id)) {
      if (!preset.vendorId?.trim()) {
        errors.push(
          `Preset route "${route.id}" must declare preset.vendorId because it is not a direct vendor`,
        )
      } else if (!vendorIds.has(preset.vendorId)) {
        errors.push(
          `Preset route "${route.id}" references missing preset.vendorId "${preset.vendorId}"`,
        )
      }
    }
  }

  // Validate catalog entries on gateways and vendors
  const routes: Array<{ id: string; catalog?: import('./descriptors.js').ModelCatalogConfig }> = [
    ...allGateways.map(g => ({ id: g.id, catalog: g.catalog })),
    ...allVendors.map(v => ({ id: v.id, catalog: v.catalog })),
  ]

  for (const route of routes) {
    if (!route.catalog) continue

    const catalog = route.catalog
    const entryIds = new Set<string>()
    let defaultCount = 0
    const routeDescriptor = _gateways.get(route.id) ?? _vendors.get(route.id)
    const explicitDefaultModel =
      routeDescriptor &&
      'defaultModel' in routeDescriptor &&
      routeDescriptor.defaultModel !== undefined

    for (const entry of catalog.models ?? []) {
      // Duplicate entry ids within route
      if (entryIds.has(entry.id)) {
        errors.push(`Duplicate catalog entry id "${entry.id}" in route "${route.id}"`)
      }
      entryIds.add(entry.id)

      // modelDescriptorId must point to existing shared model
      if (entry.modelDescriptorId && !_models.has(entry.modelDescriptorId)) {
        errors.push(
          `Catalog entry "${entry.id}" in route "${route.id}" references missing model descriptor "${entry.modelDescriptorId}"`,
        )
      }

      // Count defaults
      if (entry.default) {
        defaultCount++
        if (explicitDefaultModel) {
          errors.push(
            `Catalog entry "${entry.id}" in route "${route.id}" must not set default because the route defines defaultModel`,
          )
        }
      }
    }

    // Static catalog must have models or be explicitly empty
    if (catalog.source === 'static' && (catalog.models?.length ?? 0) === 0) {
      // Allow explicitly empty only if there's a discovery config or explicit marker
      // For now, warn if truly empty with no discovery
      if (!catalog.discovery) {
        warnings.push(`Static catalog for route "${route.id}" has no models and no discovery config`)
      }
    }

    // Multiple defaults check
    if (defaultCount > 1) {
      warnings.push(`Route "${route.id}" has ${defaultCount} default catalog entries`)
    }

    // Unsupported transport/config combinations
    if (routeDescriptor?.transportConfig.kind !== 'openai-compatible') {
      for (const entry of catalog.models ?? []) {
        if (entry.transportOverrides?.openaiShim) {
          errors.push(
            `Catalog entry "${entry.id}" in route "${route.id}" has openaiShim overrides but route transport is "${routeDescriptor?.transportConfig.kind}"`,
          )
        }
      }
    }
  }

  // Validate usage metadata delegates
  for (const gateway of allGateways) {
    if (gateway.usage?.delegateToVendorId && !_vendors.has(gateway.usage.delegateToVendorId)) {
      errors.push(
        `Gateway "${gateway.id}" delegates usage to missing vendor "${gateway.usage.delegateToVendorId}"`,
      )
    }
    if (gateway.usage?.delegateToGatewayId && !_gateways.has(gateway.usage.delegateToGatewayId)) {
      errors.push(
        `Gateway "${gateway.id}" delegates usage to missing gateway "${gateway.usage.delegateToGatewayId}"`,
      )
    }
  }

  for (const vendor of allVendors) {
    if (vendor.usage?.delegateToVendorId && !_vendors.has(vendor.usage.delegateToVendorId)) {
      errors.push(
        `Vendor "${vendor.id}" delegates usage to missing vendor "${vendor.usage.delegateToVendorId}"`,
      )
    }
    if (vendor.usage?.delegateToGatewayId && !_gateways.has(vendor.usage.delegateToGatewayId)) {
      errors.push(
        `Vendor "${vendor.id}" delegates usage to missing gateway "${vendor.usage.delegateToGatewayId}"`,
      )
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

// ---------------------------------------------------------------------------
// Test helpers (clear registry state between tests)
// ---------------------------------------------------------------------------

export function _clearRegistryForTesting(): void {
  _brands.clear()
  _vendors.clear()
  _gateways.clear()
  _anthropicProxies.clear()
  _models.clear()
}
