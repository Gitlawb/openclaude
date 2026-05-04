import { describe, expect, test } from 'bun:test'

import {
  detectBestProvider,
  detectLocalService,
  detectProviderFromEnv,
} from './providerAutoDetect.ts'

// Hermetic env scan: always report "no Codex auth on disk" so tests don't
// depend on the dev machine's ~/.codex/auth.json state.
function scan(env: Record<string, string | undefined>) {
  return detectProviderFromEnv({ env, hasCodexAuth: () => false })
}

describe('detectProviderFromEnv — priority order', () => {
  test('ANTHROPIC_API_KEY wins over all others', () => {
    expect(
      scan({
        ANTHROPIC_API_KEY: 'sk-ant-x',
        OPENAI_API_KEY: 'sk-x',
        GEMINI_API_KEY: 'gem-x',
      }),
    ).toEqual({ kind: 'anthropic', source: 'ANTHROPIC_API_KEY set' })
  })

  test('CODEX_API_KEY beats OpenAI/Gemini/etc', () => {
    expect(
      scan({
        CODEX_API_KEY: 'codex-x',
        OPENAI_API_KEY: 'sk-x',
      }),
    ).toEqual({ kind: 'codex', source: 'CODEX_API_KEY set' })
  })

  test('CHATGPT_ACCOUNT_ID alone is enough for Codex', () => {
    expect(
      scan({
        CHATGPT_ACCOUNT_ID: 'acct-123',
      }),
    ).toEqual({ kind: 'codex', source: 'CHATGPT_ACCOUNT_ID set' })
  })

  test('Codex auth file on disk is detected without any env', () => {
    expect(
      detectProviderFromEnv({ env: {}, hasCodexAuth: () => true }),
    ).toEqual({ kind: 'codex', source: '~/.codex/auth.json present' })
  })

  test('GITHUB_TOKEN wins over OpenAI', () => {
    expect(
      scan({
        GITHUB_TOKEN: 'ghp-x',
        OPENAI_API_KEY: 'sk-x',
      }),
    ).toEqual({ kind: 'github', source: 'GITHUB_TOKEN set (GitHub Copilot)' })
  })

  test('GH_TOKEN is equivalent to GITHUB_TOKEN', () => {
    expect(
      scan({
        GH_TOKEN: 'ghp-x',
      }),
    ).toEqual({ kind: 'github', source: 'GH_TOKEN set (GitHub Copilot)' })
  })

  test('OPENAI_API_KEYS (plural) detected', () => {
    expect(
      scan({
        OPENAI_API_KEYS: 'sk-a,sk-b',
      }),
    ).toEqual({ kind: 'openai', source: 'OPENAI_API_KEYS set' })
  })

  test('OPENAI_API_KEY reports baseUrl when set', () => {
    expect(
      scan({
        OPENAI_API_KEY: 'sk-x',
        OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
      }),
    ).toEqual({
      kind: 'openai',
      source: 'OPENAI_API_KEY set',
      baseUrl: 'https://openrouter.ai/api/v1',
    })
  })

  test('GEMINI_API_KEY detected', () => {
    expect(scan({ GEMINI_API_KEY: 'gem-x' })).toEqual({
      kind: 'gemini',
      source: 'GEMINI_API_KEY set',
    })
  })

  test('GOOGLE_API_KEY also detects Gemini', () => {
    expect(scan({ GOOGLE_API_KEY: 'gk-x' })).toEqual({
      kind: 'gemini',
      source: 'GOOGLE_API_KEY set',
    })
  })

  test('MISTRAL_API_KEY detected', () => {
    expect(scan({ MISTRAL_API_KEY: 'mis-x' })).toEqual({
      kind: 'mistral',
      source: 'MISTRAL_API_KEY set',
    })
  })

  test('MINIMAX_API_KEY detected', () => {
    expect(scan({ MINIMAX_API_KEY: 'mm-x' })).toEqual({
      kind: 'minimax',
      source: 'MINIMAX_API_KEY set',
    })
  })

  test('XAI_API_KEY detected', () => {
    expect(scan({ XAI_API_KEY: 'xai-x' })).toEqual({
      kind: 'xai',
      source: 'XAI_API_KEY set',
    })
  })

  test('empty-string values are ignored', () => {
    expect(
      scan({
        ANTHROPIC_API_KEY: '',
        OPENAI_API_KEY: '   ',
        GEMINI_API_KEY: 'gem-x',
      }),
    ).toEqual({ kind: 'gemini', source: 'GEMINI_API_KEY set' })
  })

  test('no credentials → null', () => {
    expect(scan({})).toBeNull()
  })
})

describe('detectLocalService', () => {
  test('returns Ollama when its /api/tags responds ok', async () => {
    const fetchImpl = (async (input: URL | RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as URL).toString()
      if (url.includes(':11434')) {
        return new Response('{"models":[]}', { status: 200 })
      }
      return new Response('', { status: 404 })
    }) as typeof fetch

    const result = await detectLocalService({
      env: {},
      fetchImpl,
      timeoutMs: 200,
    })
    expect(result?.kind).toBe('ollama')
    expect(result?.baseUrl).toBe('http://localhost:11434')
  })

  test('Ollama wins over LM Studio even when both are reachable', async () => {
    // @ts-expect-error conversion mismatch
    const fetchImpl = (async () => new Response('{}', { status: 200 })) as typeof fetch
    const result = await detectLocalService({
      env: {},
      fetchImpl,
      timeoutMs: 200,
    })
    expect(result?.kind).toBe('ollama')
  })

  test('falls back to LM Studio when Ollama is unreachable', async () => {
    const fetchImpl = (async (input: URL | RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as URL).toString()
      if (url.includes(':1234')) {
        return new Response('{"data":[]}', { status: 200 })
      }
      return new Response('', { status: 404 })
    }) as typeof fetch

    const result = await detectLocalService({
      env: {},
      fetchImpl,
      timeoutMs: 200,
    })
    expect(result?.kind).toBe('lm-studio')
    expect(result?.baseUrl).toBe('http://localhost:1234')
  })

  test('returns null when no local services respond', async () => {
    // @ts-expect-error conversion mismatch
    const fetchImpl = (async () =>
      new Response('', { status: 500 })) as typeof fetch
    const result = await detectLocalService({
      env: {},
      fetchImpl,
      timeoutMs: 200,
    })
    expect(result).toBeNull()
  })

  test('honors OLLAMA_BASE_URL override', async () => {
    const probedUrls: string[] = []
    const fetchImpl = (async (input: URL | RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as URL).toString()
      probedUrls.push(url)
      return new Response('{"models":[]}', { status: 200 })
    }) as typeof fetch

    const result = await detectLocalService({
      env: { OLLAMA_BASE_URL: 'http://10.0.0.5:11434' },
      fetchImpl,
      timeoutMs: 200,
    })
    expect(result?.baseUrl).toBe('http://10.0.0.5:11434')
    expect(probedUrls).toContain('http://10.0.0.5:11434/api/tags')
  })

  test('probe timeout does not throw — returns null', async () => {
    const fetchImpl = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      // Respect the caller's abort signal so the race with timeoutMs is fair.
      return new Promise<Response>((_resolve, reject) => {
        const onAbort = () => reject(new Error('aborted'))
        init?.signal?.addEventListener('abort', onAbort)
        setTimeout(() => {
          init?.signal?.removeEventListener('abort', onAbort)
          _resolve(new Response('ok'))
        }, 500)
      })
    }) as typeof fetch

    const result = await detectLocalService({
      env: {},
      fetchImpl,
      timeoutMs: 50,
    })
    expect(result).toBeNull()
  })

  test('network errors do not throw', async () => {
    // @ts-expect-error conversion mismatch
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED')
    }) as typeof fetch

    const result = await detectLocalService({
      env: {},
      fetchImpl,
      timeoutMs: 200,
    })
    expect(result).toBeNull()
  })
})

describe('detectBestProvider — orchestrator', () => {
  test('env match short-circuits the local probe', async () => {
    let probeCalled = false
    // @ts-expect-error conversion mismatch
    const fetchImpl = (async () => {
      probeCalled = true
      return new Response('{}', { status: 200 })
    }) as typeof fetch

    const result = await detectBestProvider({
      env: { ANTHROPIC_API_KEY: 'sk-ant' },
      fetchImpl,
      timeoutMs: 200,
      hasCodexAuth: () => false,
    })
    expect(result?.kind).toBe('anthropic')
    expect(probeCalled).toBe(false)
  })

  test('env miss falls through to local-service probe', async () => {
    // @ts-expect-error conversion mismatch
    const fetchImpl = (async () => new Response('{}', { status: 200 })) as typeof fetch
    const result = await detectBestProvider({
      env: {},
      fetchImpl,
      timeoutMs: 200,
      hasCodexAuth: () => false,
    })
    expect(result?.kind).toBe('ollama')
  })

  test('skipLocal prevents network probes', async () => {
    let probeCalled = false
    // @ts-expect-error conversion mismatch
    const fetchImpl = (async () => {
      probeCalled = true
      return new Response('{}', { status: 200 })
    }) as typeof fetch

    const result = await detectBestProvider({
      env: {},
      fetchImpl,
      skipLocal: true,
      hasCodexAuth: () => false,
    })
    expect(result).toBeNull()
    expect(probeCalled).toBe(false)
  })

  test('completely empty environment returns null', async () => {
    // @ts-expect-error conversion mismatch
    const fetchImpl = (async () => {
      throw new Error('nothing reachable')
    }) as typeof fetch

    const result = await detectBestProvider({
      env: {},
      fetchImpl,
      timeoutMs: 100,
      hasCodexAuth: () => false,
    })
    expect(result).toBeNull()
  })
})
