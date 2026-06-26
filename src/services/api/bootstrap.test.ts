import { expect, test } from 'bun:test'

import type { RouteDiscoveryResult } from '../../integrations/discoveryService.js'
import { getDiscoveredModelApiNames } from './bootstrap.js'

test('uses static route models from errored discovery results', () => {
  const discovered: RouteDiscoveryResult = {
    routeId: 'hicap',
    models: [
      { id: 'hicap-glm-5.2', apiName: 'glm-5.2', label: 'GLM 5.2' },
      { id: 'blank', apiName: '   ', label: 'Blank' },
    ],
    stale: false,
    error: { message: 'Discovery failed for route hicap', recordedAt: 1 },
    source: 'error',
  }

  expect(getDiscoveredModelApiNames(discovered)).toEqual(['glm-5.2'])
})

test('falls back to raw discovery when route discovery has no usable models', () => {
  const discovered: RouteDiscoveryResult = {
    routeId: 'hicap',
    models: [],
    stale: false,
    error: { message: 'Discovery failed for route hicap', recordedAt: 1 },
    source: 'error',
  }

  expect(getDiscoveredModelApiNames(discovered)).toBeNull()
})
