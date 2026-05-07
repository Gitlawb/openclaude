// src/integrations/compatibility.ts
// Maps legacy preset names to descriptor-authored route ids.
// This bridge preserves backward compatibility for stored provider profiles.

import type { ProviderPresetManifestEntry } from './descriptors.js'
import {
  PROVIDER_PRESET_MANIFEST,
  type ProviderPreset,
} from './generated/integrationArtifacts.generated.js'

export const PRESET_VENDOR_MAP: Array<{
  preset: ProviderPreset
  vendorId: string
  gatewayId?: string
}> = PROVIDER_PRESET_MANIFEST.map(entry => ({
  preset: entry.preset,
  vendorId: entry.vendorId,
  gatewayId: 'gatewayId' in entry ? entry.gatewayId : undefined,
}))

const PRESET_ROUTE_MAP = new Map<ProviderPreset, ProviderPresetManifestEntry>(
  PROVIDER_PRESET_MANIFEST.map(entry => [
    entry.preset,
    entry as ProviderPresetManifestEntry,
  ] as const),
)

export function isProviderPreset(value: string): value is ProviderPreset {
  return PRESET_ROUTE_MAP.has(value as ProviderPreset)
}

function getPresetEntry(preset: ProviderPreset) {
  const entry = PRESET_ROUTE_MAP.get(preset)
  if (!entry) {
    throw new Error(`Unknown preset: ${preset}`)
  }

  return entry
}

export function vendorIdForPreset(preset: ProviderPreset): string {
  return getPresetEntry(preset).vendorId
}

export function gatewayIdForPreset(preset: ProviderPreset): string | undefined {
  return getPresetEntry(preset).gatewayId
}

export function routeForPreset(preset: ProviderPreset): {
  vendorId: string
  gatewayId?: string
  routeId: string
} {
  const entry = getPresetEntry(preset)
  return {
    vendorId: entry.vendorId,
    gatewayId: entry.gatewayId,
    routeId: entry.routeId,
  }
}
