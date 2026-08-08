// Regression coverage for the inline `/model <id>` -> persisted-discovery
// fallback path in `getDiscoveredNvidiaNimModelIds()`. The cache key it
// builds must match the partition the descriptor picker
// (`getOpenAIDiscoveryRequestOptions` in src/commands/model/model.tsx)
// writes to: same `(baseUrl, apiKey, headers)` triple, including reducing
// pooled OpenAI fallback credentials to the single key used for discovery.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getDiscoveryCacheKey } from '../../integrations/discoveryService.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import { parseCustomHeadersEnv } from '../providerCustomHeaders.js'

const ROUTE = 'nvidia-nim'
const originalEnv = {
  ANTHROPIC_CUSTOM_HEADERS: process.env.ANTHROPIC_CUSTOM_HEADERS,
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
  OPENCLAUDE_CONFIG_DIR: process.env.OPENCLAUDE_CONFIG_DIR,
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  CLAUDE_CODE_USE_MISTRAL: process.env.CLAUDE_CODE_USE_MISTRAL,
  CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED:
    process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED,
  CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID:
    process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID,
  NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,
  NVIDIA_NIM: process.env.NVIDIA_NIM,
  OPENAI_API_BASE: process.env.OPENAI_API_BASE,
  OPENAI_API_KEYS: process.env.OPENAI_API_KEYS,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
}
let tempDir = ''

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function withEnv<T>(
  patch: Record<string, string | undefined>,
  fn: () => T,
): T {
  const saved: Record<string, string | undefined> = {}
  for (const key of Object.keys(patch)) {
    saved[key] = process.env[key]
    const value = patch[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  try {
    return fn()
  } finally {
    for (const key of Object.keys(saved)) {
      const previous = saved[key]
      if (previous === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = previous
      }
    }
  }
}

describe('nvidia-nim discovery cache key parity', () => {
  beforeEach(async () => {
    await acquireSharedMutationLock('nvidiaNimModels.test.ts')
    mock.restore()
    tempDir = mkdtempSync(join(tmpdir(), 'openclaude-nvidia-nim-cache-test-'))
    process.env.CLAUDE_CONFIG_DIR = tempDir
    process.env.OPENCLAUDE_CONFIG_DIR = tempDir
    delete process.env.ANTHROPIC_CUSTOM_HEADERS
  })

  afterEach(() => {
    try {
      mock.restore()
      restoreEnv()
      rmSync(tempDir, { recursive: true, force: true })
      tempDir = ''
    } finally {
      releaseSharedMutationLock()
    }
  })

  test('custom headers move the partition off the no-headers default', () => {
    const baseUrl = 'https://integrate.api.nvidia.com/v1'
    const apiKey = 'nvapi-test'

    const without = getDiscoveryCacheKey(ROUTE, { baseUrl, apiKey })
    const withHeaders = getDiscoveryCacheKey(ROUTE, {
      baseUrl,
      apiKey,
      headers: { 'x-tenant': 'acme' },
    })

    expect(withHeaders).not.toBe(without)
  })

  test('inline validator key matches the picker key for the same headers env', () => {
    const baseUrl = 'https://integrate.api.nvidia.com/v1'
    const apiKey = 'nvapi-test'

    withEnv(
      {
        ANTHROPIC_CUSTOM_HEADERS: 'x-tenant=acme,x-env=prod',
      },
      () => {
        const pickerKey = getDiscoveryCacheKey(ROUTE, {
          baseUrl,
          apiKey,
          headers: parseCustomHeadersEnv(
            process.env.ANTHROPIC_CUSTOM_HEADERS,
          ),
        })

        const inlineKey = getDiscoveryCacheKey(ROUTE, {
          baseUrl,
          apiKey,
          headers: parseCustomHeadersEnv(
            process.env.ANTHROPIC_CUSTOM_HEADERS,
          ),
        })

        expect(inlineKey).toBe(pickerKey)
      },
    )
  })

  test('inline validator reads the picker cache partition for pooled OpenAI fallback keys', async () => {
    const nonce = `${Date.now()}-${Math.random()}`
    const { getNvidiaNimDiscoveryCacheKeyForEnv } = await import(
      `./nvidiaNimModels.js?nvidiaPooledModels=${nonce}`
    )

    const baseUrl = 'https://integrate.api.nvidia.com/v1'
    const processEnv: NodeJS.ProcessEnv = {
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: baseUrl,
      OPENAI_MODEL: 'nvidia/test-chat',
      OPENAI_API_KEYS: 'key-a,key-b',
    }
    const pickerKey = getDiscoveryCacheKey(ROUTE, {
      baseUrl,
      apiKey: 'key-a',
      headers: parseCustomHeadersEnv(processEnv.ANTHROPIC_CUSTOM_HEADERS),
    })

    expect(getNvidiaNimDiscoveryCacheKeyForEnv(processEnv)).toBe(pickerKey)
  })

  test('absent ANTHROPIC_CUSTOM_HEADERS leaves picker and inline keys identical', () => {
    const baseUrl = 'https://integrate.api.nvidia.com/v1'
    const apiKey = 'nvapi-test'

    delete process.env.ANTHROPIC_CUSTOM_HEADERS

    const pickerKey = getDiscoveryCacheKey(ROUTE, {
      baseUrl,
      apiKey,
      headers: parseCustomHeadersEnv(process.env.ANTHROPIC_CUSTOM_HEADERS),
    })
    const inlineKey = getDiscoveryCacheKey(ROUTE, {
      baseUrl,
      apiKey,
      headers: parseCustomHeadersEnv(process.env.ANTHROPIC_CUSTOM_HEADERS),
    })

    expect(inlineKey).toBe(pickerKey)
  })
})
