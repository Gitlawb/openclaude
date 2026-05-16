import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { ProviderProfile } from './config.js'

const originalEnv = { ...process.env }

const RESTORED_KEYS = [
  'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED',
  'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID',
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_USE_OPENAI',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'CLAUDE_CODE_MAX_CONTEXT_TOKENS',
  'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
] as const

type MockConfigState = {
  providerProfiles: ProviderProfile[]
  activeProviderProfileId?: string
}

let mockConfigState: MockConfigState = { providerProfiles: [] }
let testConfigDir: string | null = null

beforeEach(() => {
  for (const key of RESTORED_KEYS) {
    delete process.env[key]
  }
  testConfigDir = mkdtempSync(join(tmpdir(), 'openclaude-persistence-test-'))
  process.env.CLAUDE_CONFIG_DIR = testConfigDir
})

afterEach(() => {
  for (const key of RESTORED_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = originalEnv[key]
    }
  }
  mock.restore()
  if (testConfigDir) {
    rmSync(testConfigDir, { recursive: true, force: true })
    testConfigDir = null
  }
})

async function importFreshProviderProfileModules() {
  mock.restore()
  const actualConfig = await import(`./config.js?ts=${Date.now()}-${Math.random()}`)
  mock.module('./config.js', () => ({
    ...actualConfig,
    getGlobalConfig: () => mockConfigState,
    saveGlobalConfig: (updater: (current: MockConfigState) => MockConfigState) => {
      mockConfigState = updater(mockConfigState)
    },
  }))
  const nonce = `${Date.now()}-${Math.random()}`
  return import(`./providerProfiles.js?ts=${nonce}`)
}

describe('Provider Profile Persistence (Context Window & Max Tokens)', () => {
  test('saves and loads new parameters in provider profiles', async () => {
    const { addProviderProfile, getProviderProfiles } = await importFreshProviderProfileModules()
    
    const profile = addProviderProfile({
      name: 'Custom Params',
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4o',
      contextWindowSize: 128000,
      maxOutputTokens: 4096,
    })

    expect(profile).toBeDefined()
    expect(profile?.contextWindowSize).toBe(128000)
    expect(profile?.maxOutputTokens).toBe(4096)

    const profiles = getProviderProfiles()
    expect(profiles[0].contextWindowSize).toBe(128000)
    expect(profiles[0].maxOutputTokens).toBe(4096)
  })

  test('applies new parameters to environment variables on activation', async () => {
    const { setActiveProviderProfile } = await importFreshProviderProfileModules()
    
    const profile: ProviderProfile = {
      id: 'test_params',
      name: 'Test Params',
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4o',
      contextWindowSize: 200000,
      maxOutputTokens: 8192,
    }

    mockConfigState = {
      providerProfiles: [profile],
      activeProviderProfileId: undefined
    }

    setActiveProviderProfile('test_params', { configDir: testConfigDir! })

    expect(process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe('200000')
    expect(process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe('8192')
  })

  test('persists new parameters to .openclaude-profile.json for startup fallback', async () => {
    const { setActiveProviderProfile } = await importFreshProviderProfileModules()
    
    const profile: ProviderProfile = {
      id: 'test_persist',
      name: 'Test Persist',
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4o',
      contextWindowSize: 64000,
      maxOutputTokens: 2048,
    }

    mockConfigState = {
      providerProfiles: [profile],
      activeProviderProfileId: undefined
    }

    setActiveProviderProfile('test_persist', { configDir: testConfigDir! })

    const persistedPath = join(testConfigDir!, '.openclaude-profile.json')
    const persisted = JSON.parse(readFileSync(persistedPath, 'utf8'))

    expect(persisted.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe('64000')
    expect(persisted.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe('2048')
  })

  test('uses empty string for unspecified parameters (no default values stored)', async () => {
    const { addProviderProfile } = await importFreshProviderProfileModules()
    
    const profile = addProviderProfile({
      name: 'No Params',
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4o',
    })

    expect(profile?.contextWindowSize).toBeUndefined()
    expect(profile?.maxOutputTokens).toBeUndefined()
  })
})
