import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { loadBridgeAIConfig, applyBridgeAIConfig } from './config'

describe('config', () => {
  let tempDir: string
  const envBackup: Record<string, string | undefined> = {}

  const ENV_KEYS = [
    'CLAUDE_CONFIG_DIR',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_MODEL',
  ] as const

  function saveEnv(key: string) {
    if (!(key in envBackup)) {
      envBackup[key] = process.env[key]
    }
  }

  function setEnv(key: string, value: string) {
    saveEnv(key)
    process.env[key] = value
  }

  function clearEnv(key: string) {
    saveEnv(key)
    delete process.env[key]
  }

  beforeEach(() => {
    tempDir = join(tmpdir(), `bridgeai-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempDir, { recursive: true })
    // Save and redirect config dir to temp
    for (const key of ENV_KEYS) {
      saveEnv(key)
    }
    process.env.CLAUDE_CONFIG_DIR = tempDir
  })

  afterEach(() => {
    // Restore all env vars
    for (const key of Object.keys(envBackup)) {
      if (envBackup[key] !== undefined) {
        process.env[key] = envBackup[key]
      } else {
        delete process.env[key]
      }
    }
    // Clear backup for next test
    for (const key of Object.keys(envBackup)) {
      delete envBackup[key]
    }
    // Clean up temp dir
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  })

  function writeConfig(data: unknown) {
    writeFileSync(join(tempDir, 'config.json'), JSON.stringify(data), 'utf-8')
  }

  describe('loadBridgeAIConfig', () => {
    test('returns null when config.json does not exist', () => {
      const result = loadBridgeAIConfig()
      expect(result).toBeNull()
    })

    test('returns parsed config when valid JSON exists', () => {
      writeConfig({
        provider: 'anthropic',
        apiKey: 'sk-ant-test-key',
        model: 'claude-sonnet-4-20250514',
      })
      const result = loadBridgeAIConfig()
      expect(result).toEqual({
        provider: 'anthropic',
        apiKey: 'sk-ant-test-key',
        model: 'claude-sonnet-4-20250514',
      })
    })

    test('returns null for malformed JSON', () => {
      writeFileSync(join(tempDir, 'config.json'), '{not valid json!!!', 'utf-8')
      const result = loadBridgeAIConfig()
      expect(result).toBeNull()
    })

    test('handles partial config (only apiKey, no provider)', () => {
      writeConfig({ apiKey: 'sk-ant-partial-key' })
      const result = loadBridgeAIConfig()
      expect(result).toEqual({
        provider: undefined,
        apiKey: 'sk-ant-partial-key',
        model: undefined,
      })
    })
  })

  describe('applyBridgeAIConfig', () => {
    test('sets ANTHROPIC_API_KEY when not already set', () => {
      writeConfig({ apiKey: 'sk-ant-from-config' })
      clearEnv('ANTHROPIC_API_KEY')

      applyBridgeAIConfig()

      expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-from-config')
    })

    test('does NOT override existing ANTHROPIC_API_KEY env var', () => {
      writeConfig({ apiKey: 'sk-ant-from-config' })
      setEnv('ANTHROPIC_API_KEY', 'sk-ant-from-env')

      applyBridgeAIConfig()

      expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-from-env')
    })

    test('is silent when config does not exist', () => {
      clearEnv('ANTHROPIC_API_KEY')
      clearEnv('ANTHROPIC_MODEL')

      // Should not throw
      applyBridgeAIConfig()

      expect(process.env.ANTHROPIC_API_KEY).toBeUndefined()
      expect(process.env.ANTHROPIC_MODEL).toBeUndefined()
    })
  })
})
