import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import type { GlobalConfig } from './config.js'
import {
  enableConfigs,
  getGlobalConfig,
  saveGlobalConfig,
} from './config.js'
import {
  clearRememberedEnvFileValuesForTests,
  loadEnvFile,
  rememberLoadedEnvFileValues,
} from './envFile.js'
import { applyConfigEnvironmentVariables } from './managedEnv.js'

const ENV_KEYS = [
  'CLAUDE_CODE_USE_OPENAI',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
]

const originalEnv = new Map<string, string | undefined>()
let originalConfigEnv: Record<string, string> = {}
let originalProviderProfiles: GlobalConfig['providerProfiles']
let originalActiveProviderProfileId: GlobalConfig['activeProviderProfileId']
let tempDir: string

beforeEach(async () => {
  await acquireSharedMutationLock('utils/managedEnv.test.ts')
  enableConfigs()
  tempDir = mkdtempSync(join(tmpdir(), 'openclaude-managed-env-test-'))

  for (const key of ENV_KEYS) {
    originalEnv.set(key, process.env[key])
    delete process.env[key]
  }

  const currentConfig = getGlobalConfig()
  originalConfigEnv = { ...currentConfig.env }
  originalProviderProfiles = currentConfig.providerProfiles
    ? [...currentConfig.providerProfiles]
    : undefined
  originalActiveProviderProfileId = currentConfig.activeProviderProfileId
  saveGlobalConfig(current => ({
    ...current,
    activeProviderProfileId: undefined,
    env: {},
    providerProfiles: [],
  }))
})

afterEach(() => {
  try {
    clearRememberedEnvFileValuesForTests()
    saveGlobalConfig(current => ({
      ...current,
      activeProviderProfileId: originalActiveProviderProfileId,
      env: originalConfigEnv,
      providerProfiles: originalProviderProfiles,
    }))

    for (const key of ENV_KEYS) {
      const originalValue = originalEnv.get(key)
      if (originalValue === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = originalValue
      }
    }
    originalEnv.clear()
    rmSync(tempDir, { recursive: true, force: true })
  } finally {
    releaseSharedMutationLock()
  }
})

function writeTempEnvFile(content: string): string {
  const filePath = join(tempDir, '.env')
  writeFileSync(filePath, content, 'utf-8')
  return filePath
}

describe('applyConfigEnvironmentVariables', () => {
  it('restores remembered provider env-file values after full settings env merge', () => {
    const filePath = writeTempEnvFile([
      'CLAUDE_CODE_USE_OPENAI=1',
      'OPENAI_API_KEY=file-key',
      'OPENAI_BASE_URL=https://file.example/v1',
      'OPENAI_MODEL=file-model',
    ].join('\n'))
    const loaded = loadEnvFile(filePath)
    rememberLoadedEnvFileValues(loaded)
    saveGlobalConfig(current => ({
      ...current,
      env: {
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_API_KEY: 'settings-key',
        OPENAI_BASE_URL: 'https://settings.example/v1',
        OPENAI_MODEL: 'settings-model',
      },
    }))

    applyConfigEnvironmentVariables()

    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_API_KEY).toBe('file-key')
    expect(process.env.OPENAI_BASE_URL).toBe('https://file.example/v1')
    expect(process.env.OPENAI_MODEL).toBe('file-model')
  })
})
