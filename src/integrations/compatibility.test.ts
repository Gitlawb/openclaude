import { describe, expect, test } from 'bun:test'

import './index.js'
import {
  getGateway,
  getVendor,
} from './index.js'
import {
  PRESET_VENDOR_MAP,
  gatewayIdForPreset,
  routeForPreset,
  vendorIdForPreset,
} from './compatibility.js'
import { resolveProfileRoute } from './profileResolver.js'
import type { ProviderPreset } from '../utils/providerProfiles.js'

const EXPECTED_PRESETS = [
  'anthropic',
  'openai',
  'ollama',
  'kimi-code',
  'moonshotai',
  'deepseek',
  'gemini',
  'mistral',
  'together',
  'groq',
  'hicap',
  'azure-openai',
  'openrouter',
  'lmstudio',
  'dashscope-cn',
  'dashscope-intl',
  'custom',
  'nvidia-nim',
  'minimax',
  'xai',
  'zai',
  'bankr',
  'atomic-chat',
] as const satisfies readonly ProviderPreset[]

describe('compatibility mappings', () => {
  test('cover every current provider preset exactly once', () => {
    expect(PRESET_VENDOR_MAP.map(mapping => mapping.preset).sort()).toEqual(
      [...EXPECTED_PRESETS].sort(),
    )
    expect(new Set(PRESET_VENDOR_MAP.map(mapping => mapping.preset)).size).toBe(
      EXPECTED_PRESETS.length,
    )
  })

  test('every preset resolves to an existing vendor and optional gateway', () => {
    for (const preset of EXPECTED_PRESETS) {
      const vendorId = vendorIdForPreset(preset)
      const gatewayId = gatewayIdForPreset(preset)
      const route = routeForPreset(preset)

      expect(getVendor(vendorId)?.id).toBe(vendorId)
      if (gatewayId) {
        expect(getGateway(gatewayId)?.id).toBe(gatewayId)
      }

      expect(route.vendorId).toBe(vendorId)
      expect(route.gatewayId).toBe(gatewayId)
      expect(route.routeId).toBe(gatewayId ?? vendorId)
    }
  })

  test('native gateway profile routes use their descriptor vendor', () => {
    expect(resolveProfileRoute('bedrock')).toEqual({
      vendorId: 'anthropic',
      gatewayId: 'bedrock',
      routeId: 'bedrock',
    })
    expect(resolveProfileRoute('vertex')).toEqual({
      vendorId: 'anthropic',
      gatewayId: 'vertex',
      routeId: 'vertex',
    })
  })
})
