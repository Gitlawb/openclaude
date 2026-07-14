import { describe, expect, test } from 'bun:test'

import {
  getCatalogEntriesForRoute,
  getModel,
} from './index.js'
import { resolveModelRuntimeLimits } from './runtimeMetadata.js'

describe('Tencent HY3 descriptor', () => {
  test('exposes the verified HY3 capabilities and limits to gateway catalogs', () => {
    const model = getModel('tencent/hy3')

    expect(model).toBeDefined()
    expect(model).toMatchObject({
      id: 'tencent/hy3',
      classification: ['chat', 'reasoning', 'coding'],
      contextWindow: 262_144,
      maxOutputTokens: 131_072,
      capabilities: {
        supportsVision: false,
        supportsStreaming: true,
        supportsFunctionCalling: true,
        supportsJsonMode: true,
        supportsReasoning: true,
      },
    })

    const catalogEntry = getCatalogEntriesForRoute('gitlawb-opengateway').find(
      entry => entry.apiName === 'tencent/hy3',
    )
    expect(catalogEntry?.modelDescriptorId).toBe(model?.id)

    expect(
      resolveModelRuntimeLimits({
        model: 'tencent/hy3',
        baseUrl: 'https://opengateway.gitlawb.com/v1',
        processEnv: {},
      }),
    ).toEqual({ contextWindow: 262_144, maxOutputTokens: 131_072 })
  })
})
