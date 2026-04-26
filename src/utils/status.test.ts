import { afterEach, expect, test } from 'bun:test'

import { DEFAULT_CODEX_BASE_URL } from '../services/api/providerConfig.js'
import { buildAPIProviderProperties } from './status.js'

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

function readPropertyValue(label: string): unknown {
  return buildAPIProviderProperties().find(property => property.label === label)
    ?.value
}

afterEach(() => {
  restoreEnv()
})

test('buildAPIProviderProperties labels NVIDIA NIM sessions', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.NVIDIA_NIM = '1'
  process.env.OPENAI_BASE_URL = 'https://integrate.api.nvidia.com/v1'
  process.env.OPENAI_MODEL = 'nvidia/llama-3.1-nemotron-70b-instruct'

  expect(readPropertyValue('API provider')).toBe('NVIDIA NIM')
  expect(readPropertyValue('NVIDIA NIM base URL')).toBe(
    'https://integrate.api.nvidia.com/v1',
  )
  expect(readPropertyValue('Model')).toBe(
    'nvidia/llama-3.1-nemotron-70b-instruct',
  )
})

test('buildAPIProviderProperties labels MiniMax sessions', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.MINIMAX_API_KEY = 'minimax-key'
  process.env.OPENAI_BASE_URL = 'https://api.minimax.chat/v1'
  process.env.OPENAI_MODEL = 'MiniMax-M2.5'

  expect(readPropertyValue('API provider')).toBe('MiniMax')
  expect(readPropertyValue('MiniMax base URL')).toBe(
    'https://api.minimax.chat/v1',
  )
  expect(readPropertyValue('Model')).toBe('MiniMax-M2.5')
})

test('buildAPIProviderProperties keeps Codex-specific labels on the shared OpenAI-compatible path', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = DEFAULT_CODEX_BASE_URL
  process.env.OPENAI_MODEL = 'codexplan'
  process.env.CHATGPT_ACCOUNT_ID = 'acct_123'

  expect(readPropertyValue('API provider')).toBe('Codex')
  expect(readPropertyValue('Codex base URL')).toBe(
    DEFAULT_CODEX_BASE_URL,
  )
  expect(readPropertyValue('Model')).toBe('gpt-5.5 (high)')
})
