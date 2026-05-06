import { describe, expect, mock, test } from 'bun:test'

import { clearStartupProviderOverrides, STARTUP_PROVIDER_OVERRIDE_ENV_KEYS } from './providerStartupOverrides.js'

describe('clearStartupProviderOverrides', () => {
  test('removes stale provider env from user settings and global config env', () => {
    const updateUserSettings = mock(() => ({ error: null }))
    const saveConfig = mock((updater: (current: {
      env: Record<string, string>
    }) => { env: Record<string, string> }) =>
      updater({
        env: {
          CLAUDE_CODE_USE_OPENAI: '1',
          OPENAI_BASE_URL: 'https://api.minimax.io/v1',
          OPENAI_MODEL: 'minimax-m2.7',
          MINIMAX_API_KEY: 'sk-minimax',
          KEEP_ME: '1',
        },
      }),
    )

    const error = clearStartupProviderOverrides({
      updateUserSettings,
      saveConfig: saveConfig as any,
    })

    expect(error).toBeNull()
    expect(updateUserSettings).toHaveBeenCalledWith(
      'userSettings',
      expect.objectContaining({
        env: expect.objectContaining({
          CLAUDE_CODE_USE_OPENAI: undefined,
          OPENAI_BASE_URL: undefined,
          OPENAI_MODEL: undefined,
          MINIMAX_API_KEY: undefined,
        }),
      }),
    )
    expect(
      (saveConfig.mock.results[0]?.value as { env: Record<string, string> }).env,
    ).toEqual({ KEEP_ME: '1' })
  })

  test('removes Spark provider env vars from global config env', () => {
    const updateUserSettings = mock(() => ({ error: null }))
    const saveConfig = mock((updater: (current: {
      env: Record<string, string>
    }) => { env: Record<string, string> }) =>
      updater({
        env: {
          CLAUDE_CODE_USE_SPARK: '1',
          SPARK_API_KEY: 'sk-spark',
          SPARK_BASE_URL: 'https://spark-api-open.xf-yun.com/v1/chat/completions',
          SPARK_MODEL: 'generalv3.5',
          KEEP_ME: '1',
        },
      }),
    )

    const error = clearStartupProviderOverrides({
      updateUserSettings,
      saveConfig: saveConfig as any,
    })

    expect(error).toBeNull()
    expect(updateUserSettings).toHaveBeenCalledWith(
      'userSettings',
      expect.objectContaining({
        env: expect.objectContaining({
          CLAUDE_CODE_USE_SPARK: undefined,
          SPARK_API_KEY: undefined,
          SPARK_BASE_URL: undefined,
          SPARK_MODEL: undefined,
        }),
      }),
    )
    expect(
      (saveConfig.mock.results[0]?.value as { env: Record<string, string> }).env,
    ).toEqual({ KEEP_ME: '1' })
  })
})

describe('STARTUP_PROVIDER_OVERRIDE_ENV_KEYS', () => {
  test('includes Spark env vars', () => {
    const keys = [...STARTUP_PROVIDER_OVERRIDE_ENV_KEYS]
    expect(keys).toContain('CLAUDE_CODE_USE_SPARK')
    expect(keys).toContain('SPARK_API_KEY')
    expect(keys).toContain('SPARK_BASE_URL')
    expect(keys).toContain('SPARK_MODEL')
  })
})
