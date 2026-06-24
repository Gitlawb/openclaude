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
})
