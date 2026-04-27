import { describe, expect, mock, test } from 'bun:test'

import { clearStartupProviderOverrides } from './providerStartupOverrides.js'

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
          MINIMAX_API_KEY: undefined,
        }),
      }),
    )
    expect(saveConfig.mock.results[0]?.value.env).toEqual({ KEEP_ME: '1' })
  })
})
