// src/integrations/define.ts
// Lightweight typed helpers for descriptor authoring.
// Contributors import these instead of registry functions or descriptor types.

import type {
  AnthropicProxyDescriptor,
  BrandDescriptor,
  GatewayDescriptor,
  ModelCatalogConfig,
  ModelDescriptor,
  VendorDescriptor,
} from './descriptors.js'

export function defineVendor(d: VendorDescriptor): VendorDescriptor {
  return d
}

export function defineGateway(d: GatewayDescriptor): GatewayDescriptor {
  return d
}

export function defineAnthropicProxy(d: AnthropicProxyDescriptor): AnthropicProxyDescriptor {
  return d
}

export function defineBrand(d: BrandDescriptor): BrandDescriptor {
  return d
}

export function defineModel(d: ModelDescriptor): ModelDescriptor {
  return d
}

export function defineCatalog(d: ModelCatalogConfig): ModelCatalogConfig {
  return d
}
