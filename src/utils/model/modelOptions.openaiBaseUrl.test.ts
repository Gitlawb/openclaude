import { afterEach, beforeEach, expect, test } from 'bun:test'
import { isOpenAIOrCodexBaseUrl } from './modelOptions.js'

const originalBaseUrl = process.env.OPENAI_BASE_URL

beforeEach(() => {
  delete process.env.OPENAI_BASE_URL
})

afterEach(() => {
  if (originalBaseUrl === undefined) {
    delete process.env.OPENAI_BASE_URL
  } else {
    process.env.OPENAI_BASE_URL = originalBaseUrl
  }
})

test('treats unset OPENAI_BASE_URL as vanilla OpenAI', () => {
  expect(isOpenAIOrCodexBaseUrl()).toBe(true)
})

test('treats empty / whitespace OPENAI_BASE_URL as vanilla OpenAI', () => {
  process.env.OPENAI_BASE_URL = '   '
  expect(isOpenAIOrCodexBaseUrl()).toBe(true)
})

test.each([
  'https://api.openai.com/v1',
  'https://API.OPENAI.COM/v1',
  'https://chatgpt.com/backend-api',
  'https://chatgpt.com/backend-api/codex',
  'https://api.codex.openai.example.test/v1',
])('treats %s as OpenAI/Codex', baseUrl => {
  process.env.OPENAI_BASE_URL = baseUrl
  expect(isOpenAIOrCodexBaseUrl()).toBe(true)
})

test.each([
  'https://api.kimi.com/coding/',
  'https://api.z.ai/api/anthropic',
  'https://openrouter.ai/api/v1',
  'https://api.sambanova.ai',
  'https://integrate.api.nvidia.com/v1',
  'https://api.deepinfra.com/v1/openai',
  'http://localhost:11434/v1',
])('treats %s as non-OpenAI', baseUrl => {
  process.env.OPENAI_BASE_URL = baseUrl
  expect(isOpenAIOrCodexBaseUrl()).toBe(false)
})
