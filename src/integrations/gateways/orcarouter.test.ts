// Pins the OrcaRouter gateway descriptor and its registry/preset wiring.
//
// OrcaRouter is an aggregating OpenAI-compatible gateway, so the risky parts
// are the ones a future refactor could silently change: the transport family
// (it must stay `openai-compatible`, not drift to `local` or a proxy family),
// the public-`/models` discovery flag, and the preset -> route mapping that
// `/provider` uses. Everything here is descriptor/registry assertion only —
// no network.

import { describe, expect, test } from 'bun:test'

import '../index.js'
import {
  getCatalogEntriesForRoute,
  getGateway,
  getModelsForGateway,
  routeForPreset,
} from '../index.js'
import { getRouteCredentialEnvVars } from '../routeMetadata.js'
import orcarouter from './orcarouter.js'

describe('orcarouter gateway descriptor', () => {
  test('routes OpenAI-compatible traffic to the OrcaRouter endpoint', () => {
    expect(orcarouter.id).toBe('orcarouter')
    expect(orcarouter.category).toBe('aggregating')
    expect(orcarouter.defaultBaseUrl).toBe('https://api.orcarouter.ai/v1')
    expect(orcarouter.defaultModel).toBe('openai/gpt-5-mini')
    expect(orcarouter.supportsModelRouting).toBe(true)
    expect(orcarouter.transportConfig.kind).toBe('openai-compatible')
  })

  test('requires an API key and names a dedicated credential env var', () => {
    expect(orcarouter.setup.requiresAuth).toBe(true)
    expect(orcarouter.setup.authMode).toBe('api-key')
    expect(orcarouter.setup.credentialEnvVars).toEqual(['ORCAROUTER_API_KEY'])
  })

  test('declares no reasoning controls at the gateway level', () => {
    // Mixed upstream catalog: `/effort` metadata belongs on catalog entries
    // that have been probed, never on the aggregating gateway itself.
    expect('reasoning' in orcarouter).toBe(false)
  })

  test('uses a hybrid catalog with keyless model discovery', () => {
    // `GET https://api.orcarouter.ai/v1/models` answers without auth, so the
    // picker can populate before a key is entered; inference still needs one.
    expect(orcarouter.catalog?.source).toBe('hybrid')
    expect(orcarouter.catalog?.discovery?.kind).toBe('openai-compatible')
    expect(orcarouter.catalog?.discovery?.requiresAuth).toBe(false)
    expect(orcarouter.catalog?.discoveryCacheTtl).toBe('1d')
    expect(orcarouter.catalog?.discoveryRefreshMode).toBe('background-if-stale')
    expect(orcarouter.catalog?.allowManualRefresh).toBe(true)
  })

  test('curated catalog entry matches the route default model', () => {
    const curated = orcarouter.catalog?.models ?? []
    expect(curated.map(model => model.apiName)).toEqual(['openai/gpt-5-mini'])
    expect(curated[0]?.modelDescriptorId).toBe('gpt-5-mini')
    // The route default must be resolvable from the curated catalog even
    // while discovery is cold or failing.
    expect(curated.some(model => model.apiName === orcarouter.defaultModel)).toBe(true)
  })
})

describe('orcarouter registry wiring', () => {
  test('is registered and exposes its curated model', () => {
    expect(getGateway('orcarouter')).toBeDefined()
    expect(
      getCatalogEntriesForRoute('orcarouter').some(
        entry => entry.apiName === 'openai/gpt-5-mini',
      ),
    ).toBe(true)
    // The curated entry points at a real shared model descriptor, so the
    // /model picker gets context/limit metadata instead of a bare id.
    expect(
      getModelsForGateway('orcarouter').some(model => model.id === 'gpt-5-mini'),
    ).toBe(true)
  })

  test('the generated preset resolves back to the gateway route', () => {
    expect(routeForPreset('orcarouter')).toEqual({
      routeId: 'orcarouter',
      vendorId: 'openai',
      gatewayId: 'orcarouter',
    })
  })

  test('accepts the dedicated key first and the generic OpenAI key as fallback', () => {
    // Same contract as the other aggregating OpenAI-compatible gateways: the
    // route is not `dedicatedCredentialsOnly`, so an existing OPENAI_API_KEY
    // pointed at the gateway keeps working.
    const envVars = getRouteCredentialEnvVars('orcarouter')
    expect(envVars[0]).toBe('ORCAROUTER_API_KEY')
    expect(envVars).toContain('OPENAI_API_KEYS')
    expect(envVars).toContain('OPENAI_API_KEY')
  })
})
