import { describe, expect, test } from 'bun:test'
import { resolveSmartRoutingConfig } from './resolveConfig.js'
import type { SettingsJson } from '../../../utils/settings/types.js'

const PARENT = 'gpt-5'

function settings(overrides: Record<string, unknown>): SettingsJson {
  return overrides as unknown as SettingsJson
}

describe('resolveSmartRoutingConfig', () => {
  test('both roles as model-only agentModels keys resolve to their model strings', () => {
    const s = settings({
      agentModels: {
        mini: { model: 'gpt-5-mini' },
        main: { model: 'gpt-5' },
      },
      smartRouting: { enabled: true, simpleModel: 'mini', strongModel: 'main' },
    })
    const config = resolveSmartRoutingConfig({ settings: s, parentModel: PARENT })
    expect(config.enabled).toBe(true)
    expect(config.simpleModel).toBe('gpt-5-mini')
    expect(config.strongModel).toBe('gpt-5')
  })

  test('simpleModel resolving to a cross-provider override collapses to strong, no credential leak', () => {
    const s = settings({
      agentModels: {
        ds: { base_url: 'https://api.deepseek.com/v1', api_key: 'sk-secret' },
        main: { model: 'gpt-5' },
      },
      smartRouting: { enabled: true, simpleModel: 'ds', strongModel: 'main' },
    })
    const config = resolveSmartRoutingConfig({ settings: s, parentModel: PARENT })
    expect(config.enabled).toBe(true)
    expect(config.simpleModel).toBe('gpt-5') // collapsed to strong
    expect(config.strongModel).toBe('gpt-5')
    // No credential field leaked into the returned config.
    const json = JSON.stringify(config)
    expect(json).not.toContain('sk-secret')
    expect(json).not.toContain('api_key')
    expect(json).not.toContain('base_url')
  })

  test('strong role resolving to a cross-provider override disables routing (no safe fallback)', () => {
    const s = settings({
      agentModels: {
        ds: { base_url: 'https://api.deepseek.com/v1', api_key: 'sk-secret' },
        mini: { model: 'gpt-5-mini' },
      },
      smartRouting: { enabled: true, simpleModel: 'mini', strongModel: 'ds' },
    })
    const config = resolveSmartRoutingConfig({ settings: s, parentModel: PARENT })
    expect(config.enabled).toBe(false)
    expect(JSON.stringify(config)).not.toContain('sk-secret')
  })

  test('missing simpleModel collapses to strong (routeModel treats equal models as always-strong)', () => {
    const s = settings({
      agentModels: { main: { model: 'gpt-5' } },
      smartRouting: { enabled: true, strongModel: 'main' },
    })
    const config = resolveSmartRoutingConfig({ settings: s, parentModel: PARENT })
    expect(config.enabled).toBe(true)
    expect(config.simpleModel).toBe('gpt-5')
    expect(config.strongModel).toBe('gpt-5')
  })

  test('bare model ids (not agentModels keys) pass through as model strings', () => {
    const s = settings({
      smartRouting: { enabled: true, simpleModel: 'qwen2.5-coder:7b', strongModel: 'qwen2.5-coder:32b' },
    })
    const config = resolveSmartRoutingConfig({ settings: s, parentModel: PARENT })
    expect(config.enabled).toBe(true)
    expect(config.simpleModel).toBe('qwen2.5-coder:7b')
    expect(config.strongModel).toBe('qwen2.5-coder:32b')
  })

  test('thresholds carry through from settings', () => {
    const s = settings({
      smartRouting: { enabled: true, simpleModel: 'a', strongModel: 'b', simpleMaxChars: 200, simpleMaxWords: 40 },
    })
    const config = resolveSmartRoutingConfig({ settings: s, parentModel: PARENT })
    expect(config.simpleMaxChars).toBe(200)
    expect(config.simpleMaxWords).toBe(40)
  })

  test('disabled settings produce a disabled config', () => {
    const s = settings({ smartRouting: { enabled: false, simpleModel: 'a', strongModel: 'b' } })
    expect(resolveSmartRoutingConfig({ settings: s, parentModel: PARENT }).enabled).toBe(false)
    expect(resolveSmartRoutingConfig({ settings: null, parentModel: PARENT }).enabled).toBe(false)
  })
})
