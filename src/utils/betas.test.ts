import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  CLAUDE_CODE_20250219_BETA_HEADER,
} from '../constants/betas.js'
import { setSdkBetas } from '../bootstrap/state.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

const originalEnv = { ...process.env }

beforeEach(async () => {
  await acquireSharedMutationLock('utils/betas.test.ts')
  process.env = { ...originalEnv }
  useOpenAIProviderForTest()
})

afterEach(() => {
  try {
    process.env = { ...originalEnv }
    setSdkBetas(undefined)
  } finally {
    releaseSharedMutationLock()
  }
})

test('adds trimmed user-provided beta headers without empty entries', async () => {
  process.env.ANTHROPIC_BETAS =
    ' custom-beta-2026-01-01, ,second-beta-2026-02-02 '

  const { getAllModelBetas } = await importFreshBetasModule()
  const betas = getAllModelBetas('claude-3-haiku-20240307')

  expect(betas.slice(-2)).toEqual([
    'custom-beta-2026-01-01',
    'second-beta-2026-02-02',
  ])
  expect(betas).not.toContain('')
})

test('does not duplicate an env-provided agentic beta for Haiku requests', async () => {
  process.env.ANTHROPIC_BETAS = [
    CLAUDE_CODE_20250219_BETA_HEADER,
    'custom-beta-2026-01-01',
  ].join(',')

  const { getMergedBetas } = await importFreshBetasModule()
  const mergedBetas = getMergedBetas('claude-3-haiku-20240307', {
    isAgenticQuery: true,
  })

  expect(
    mergedBetas.filter(beta => beta === CLAUDE_CODE_20250219_BETA_HEADER),
  ).toHaveLength(1)
  expect(mergedBetas).toContain('custom-beta-2026-01-01')
})

async function importFreshBetasModule() {
  return import(`./betas.ts?betasTest=${Date.now()}-${Math.random()}`)
}

function useOpenAIProviderForTest(): void {
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_MISTRAL
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.NVIDIA_NIM
  delete process.env.USER_TYPE
  delete process.env.CLAUDE_CODE_ENTRYPOINT
  delete process.env.DISABLE_INTERLEAVED_THINKING
  delete process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS
  delete process.env.USE_API_CONTEXT_MANAGEMENT
  delete process.env.USE_CONNECTOR_TEXT_SUMMARIZATION

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_MODEL = 'claude-3-haiku-20240307'
  process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'
  process.env.OPENAI_API_KEY = 'test'
  setSdkBetas(undefined)
}
