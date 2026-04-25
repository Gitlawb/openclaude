import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { detectProvider } from './StartupScreen.js'

const ENV_KEYS = [
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_MISTRAL',
  'OPENAI_BASE_URL',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'GEMINI_MODEL',
  'MISTRAL_MODEL',
  'ANTHROPIC_MODEL',
  'NVIDIA_NIM',
  'MINIMAX_API_KEY',
]

const originalEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = originalEnv[key]
    }
  }
})

function setupOpenAIMode(baseUrl: string, model: string): void {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = baseUrl
  process.env.OPENAI_MODEL = model
  process.env.OPENAI_API_KEY = 'test-key'
}

// --- Issue #855: aggregator URL must win over vendor-prefixed model name ---

describe('detectProvider — aggregator URL authoritative over model-name substring (#855)', () => {
  test('OpenRouter + deepseek/deepseek-chat labels as OpenRouter', () => {
    setupOpenAIMode('https://openrouter.ai/api/v1', 'deepseek/deepseek-chat')
    expect(detectProvider().name).toBe('OpenRouter')
  })

  test('OpenRouter + moonshotai/kimi-k2 labels as OpenRouter', () => {
    setupOpenAIMode('https://openrouter.ai/api/v1', 'moonshotai/kimi-k2')
    expect(detectProvider().name).toBe('OpenRouter')
  })

  test('OpenRouter + mistralai/mistral-large labels as OpenRouter', () => {
    setupOpenAIMode('https://openrouter.ai/api/v1', 'mistralai/mistral-large')
    expect(detectProvider().name).toBe('OpenRouter')
  })

  test('OpenRouter + meta-llama/llama-3.3 labels as OpenRouter', () => {
    setupOpenAIMode('https://openrouter.ai/api/v1', 'meta-llama/llama-3.3-70b-instruct')
    expect(detectProvider().name).toBe('OpenRouter')
  })

  test('Together + deepseek-ai/DeepSeek-V3 labels as Together AI', () => {
    setupOpenAIMode('https://api.together.xyz/v1', 'deepseek-ai/DeepSeek-V3')
    expect(detectProvider().name).toBe('Together AI')
  })

  test('Together + meta-llama/Llama-3.3 labels as Together AI', () => {
    setupOpenAIMode('https://api.together.xyz/v1', 'meta-llama/Llama-3.3-70B-Instruct-Turbo')
    expect(detectProvider().name).toBe('Together AI')
  })

  test('Groq + deepseek-r1-distill-llama-70b labels as Groq', () => {
    setupOpenAIMode('https://api.groq.com/openai/v1', 'deepseek-r1-distill-llama-70b')
    expect(detectProvider().name).toBe('Groq')
  })

  test('Groq + llama-3.3-70b-versatile labels as Groq', () => {
    setupOpenAIMode('https://api.groq.com/openai/v1', 'llama-3.3-70b-versatile')
    expect(detectProvider().name).toBe('Groq')
  })

  test('Azure + any deepseek deployment labels as Azure OpenAI', () => {
    setupOpenAIMode('https://my-resource.openai.azure.com/', 'deepseek-chat')
    expect(detectProvider().name).toBe('Azure OpenAI')
  })
})

// --- Direct vendor endpoints still label correctly (regression) ---

describe('detectProvider — direct vendor endpoints', () => {
  test('api.deepseek.com labels as DeepSeek', () => {
    setupOpenAIMode('https://api.deepseek.com/v1', 'deepseek-chat')
    expect(detectProvider().name).toBe('DeepSeek')
  })

  test('api.kimi.com labels as Moonshot AI - Kimi Code', () => {
    setupOpenAIMode('https://api.kimi.com/coding/v1', 'kimi-for-coding')
    expect(detectProvider().name).toBe('Moonshot AI - Kimi Code')
  })

  test('api.moonshot.cn labels as Moonshot AI - API', () => {
    setupOpenAIMode('https://api.moonshot.cn/v1', 'moonshot-v1-8k')
    expect(detectProvider().name).toBe('Moonshot AI - API')
  })

  test('api.mistral.ai labels as Mistral', () => {
    setupOpenAIMode('https://api.mistral.ai/v1', 'mistral-large-latest')
    expect(detectProvider().name).toBe('Mistral')
  })

  test('default OpenAI URL + gpt-4o labels as OpenAI', () => {
    setupOpenAIMode('https://api.openai.com/v1', 'gpt-4o')
    expect(detectProvider().name).toBe('OpenAI')
  })
})

// --- rawModel fallback for generic/custom endpoints ---

describe('detectProvider — rawModel fallback when URL is generic', () => {
  test('custom proxy + deepseek-chat falls back to DeepSeek', () => {
    setupOpenAIMode('https://my-proxy.internal/v1', 'deepseek-chat')
    expect(detectProvider().name).toBe('DeepSeek')
  })

  test('custom proxy + kimi-for-coding falls back to Moonshot AI - Kimi Code', () => {
    setupOpenAIMode('https://my-proxy.internal/v1', 'kimi-for-coding')
    expect(detectProvider().name).toBe('Moonshot AI - Kimi Code')
  })

  test('custom proxy + kimi-k2 falls back to Moonshot AI - API', () => {
    setupOpenAIMode('https://my-proxy.internal/v1', 'kimi-k2-instruct')
    expect(detectProvider().name).toBe('Moonshot AI - API')
  })

  test('custom proxy + llama-3.3 falls back to Meta Llama', () => {
    setupOpenAIMode('https://my-proxy.internal/v1', 'llama-3.3-70b')
    expect(detectProvider().name).toBe('Meta Llama')
  })

  test('custom proxy + mistral-large falls back to Mistral', () => {
    setupOpenAIMode('https://my-proxy.internal/v1', 'mistral-large-latest')
    expect(detectProvider().name).toBe('Mistral')
  })
})

// --- Explicit env flags win over URL heuristics ---

describe('detectProvider — explicit dedicated-provider env flags', () => {
  test('NVIDIA_NIM=1 overrides aggregator URL', () => {
    setupOpenAIMode('https://openrouter.ai/api/v1', 'some-nim-model')
    process.env.NVIDIA_NIM = '1'
    expect(detectProvider().name).toBe('NVIDIA NIM')
  })

  test('MINIMAX_API_KEY overrides aggregator URL', () => {
    setupOpenAIMode('https://openrouter.ai/api/v1', 'any-model')
    process.env.MINIMAX_API_KEY = 'test-key'
    expect(detectProvider().name).toBe('MiniMax')
  })
})
