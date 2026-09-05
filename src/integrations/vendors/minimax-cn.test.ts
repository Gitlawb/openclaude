import { describe, expect, test } from 'bun:test'

import {
  ensureIntegrationsLoaded,
  getCatalogEntriesForRoute,
  getProviderPresetUiMetadata,
  getRouteDefaultBaseUrl,
  getRouteDefaultModel,
  getVendor,
  resolveRouteIdFromBaseUrl,
  validateIntegrationRegistry,
} from '../index.js'

describe('minimax-cn vendor (国内 MiniMax)', () => {
  test('registers the mainland-China endpoint, catalog, and preset metadata', () => {
    ensureIntegrationsLoaded()

    const vendor = getVendor('minimax-cn')
    expect(vendor).toBeDefined()
    expect(vendor?.defaultBaseUrl).toBe('https://api.minimaxi.com/anthropic')
    expect(vendor?.defaultModel).toBe('MiniMax-M3')
    expect(vendor?.setup.credentialEnvVars).toEqual(['MINIMAX_API_KEY'])
    expect(vendor?.requiredEnvVars).toContain('MINIMAX_API_KEY')

    expect(getRouteDefaultBaseUrl('minimax-cn')).toBe(
      'https://api.minimaxi.com/anthropic',
    )
    expect(getRouteDefaultModel('minimax-cn')).toBe('MiniMax-M3')

    // 国内端点必须被识别为 minimax-cn vendor（之前 isMiniMaxBaseUrl 漏掉）。
    expect(resolveRouteIdFromBaseUrl('https://api.minimaxi.com/anthropic')).toBe(
      'minimax-cn',
    )
    expect(resolveRouteIdFromBaseUrl('https://api.minimaxi.com/v1')).toBe(
      'minimax-cn',
    )
    // 海外端点仍归 minimax，不能串。
    expect(resolveRouteIdFromBaseUrl('https://api.minimax.io/anthropic')).toBe(
      'minimax',
    )

    const catalog = getCatalogEntriesForRoute('minimax-cn')
    expect(catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ apiName: 'MiniMax-M3' }),
      ]),
    )

    const preset = getProviderPresetUiMetadata('minimax-cn')
    expect(preset.routeId).toBe('minimax-cn')
    expect(preset.credentialEnvVars).toContain('MINIMAX_API_KEY')
    expect(preset.baseUrl).toBe('https://api.minimaxi.com/anthropic')
    expect(preset.model).toBe('MiniMax-M3')
    expect(preset.requiresApiKey).toBe(true)
    expect(preset.description).toBe('MiniMax (China) — api.minimaxi.com')
    expect(preset.name).toBe('MiniMax (China)')
    expect(preset.label).toBe('MiniMax (China)')

    const validation = validateIntegrationRegistry()
    expect(validation.valid).toBe(true)
  })
})