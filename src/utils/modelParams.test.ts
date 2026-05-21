import { expect, test, describe, beforeEach, afterEach } from 'bun:test'
import { applyProviderProfileToProcessEnv } from './providerProfiles.js'
import { getContextWindowForModel } from './context.ts'
import { resolveAgentProvider } from '../services/api/agentRouting.ts'
import { getAutoCompactThreshold, getEffectiveContextWindowSize } from '../services/compact/autoCompact.ts'

describe('Model Parameter Configuration', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Clear relevant env vars to ensure hermetic tests
    delete process.env.CLAUDE_CODE_TEMPERATURE
    delete process.env.CLAUDE_CODE_TOP_P
    delete process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS
    delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
    delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_MODEL
    delete process.env.USER_TYPE
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  test('ProviderProfile respects temperature, top_p, and num_ctx', () => {
    const profile = {
      id: 'test-profile',
      name: 'Test Profile',
      provider: 'openai' as any,
      baseUrl: 'https://api.example.com/v1',
      model: 'test-model',
      temperature: 0.2,
      top_p: 0.85,
      num_ctx: 128000,
    }

    applyProviderProfileToProcessEnv(profile)

    expect(process.env.CLAUDE_CODE_TEMPERATURE).toBe('0.2')
    expect(process.env.CLAUDE_CODE_TOP_P).toBe('0.85')
    expect(process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe('128000')
    
    // Verify getContextWindowForModel uses the env var
    expect(getContextWindowForModel('test-model')).toBe(128000)
  })

  test('agentRouting respects temperature, top_p, and num_ctx', () => {
    const settings = {
      agentRouting: {
        'test-agent': 'test-model',
      },
      agentModels: {
        'test-model': {
          base_url: 'https://api.example.com/v1',
          api_key: 'sk-test',
          temperature: 0.3,
          top_p: 0.7,
          num_ctx: 64000,
        },
      },
    } as any

    const override = resolveAgentProvider('test-agent', undefined, settings)
    expect(override).not.toBeNull()
    expect(override?.temperature).toBe(0.3)
    expect(override?.top_p).toBe(0.7)
    expect(override?.num_ctx).toBe(64000)
  })

  test('getContextWindowForModel supports explicit override', () => {
    expect(getContextWindowForModel('any-model', [], 50000)).toBe(50000)
  })

  test('temperature: 0 is correctly handled', () => {
    const profile = {
      id: 'test-profile-0',
      name: 'Test Profile 0',
      provider: 'openai' as any,
      baseUrl: 'https://api.example.com/v1',
      model: 'test-model',
      temperature: 0,
    }
    applyProviderProfileToProcessEnv(profile)
    expect(process.env.CLAUDE_CODE_TEMPERATURE).toBe('0')
  })

  test('num_ctx override correctly impacts compaction thresholds', () => {
    const model = 'claude-3-5-sonnet-20240620'
    
    const baseWindow = getEffectiveContextWindowSize(model)
    const baseThreshold = getAutoCompactThreshold(model)
    
    // Use a much larger override
    const overrideNumCtx = 500000
    const overridenWindow = getEffectiveContextWindowSize(model, overrideNumCtx)
    const overridenThreshold = getAutoCompactThreshold(model, overrideNumCtx)
    
    // Verify that thresholds have increased significantly
    expect(overridenWindow).toBeGreaterThan(baseWindow)
    expect(overridenThreshold).toBeGreaterThan(baseThreshold)
    
    // Verify that the relationship between window and threshold is preserved (AUTOCOMPACT_BUFFER_TOKENS = 13000)
    expect(overridenThreshold).toBe(overridenWindow - 13000)
    
    // Verify that the overriden window is within expected bounds 
    // (should be close to overrideNumCtx, but minus summary reservation)
    expect(overridenWindow).toBeLessThan(overrideNumCtx)
    expect(overridenWindow).toBeGreaterThan(overrideNumCtx - 30000)
  })
})
