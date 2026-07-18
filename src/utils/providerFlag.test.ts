import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import {
  parseProviderFlag,
  parseModelFlag,
  applyProviderFlag,
  applyProviderFlagFromArgs,
  reapplyRememberedProviderFlag,
  clearRememberedProviderFlagForTests,
  applyModelFlagFromArgs,
  VALID_PROVIDERS,
} from './providerFlag.js'

const ENV_KEYS = [
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_MISTRAL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'OPENAI_BASE_URL',
  'OPENAI_API_BASE',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'OPENAI_API_FORMAT',
  'OPENAI_AZURE_STYLE',
  'OPENAI_AUTH_HEADER',
  'OPENAI_AUTH_SCHEME',
  'OPENAI_AUTH_HEADER_VALUE',
  'GEMINI_MODEL',
  'NVIDIA_API_KEY',
  'NVIDIA_NIM',
  'BNKR_API_KEY',
  'XAI_API_KEY',
  'MINIMAX_API_KEY',
  'VENICE_API_KEY',
  'MIMO_API_KEY',
  'ATLAS_CLOUD_API_KEY',
  'LONGCAT_API_KEY',
  'OPENGATEWAY_API_KEY',
  'OPENGATEWAY_BASE_URL',
  'CLOUDFLARE_API_TOKEN',
  'MISTRAL_MODEL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_CUSTOM_HEADERS',
  'USER_TYPE',
]

const originalEnv: Record<string, string | undefined> = {}

beforeEach(async () => {
  await acquireSharedMutationLock('utils/providerFlag.test.ts')
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key]
    delete process.env[key]
  }
})

const RESET_KEYS = [
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_MISTRAL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'OPENAI_BASE_URL',
  'OPENAI_API_BASE',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'OPENAI_API_FORMAT',
  'OPENAI_AZURE_STYLE',
  'OPENAI_AUTH_HEADER',
  'OPENAI_AUTH_SCHEME',
  'OPENAI_AUTH_HEADER_VALUE',
  'GEMINI_MODEL',
  'NVIDIA_API_KEY',
  'NVIDIA_NIM',
  'BNKR_API_KEY',
  'XAI_API_KEY',
  'MINIMAX_API_KEY',
  'VENICE_API_KEY',
  'MIMO_API_KEY',
  'ATLAS_CLOUD_API_KEY',
  'LONGCAT_API_KEY',
  'OPENGATEWAY_API_KEY',
  'OPENGATEWAY_BASE_URL',
  'CLOUDFLARE_API_TOKEN',
  'MISTRAL_MODEL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_CUSTOM_HEADERS',
  'USER_TYPE',
] as const

beforeEach(() => {
  clearRememberedProviderFlagForTests()
  for (const key of RESET_KEYS) {
    delete process.env[key]
  }
})

afterEach(() => {
  try {
    clearRememberedProviderFlagForTests()
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = originalEnv[key]
      }
    }
  } finally {
    releaseSharedMutationLock()
  }
})

// --- parseProviderFlag ---

describe('parseProviderFlag', () => {
  test('returns provider name when --provider flag present', () => {
    expect(parseProviderFlag(['--provider', 'openai'])).toBe('openai')
  })

  test('returns provider name with --model alongside', () => {
    expect(parseProviderFlag(['--provider', 'gemini', '--model', 'gemini-2.0-flash'])).toBe('gemini')
  })

  test('returns null when --provider flag absent', () => {
    expect(parseProviderFlag(['--model', 'gpt-4o'])).toBeNull()
  })

  test('returns null for empty args', () => {
    expect(parseProviderFlag([])).toBeNull()
  })

  test('returns null when --provider has no value', () => {
    expect(parseProviderFlag(['--provider'])).toBeNull()
  })

  test('returns null when --provider value starts with --', () => {
    expect(parseProviderFlag(['--provider', '--model'])).toBeNull()
  })
})

// --- applyProviderFlag ---

describe('applyProviderFlag - anthropic', () => {
  test('sets no env vars for anthropic (default)', () => {
    const result = applyProviderFlag('anthropic', [])
    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_GEMINI).toBeUndefined()
  })

  test('clears a previously selected custom Anthropic endpoint', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://proxy.example/v1'
    process.env.ANTHROPIC_MODEL = 'proxy-model'
    process.env.ANTHROPIC_API_KEY = 'proxy-api-key'
    process.env.ANTHROPIC_AUTH_TOKEN = 'proxy-token'
    process.env.ANTHROPIC_CUSTOM_HEADERS = 'x-tenant: example'

    const result = applyProviderFlag('anthropic', [])

    expect(result.error).toBeUndefined()
    expect(process.env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(process.env.ANTHROPIC_MODEL).toBeUndefined()
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(process.env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined()
  })

  test('preserves a first-party Anthropic API key', () => {
    process.env.ANTHROPIC_API_KEY = 'first-party-key'

    const result = applyProviderFlag('anthropic', [])

    expect(result.error).toBeUndefined()
    expect(process.env.ANTHROPIC_API_KEY).toBe('first-party-key')
  })
})

describe('applyProviderFlag - custom Anthropic-compatible', () => {
  test('requires a custom endpoint instead of sending its credential to Anthropic', () => {
    process.env.ANTHROPIC_AUTH_TOKEN = 'proxy-token'

    const result = applyProviderFlag('custom-anthropic', [])

    expect(result.error).toContain('ANTHROPIC_BASE_URL')
  })

  test('rejects the first-party Anthropic endpoint instead of forwarding a custom credential', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
    process.env.ANTHROPIC_AUTH_TOKEN = 'proxy-token'

    const result = applyProviderFlag('custom-anthropic', [])

    expect(result.error).toContain('non-Anthropic ANTHROPIC_BASE_URL')
  })

  test('rejects the internal first-party Anthropic staging endpoint', () => {
    process.env.USER_TYPE = 'ant'
    process.env.ANTHROPIC_BASE_URL = 'https://api-staging.anthropic.com'
    process.env.ANTHROPIC_AUTH_TOKEN = 'proxy-token'

    const result = applyProviderFlag('custom-anthropic', [])

    expect(result.error).toContain('non-Anthropic ANTHROPIC_BASE_URL')
  })

  test('keeps native Anthropic routing and applies --model', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://proxy.example/v1'
    process.env.ANTHROPIC_AUTH_TOKEN = 'proxy-token'
    process.env.ANTHROPIC_API_KEY = 'stale-anthropic-key'
    process.env.CLAUDE_CODE_USE_FOUNDRY = '1'
    process.env.OPENAI_BASE_URL = 'https://stale.example/v1'
    process.env.OPENAI_API_BASE = 'https://stale.example/v1'
    process.env.OPENAI_API_FORMAT = 'responses'
    process.env.OPENAI_AUTH_HEADER = 'Authorization'
    process.env.OPENAI_AUTH_SCHEME = 'bearer'
    process.env.OPENAI_AUTH_HEADER_VALUE = 'stale-token'

    const result = applyProviderFlag('custom-anthropic', ['--model', 'proxy-model'])

    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_FOUNDRY).toBeUndefined()
    expect(process.env.OPENAI_MODEL).toBeUndefined()
    expect(process.env.OPENAI_BASE_URL).toBeUndefined()
    expect(process.env.OPENAI_API_BASE).toBeUndefined()
    expect(process.env.OPENAI_API_FORMAT).toBeUndefined()
    expect(process.env.OPENAI_AUTH_HEADER).toBeUndefined()
    expect(process.env.OPENAI_AUTH_SCHEME).toBeUndefined()
    expect(process.env.OPENAI_AUTH_HEADER_VALUE).toBeUndefined()
    expect(process.env.ANTHROPIC_BASE_URL).toBe('https://proxy.example/v1')
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBe('proxy-token')
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(process.env.ANTHROPIC_MODEL).toBe('proxy-model')
  })

  test('accepts native x-api-key authentication', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://proxy.example/v1'
    process.env.ANTHROPIC_API_KEY = 'stale-first-party-key'

    const result = applyProviderFlag('custom-anthropic', [])

    expect(result.error).toBeUndefined()
    expect(process.env.ANTHROPIC_API_KEY).toBe('stale-first-party-key')
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
  })
})

describe('VALID_PROVIDERS', () => {
  test('includes descriptor-backed preset and route ids', () => {
    expect(VALID_PROVIDERS).toContain('deepseek')
    expect(VALID_PROVIDERS).toContain('moonshotai')
    expect(VALID_PROVIDERS).toContain('openrouter')
    expect(VALID_PROVIDERS).toContain('atomic-chat')
    expect(VALID_PROVIDERS).toContain('zai')
    expect(VALID_PROVIDERS).toContain('venice')
    expect(VALID_PROVIDERS).toContain('xiaomi-mimo')
    expect(VALID_PROVIDERS).toContain('xiaomi-mimo-token')
    expect(VALID_PROVIDERS).toContain('longcat')
    expect(VALID_PROVIDERS).toContain('custom-anthropic')
  })
})

describe('applyProviderFlag - openai', () => {
  test('sets CLAUDE_CODE_USE_OPENAI=1', () => {
    const result = applyProviderFlag('openai', [])
    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
  })

  test('sets OPENAI_MODEL when --model is provided', () => {
    applyProviderFlag('openai', ['--model', 'gpt-4o'])
    expect(process.env.OPENAI_MODEL).toBe('gpt-4o')
  })
})

describe('applyProviderFlag - cloudflare', () => {
  test('does not seed the placeholder <ACCOUNT_ID> base URL', () => {
    process.env.CLOUDFLARE_API_TOKEN = 'cf-token'
    const result = applyProviderFlag('cloudflare', [])
    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    // The descriptor default contains an unresolved `<ACCOUNT_ID>` placeholder;
    // it must not be installed verbatim as a broken endpoint.
    expect(process.env.OPENAI_BASE_URL).toBeUndefined()
  })

  test('keeps a real account-scoped base URL the user already configured', () => {
    process.env.CLOUDFLARE_API_TOKEN = 'cf-token'
    process.env.OPENAI_BASE_URL =
      'https://api.cloudflare.com/client/v4/accounts/real123/ai/v1'
    applyProviderFlag('cloudflare', [])
    expect(process.env.OPENAI_BASE_URL).toBe(
      'https://api.cloudflare.com/client/v4/accounts/real123/ai/v1',
    )
  })

  test('mirrors CLOUDFLARE_API_TOKEN into OPENAI_API_KEY once a real Cloudflare endpoint is configured', () => {
    process.env.CLOUDFLARE_API_TOKEN = 'cf-token'
    process.env.OPENAI_BASE_URL =
      'https://api.cloudflare.com/client/v4/accounts/real123/ai/v1'
    delete process.env.OPENAI_API_KEY
    applyProviderFlag('cloudflare', [])
    // The Cloudflare transport authenticates via the generic OpenAI-compatible
    // header, so the dedicated token is copied into OPENAI_API_KEY — but only
    // once the configured base URL resolves to api.cloudflare.com.
    expect(String(process.env.OPENAI_API_KEY)).toBe('cf-token')
  })

  test('does NOT mirror the token while no Cloudflare endpoint is configured', () => {
    // The descriptor default is an unresolved `<ACCOUNT_ID>` placeholder that is
    // never seeded, so with OPENAI_BASE_URL unset the endpoint is unknown.
    // Mirroring here would leave the token attached to no real host.
    process.env.CLOUDFLARE_API_TOKEN = 'cf-token'
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_API_KEY
    applyProviderFlag('cloudflare', [])
    expect(process.env.OPENAI_API_KEY).toBeUndefined()
  })

  test('does NOT leak the token onto a stale non-Cloudflare base URL', () => {
    // Regression: a previous OpenAI-compatible provider left OPENAI_BASE_URL
    // pointing elsewhere. The Cloudflare token must not be copied onto it.
    process.env.CLOUDFLARE_API_TOKEN = 'cf-token'
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
    delete process.env.OPENAI_API_KEY
    applyProviderFlag('cloudflare', [])
    expect(process.env.OPENAI_API_KEY).toBeUndefined()
  })

  test('does NOT mirror the token onto the shared AI Gateway host', () => {
    // The AI Gateway host (gateway.ai.cloudflare.com) is not the Workers AI
    // endpoint isCloudflareBaseUrl keys on (api.cloudflare.com), so the token
    // must not be mirrored there either.
    process.env.CLOUDFLARE_API_TOKEN = 'cf-token'
    process.env.OPENAI_BASE_URL =
      'https://gateway.ai.cloudflare.com/v1/acc/gw/workers-ai/v1'
    delete process.env.OPENAI_API_KEY
    applyProviderFlag('cloudflare', [])
    expect(process.env.OPENAI_API_KEY).toBeUndefined()
  })

  test('does NOT mirror the token onto a general Cloudflare REST path on the same host', () => {
    // api.cloudflare.com also serves the general Cloudflare REST API. A
    // non-Workers-AI path (e.g. token verification) must NOT inherit Workers-AI
    // credential mirroring just because it shares the host.
    process.env.CLOUDFLARE_API_TOKEN = 'cf-token'
    process.env.OPENAI_BASE_URL =
      'https://api.cloudflare.com/client/v4/user/tokens/verify'
    delete process.env.OPENAI_API_KEY
    applyProviderFlag('cloudflare', [])
    expect(process.env.OPENAI_API_KEY).toBeUndefined()
  })

  test('clears a stale OPENAI_API_KEY when no CLOUDFLARE_API_TOKEN is set', () => {
    delete process.env.CLOUDFLARE_API_TOKEN
    delete process.env.OPENAI_BASE_URL
    process.env.OPENAI_API_KEY = 'leftover-from-another-provider'
    applyProviderFlag('cloudflare', [])
    // Without a Cloudflare token a lingering generic key must not be sent to
    // Cloudflare; validation should report the missing token instead.
    expect(process.env.OPENAI_API_KEY).toBeUndefined()
  })

  test('does NOT mirror the token onto the literal <ACCOUNT_ID> placeholder URL', () => {
    // The placeholder shares the api.cloudflare.com host, so a host-only check
    // would mirror the token onto an endpoint that cannot serve a request until
    // the account id is filled in. Reject placeholder URLs before mirroring.
    process.env.CLOUDFLARE_API_TOKEN = 'cf-token'
    process.env.OPENAI_BASE_URL =
      'https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1'
    delete process.env.OPENAI_API_KEY
    applyProviderFlag('cloudflare', [])
    expect(process.env.OPENAI_API_KEY).toBeUndefined()
  })

  test('preserves an existing OPENAI_API_KEY fallback on a real Cloudflare endpoint with no token', () => {
    // The descriptor lists OPENAI_API_KEY as a documented compatibility
    // fallback after CLOUDFLARE_API_TOKEN. A user who configured the generic
    // key against a real Workers AI URL must stay authenticated even without a
    // dedicated token.
    delete process.env.CLOUDFLARE_API_TOKEN
    process.env.OPENAI_BASE_URL =
      'https://api.cloudflare.com/client/v4/accounts/real123/ai/v1'
    process.env.OPENAI_API_KEY = 'compat-key'
    applyProviderFlag('cloudflare', [])
    expect(process.env.OPENAI_API_KEY).toBe('compat-key')
  })
})

describe('applyProviderFlag - gemini', () => {
  test('sets CLAUDE_CODE_USE_GEMINI=1', () => {
    const result = applyProviderFlag('gemini', [])
    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_GEMINI).toBe('1')
  })

  test('sets GEMINI_MODEL when --model is provided', () => {
    applyProviderFlag('gemini', ['--model', 'gemini-2.0-flash'])
    expect(process.env.GEMINI_MODEL).toBe('gemini-2.0-flash')
  })
})

describe('applyProviderFlag - github', () => {
  test('sets CLAUDE_CODE_USE_GITHUB=1', () => {
    const result = applyProviderFlag('github', [])
    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_GITHUB).toBe('1')
  })
})

describe('applyProviderFlag - bedrock', () => {
  test('sets CLAUDE_CODE_USE_BEDROCK=1', () => {
    const result = applyProviderFlag('bedrock', [])
    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_BEDROCK).toBe('1')
  })
})

describe('applyProviderFlag - vertex', () => {
  test('sets CLAUDE_CODE_USE_VERTEX=1', () => {
    const result = applyProviderFlag('vertex', [])
    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_VERTEX).toBe('1')
  })
})

describe('applyProviderFlag - ollama', () => {
  test('sets CLAUDE_CODE_USE_OPENAI=1 with Ollama defaults when unset', () => {
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_API_KEY

    const result = applyProviderFlag('ollama', [])
    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_BASE_URL!).toBe('http://localhost:11434/v1')
    expect(process.env.OPENAI_API_KEY!).toBe('ollama')
  })

  test('sets OPENAI_MODEL when --model is provided', () => {
    applyProviderFlag('ollama', ['--model', 'llama3.2'])
    expect(process.env.OPENAI_MODEL).toBe('llama3.2')
  })

  test('clears Azure-only routing mode', () => {
    process.env.OPENAI_AZURE_STYLE = '1'

    applyProviderFlag('ollama', [])

    expect(process.env.OPENAI_AZURE_STYLE).toBeUndefined()
  })

  test('does not override existing OPENAI_BASE_URL when user set a custom one', () => {
    process.env.OPENAI_BASE_URL = 'http://my-ollama:11434/v1'
    applyProviderFlag('ollama', [])
    expect(process.env.OPENAI_BASE_URL).toBe('http://my-ollama:11434/v1')
  })

  test('preserves explicit OPENAI_BASE_URL and OPENAI_API_KEY overrides', () => {
    process.env.OPENAI_BASE_URL = 'http://remote-ollama.internal:11434/v1'
    process.env.OPENAI_API_KEY = 'secret-token'

    applyProviderFlag('ollama', [])

    expect(process.env.OPENAI_BASE_URL).toBe('http://remote-ollama.internal:11434/v1')
    expect(process.env.OPENAI_API_KEY).toBe('secret-token')
  })
})

describe('applyProviderFlag - descriptor-backed openai-compatible routes', () => {
  test('deepseek applies generic openai-compatible routing with descriptor defaults', () => {
    const result = applyProviderFlag('deepseek', [])

    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('https://api.deepseek.com/v1')
    expect(process.env.OPENAI_MODEL).toBe('deepseek-v4-pro')
  })

  test('openrouter applies gateway defaults from descriptors', () => {
    const result = applyProviderFlag('openrouter', [])

    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('https://openrouter.ai/api/v1')
  })

  test('descriptor-backed provider selection preserves custom OPENAI_BASE_URL', () => {
    process.env.OPENAI_BASE_URL = 'http://proxy.local:8080/v1'

    const result = applyProviderFlag('openrouter', [])

    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('http://proxy.local:8080/v1')
  })

  test('descriptor-backed provider selection preserves custom OPENAI_API_BASE alias', () => {
    process.env.OPENAI_API_BASE = 'http://proxy.local:8080/v1'
    process.env.OPENGATEWAY_API_KEY = 'fake-ogw-key'

    const result = applyProviderFlag('gitlawb-opengateway', [])

    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBeUndefined()
    expect(process.env.OPENAI_API_BASE).toBe('http://proxy.local:8080/v1')
    expect(process.env.OPENAI_API_KEY).toBe('fake-ogw-key')
  })

  test('descriptor-backed provider selection ignores placeholder OPENAI_API_BASE alias values', () => {
    process.env.OPENAI_API_BASE = 'undefined'

    const result = applyProviderFlag('gitlawb-opengateway', [])

    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('https://opengateway.gitlawb.com/v1')
    expect(process.env.OPENAI_API_BASE).toBe('undefined')
  })

  test('gitlawb-opengateway explicit provider overrides stale generic base URL', () => {
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
    process.env.OPENAI_MODEL = 'gpt-5.5'
    process.env.OPENGATEWAY_API_KEY = 'fake-ogw-key'

    const result = applyProviderFlag('gitlawb-opengateway', [])

    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('https://opengateway.gitlawb.com/v1')
    expect(process.env.OPENGATEWAY_API_KEY).toBe('fake-ogw-key')
    expect(process.env.OPENAI_API_KEY).toBe('fake-ogw-key')
  })

  test('gitlawb-opengateway explicit provider respects OPENGATEWAY_BASE_URL override', () => {
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
    process.env.OPENGATEWAY_BASE_URL = 'http://localhost:8181/v1'

    const result = applyProviderFlag('gitlawb-opengateway', [])

    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('http://localhost:8181/v1')
  })

  test('gitlawb-opengateway explicit provider preserves custom OPENAI_BASE_URL when no OPENGATEWAY_BASE_URL is set', () => {
    process.env.OPENAI_BASE_URL = 'http://localhost:8181/v1'
    process.env.OPENGATEWAY_API_KEY = 'fake-ogw-key'

    const result = applyProviderFlag('gitlawb-opengateway', [])

    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('http://localhost:8181/v1')
    expect(process.env.OPENAI_API_KEY).toBe('fake-ogw-key')
  })

  test('gitlawb-opengateway explicit provider prefers OPENGATEWAY_API_KEY over generic OPENAI_API_KEY', () => {
    process.env.OPENGATEWAY_BASE_URL = 'http://localhost:8181/v1'
    process.env.OPENGATEWAY_API_KEY = 'fake-ogw-key'
    process.env.OPENAI_API_KEY = 'fake-generic-openai-key'

    const result = applyProviderFlag('gitlawb-opengateway', [])

    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('http://localhost:8181/v1')
    expect(process.env.OPENAI_API_KEY).toBe('fake-ogw-key')
  })

  test('gitlawb-opengateway explicit provider ignores blank OPENGATEWAY_API_KEY fallback', () => {
    process.env.OPENGATEWAY_BASE_URL = 'http://localhost:8181/v1'
    process.env.OPENGATEWAY_API_KEY = '   '
    process.env.OPENAI_API_KEY = 'fake-openai-fallback'

    const result = applyProviderFlag('gitlawb-opengateway', [])

    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('http://localhost:8181/v1')
    expect(process.env.OPENAI_API_KEY).toBe('fake-openai-fallback')
  })

  test('gitlawb-opengateway trims scoped API key and clears the copied key when switching routes', () => {
    process.env.OPENGATEWAY_API_KEY = ' fake-ogw-key '

    const opengatewayResult = applyProviderFlag('gitlawb-opengateway', [])
    expect(opengatewayResult.error).toBeUndefined()
    expect(process.env.OPENAI_API_KEY).toBe('fake-ogw-key')

    const openrouterResult = applyProviderFlag('openrouter', [])

    expect(openrouterResult.error).toBeUndefined()
    expect(process.env.OPENAI_BASE_URL).toBe('https://openrouter.ai/api/v1')
    expect(process.env.OPENAI_API_KEY).toBeUndefined()
    expect(process.env.OPENGATEWAY_API_KEY).toBe(' fake-ogw-key ')
  })

  test('clears OPENGATEWAY_API_KEY copied into OPENAI_API_KEY when switching routes', () => {
    process.env.OPENAI_API_KEY = 'fake-ogw-key'
    process.env.OPENGATEWAY_API_KEY = 'fake-ogw-key'

    const result = applyProviderFlag('openrouter', [])

    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('https://openrouter.ai/api/v1')
    expect(process.env.OPENAI_API_KEY).toBeUndefined()
    expect(process.env.OPENGATEWAY_API_KEY).toBe('fake-ogw-key')
  })

  test('descriptor-backed provider selection does not keep stale OpenGateway route', () => {
    process.env.OPENAI_BASE_URL = 'https://opengateway.gitlawb.com/v1'
    process.env.OPENGATEWAY_API_KEY = 'fake-ogw-key'

    const result = applyProviderFlag('openrouter', [])

    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('https://openrouter.ai/api/v1')
    expect(process.env.OPENGATEWAY_API_KEY).toBe('fake-ogw-key')
  })

  test('clears stale NVIDIA_NIM marker when switching to another OpenAI-compatible route', () => {
    process.env.NVIDIA_NIM = '1'

    const result = applyProviderFlag('openrouter', [])

    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.NVIDIA_NIM).toBeUndefined()
    expect(process.env.OPENAI_BASE_URL).toBe('https://openrouter.ai/api/v1')
  })

  test('clears NVIDIA_API_KEY copied into OPENAI_API_KEY when switching routes', () => {
    process.env.NVIDIA_API_KEY = 'nvidia-live-key'

    const nvidiaResult = applyProviderFlag('nvidia-nim', [])
    expect(nvidiaResult.error).toBeUndefined()
    expect(process.env.OPENAI_API_KEY).toBe('nvidia-live-key')

    process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
    const openrouterResult = applyProviderFlag('openrouter', [])

    expect(openrouterResult.error).toBeUndefined()
    expect(process.env.NVIDIA_NIM).toBeUndefined()
    expect(process.env.OPENAI_API_KEY).toBeUndefined()
    expect(process.env.OPENAI_BASE_URL).toBe('https://openrouter.ai/api/v1')
  })

  test('clears BNKR_API_KEY copied into OPENAI_API_KEY when switching routes', () => {
    process.env.BNKR_API_KEY = 'bankr-live-key'

    const bankrResult = applyProviderFlag('bankr', [])
    expect(bankrResult.error).toBeUndefined()
    expect(process.env.OPENAI_API_KEY).toBe('bankr-live-key')

    process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
    const openrouterResult = applyProviderFlag('openrouter', [])

    expect(openrouterResult.error).toBeUndefined()
    expect(process.env.OPENAI_API_KEY).toBeUndefined()
    expect(process.env.OPENAI_BASE_URL).toBe('https://openrouter.ai/api/v1')
  })

  test('clears MIMO_API_KEY copied into OPENAI_API_KEY when switching routes', () => {
    process.env.MIMO_API_KEY = 'mimo-live-key'

    const mimoResult = applyProviderFlag('xiaomi-mimo', [])
    expect(mimoResult.error).toBeUndefined()
    expect(process.env.OPENAI_API_KEY).toBe('mimo-live-key')

    process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
    const openrouterResult = applyProviderFlag('openrouter', [])

    expect(openrouterResult.error).toBeUndefined()
    expect(process.env.OPENAI_API_KEY).toBeUndefined()
    expect(process.env.OPENAI_BASE_URL).toBe('https://openrouter.ai/api/v1')
  })

  test('clears XAI_API_KEY copied into OPENAI_API_KEY when switching routes', () => {
    process.env.XAI_API_KEY = 'xai-live-key'

    const xaiResult = applyProviderFlag('xai', [])
    expect(xaiResult.error).toBeUndefined()
    expect(process.env.OPENAI_API_KEY).toBe('xai-live-key')

    process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
    const openrouterResult = applyProviderFlag('openrouter', [])

    expect(openrouterResult.error).toBeUndefined()
    expect(process.env.OPENAI_API_KEY).toBeUndefined()
    expect(process.env.OPENAI_BASE_URL).toBe('https://openrouter.ai/api/v1')
  })

  test('clears MINIMAX_API_KEY copied into OPENAI_API_KEY when switching routes', () => {
    process.env.MINIMAX_API_KEY = 'minimax-live-key'
    process.env.OPENAI_API_KEY = 'minimax-live-key'
    process.env.XAI_API_KEY = 'xai-live-key'

    const xaiResult = applyProviderFlag('xai', [])

    expect(xaiResult.error).toBeUndefined()
    expect(process.env.OPENAI_API_KEY).toBe('xai-live-key')
    expect(process.env.OPENAI_BASE_URL).toBe('https://api.x.ai/v1')
  })
})

describe('applyProviderFlag - minimax', () => {
  test('preserves MiniMax default base URL and model semantics', () => {
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
    process.env.OPENAI_MODEL = 'gpt-4o'
    process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
    process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-5'

    const result = applyProviderFlag('minimax', [])

    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
    expect(process.env.ANTHROPIC_BASE_URL).toBe('https://api.minimax.io/anthropic')
    expect(process.env.ANTHROPIC_MODEL).toBe('MiniMax-M3')
    expect(process.env.OPENAI_BASE_URL).toBeUndefined()
    expect(process.env.OPENAI_MODEL).toBeUndefined()
  })
})

describe('applyProviderFlag - nvidia-nim', () => {
  test('maps NVIDIA_API_KEY into the OPENAI-compatible auth env when present', () => {
    process.env.NVIDIA_API_KEY = 'nvidia-live-key'

    const result = applyProviderFlag('nvidia-nim', [])

    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.NVIDIA_NIM).toBe('1')
    expect(process.env.OPENAI_API_KEY).toBe('nvidia-live-key')
    expect(process.env.OPENAI_BASE_URL).toBe('https://integrate.api.nvidia.com/v1')
  })
})

describe('applyProviderFlag - zai', () => {
  test('preserves Z.AI default base URL and model semantics', () => {
    const result = applyProviderFlag('zai', [])

    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('https://api.z.ai/api/coding/paas/v4')
    expect(process.env.OPENAI_MODEL).toBe('glm-5.2')
  })
})

describe('applyProviderFlag - longcat', () => {
  test('sets LongCat OpenAI-compatible defaults and mirrors LONGCAT_API_KEY', () => {
    process.env.LONGCAT_API_KEY = 'longcat-secret-key'

    const result = applyProviderFlag('longcat', [])

    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('https://api.longcat.chat/openai/v1')
    expect(process.env.OPENAI_MODEL).toBe('LongCat-2.0')
    expect(process.env.OPENAI_API_KEY).toBe('longcat-secret-key')
  })

  test('sets LongCat OPENAI_MODEL when --model is provided', () => {
    applyProviderFlag('longcat', ['--model', 'LongCat-2.0'])

    expect(process.env.OPENAI_MODEL).toBe('LongCat-2.0')
  })

  test('clears incompatible OpenAI transport and auth overrides', () => {
    process.env.LONGCAT_API_KEY = 'longcat-secret-key'
    process.env.OPENAI_API_FORMAT = 'responses'
    process.env.OPENAI_AUTH_HEADER = 'api-key'
    process.env.OPENAI_AUTH_SCHEME = 'token'
    process.env.OPENAI_AUTH_HEADER_VALUE = 'stale-secret'

    const result = applyProviderFlag('longcat', [])

    expect(result.error).toBeUndefined()
    expect(process.env.OPENAI_API_FORMAT).toBeUndefined()
    expect(process.env.OPENAI_AUTH_HEADER).toBeUndefined()
    expect(process.env.OPENAI_AUTH_SCHEME).toBeUndefined()
    expect(process.env.OPENAI_AUTH_HEADER_VALUE).toBeUndefined()
  })

  test('does not mirror LONGCAT_API_KEY to a preserved custom base URL', () => {
    process.env.OPENAI_BASE_URL = 'https://untrusted.example/v1'
    process.env.LONGCAT_API_KEY = 'longcat-secret-key'

    const result = applyProviderFlag('longcat', [])

    expect(result.error).toBeUndefined()
    expect(process.env.OPENAI_BASE_URL).toBe('https://untrusted.example/v1')
    expect(process.env.OPENAI_API_KEY).toBeUndefined()
  })

  test('clears LONGCAT_API_KEY copied into OPENAI_API_KEY when switching routes', () => {
    process.env.LONGCAT_API_KEY = 'longcat-live-key'

    const longcatResult = applyProviderFlag('longcat', [])
    expect(longcatResult.error).toBeUndefined()
    expect(process.env.OPENAI_API_KEY).toBe('longcat-live-key')

    process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
    const openrouterResult = applyProviderFlag('openrouter', [])

    expect(openrouterResult.error).toBeUndefined()
    expect(process.env.OPENAI_API_KEY).toBeUndefined()
    expect(process.env.OPENAI_BASE_URL).toBe('https://openrouter.ai/api/v1')
  })
})

describe('applyProviderFlag - xiaomi-mimo', () => {
  test('sets Xiaomi MiMo OpenAI-compatible defaults and mirrors MIMO_API_KEY', () => {
    process.env.MIMO_API_KEY = 'mimo-secret-key'

    const result = applyProviderFlag('xiaomi-mimo', [])

    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('https://api.xiaomimimo.com/v1')
    expect(process.env.OPENAI_MODEL).toBe('mimo-v2.5-pro')
    expect(process.env.OPENAI_API_KEY).toBe('mimo-secret-key')
  })

  test('sets Xiaomi MiMo OPENAI_MODEL when --model is provided', () => {
    applyProviderFlag('xiaomi-mimo', ['--model', 'mimo-v2-flash'])

    expect(process.env.OPENAI_MODEL).toBe('mimo-v2-flash')
  })
})

describe('applyProviderFlag - xiaomi-mimo-token', () => {
  test('sets Xiaomi MiMo Token Plan OpenAI-compatible defaults and mirrors MIMO_API_KEY', () => {
    process.env.MIMO_API_KEY = 'tp-token-plan-key'

    const result = applyProviderFlag('xiaomi-mimo-token', [])

    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe(
      'https://token-plan-sgp.xiaomimimo.com/v1',
    )
    expect(process.env.OPENAI_MODEL).toBe('mimo-v2.5-pro')
    expect(process.env.OPENAI_API_KEY).toBe('tp-token-plan-key')
  })

  test('replaces stale known provider base URL with the token-plan default', () => {
    process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'

    const result = applyProviderFlag('xiaomi-mimo-token', [])

    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe(
      'https://token-plan-sgp.xiaomimimo.com/v1',
    )
  })

  test('sets Xiaomi MiMo Token Plan OPENAI_MODEL when --model is provided', () => {
    applyProviderFlag('xiaomi-mimo-token', ['--model', 'mimo-v2-flash'])

    expect(process.env.OPENAI_MODEL).toBe('mimo-v2-flash')
  })
})

describe('applyProviderFlag - venice', () => {
  test('sets Venice OpenAI-compatible defaults and mirrors VENICE_API_KEY', () => {
    process.env.VENICE_API_KEY = 'venice-secret-key'

    const result = applyProviderFlag('venice', [])

    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('https://api.venice.ai/api/v1')
    expect(process.env.OPENAI_MODEL).toBe('venice-uncensored')
    expect(process.env.OPENAI_API_KEY).toBe('venice-secret-key')
  })
})

describe('applyProviderFlag - atlas-cloud', () => {
  test('sets Atlas Cloud OpenAI-compatible defaults and mirrors ATLAS_CLOUD_API_KEY', () => {
    process.env.ATLAS_CLOUD_API_KEY = 'atlas-secret-key'

    const result = applyProviderFlag('atlas-cloud', [])

    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('https://api.atlascloud.ai/v1')
    expect(process.env.OPENAI_MODEL).toBe('deepseek-ai/deepseek-v4-pro')
    expect(process.env.OPENAI_API_KEY).toBe('atlas-secret-key')
  })

  test('dedicated key overrides a lingering OPENAI_API_KEY from another provider', () => {
    process.env.OPENAI_API_KEY = 'existing-openai-key'
    process.env.ATLAS_CLOUD_API_KEY = 'atlas-secret-key'

    applyProviderFlag('atlas-cloud', [])

    expect(process.env.OPENAI_API_KEY).toBe('atlas-secret-key')
  })

  test('clears a stale OPENAI_API_KEY when no Atlas Cloud key is set', () => {
    process.env.OPENAI_API_KEY = 'existing-openai-key'

    applyProviderFlag('atlas-cloud', [])

    expect(process.env.OPENAI_API_KEY).toBeUndefined()
  })

  test('keeps a copied Atlas key in OPENAI_API_KEY when selecting atlas-cloud', () => {
    process.env.ATLAS_CLOUD_API_KEY = 'atlas-secret-key'
    process.env.OPENAI_API_KEY = 'atlas-secret-key'

    applyProviderFlag('atlas-cloud', [])

    expect(process.env.OPENAI_API_KEY).toBe('atlas-secret-key')
  })

  test('clears a copied Atlas key from OPENAI_API_KEY when switching to another provider', () => {
    process.env.ATLAS_CLOUD_API_KEY = 'atlas-secret-key'
    process.env.OPENAI_API_KEY = 'atlas-secret-key'

    applyProviderFlag('openai', [])

    expect(process.env.OPENAI_API_KEY).toBeUndefined()
  })

  test('replaces a stale base URL belonging to another known provider', () => {
    process.env.OPENAI_BASE_URL = 'https://api.venice.ai/api/v1'
    process.env.ATLAS_CLOUD_API_KEY = 'atlas-secret-key'

    applyProviderFlag('atlas-cloud', [])

    expect(process.env.OPENAI_BASE_URL).toBe('https://api.atlascloud.ai/v1')
  })

  test('preserves a custom base URL that matches no known provider', () => {
    process.env.OPENAI_BASE_URL = 'https://llm-proxy.internal.example/v1'
    process.env.ATLAS_CLOUD_API_KEY = 'atlas-secret-key'

    applyProviderFlag('atlas-cloud', [])

    expect(process.env.OPENAI_BASE_URL).toBe('https://llm-proxy.internal.example/v1')
  })

  test('sets OPENAI_MODEL when --model is provided', () => {
    process.env.ATLAS_CLOUD_API_KEY = 'atlas-secret-key'

    applyProviderFlag('atlas-cloud', ['--model', 'zai-org/glm-5'])

    expect(process.env.OPENAI_MODEL).toBe('zai-org/glm-5')
  })
})

describe('applyProviderFlag - xai', () => {
  test('sets CLAUDE_CODE_USE_OPENAI=1 with xAI defaults when unset', () => {
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_API_KEY

    const result = applyProviderFlag('xai', [])
    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_BASE_URL as string | undefined).toBe('https://api.x.ai/v1')
    expect(process.env.OPENAI_MODEL).toBe('grok-4.3')
  })

  test('sets OPENAI_MODEL when --model is provided', () => {
    applyProviderFlag('xai', ['--model', 'grok-3'])
    expect(process.env.OPENAI_MODEL).toBe('grok-3')
  })

  test('propagates XAI_API_KEY to OPENAI_API_KEY when only XAI_API_KEY is set', () => {
    delete process.env.OPENAI_API_KEY
    process.env.XAI_API_KEY = 'xai-secret-key'

    applyProviderFlag('xai', [])

    expect(process.env.OPENAI_API_KEY as string | undefined).toBe('xai-secret-key')
  })

  test('does not override existing OPENAI_API_KEY when both keys are set', () => {
    process.env.OPENAI_API_KEY = 'existing-openai-key'
    process.env.XAI_API_KEY = 'xai-secret-key'

    applyProviderFlag('xai', [])

    expect(process.env.OPENAI_API_KEY).toBe('existing-openai-key')
  })
})

describe('applyProviderFlag - invalid provider', () => {
  test('returns error for unknown provider', () => {
    const result = applyProviderFlag('unknown-provider', [])
    expect(result.error).toContain('unknown-provider')
    expect(result.error).toContain(VALID_PROVIDERS.join(', '))
  })
})

describe('applyProviderFlagFromArgs', () => {
  test('applies ollama provider and model from argv in one step', () => {
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_API_KEY

    const result = applyProviderFlagFromArgs([
      '--provider',
      'ollama',
      '--model',
      'qwen2.5:3b',
    ])

    expect(result?.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_BASE_URL!).toBe('http://localhost:11434/v1')
    expect(process.env.OPENAI_API_KEY!).toBe('ollama')
    expect(process.env.OPENAI_MODEL).toBe('qwen2.5:3b')
  })

  test('returns undefined when --provider is absent', () => {
    expect(applyProviderFlagFromArgs(['--model', 'gpt-4o'])).toBeUndefined()
  })

  test('reapplies remembered gitlawb-opengateway after settings env restores stale OpenAI routing', () => {
    const args = ['--provider', 'gitlawb-opengateway']
    delete process.env.OPENGATEWAY_API_KEY
    delete process.env.OPENAI_API_KEY

    const earlyResult = applyProviderFlagFromArgs(args, {
      rememberForSettingsEnv: true,
    })
    expect(earlyResult?.error).toBeUndefined()
    expect(process.env.OPENAI_BASE_URL).toBe(
      'https://opengateway.gitlawb.com/v1',
    )
    expect(process.env.OPENAI_API_KEY).toBeUndefined()

    process.env.OPENGATEWAY_API_KEY = 'settings-ogw-key'
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'

    const lateResult = reapplyRememberedProviderFlag()

    expect(lateResult?.error).toBeUndefined()
    expect(process.env.OPENAI_BASE_URL).toBe(
      'https://opengateway.gitlawb.com/v1',
    )
    expect(process.env.OPENAI_API_KEY as string | undefined).toBe(
      'settings-ogw-key',
    )
  })

  test('remembered provider reapply preserves an explicit --model', () => {
    const result = applyProviderFlagFromArgs(
      [
        '--print',
        '--provider',
        'gitlawb-opengateway',
        '--model',
        'custom-ogw-model',
        'do not retain prompt text',
      ],
      { rememberForSettingsEnv: true },
    )

    expect(result?.error).toBeUndefined()
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
    process.env.OPENAI_MODEL = 'stale-openai-model'

    const lateResult = reapplyRememberedProviderFlag()

    expect(lateResult?.error).toBeUndefined()
    expect(process.env.OPENAI_BASE_URL).toBe(
      'https://opengateway.gitlawb.com/v1',
    )
    expect(process.env.OPENAI_MODEL).toBe('custom-ogw-model')
  })
})

// --- parseModelFlag ---

describe('parseModelFlag', () => {
  test('returns model value when --model is present', () => {
    expect(parseModelFlag(['--model', 'gpt-4o-mini'])).toBe('gpt-4o-mini')
  })

  test('returns null when --model is absent', () => {
    expect(parseModelFlag(['--provider', 'openai'])).toBeNull()
  })

  test('returns null when --model has no value', () => {
    expect(parseModelFlag(['--model'])).toBeNull()
  })

  test('returns null when --model value looks like another flag', () => {
    expect(parseModelFlag(['--model', '--provider'])).toBeNull()
  })
})

// --- applyModelFlagFromArgs (#808) ---

describe('applyModelFlagFromArgs', () => {
  test('is a no-op when --model is absent', () => {
    applyModelFlagFromArgs(['--ide'])
    expect(process.env.OPENAI_MODEL).toBeUndefined()
    expect(process.env.GEMINI_MODEL).toBeUndefined()
    expect(process.env.ANTHROPIC_MODEL).toBeUndefined()
  })

  test('is a no-op when --provider is also present (handled by applyProviderFlagFromArgs)', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    applyModelFlagFromArgs(['--provider', 'openai', '--model', 'gpt-4o'])
    expect(process.env.OPENAI_MODEL).toBeUndefined()
  })

  test('sets OPENAI_MODEL when CLAUDE_CODE_USE_OPENAI is active', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    applyModelFlagFromArgs(['--model', 'gpt-4o-mini'])
    expect(process.env.OPENAI_MODEL).toBe('gpt-4o-mini')
  })

  test('sets GEMINI_MODEL when CLAUDE_CODE_USE_GEMINI is active', () => {
    process.env.CLAUDE_CODE_USE_GEMINI = '1'
    applyModelFlagFromArgs(['--model', 'gemini-2.0-flash'])
    expect(process.env.GEMINI_MODEL).toBe('gemini-2.0-flash')
  })

  test('sets MISTRAL_MODEL when CLAUDE_CODE_USE_MISTRAL is active', () => {
    process.env.CLAUDE_CODE_USE_MISTRAL = '1'
    applyModelFlagFromArgs(['--model', 'devstral-latest'])
    expect(process.env.MISTRAL_MODEL).toBe('devstral-latest')
  })

  test('sets OPENAI_MODEL when CLAUDE_CODE_USE_GITHUB is active', () => {
    process.env.CLAUDE_CODE_USE_GITHUB = '1'
    applyModelFlagFromArgs(['--model', 'gpt-4.1'])
    expect(process.env.OPENAI_MODEL).toBe('gpt-4.1')
  })

  test('falls back to ANTHROPIC_MODEL when no provider flag is set', () => {
    applyModelFlagFromArgs(['--model', 'claude-sonnet-4-6'])
    expect(process.env.ANTHROPIC_MODEL).toBe('claude-sonnet-4-6')
  })

  test('overrides an existing *_MODEL value (saved profile override)', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_MODEL = 'gpt-4o'
    applyModelFlagFromArgs(['--model', 'gpt-4o-mini'])
    expect(process.env.OPENAI_MODEL).toBe('gpt-4o-mini')
  })

  test('accepts --model value containing colons (ollama tag syntax)', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    applyModelFlagFromArgs(['--model', 'qwen2.5-coder:14b'])
    expect(process.env.OPENAI_MODEL).toBe('qwen2.5-coder:14b')
  })
})
