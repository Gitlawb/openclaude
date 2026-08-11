import { describe, expect, test } from 'bun:test'

import {
  getCatalogEntriesForRoute,
  getModel,
  getModelsForBrand,
} from './index.js'
import { resolveModelRuntimeLimits } from './runtimeMetadata.js'

describe('Ling 3.0 Tiny :free descriptor', () => {
  test('exposes the Tiny capabilities and limits to gateway catalogs', () => {
    const model = getModel('inclusionai/ling-3.0-tiny:free')

    expect(model).toBeDefined()
    expect(model).toMatchObject({
      id: 'inclusionai/ling-3.0-tiny:free',
      brandId: 'ling',
      classification: ['chat', 'reasoning', 'coding'],
      contextWindow: 262_144,
      maxOutputTokens: 32_768,
      capabilities: {
        supportsVision: false,
        supportsStreaming: true,
        supportsFunctionCalling: true,
        supportsJsonMode: false,
        supportsReasoning: true,
      },
    })
    expect(getModelsForBrand('ling').map(m => m.id)).toContain(
      'inclusionai/ling-3.0-tiny:free',
    )

    // The gateway entry must map BOTH the wire id (apiName) and the picker
    // descriptor to the :free id — a mismatch would send a different model
    // upstream than the picker advertises.
    const catalogEntry = getCatalogEntriesForRoute('gitlawb-opengateway').find(
      entry => entry.apiName === 'inclusionai/ling-3.0-tiny:free',
    )
    expect(catalogEntry?.id).toBe('opengateway-ling-3.0-tiny-free')
    expect(catalogEntry?.modelDescriptorId).toBe(model?.id)

    expect(
      resolveModelRuntimeLimits({
        model: 'inclusionai/ling-3.0-tiny:free',
        baseUrl: 'https://opengateway.gitlawb.com/v1',
        processEnv: {},
      }),
    ).toEqual({ contextWindow: 262_144, maxOutputTokens: 32_768 })
  })
})
