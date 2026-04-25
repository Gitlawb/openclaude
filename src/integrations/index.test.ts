// src/integrations/index.test.ts
// Integration test: validates the full registry after loading all descriptors.

import { describe, expect, test } from 'bun:test'
import { validateIntegrationRegistry } from './index.js'

describe('loaded registry validation', () => {
  test('registry is valid after loading all descriptors', () => {
    const result = validateIntegrationRegistry()
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })
})
