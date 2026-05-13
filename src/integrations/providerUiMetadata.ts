import type { AuthMode } from './descriptors.js'
import type { ProviderPresetManifestEntry } from './descriptors.js'
import { routeForPreset } from './compatibility.js'
import {
  ORDERED_PROVIDER_PRESETS,
  PROVIDER_PRESET_MANIFEST,
  type ProviderPreset,
} from './generated/integrationArtifacts.generated.js'
import {
  getRouteDefaultBaseUrl,
  getRouteDefaultModel,
  getRouteDescriptor,
  getRouteLabel,
  routeSupportsCustomHeaders,
} from './routeMetadata.js'

const PRESET_UI_METADATA = new Map<ProviderPreset, ProviderPresetManifestEntry>(
  PROVIDER_PRESET_MANIFEST.map(entry => [
    entry.preset,
    entry as ProviderPresetManifestEntry,
  ] as const),
)

function readFirstEnvValue(
  processEnv: NodeJS.ProcessEnv,
  envVars?: readonly string[],
): string {
  for (const envVar of envVars ?? []) {
    const value = processEnv[envVar]?.trim()
    if (value) {
      return value
    }
  }

  return ''
}

export type ProviderPresetUiMetadata = {
  apiKey: string
  authMode: AuthMode
  baseUrl: string
  credentialEnvVars: string[]
  description: string
  label: string
  model: string
  name: string
  preset: ProviderPreset
  provider: string
  requiresApiKey: boolean
  routeId: string
  supportsCustomHeaders: boolean
}

export { ORDERED_PROVIDER_PRESETS }

export function getProviderPresetUiMetadata(
  preset: ProviderPreset,
  processEnv: NodeJS.ProcessEnv = process.env,
): ProviderPresetUiMetadata {
  const route = routeForPreset(preset)
  const descriptor = getRouteDescriptor(route.routeId)
  const presetMetadata = PRESET_UI_METADATA.get(preset)
  if (!presetMetadata) {
    throw new Error(`Unknown preset: ${preset}`)
  }

  const credentialEnvVars = [
    ...(presetMetadata.apiKeyEnvVars ?? descriptor?.setup.credentialEnvVars ?? []),
  ]
  const baseUrl =
    readFirstEnvValue(processEnv, presetMetadata.baseUrlEnvVars) ||
    getRouteDefaultBaseUrl(route.routeId) ||
    presetMetadata.fallbackBaseUrl ||
    ''
  const model =
    readFirstEnvValue(processEnv, presetMetadata.modelEnvVars) ||
    getRouteDefaultModel(route.routeId) ||
    presetMetadata.fallbackModel ||
    ''
  const label =
    presetMetadata.label ?? getRouteLabel(route.routeId) ?? route.routeId

  return {
    apiKey: readFirstEnvValue(processEnv, credentialEnvVars),
    authMode: descriptor?.setup.authMode ?? 'api-key',
    baseUrl,
    credentialEnvVars,
    description: presetMetadata.description,
    label,
    model,
    name: presetMetadata.name ?? label,
    preset,
    provider: route.routeId,
    requiresApiKey: descriptor?.setup.requiresAuth ?? false,
    routeId: route.routeId,
    supportsCustomHeaders: routeSupportsCustomHeaders(route.routeId),
  }
}
