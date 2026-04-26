import { afterEach, expect, mock, test } from 'bun:test'

const ORIGINAL_ENV = { ...process.env }

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }

  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

afterEach(() => {
  mock.restore()
  restoreEnv()
})

function clearProviderEnv(): void {
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_MISTRAL
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_API_BASE
  delete process.env.OPENAI_MODEL
  delete process.env.MINIMAX_API_KEY
  delete process.env.NVIDIA_NIM
  delete process.env.XAI_API_KEY
}

async function importFreshTeammateModelModule() {
  mock.restore()
  const nonce = `${Date.now()}-${Math.random()}`
  return import(`./teammateModel.js?ts=${nonce}`)
}

test('getHardcodedTeammateModelFallback returns a Mistral fallback in mistral mode', async () => {
  clearProviderEnv()
  process.env.CLAUDE_CODE_USE_MISTRAL = '1'
  const { getHardcodedTeammateModelFallback } =
    await importFreshTeammateModelModule()

  expect(getHardcodedTeammateModelFallback()).toBe('devstral-latest')
})
