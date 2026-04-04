import { afterEach, expect, mock, test } from 'bun:test'

const originalEnv = {
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
}

afterEach(() => {
  mock.restore()
  process.env.CLAUDE_CODE_USE_OPENAI = originalEnv.CLAUDE_CODE_USE_OPENAI
  process.env.OPENAI_BASE_URL = originalEnv.OPENAI_BASE_URL
  process.env.OPENAI_MODEL = originalEnv.OPENAI_MODEL
})

test('opens the model picker without awaiting local model discovery refresh', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:8080/v1'
  process.env.OPENAI_MODEL = 'qwen2.5-coder-7b-instruct'

  let resolveBootstrap: (() => void) | undefined
  const fetchBootstrapData = mock(
    () =>
      new Promise<void>(resolve => {
        resolveBootstrap = resolve
      }),
  )

  mock.module('../../services/api/bootstrap.js', () => ({
    fetchBootstrapData,
  }))

  const { call } = await import('./model.js')
  const result = await Promise.race([
    call(() => {}, {} as never, ''),
    new Promise(resolve => setTimeout(() => resolve('timeout'), 50)),
  ])

  resolveBootstrap?.()

  expect(result).not.toBe('timeout')
  expect(fetchBootstrapData).toHaveBeenCalledTimes(1)
})