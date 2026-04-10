import { afterEach, beforeEach, expect, mock, test } from 'bun:test'

import { getReasoningEffortForModel } from '../services/api/providerConfig.js'

const originalEnv = {
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_EFFORT_LEVEL: process.env.CLAUDE_CODE_EFFORT_LEVEL,
}

async function importFreshEffortModule(
  provider: 'firstParty' | 'openai' | 'codex',
) {
  mock.restore()
  mock.module('./model/providers.js', () => ({
    getAPIProvider: () => provider,
  }))
  const nonce = `${Date.now()}-${Math.random()}`
  return import(`./effort.js?ts=${nonce}`)
}

beforeEach(() => {
  mock.restore()
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_EFFORT_LEVEL
})

afterEach(() => {
  process.env.CLAUDE_CODE_USE_OPENAI = originalEnv.CLAUDE_CODE_USE_OPENAI
  process.env.CLAUDE_CODE_EFFORT_LEVEL = originalEnv.CLAUDE_CODE_EFFORT_LEVEL
  mock.restore()
})

test.each(['openai', 'codex'] as const)(
  'OpenAI/Codex models expose xhigh effort for %s',
  async provider => {
    const {
      getAvailableEffortLevels,
      modelUsesOpenAIEffort,
      resolveAppliedEffort,
    } = await importFreshEffortModule(provider)

    expect(modelUsesOpenAIEffort('gpt-5.4')).toBe(true)
    expect(getAvailableEffortLevels('gpt-5.4')).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
    ])
    expect(resolveAppliedEffort('gpt-5.4', 'xhigh')).toBe('xhigh')
    expect(getReasoningEffortForModel('gpt-5.4')).toBe('high')
    expect(getReasoningEffortForModel('gpt-5.4-mini')).toBe('medium')
  },
)

test('Claude models still advertise max effort instead of xhigh', async () => {
  const { getAvailableEffortLevels, modelUsesOpenAIEffort } =
    await importFreshEffortModule('firstParty')

  expect(modelUsesOpenAIEffort('claude-opus-4-6')).toBe(false)
  expect(getAvailableEffortLevels('claude-opus-4-6')).toEqual([
    'low',
    'medium',
    'high',
    'max',
  ])
})
