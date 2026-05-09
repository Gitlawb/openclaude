import { describe, expect, test } from 'bun:test'

import type { ModelCatalogConfig } from './types.js'
import { validateModelCatalogConfig } from './schema.js'

describe('validateModelCatalogConfig', () => {
  test('accepts a descriptor-era static catalog', () => {
    const catalog: ModelCatalogConfig = {
      source: 'static',
      models: [
        {
          id: 'gpt-5.4',
          apiName: 'gpt-5.4',
          label: 'GPT-5.4',
          modelDescriptorId: 'gpt-5.4',
          capabilities: { supportsReasoning: true },
          contextWindow: 1_050_000,
          maxOutputTokens: 128_000,
        },
      ],
    }

    const result = validateModelCatalogConfig(catalog, {
      routeId: 'openai',
      knownModelIds: ['gpt-5.4'],
    })

    expect(result).toEqual({ valid: true, errors: [] })
  })

  test('rejects invalid catalog source values', () => {
    const result = validateModelCatalogConfig({
      source: 'provider-json',
      models: [],
    })

    expect(result.valid).toBe(false)
    expect(result.errors.some(error => error.includes('/source'))).toBe(true)
  })

  test('rejects catalog entries without apiName', () => {
    const result = validateModelCatalogConfig({
      source: 'static',
      models: [{ id: 'missing-api-name' }],
    })

    expect(result.valid).toBe(false)
    expect(result.errors.some(error => error.includes('apiName'))).toBe(true)
  })

  test('rejects duplicate ids and api names within one route only', () => {
    const result = validateModelCatalogConfig(
      {
        source: 'static',
        models: [
          { id: 'model-a', apiName: 'provider/model-a' },
          { id: 'MODEL-A', apiName: 'provider/model-b' },
          { id: 'model-c', apiName: 'Provider/Model-A' },
        ],
      },
      { routeId: 'openrouter' },
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'Duplicate catalog entry id "MODEL-A" in route "openrouter"; first used by "model-a"',
    )
    expect(result.errors).toContain(
      'Duplicate catalog apiName "Provider/Model-A" in route "openrouter"; first used by "model-a"',
    )
  })

  test('rejects unknown modelDescriptorId when known ids are supplied', () => {
    const result = validateModelCatalogConfig(
      {
        source: 'static',
        models: [
          {
            id: 'route-model',
            apiName: 'route-model',
            modelDescriptorId: 'missing-model',
          },
        ],
      },
      { routeId: 'acme', knownModelIds: ['known-model'] },
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'Catalog entry "route-model" in route "acme" references missing model descriptor "missing-model"',
    )
  })

  test('accepts discovery mapModel functions through runtime validation', () => {
    const catalog: ModelCatalogConfig = {
      source: 'dynamic',
      discovery: {
        kind: 'custom',
        mapModel: raw => {
          if (typeof raw !== 'object' || raw === null) {
            return null
          }
          return { id: 'dynamic-model', apiName: 'dynamic-model' }
        },
      },
    }

    const result = validateModelCatalogConfig(catalog)

    expect(result).toEqual({ valid: true, errors: [] })
  })

  test('rejects unsupported top-level function properties', () => {
    const result = validateModelCatalogConfig({
      source: 'static',
      unexpected: () => 'x',
      models: [],
    })

    expect(result.valid).toBe(false)
    expect(
      result.errors.some(error =>
        error.includes('/ has unsupported property "unexpected"'),
      ),
    ).toBe(true)
  })

  test('rejects unsupported nested function properties under discovery', () => {
    const result = validateModelCatalogConfig({
      source: 'dynamic',
      discovery: {
        kind: 'custom',
        unexpected: () => 'x',
      },
    })

    expect(result.valid).toBe(false)
    expect(
      result.errors.some(error =>
        error.includes('/discovery has unsupported property "unexpected"'),
      ),
    ).toBe(true)
  })

  test('rejects function values on non-function catalog fields', () => {
    const result = validateModelCatalogConfig({
      source: 'dynamic',
      discovery: {
        kind: 'custom',
        path: () => '/models',
      },
    })

    expect(result.valid).toBe(false)
    expect(
      result.errors.some(error => error.includes('/discovery/path')),
    ).toBe(true)
  })

  test('rejects non-function discovery mapModel values', () => {
    const result = validateModelCatalogConfig({
      source: 'dynamic',
      discovery: {
        kind: 'custom',
        mapModel: 'not-a-function',
      },
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'Catalog discovery mapModel must be a function when provided',
    )
  })

  test('validates transportOverrides.openaiShim shape', () => {
    const result = validateModelCatalogConfig({
      source: 'static',
      models: [
        {
          id: 'bad-override',
          apiName: 'bad-override',
          transportOverrides: {
            openaiShim: {
              removeBodyFields: ['store', 123],
            },
          },
        },
      ],
    })

    expect(result.valid).toBe(false)
    expect(
      result.errors.some(error =>
        error.includes('/models/0/transportOverrides/openaiShim/removeBodyFields/1'),
      ),
    ).toBe(true)
  })
})
