import { afterEach, expect, test } from 'bun:test'

const ORIGINAL_ENV = {
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_BASE: process.env.OPENAI_API_BASE,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
  ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

afterEach(() => {
  restoreEnv()
})

test('benchmark support does not advertise direct MiniMax Anthropic-compatible env', async () => {
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_API_BASE
  delete process.env.OPENAI_MODEL
  process.env.MINIMAX_API_KEY = 'minimax-test-key'
  process.env.ANTHROPIC_BASE_URL = 'https://api.minimax.io/anthropic'
  process.env.ANTHROPIC_MODEL = 'MiniMax-M2.7'

  const { isBenchmarkSupported } = await import(
    `./benchmark.js?ts=${Date.now()}-${Math.random()}`
  )

  expect(isBenchmarkSupported()).toBe(false)
})
