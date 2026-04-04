import { afterEach, beforeEach, expect, test } from 'bun:test'

import {
  applyGithubEnvToProcess,
  buildGithubUserSettingsEnv,
  mergeUserSettingsEnv,
} from './onboard-github.js'

const originalEnv = { ...process.env }

beforeEach(() => {
  resetTestEnv()
})

afterEach(() => {
  process.env = { ...originalEnv }
})

function resetTestEnv() {
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_GROQ
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_API_KEY
  delete process.env.GROQ_API_KEY
  delete process.env.OPENAI_MODEL
  delete process.env.GEMINI_API_KEY
  delete process.env.GEMINI_MODEL
  delete process.env.GEMINI_BASE_URL
  delete process.env.GOOGLE_API_KEY
  delete process.env.CODEX_API_KEY
  delete process.env.CHATGPT_ACCOUNT_ID
  delete process.env.CODEX_ACCOUNT_ID
}

test('buildGithubUserSettingsEnv clears stale third-party provider env keys', () => {
  const env = buildGithubUserSettingsEnv('github:copilot')

  expect(env).toMatchObject({
    CLAUDE_CODE_USE_GITHUB: '1',
    OPENAI_MODEL: 'github:copilot',
    CLAUDE_CODE_USE_OPENAI: undefined,
    CLAUDE_CODE_USE_GROQ: undefined,
    OPENAI_BASE_URL: undefined,
    OPENAI_API_KEY: undefined,
    GROQ_API_KEY: undefined,
    GEMINI_API_KEY: undefined,
    CODEX_API_KEY: undefined,
  })
})

test('applyGithubEnvToProcess clears stale OpenAI and Groq session state', () => {
  resetTestEnv()
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.CLAUDE_CODE_USE_GROQ = '1'
  process.env.OPENAI_BASE_URL = 'https://api.groq.com/openai/v1'
  process.env.OPENAI_API_KEY = 'gsk-test'
  process.env.GROQ_API_KEY = 'gsk-test'
  process.env.OPENAI_MODEL = 'llama-3.3-70b-versatile'

  applyGithubEnvToProcess('github:copilot')

  expect(process.env.CLAUDE_CODE_USE_GITHUB).toBe('1')
  expect(process.env.OPENAI_MODEL).toBe('github:copilot')
  expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
  expect(process.env.CLAUDE_CODE_USE_GROQ).toBeUndefined()
  expect(process.env.OPENAI_BASE_URL).toBeUndefined()
  expect(process.env.OPENAI_API_KEY).toBeUndefined()
  expect(process.env.GROQ_API_KEY).toBeUndefined()
})

test('applyGithubEnvToProcess falls back to default model', () => {
  resetTestEnv()
  applyGithubEnvToProcess('  ')
  expect(process.env.OPENAI_MODEL).toBe('github:copilot')
})

test('mergeUserSettingsEnv accepts github model update', () => {
  const result = mergeUserSettingsEnv('github:copilot')
  expect(result.ok).toBe(true)
})

