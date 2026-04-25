// src/integrations/profileResolver.ts
// Resolves a stored profile.provider string to a descriptor-backed route.
// This bridges legacy preset names, vendor ids, gateway ids, and custom strings.

import { getGateway, getVendor } from './registry.js'
import { routeForPreset } from './compatibility.js'

export type ResolvedProfileRoute = {
  vendorId: string
  gatewayId?: string
  routeId: string
}

/**
 * Resolve a stored profile provider string to a route.
 *
 * Resolution order:
 *   1. Try compatibility preset mapping
 *   2. Try direct vendor id lookup
 *   3. Try gateway id lookup
 *   4. Return safe unknown-provider fallback
 */
export function resolveProfileRoute(provider: string): ResolvedProfileRoute {
  // 1. Try preset mapping
  try {
    return routeForPreset(provider as import('../utils/providerProfiles.js').ProviderPreset)
  } catch {
    // Not a known preset
  }

  // 2. Try direct vendor id
  const vendor = getVendor(provider)
  if (vendor) {
    return { vendorId: vendor.id, routeId: vendor.id }
  }

  // 3. Try gateway id
  const gateway = getGateway(provider)
  if (gateway) {
    return { vendorId: 'openai', gatewayId: gateway.id, routeId: gateway.id }
  }

  // 4. Safe fallback — OpenAI-compatible so the user can still interact,
  //    but the routeId makes it clear this is unrecognised.
  return { vendorId: 'openai', routeId: 'unknown-fallback' }
}
