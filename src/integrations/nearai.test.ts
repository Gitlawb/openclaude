// src/integrations/nearai.test.ts
//
// Regression coverage for the NearAI `anthropic/claude-opus-4-8` route.
// The vendor catalog exposes the model via a catalog entry whose
// modelDescriptorId must resolve to a registered model descriptor; this
// test exercises that exact provider/model path so the route can't silently
// break (e.g. a removed descriptor or a mismatched id) without failing here.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { ensureIntegrationsLoaded } from './index.js'
import {
  _clearRegistryForTesting,
  getCatalogEntriesForRoute,
  getModelsForVendor,
} from './registry.js'
import { getRouteDefaultBaseUrl } from './routeMetadata.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

const OPUS_48_ID = 'anthropic/claude-opus-4-8'

beforeEach(async () => {
  await acquireSharedMutationLock('integrations/nearai.test.ts')
  _clearRegistryForTesting()
  ensureIntegrationsLoaded()
})

afterEach(() => {
  releaseSharedMutationLock()
})

describe('NearAI Claude Opus 4.8 route', () => {
  test('catalog exposes the anthropic/claude-opus-4-8 entry', () => {
    const entry = getCatalogEntriesForRoute('nearai').find(
      e => e.id === OPUS_48_ID,
    )
    expect(entry).toBeDefined()
    expect(entry!.apiName).toBe(OPUS_48_ID)
    // The entry must link to a model descriptor so the route resolves it.
    expect(entry!.modelDescriptorId).toBe(OPUS_48_ID)
  })

  test('catalog entry resolves to a registered NearAI model descriptor', () => {
    const model = getModelsForVendor('nearai').find(m => m.id === OPUS_48_ID)
    // getModelsForVendor drops entries whose modelDescriptorId has no
    // matching descriptor, so a defined result proves the route is wired.
    expect(model).toBeDefined()
    expect(model!.vendorId).toBe('nearai')
    expect(model!.brandId).toBe('nearai')
    expect(model!.defaultModel).toBe(OPUS_48_ID)
    expect(model!.label).toBe('Claude Opus 4.8')
  })

  test('NearAI route points at the NearAI cloud gateway base URL', () => {
    expect(getRouteDefaultBaseUrl('nearai')).toBe(
      'https://cloud-api.near.ai/v1',
    )
  })
})
