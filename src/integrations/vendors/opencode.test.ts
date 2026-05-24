// src/integrations/vendors/opencode.test.ts

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ensureIntegrationsLoaded } from '../index.js'
import {
  _clearRegistryForTesting,
  getVendor,
  getGateway,
  getBrand,
  getModelsForBrand,
  getModelsForGateway,
  getCatalogEntriesForRoute,
  validateIntegrationRegistry,
} from '../registry.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'

beforeEach(async () => {
  await acquireSharedMutationLock('integrations/vendors/opencode.test.ts')
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
// Vendor Descriptor Tests
// ---------------------------------------------------------------------------

describe('OpenCode vendor descriptor', () => {
  test('is registered with correct id', () => {
    const vendor = getVendor('opencode')
    expect(vendor).not.toBeNull()
    expect(vendor!.id).toBe('opencode')
  })

  test('has correct label', () => {
    const vendor = getVendor('opencode')
    expect(vendor!.label).toBe('OpenCode')
  })

  test('has openai-compatible classification', () => {
    const vendor = getVendor('opencode')
    expect(vendor!.classification).toBe('openai-compatible')
  })

  test('has correct default base URL', () => {
    const vendor = getVendor('opencode')
    expect(vendor!.defaultBaseUrl).toBe('https://opencode.ai/zen/v1')
  })

  test('has correct default model', () => {
    const vendor = getVendor('opencode')
    expect(vendor!.defaultModel).toBe('gpt-5.4')
  })

  test('requires auth', () => {
    const vendor = getVendor('opencode')
    expect(vendor!.setup.requiresAuth).toBe(true)
  })

  test('uses api-key auth mode', () => {
    const vendor = getVendor('opencode')
    expect(vendor!.setup.authMode).toBe('api-key')
  })

  test('has OPENCODE_API_KEY in credential env vars', () => {
    const vendor = getVendor('opencode')
    expect(vendor!.setup.credentialEnvVars).toContain('OPENCODE_API_KEY')
  })

  test('has openai-compatible transport kind', () => {
    const vendor = getVendor('opencode')
    expect(vendor!.transportConfig.kind).toBe('openai-compatible')
  })

  test('has preset metadata', () => {
    const vendor = getVendor('opencode')
    expect(vendor!.preset).toBeDefined()
    expect(vendor!.preset!.id).toBe('opencode')
    expect(vendor!.preset!.apiKeyEnvVars).toContain('OPENCODE_API_KEY')
  })

  test('has validation metadata', () => {
    const vendor = getVendor('opencode')
    expect(vendor!.validation).toBeDefined()
    expect(vendor!.validation!.kind).toBe('credential-env')
  })

  test('has catalog with static + hybrid source', () => {
    const vendor = getVendor('opencode')
    expect(vendor!.catalog).toBeDefined()
    expect(vendor!.catalog!.source).toBe('hybrid')
  })

  test('has discovery config', () => {
    const vendor = getVendor('opencode')
    expect(vendor!.catalog!.discovery).toBeDefined()
    expect(vendor!.catalog!.discovery!.kind).toBe('openai-compatible')
  })

  test('has static models in catalog', () => {
    const vendor = getVendor('opencode')
    expect(vendor!.catalog!.models).toBeDefined()
    expect(vendor!.catalog!.models!.length).toBeGreaterThan(0)
  })

  test('has usage metadata', () => {
    const vendor = getVendor('opencode')
    expect(vendor!.usage).toBeDefined()
    expect(vendor!.usage!.supported).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Gateway Descriptor Tests
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

  test('has correct vendor id', () => {
    const gateway = getGateway('opencode-go')
    expect(gateway!.vendorId).toBe('opencode')
  })

  test('has hosted category', () => {
    const gateway = getGateway('opencode-go')
    expect(gateway!.category).toBe('hosted')
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

  test('has preset metadata with vendor id', () => {
    const gateway = getGateway('opencode-go')
    expect(gateway!.preset).toBeDefined()
    expect(gateway!.preset!.id).toBe('opencode-go')
    expect(gateway!.preset!.vendorId).toBe('opencode')
    expect(gateway!.preset!.apiKeyEnvVars).toContain('OPENCODE_API_KEY')
  })

  test('has catalog with hybrid source', () => {
    const gateway = getGateway('opencode-go')
    expect(gateway!.catalog).toBeDefined()
    expect(gateway!.catalog!.source).toBe('hybrid')
  })

  test('has discovery config', () => {
    const gateway = getGateway('opencode-go')
    expect(gateway!.catalog!.discovery).toBeDefined()
    expect(gateway!.catalog!.discovery!.kind).toBe('openai-compatible')
  })

  test('has static models in catalog', () => {
    const gateway = getGateway('opencode-go')
    expect(gateway!.catalog!.models).toBeDefined()
    expect(gateway!.catalog!.models!.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Brand Descriptor Tests
// ---------------------------------------------------------------------------

describe('OpenCode brand descriptor', () => {
  test('is registered with correct id', () => {
    const brand = getBrand('opencode')
    expect(brand).not.toBeNull()
    expect(brand!.id).toBe('opencode')
  })

  test('has correct label', () => {
    const brand = getBrand('opencode')
    expect(brand!.label).toBe('OpenCode')
  })

  test('has correct canonical vendor id', () => {
    const brand = getBrand('opencode')
    expect(brand!.canonicalVendorId).toBe('opencode')
  })

  test('has default capabilities', () => {
    const brand = getBrand('opencode')
    expect(brand!.defaultCapabilities).toBeDefined()
    expect(brand!.defaultCapabilities.supportsVision).toBe(true)
    expect(brand!.defaultCapabilities.supportsStreaming).toBe(true)
    expect(brand!.defaultCapabilities.supportsFunctionCalling).toBe(true)
    expect(brand!.defaultCapabilities.supportsJsonMode).toBe(true)
  })

  test('has model ids list', () => {
    const brand = getBrand('opencode')
    expect(brand!.modelIds).toBeDefined()
    expect(brand!.modelIds!.length).toBeGreaterThan(0)
  })

  test('model ids list contains both zen and go models', () => {
    const brand = getBrand('opencode')
    const hasZenModels = brand!.modelIds!.some(id => id.startsWith('opencode-gpt'))
    const hasGoModels = brand!.modelIds!.some(id => id.startsWith('opencode-go-'))
    expect(hasZenModels).toBe(true)
    expect(hasGoModels).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Model Catalog Tests
// ---------------------------------------------------------------------------

describe('OpenCode model catalog', () => {
  test('brand has models registered', () => {
    const models = getModelsForBrand('opencode')
    expect(models.length).toBeGreaterThan(0)
  })

  test('gateway has models registered', () => {
    const models = getModelsForGateway('opencode-go')
    expect(models.length).toBeGreaterThan(0)
  })

  test('zen models have correct vendor id', () => {
    const models = getModelsForBrand('opencode')
    const zenModels = models.filter(m => m.id.startsWith('opencode-gpt') || m.id.startsWith('opencode-claude') || m.id.startsWith('opencode-gemini'))
    for (const model of zenModels) {
      expect(model.vendorId).toBe('opencode')
    }
  })

  test('go models have correct vendor id', () => {
    const models = getModelsForGateway('opencode-go')
    for (const model of models) {
      expect(model.vendorId).toBe('opencode')
    }
  })

  test('all models have required fields', () => {
    const models = getModelsForBrand('opencode')
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
    const models = getModelsForBrand('opencode')
    const validClassifications = ['chat', 'reasoning', 'vision', 'coding']
    for (const model of models) {
      expect(model.classification.length).toBeGreaterThan(0)
      for (const c of model.classification) {
        expect(validClassifications).toContain(c)
      }
    }
  })

  test('zen gpt models have correct classification', () => {
    const models = getModelsForBrand('opencode')
    const gptModels = models.filter(m => m.id.startsWith('opencode-gpt-'))
    for (const model of gptModels) {
      expect(model.classification).toContain('chat')
    }
  })

  test('zen claude models have correct classification', () => {
    const models = getModelsForBrand('opencode')
    const claudeModels = models.filter(m => m.id.startsWith('opencode-claude-'))
    for (const model of claudeModels) {
      expect(model.classification).toContain('chat')
    }
  })

  test('codex models have coding classification', () => {
    const models = getModelsForBrand('opencode')
    const codexModels = models.filter(m => m.defaultModel.includes('codex'))
    for (const model of codexModels) {
      expect(model.classification).toContain('coding')
    }
  })

  test('reasoning models have reasoning classification', () => {
    const models = getModelsForBrand('opencode')
    // Only check models that are explicitly reasoning models
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
    const models = getModelsForBrand('opencode')
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
    // 17 GPT + 9 Claude + 3 Gemini + 2 Qwen + 10 others = 41
    expect(models.length).toBe(41)
  })

  test('go model count matches expected', () => {
    const models = getCatalogEntriesForRoute('opencode-go')
    // 8 chat/completions + 4 messages = 12
    expect(models.length).toBe(12)
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

// ---------------------------------------------------------------------------
// Cross-Reference Tests
// ---------------------------------------------------------------------------

describe('OpenCode cross-reference consistency', () => {
  test('brand model ids match actual model descriptors', () => {
    const brand = getBrand('opencode')
    const models = getModelsForBrand('opencode')
    const modelIds = new Set(models.map(m => m.id))
    for (const brandModelId of brand!.modelIds!) {
      expect(modelIds.has(brandModelId)).toBe(true)
    }
  })

  test('vendor catalog modelDescriptorIds match actual model descriptors', () => {
    const vendor = getVendor('opencode')
    const models = getModelsForBrand('opencode')
    const modelIds = new Set(models.map(m => m.id))
    for (const entry of vendor!.catalog!.models!) {
      if (entry.modelDescriptorId) {
        expect(modelIds.has(entry.modelDescriptorId)).toBe(true)
      }
    }
  })

  test('gateway catalog modelDescriptorIds match actual model descriptors', () => {
    const gateway = getGateway('opencode-go')
    const models = getModelsForGateway('opencode-go')
    const modelIds = new Set(models.map(m => m.id))
    for (const entry of gateway!.catalog!.models!) {
      if (entry.modelDescriptorId) {
        expect(modelIds.has(entry.modelDescriptorId)).toBe(true)
      }
    }
  })

  test('vendor and gateway share the same OPENCODE_API_KEY', () => {
    const vendor = getVendor('opencode')
    const gateway = getGateway('opencode-go')
    expect(vendor!.setup.credentialEnvVars).toEqual(gateway!.setup.credentialEnvVars)
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
  test('vendor catalog entries have unique ids', () => {
    const vendor = getVendor('opencode')
    const ids = vendor!.catalog!.models!.map(m => m.id)
    const uniqueIds = new Set(ids)
    expect(ids.length).toBe(uniqueIds.size)
  })

  test('gateway catalog entries have unique ids', () => {
    const gateway = getGateway('opencode-go')
    const ids = gateway!.catalog!.models!.map(m => m.id)
    const uniqueIds = new Set(ids)
    expect(ids.length).toBe(uniqueIds.size)
  })

  test('vendor catalog entries have unique apiNames', () => {
    const vendor = getVendor('opencode')
    const apiNames = vendor!.catalog!.models!.map(m => m.apiName)
    const uniqueApiNames = new Set(apiNames)
    expect(apiNames.length).toBe(uniqueApiNames.size)
  })

  test('gateway catalog entries have unique apiNames', () => {
    const gateway = getGateway('opencode-go')
    const apiNames = gateway!.catalog!.models!.map(m => m.apiName)
    const uniqueApiNames = new Set(apiNames)
    expect(apiNames.length).toBe(uniqueApiNames.size)
  })

  test('vendor catalog entries have non-empty labels', () => {
    const vendor = getVendor('opencode')
    for (const entry of vendor!.catalog!.models!) {
      expect(entry.label.length).toBeGreaterThan(0)
    }
  })

  test('gateway catalog entries have non-empty labels', () => {
    const gateway = getGateway('opencode-go')
    for (const entry of gateway!.catalog!.models!) {
      expect(entry.label.length).toBeGreaterThan(0)
    }
  })

  test('model descriptors have non-empty contextWindow', () => {
    const models = getModelsForBrand('opencode')
    for (const model of models) {
      if (model.contextWindow !== undefined) {
        expect(model.contextWindow).toBeGreaterThan(0)
      }
    }
  })

  test('model descriptors have non-empty maxOutputTokens', () => {
    const models = getModelsForBrand('opencode')
    for (const model of models) {
      if (model.maxOutputTokens !== undefined) {
        expect(model.maxOutputTokens).toBeGreaterThan(0)
      }
    }
  })

  test('model descriptors have valid defaultModel format', () => {
    const models = getModelsForBrand('opencode')
    for (const model of models) {
      // defaultModel should not contain spaces or special chars
      expect(model.defaultModel).toMatch(/^[a-z0-9\-\.]+$/)
    }
  })

  test('vendor validation message mentions OPENCODE_API_KEY', () => {
    const vendor = getVendor('opencode')
    expect(vendor!.validation!.missingCredentialMessage).toContain('OPENCODE_API_KEY')
  })

  test('vendor validation message mentions opencode.ai', () => {
    const vendor = getVendor('opencode')
    expect(vendor!.validation!.missingCredentialMessage).toContain('opencode.ai')
  })

  test('discovery cache ttl is set', () => {
    const vendor = getVendor('opencode')
    expect(vendor!.catalog!.discoveryCacheTtl).toBeDefined()
  })

  test('discovery refresh mode is set', () => {
    const vendor = getVendor('opencode')
    expect(vendor!.catalog!.discoveryRefreshMode).toBeDefined()
  })

  test('manual refresh is allowed', () => {
    const vendor = getVendor('opencode')
    expect(vendor!.catalog!.allowManualRefresh).toBe(true)
  })
})
