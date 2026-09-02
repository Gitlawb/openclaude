import { describe, expect, test } from 'bun:test'
import { hasUsableOpenAILaunchCredential } from './provider-launch.ts'

describe('provider-launch OpenAI credential validation', () => {
  test('accepts valid OPENAI_API_KEYS before placeholder OPENAI_API_KEY fallback', () => {
    expect(
      hasUsableOpenAILaunchCredential({
        OPENAI_API_KEYS: 'sk-openai-a,sk-openai-b',
        OPENAI_API_KEY: 'SUA_CHAVE',
      } as NodeJS.ProcessEnv),
    ).toBe(true)
  })

  test('rejects placeholder OPENAI_API_KEYS before singular fallback', () => {
    expect(
      hasUsableOpenAILaunchCredential({
        OPENAI_API_KEYS: 'sk-openai-a,SUA_CHAVE',
        OPENAI_API_KEY: 'sk-openai-single',
      } as NodeJS.ProcessEnv),
    ).toBe(false)
  })

  test('accepts a dedicated Command Code credential on its selected route', () => {
    expect(
      hasUsableOpenAILaunchCredential({
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_BASE_URL: 'https://api.commandcode.ai/provider/v1',
        CMD_API_KEY: 'cmd-key',
      } as NodeJS.ProcessEnv),
    ).toBe(true)
  })

  test('accepts the Command Code fallback credential on its selected route', () => {
    expect(
      hasUsableOpenAILaunchCredential({
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_BASE_URL: 'https://api.commandcode.ai/provider/v1',
        COMMANDCODE_API_KEY: 'fallback-key',
      } as NodeJS.ProcessEnv),
    ).toBe(true)
  })

  test('rejects a generic credential for the dedicated-only Command Code route', () => {
    expect(
      hasUsableOpenAILaunchCredential({
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_BASE_URL: 'https://api.commandcode.ai/provider/v1',
        OPENAI_API_KEY: 'generic-key',
      } as NodeJS.ProcessEnv),
    ).toBe(false)
  })
})
