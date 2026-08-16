import { describe, expect, mock, test } from 'bun:test'
import type { GlobalConfigWithEnv } from './providerStartupOverrides.js'

async function importStartupOverridesForTest() {
  return import(
    `./providerStartupOverrides.ts?startupOverridesTest=${Date.now()}-${Math.random()}`
  )
}

describe('clearStartupProviderOverrides', () => {
  test('removes stale provider env from user settings and global config env', async () => {
    const { clearStartupProviderOverrides } = await importStartupOverridesForTest()
    const updateUserSettings = mock(() => ({ error: null, written: true }))
    const saveConfig = mock((updater: (
      current: GlobalConfigWithEnv
    ) => GlobalConfigWithEnv) =>
      updater({
        env: {
          CLAUDE_CODE_USE_OPENAI: '1',
          OPENAI_BASE_URL: 'https://api.minimax.io/v1',
          OPENAI_MODEL: 'minimax-m2.7',
          OPENAI_API_KEYS: 'pool-a,pool-b',
          OPENAI_API_KEY: 'single-key',
          MINIMAX_API_KEY: 'sk-minimax',
          VENICE_API_KEY: 'sk-venice',
          LONGCAT_API_KEY: 'sk-longcat',
          ANTHROPIC_AUTH_TOKEN: 'stale-proxy-token',
          KEEP_ME: '1',
        },
      }),
    )

    const error = clearStartupProviderOverrides({
      updateUserSettings,
      saveConfig,
    })

    expect(error).toBeNull()
    expect(updateUserSettings).toHaveBeenCalledWith(
      'userSettings',
      expect.objectContaining({
        env: expect.objectContaining({
          CLAUDE_CODE_USE_OPENAI: undefined,
          OPENAI_BASE_URL: undefined,
          OPENAI_MODEL: undefined,
          OPENAI_API_KEYS: undefined,
          OPENAI_API_KEY: undefined,
          MINIMAX_API_KEY: undefined,
          VENICE_API_KEY: undefined,
          LONGCAT_API_KEY: undefined,
          ANTHROPIC_AUTH_TOKEN: undefined,
        }),
      }),
    )
    expect(
      (saveConfig.mock.results[0]?.value as { env: Record<string, string> }).env,
    ).toEqual({ KEEP_ME: '1' })
  })

  test('treats a committed settings write with a cleanup error as cleared', async () => {
    const { clearStartupProviderOverrides } = await importStartupOverridesForTest()

    const error = clearStartupProviderOverrides({
      updateUserSettings: mock(() => ({
        error: new Error('lock release failed'),
        written: true,
      })),
      saveConfig: mock((updater: (
        current: GlobalConfigWithEnv
      ) => GlobalConfigWithEnv) => updater({ env: {} })),
    })

    expect(error).toBeNull()
  })

  test('reports an unwritten settings update even when no error object is returned', async () => {
    const { clearStartupProviderOverrides } = await importStartupOverridesForTest()

    const saveConfig = mock((updater: (
      current: GlobalConfigWithEnv
    ) => GlobalConfigWithEnv) => updater({ env: {} }))
    const error = clearStartupProviderOverrides({
      updateUserSettings: mock(() => ({ error: null, written: false })),
      saveConfig,
    })

    expect(error).toBe('Settings update was not written')
    expect(saveConfig).not.toHaveBeenCalled()
  })

  test('persists the selected model in the same settings transition', async () => {
    const updateUserSettings = mock(() => ({ error: null, written: true }))

    const { clearStartupProviderOverrides } =
      await importStartupOverridesForTest()
    expect(
      clearStartupProviderOverrides({
        model: 'gpt-5-mini',
        updateUserSettings,
        saveConfig: mock(updater => updater({ env: {} })),
      }),
    ).toBeNull()
    expect(updateUserSettings).toHaveBeenCalledWith(
      'userSettings',
      expect.objectContaining({ model: 'gpt-5-mini' }),
    )
  })

  test('reports a silently refused global config update', async () => {
    const { clearStartupProviderOverrides } =
      await importStartupOverridesForTest()

    expect(
      clearStartupProviderOverrides({
        updateUserSettings: mock(() => ({ error: null, written: true })),
        saveConfig: mock(() => undefined),
      }),
    ).toBe('Global config update was not applied')
  })

  test('reports a global config save that returns stale provider overrides', async () => {
    const { clearStartupProviderOverrides } =
      await importStartupOverridesForTest()
    const stale = { env: { CLAUDE_CODE_USE_OPENAI: '1' } }

    expect(
      clearStartupProviderOverrides({
        updateUserSettings: mock(() => ({ error: null, written: true })),
        saveConfig: mock(updater => {
          updater(stale)
          return stale
        }),
      }),
    ).toBe('Global config update was not applied')
  })

  test('exposes the committed settings transition for a later activation rollback', async () => {
    const { clearStartupProviderOverrides } =
      await importStartupOverridesForTest()
    const transition = {
      attempted: { model: 'claude-opus-4-6' },
      previous: { model: 'gpt-5-mini' },
    }
    const onCommittedTransition = mock(() => {})

    expect(
      clearStartupProviderOverrides({
        model: 'claude-opus-4-6',
        commitTransition: mock(() => ({
          result: { error: null, written: true, committed: true },
          transition,
        })),
        saveConfig: mock(updater => updater({ env: {} })),
        onCommittedTransition,
      }),
    ).toBeNull()
    expect(onCommittedTransition).toHaveBeenCalledWith(
      transition,
      expect.any(Function),
    )
  })

  test('restores cleared global overrides after a later activation failure', async () => {
    const { clearStartupProviderOverrides } =
      await importStartupOverridesForTest()
    let config: GlobalConfigWithEnv = {
      env: {
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_BASE_URL: 'https://api.example.test/v1',
        KEEP_ME: '1',
      },
    }
    const saveConfig = mock(
      (updater: (current: GlobalConfigWithEnv) => GlobalConfigWithEnv) => {
        config = updater(config)
        return config
      },
    )
    let rollbackGlobalConfig: (() => string | null) | undefined

    expect(
      clearStartupProviderOverrides({
        commitTransition: mock(() => ({
          result: { error: null, written: true, committed: true },
          transition: {
            attempted: { model: 'claude-sonnet-4-6' },
            previous: { model: 'gpt-5-mini' },
          },
        })),
        saveConfig,
        onCommittedTransition(_transition, rollback) {
          rollbackGlobalConfig = rollback
        },
      }),
    ).toBeNull()
    expect(config.env).toEqual({ KEEP_ME: '1' })

    expect(rollbackGlobalConfig?.()).toBeNull()
    expect(config.env).toEqual({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'https://api.example.test/v1',
      KEEP_ME: '1',
    })
  })
})
