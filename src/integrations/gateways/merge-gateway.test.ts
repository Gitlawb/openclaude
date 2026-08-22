import { describe, expect, test } from 'bun:test'

import '../index.js'
import {
  getRouteCredentialEnvVars,
  resolveActiveRouteIdFromEnv,
} from '../routeMetadata.js'
import { applyProviderFlag } from '../../utils/providerFlag.js'
import mergeGateway from './merge-gateway.js'

const mapModel = mergeGateway.catalog?.discovery?.mapModel

describe('Merge Gateway', () => {
  test('uses a dedicated OpenAI-compatible gateway route', () => {
    expect(mergeGateway.id).toBe('merge-gateway')
    expect(mergeGateway.defaultBaseUrl).toBe(
      'https://api-gateway.merge.dev/v1/openai',
    )
    expect(mergeGateway.setup.credentialEnvVars).toEqual([
      'MERGE_GATEWAY_API_KEY',
    ])
    expect(mergeGateway.setup.dedicatedCredentialsOnly).toBe(true)
    expect(mergeGateway.transportConfig.kind).toBe('openai-compatible')
    expect(
      mergeGateway.transportConfig.openaiShim?.supportsApiFormatSelection,
    ).toBe(true)
  })

  test('keeps routing policy and concrete model fallbacks in the catalog', () => {
    expect(mergeGateway.catalog?.source).toBe('hybrid')
    expect(mergeGateway.catalog?.discovery?.requiresAuth).toBe(true)
    expect(mergeGateway.catalog?.models?.map(model => model.apiName)).toEqual([
      'default_routing',
      'openai/gpt-5.5',
    ])
  })

  test('--provider selects the route while keeping credentials dedicated', () => {
    expect(getRouteCredentialEnvVars('merge-gateway')).toEqual([
      'MERGE_GATEWAY_API_KEY',
    ])

    const previousEnv = { ...process.env }
    try {
      process.env.MERGE_GATEWAY_API_KEY = 'merge-key'
      process.env.OPENAI_API_KEY = 'unrelated-openai-key'
      delete process.env.OPENAI_BASE_URL

      expect(
        applyProviderFlag('merge-gateway', [
          '--provider',
          'merge-gateway',
          '--model',
          'default_routing',
        ]),
      ).toEqual({})
      expect(String(process.env.OPENAI_BASE_URL)).toBe(
        'https://api-gateway.merge.dev/v1/openai',
      )
      expect(String(process.env.OPENAI_MODEL)).toBe('default_routing')
      expect(resolveActiveRouteIdFromEnv(process.env)).toBe('merge-gateway')
    } finally {
      for (const name of Object.keys(process.env)) {
        if (!(name in previousEnv)) delete process.env[name]
      }
      Object.assign(process.env, previousEnv)
    }
  })

  test('maps native and OpenAI-compatible model list shapes', () => {
    if (!mapModel) throw new Error('mapModel missing')

    expect(
      mapModel({
        model: 'anthropic/claude-sonnet-5',
        display_name: 'Claude Sonnet 5',
      }),
    ).toEqual({
      id: 'merge-gateway-anthropic/claude-sonnet-5',
      apiName: 'anthropic/claude-sonnet-5',
      label: 'Claude Sonnet 5 (via Merge Gateway)',
    })
    expect(mapModel({ id: 'openai/gpt-5.5' })).toEqual({
      id: 'merge-gateway-openai/gpt-5.5',
      apiName: 'openai/gpt-5.5',
      label: 'openai/gpt-5.5 (via Merge Gateway)',
    })
    expect(mapModel({})).toBeNull()
    expect(mapModel(null)).toBeNull()
  })
})
