import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ensureIntegrationsLoaded } from '../index.js'
import {
  _clearRegistryForTesting,
  getGateway,
  getModelsForGateway,
  getCatalogEntriesForRoute,
  getAllModels,
  validateIntegrationRegistry,
} from '../registry.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import { createOpenAIShimClient } from '../../services/api/openaiShim.js'

beforeEach(async () => {
  await acquireSharedMutationLock('integrations/gateways/opencode.test.ts')
  _clearRegistryForTesting()
  ensureIntegrationsLoaded()
})

afterEach(() => {
  try {
    _clearRegistryForTesting()
    ensureIntegrationsLoaded()
  } finally {
    releaseSharedMutationLock()
  }
})

// ---------------------------------------------------------------------------
// Zen Gateway Descriptor Tests
// ---------------------------------------------------------------------------

describe('OpenCode Zen gateway descriptor', () => {
  test('is registered with correct id', () => {
    const gateway = getGateway('opencode')
    expect(gateway).not.toBeNull()
    expect(gateway!.id).toBe('opencode')
  })

  test('has correct label', () => {
    const gateway = getGateway('opencode')
    expect(gateway!.label).toBe('OpenCode Zen')
  })

  test('has aggregating category', () => {
    const gateway = getGateway('opencode')
    expect(gateway!.category).toBe('aggregating')
  })

  test('has correct default base URL', () => {
    const gateway = getGateway('opencode')
    expect(gateway!.defaultBaseUrl).toBe('https://opencode.ai/zen/v1')
  })

  test('has correct default model', () => {
    const gateway = getGateway('opencode')
    expect(gateway!.defaultModel).toBe('gpt-5.4')
  })

  test('requires auth', () => {
    const gateway = getGateway('opencode')
    expect(gateway!.setup.requiresAuth).toBe(true)
  })

  test('uses api-key auth mode', () => {
    const gateway = getGateway('opencode')
    expect(gateway!.setup.authMode).toBe('api-key')
  })

  test('has OPENCODE_API_KEY in credential env vars', () => {
    const gateway = getGateway('opencode')
    expect(gateway!.setup.credentialEnvVars).toContain('OPENCODE_API_KEY')
  })

  test('has openai-compatible transport kind', () => {
    const gateway = getGateway('opencode')
    expect(gateway!.transportConfig.kind).toBe('openai-compatible')
  })

  test('has preset metadata', () => {
    const gateway = getGateway('opencode')
    expect(gateway!.preset).toBeDefined()
    expect(gateway!.preset!.id).toBe('opencode')
    expect(gateway!.preset!.vendorId).toBe('openai')
    expect(gateway!.preset!.apiKeyEnvVars).toContain('OPENCODE_API_KEY')
  })

  test('has validation metadata', () => {
    const gateway = getGateway('opencode')
    expect(gateway!.validation).toBeDefined()
    expect(gateway!.validation!.kind).toBe('credential-env')
  })

  test('has catalog with static source', () => {
    const gateway = getGateway('opencode')
    expect(gateway!.catalog).toBeDefined()
    expect(gateway!.catalog!.source).toBe('static')
  })

  test('has static models in catalog', () => {
    const gateway = getGateway('opencode')
    expect(gateway!.catalog!.models).toBeDefined()
    expect(gateway!.catalog!.models!.length).toBeGreaterThan(0)
  })

  test('has usage metadata', () => {
    const gateway = getGateway('opencode')
    expect(gateway!.usage).toBeDefined()
    expect(gateway!.usage!.supported).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Go Gateway Descriptor Tests
// ---------------------------------------------------------------------------

describe('OpenCode Go gateway descriptor', () => {
  test('is registered with correct id', () => {
    const gateway = getGateway('opencode-go')
    expect(gateway).not.toBeNull()
    expect(gateway!.id).toBe('opencode-go')
  })

  test('has correct label', () => {
    const gateway = getGateway('opencode-go')
    expect(gateway!.label).toBe('OpenCode Go')
  })

  test('has aggregating category', () => {
    const gateway = getGateway('opencode-go')
    expect(gateway!.category).toBe('aggregating')
  })

  test('has correct default base URL', () => {
    const gateway = getGateway('opencode-go')
    expect(gateway!.defaultBaseUrl).toBe('https://opencode.ai/zen/go/v1')
  })

  test('has correct default model', () => {
    const gateway = getGateway('opencode-go')
    expect(gateway!.defaultModel).toBe('glm-5.1')
  })

  test('requires auth', () => {
    const gateway = getGateway('opencode-go')
    expect(gateway!.setup.requiresAuth).toBe(true)
  })

  test('uses api-key auth mode', () => {
    const gateway = getGateway('opencode-go')
    expect(gateway!.setup.authMode).toBe('api-key')
  })

  test('has OPENCODE_API_KEY in credential env vars', () => {
    const gateway = getGateway('opencode-go')
    expect(gateway!.setup.credentialEnvVars).toContain('OPENCODE_API_KEY')
  })

  test('has openai-compatible transport kind', () => {
    const gateway = getGateway('opencode-go')
    expect(gateway!.transportConfig.kind).toBe('openai-compatible')
  })

  test('has preset metadata with vendorId openai', () => {
    const gateway = getGateway('opencode-go')
    expect(gateway!.preset).toBeDefined()
    expect(gateway!.preset!.id).toBe('opencode-go')
    expect(gateway!.preset!.vendorId).toBe('openai')
    expect(gateway!.preset!.apiKeyEnvVars).toContain('OPENCODE_API_KEY')
  })

  test('has catalog with static source', () => {
    const gateway = getGateway('opencode-go')
    expect(gateway!.catalog).toBeDefined()
    expect(gateway!.catalog!.source).toBe('static')
  })

  test('has static models in catalog', () => {
    const gateway = getGateway('opencode-go')
    expect(gateway!.catalog!.models).toBeDefined()
    expect(gateway!.catalog!.models!.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Model Catalog Tests
// ---------------------------------------------------------------------------

describe('OpenCode model catalog', () => {
  test('zen gateway has models registered', () => {
    const models = getModelsForGateway('opencode')
    expect(models.length).toBeGreaterThan(0)
  })

  test('go gateway has models registered', () => {
    const models = getModelsForGateway('opencode-go')
    expect(models.length).toBeGreaterThan(0)
  })

  test('models have vendorId openai', () => {
    const models = getAllModels().filter(m => m.id.startsWith('opencode-'))
    for (const model of models) {
      expect(model.vendorId).toBe('openai')
    }
  })

  test('all models have required fields', () => {
    const models = getAllModels().filter(m => m.id.startsWith('opencode-'))
    for (const model of models) {
      expect(model.id).toBeDefined()
      expect(model.label).toBeDefined()
      expect(model.vendorId).toBeDefined()
      expect(model.classification).toBeDefined()
      expect(model.defaultModel).toBeDefined()
      expect(model.capabilities).toBeDefined()
    }
  })

  test('all models have valid classification', () => {
    const models = getAllModels().filter(m => m.id.startsWith('opencode-'))
    const validClassifications = ['chat', 'reasoning', 'vision', 'coding']
    for (const model of models) {
      expect(model.classification.length).toBeGreaterThan(0)
      for (const c of model.classification) {
        expect(validClassifications).toContain(c)
      }
    }
  })

  test('zen gpt models have correct classification', () => {
    const models = getAllModels().filter(m => m.id.startsWith('opencode-gpt-'))
    for (const model of models) {
      expect(model.classification).toContain('chat')
    }
  })

  test('zen claude models have correct classification', () => {
    const models = getAllModels().filter(m => m.id.startsWith('opencode-claude-'))
    for (const model of models) {
      expect(model.classification).toContain('chat')
    }
  })

  test('codex models have coding classification', () => {
    const models = getAllModels().filter(m => m.id.startsWith('opencode-'))
    const codexModels = models.filter(m => m.defaultModel.includes('codex'))
    for (const model of codexModels) {
      expect(model.classification).toContain('coding')
    }
  })

  test('reasoning models have reasoning classification', () => {
    const models = getAllModels().filter(m => m.id.startsWith('opencode-'))
    const reasoningModels = models.filter(m =>
      m.defaultModel.includes('opus') ||
      m.defaultModel === 'gpt-5.5-pro' ||
      m.defaultModel === 'gpt-5.4-pro' ||
      m.defaultModel === 'deepseek-v4-pro' ||
      m.defaultModel === 'gemini-3.1-pro'
    )
    for (const model of reasoningModels) {
      expect(model.classification).toContain('reasoning')
    }
  })

  test('no duplicate model ids', () => {
    const models = getAllModels().filter(m => m.id.startsWith('opencode-'))
    const ids = models.map(m => m.id)
    const uniqueIds = new Set(ids)
    expect(ids.length).toBe(uniqueIds.size)
  })

  test('no duplicate model ids across zen and go', () => {
    const zenModels = getCatalogEntriesForRoute('opencode')
    const goModels = getCatalogEntriesForRoute('opencode-go')
    const zenIds = new Set(zenModels.map(m => m.id))
    const goIds = new Set(goModels.map(m => m.id))
    for (const id of goIds) {
      expect(zenIds.has(id)).toBe(false)
    }
  })

  test('zen model count matches expected', () => {
    const models = getCatalogEntriesForRoute('opencode')
    expect(models.length).toBe(43)
  })

  test('go model count matches expected', () => {
    const models = getCatalogEntriesForRoute('opencode-go')
    expect(models.length).toBe(15)

    const modelIds = models.map(m => m.id)
    expect(modelIds).toContain('opencode-go-qwen3.7-max')
    expect(modelIds).toContain('opencode-go-qwen3.7-plus')
  })

  test('go qwen3.7 models resolve with endpointPath: /messages', () => {
    const models = getCatalogEntriesForRoute('opencode-go')
    const qwenMax = models.find(m => m.id === 'opencode-go-qwen3.7-max')
    const qwenPlus = models.find(m => m.id === 'opencode-go-qwen3.7-plus')
    
    expect(qwenMax).toBeDefined()
    expect(qwenPlus).toBeDefined()
    expect(qwenMax?.transportOverrides?.openaiShim?.endpointPath).toBe('/messages')
    expect(qwenPlus?.transportOverrides?.openaiShim?.endpointPath).toBe('/messages')
  })


  test('all zen gpt models have modelDescriptorId', () => {
    const models = getCatalogEntriesForRoute('opencode')
    const gptModels = models.filter(m => m.apiName.startsWith('gpt-'))
    for (const model of gptModels) {
      expect(model.modelDescriptorId).toBeDefined()
      expect(model.modelDescriptorId).toMatch(/^opencode-gpt-/)
    }
  })

  test('all zen claude models have modelDescriptorId', () => {
    const models = getCatalogEntriesForRoute('opencode')
    const claudeModels = models.filter(m => m.apiName.startsWith('claude-'))
    for (const model of claudeModels) {
      expect(model.modelDescriptorId).toBeDefined()
      expect(model.modelDescriptorId).toMatch(/^opencode-claude-/)
    }
  })

  test('all go models have modelDescriptorId', () => {
    const models = getCatalogEntriesForRoute('opencode-go')
    for (const model of models) {
      expect(model.modelDescriptorId).toBeDefined()
      expect(model.modelDescriptorId).toMatch(/^opencode-go-/)
    }
  })
})


describe('OpenCode Auth and Transport Tests', () => {
  const originalFetch = globalThis.fetch
  const originalEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    originalEnv.CLAUDE_CODE_USE_OPENAI = process.env.CLAUDE_CODE_USE_OPENAI
    originalEnv.OPENAI_BASE_URL = process.env.OPENAI_BASE_URL
    originalEnv.OPENAI_MODEL = process.env.OPENAI_MODEL
    originalEnv.OPENAI_API_KEY = process.env.OPENAI_API_KEY
  })

  afterEach(() => {
    const keys = ['CLAUDE_CODE_USE_OPENAI', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'OPENAI_API_KEY']
    
    for (const key of keys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key] 
      } else {
        process.env[key] = originalEnv[key]
      }
    }
    
    globalThis.fetch = originalFetch
  })

  test('OpenCode (Anthropic route) sends x-api-key', async () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'https://opencode.ai'
    process.env.OPENAI_MODEL = 'opencode-go-qwen3.7-max'
    process.env.OPENAI_API_KEY = 'test-anthropic-key'
    ensureIntegrationsLoaded()

    let fetchCalled = false
    let capturedHeaders: Headers = new Headers()

    globalThis.fetch = (async (_input, init) => {
      fetchCalled = true
      capturedHeaders = new Headers(init?.headers as HeadersInit)
      return new Response(JSON.stringify({ id: 'test', choices: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }) as any

    const client = createOpenAIShimClient({}) as any

    await client.beta.messages.create({
      model: 'opencode-go-qwen3.7-max',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 64,
      stream: false,
    })

    expect(fetchCalled).toBe(true)
    expect(capturedHeaders.get('x-api-key')).toBe('test-anthropic-key')
    expect(capturedHeaders.get('authorization')).toBeNull()
  })

  test('OpenCode (Standard route) sends Bearer auth', async () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'https://opencode.ai'
    process.env.OPENAI_MODEL = 'opencode-go-glm-5.1'
    process.env.OPENAI_API_KEY = 'test-openai-key'
    ensureIntegrationsLoaded()

    let fetchCalled = false
    let capturedHeaders: Headers = new Headers()
    
    globalThis.fetch = (async (_input, init) => {
      fetchCalled = true
      capturedHeaders = new Headers(init?.headers as HeadersInit)
      return new Response(JSON.stringify({ id: 'test', choices: [] }), { 
        status: 200, 
        headers: { 'content-type': 'application/json' } 
      })
    }) as any

    const client = createOpenAIShimClient({}) as any
    
    await client.beta.messages.create({
      model: 'opencode-go-glm-5.1',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 64,
      stream: false,
    })

    expect(fetchCalled).toBe(true)
    expect(capturedHeaders.get('authorization')).toBe('Bearer test-openai-key')
    expect(capturedHeaders.get('x-api-key')).toBeNull()
  })
})



// ---------------------------------------------------------------------------
// Cross-Reference Tests
// ---------------------------------------------------------------------------

describe('OpenCode cross-reference consistency', () => {
  test('gateway catalog modelDescriptorIds match actual model descriptors', () => {
    const models = getAllModels().filter(m => m.id.startsWith('opencode-'))
    const modelIds = new Set(models.map(m => m.id))
    const entry = getGateway('opencode')
    for (const catalogEntry of entry!.catalog!.models!) {
      if (catalogEntry.modelDescriptorId) {
        expect(modelIds.has(catalogEntry.modelDescriptorId)).toBe(true)
      }
    }
  })

  test('go gateway catalog modelDescriptorIds match actual model descriptors', () => {
    const models = getAllModels().filter(m => m.id.startsWith('opencode-'))
    const modelIds = new Set(models.map(m => m.id))
    const gateway = getGateway('opencode-go')
    for (const catalogEntry of gateway!.catalog!.models!) {
      if (catalogEntry.modelDescriptorId) {
        expect(modelIds.has(catalogEntry.modelDescriptorId)).toBe(true)
      }
    }
  })

  test('zen and go gateways share the same OPENCODE_API_KEY', () => {
    const zen = getGateway('opencode')
    const go = getGateway('opencode-go')
    expect(zen!.setup.credentialEnvVars).toEqual(go!.setup.credentialEnvVars)
  })
})

// ---------------------------------------------------------------------------
// Validation Registry Tests
// ---------------------------------------------------------------------------

describe('OpenCode integration validation', () => {
  test('registry validation passes with opencode descriptors', () => {
    const result = validateIntegrationRegistry()
    const opencodeErrors = result.errors.filter(e => e.includes('opencode'))
    expect(opencodeErrors).toHaveLength(0)
  })

  test('no preset id conflicts', () => {
    const result = validateIntegrationRegistry()
    const presetErrors = result.errors.filter(e => e.includes('preset'))
    expect(presetErrors).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe('OpenCode edge cases', () => {
  test('zen catalog entries have unique ids', () => {
    const gateway = getGateway('opencode')
    const ids = gateway!.catalog!.models!.map(m => m.id)
    const uniqueIds = new Set(ids)
    expect(ids.length).toBe(uniqueIds.size)
  })

  test('go catalog entries have unique ids', () => {
    const gateway = getGateway('opencode-go')
    const ids = gateway!.catalog!.models!.map(m => m.id)
    const uniqueIds = new Set(ids)
    expect(ids.length).toBe(uniqueIds.size)
  })

  test('zen catalog entries have unique apiNames', () => {
    const gateway = getGateway('opencode')
    const apiNames = gateway!.catalog!.models!.map(m => m.apiName)
    const uniqueApiNames = new Set(apiNames)
    expect(apiNames.length).toBe(uniqueApiNames.size)
  })

  test('go catalog entries have unique apiNames', () => {
    const gateway = getGateway('opencode-go')
    const apiNames = gateway!.catalog!.models!.map(m => m.apiName)
    const uniqueApiNames = new Set(apiNames)
    expect(apiNames.length).toBe(uniqueApiNames.size)
  })

  test('zen catalog entries have non-empty labels', () => {
    const gateway = getGateway('opencode')
    for (const entry of gateway!.catalog!.models!) {
      // label is optional in the catalog type; an undefined label fails too.
      expect((entry.label ?? '').length).toBeGreaterThan(0)
    }
  })

  test('go catalog entries have non-empty labels', () => {
    const gateway = getGateway('opencode-go')
    for (const entry of gateway!.catalog!.models!) {
      expect((entry.label ?? '').length).toBeGreaterThan(0)
    }
  })

  test('model descriptors have non-empty contextWindow', () => {
    const models = getAllModels().filter(m => m.id.startsWith('opencode-'))
    for (const model of models) {
      if (model.contextWindow !== undefined) {
        expect(model.contextWindow).toBeGreaterThan(0)
      }
    }
  })

  test('model descriptors have non-empty maxOutputTokens', () => {
    const models = getAllModels().filter(m => m.id.startsWith('opencode-'))
    for (const model of models) {
      if (model.maxOutputTokens !== undefined) {
        expect(model.maxOutputTokens).toBeGreaterThan(0)
      }
    }
  })

  test('model descriptors have valid defaultModel format', () => {
    const models = getAllModels().filter(m => m.id.startsWith('opencode-'))
    for (const model of models) {
      expect(model.defaultModel).toMatch(/^[a-z0-9\-\.]+$/)
    }
  })

  test('zen gateway validation message mentions OPENCODE_API_KEY', () => {
    const gateway = getGateway('opencode')
    expect(gateway!.validation!.missingCredentialMessage).toContain('OPENCODE_API_KEY')
  })

  test('zen gateway validation message mentions opencode.ai', () => {
    const gateway = getGateway('opencode')
    expect(gateway!.validation!.missingCredentialMessage).toContain('opencode.ai')
  })
})
