import { afterEach, expect, mock, test } from 'bun:test'
import axios from 'axios'

const originalEnv = {
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

afterEach(() => {
  mock.restore()
  restoreEnv(
    'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
    originalEnv.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,
  )
  restoreEnv('CLAUDE_CODE_USE_OPENAI', originalEnv.CLAUDE_CODE_USE_OPENAI)
  restoreEnv('OPENAI_BASE_URL', originalEnv.OPENAI_BASE_URL)
  restoreEnv('OPENAI_MODEL', originalEnv.OPENAI_MODEL)
})

test('skips legacy OpenAI-compatible model discovery when nonessential traffic is disabled', async () => {
  process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'http://localhost:1234/v1'
  process.env.OPENAI_MODEL = 'local-model'

  const getSpy = mock(async () => {
    throw new Error('unexpected legacy model discovery request')
  })
  axios.get = getSpy as typeof axios.get

  const { discoverOpenAICompatibleModelOptions } = await import(
    `./openaiModelDiscovery.js?privacy=${Date.now()}-${Math.random()}`
  )

  await expect(discoverOpenAICompatibleModelOptions()).resolves.toEqual([])
  expect(getSpy).not.toHaveBeenCalled()
})
