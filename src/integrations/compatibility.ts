// src/integrations/compatibility.ts
// Maps legacy preset names to descriptor ids.
// This bridge preserves backward compatibility for stored provider profiles.

import type { ProviderPreset } from '../utils/providerProfiles.js'

export const PRESET_VENDOR_MAP: Array<{
  preset: ProviderPreset
  vendorId: string
  gatewayId?: string
}> = [
  { preset: 'anthropic', vendorId: 'anthropic' },
  { preset: 'openai', vendorId: 'openai' },
  { preset: 'ollama', vendorId: 'openai', gatewayId: 'ollama' },
  { preset: 'kimi-code', vendorId: 'openai', gatewayId: 'kimi-code' },
  { preset: 'moonshotai', vendorId: 'moonshot' },
  { preset: 'deepseek', vendorId: 'deepseek' },
  { preset: 'gemini', vendorId: 'gemini' },
  { preset: 'mistral', vendorId: 'mistral' },
  { preset: 'together', vendorId: 'openai', gatewayId: 'together' },
  { preset: 'groq', vendorId: 'openai', gatewayId: 'groq' },
  { preset: 'azure-openai', vendorId: 'openai', gatewayId: 'azure-openai' },
  { preset: 'openrouter', vendorId: 'openai', gatewayId: 'openrouter' },
  { preset: 'lmstudio', vendorId: 'openai', gatewayId: 'lmstudio' },
  { preset: 'dashscope-cn', vendorId: 'openai', gatewayId: 'dashscope-cn' },
  { preset: 'dashscope-intl', vendorId: 'openai', gatewayId: 'dashscope-intl' },
  { preset: 'custom', vendorId: 'openai', gatewayId: 'custom' },
  { preset: 'nvidia-nim', vendorId: 'openai', gatewayId: 'nvidia-nim' },
  { preset: 'minimax', vendorId: 'minimax' },
  { preset: 'bankr', vendorId: 'bankr' },
  { preset: 'atomic-chat', vendorId: 'openai', gatewayId: 'atomic-chat' },
]

export function vendorIdForPreset(preset: ProviderPreset): string {
  const mapping = PRESET_VENDOR_MAP.find(m => m.preset === preset)
  if (!mapping) {
    throw new Error(`Unknown preset: ${preset}`)
  }
  return mapping.vendorId
}

export function gatewayIdForPreset(preset: ProviderPreset): string | undefined {
  const mapping = PRESET_VENDOR_MAP.find(m => m.preset === preset)
  return mapping?.gatewayId
}

export function routeForPreset(preset: ProviderPreset): {
  vendorId: string
  gatewayId?: string
  routeId: string
} {
  const mapping = PRESET_VENDOR_MAP.find(m => m.preset === preset)
  if (!mapping) {
    throw new Error(`Unknown preset: ${preset}`)
  }
  return {
    vendorId: mapping.vendorId,
    gatewayId: mapping.gatewayId,
    routeId: mapping.gatewayId ?? mapping.vendorId,
  }
}
