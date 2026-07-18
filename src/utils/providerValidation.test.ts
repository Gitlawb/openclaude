import { afterEach, beforeAll, beforeEach, expect, test } from 'bun:test'
import { ensureIntegrationsLoaded, getAllGateways } from '../integrations/index.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

import {
  getProviderValidationError,
  shouldExitForStartupProviderValidationError,
} from './providerValidation.js'

const ENV_KEYS = [
  'CLAUDE_CODE_USE_OPENAI',
  'OPENAI_API_KEYS',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'CODEX_API_KEY',
  'CODEX_AUTH_JSON_PATH',
  'CODEX_HOME',
  'CHATGPT_ACCOUNT_ID',
  'CODEX_ACCOUNT_ID',
  'CLAUDE_CODE_USE_GITHUB',
  'GITHUB_COPILOT_KEY',
  'GITHUB_ENTERPRISE_URL',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_MISTRAL',
  'CLAUDE_CODE_SIMPLE',
  'MISTRAL_API_KEY',
  'MINIMAX_API_KEY',
  'LONGCAT_API_KEY',
  'NVIDIA_API_KEY',
  'NVIDIA_NIM',
  'BNKR_API_KEY',
  'OPENGATEWAY_API_KEY',
  'OPENROUTER_API_KEY',
  'DEEPSEEK_API_KEY',
  'MOONSHOT_API_KEY',
  'MIMO_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_ACCESS_TOKEN',
  'GEMINI_AUTH_MODE',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'XAI_API_KEY',
  'XAI_CREDENTIAL_SOURCE',
  'NEARAI_API_KEY',
  'CLOUDFLARE_API_TOKEN',
] as const

const originalEnv: Record<string, string | undefined> = {}

beforeAll(() => {
  ensureIntegrationsLoaded()
})

beforeEach(async () => {
  await acquireSharedMutationLock('utils/providerValidation.test.ts')
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  try {
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

test('accepts GEMINI_ACCESS_TOKEN as valid Gemini auth', async () => {
  process.env.CLAUDE_CODE_USE_GEMINI = '1'
  process.env.GEMINI_AUTH_MODE = 'access-token'
  delete process.env.GEMINI_API_KEY
  delete process.env.GOOGLE_API_KEY
  process.env.GEMINI_ACCESS_TOKEN = 'token-123'

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('accepts ADC credentials for Gemini auth', async () => {
  process.env.CLAUDE_CODE_USE_GEMINI = '1'
  process.env.GEMINI_AUTH_MODE = 'adc'
  delete process.env.GEMINI_API_KEY
  delete process.env.GOOGLE_API_KEY
  delete process.env.GEMINI_ACCESS_TOKEN

  await expect(
    getProviderValidationError(process.env, {
      resolveGeminiCredential: async () => ({
        kind: 'adc',
        credential: 'adc-token',
        projectId: 'adc-project',
      }),
    }),
  ).resolves.toBeNull()
})

test('still errors when no Gemini credential source is available', async () => {
  process.env.CLAUDE_CODE_USE_GEMINI = '1'
  process.env.GEMINI_AUTH_MODE = 'access-token'
  delete process.env.GEMINI_API_KEY
  delete process.env.GOOGLE_API_KEY
  delete process.env.GEMINI_ACCESS_TOKEN
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS

  await expect(getProviderValidationError(process.env)).resolves.toBe(
    'GEMINI_API_KEY, GOOGLE_API_KEY, GEMINI_ACCESS_TOKEN, or Google ADC credentials are required when CLAUDE_CODE_USE_GEMINI=1.',
  )
})

test('openai missing key error includes recovery guidance and config locations', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_MODEL
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CODEX_API_KEY
  delete process.env.CHATGPT_ACCOUNT_ID
  delete process.env.CODEX_ACCOUNT_ID

  const message = await getProviderValidationError(process.env)
  expect(message).not.toBeNull()
  expect(message!).toContain(
    'OPENAI_API_KEYS or OPENAI_API_KEY is required when CLAUDE_CODE_USE_OPENAI=1 and OPENAI_BASE_URL is not local.',
  )
  expect(message!).toContain(
    'set CLAUDE_CODE_USE_OPENAI=0 in your shell environment',
  )
  expect(message!).toContain('Saved startup settings can come from')
})

test('cloudflare Workers AI URL selects the Cloudflare validation target', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL =
    'https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1'
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEYS
  delete process.env.CLOUDFLARE_API_TOKEN
  delete process.env.OPENAI_MODEL

  await expect(getProviderValidationError(process.env)).resolves.toBe(
    'Cloudflare Workers AI auth is required. Set CLOUDFLARE_API_TOKEN or OPENAI_API_KEY.',
  )
})

test('non-Workers Cloudflare path falls back to generic OpenAI validation', async () => {
  // Same api.cloudflare.com host, but the REST management path — NOT Workers
  // AI. Host-only matching would demand Cloudflare Workers AI auth; the path
  // guard must let this fall through to the generic OpenAI credential error.
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL =
    'https://api.cloudflare.com/client/v4/user/tokens/verify'
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEYS
  delete process.env.CLOUDFLARE_API_TOKEN
  delete process.env.OPENAI_MODEL
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CODEX_API_KEY

  const message = await getProviderValidationError(process.env)
  expect(message).not.toBeNull()
  expect(message!).not.toContain('Cloudflare Workers AI auth is required')
  expect(message!).toContain(
    'OPENAI_API_KEYS or OPENAI_API_KEY is required when CLAUDE_CODE_USE_OPENAI=1',
  )
})

test('non-OpenAI LongCat path falls back to generic OpenAI validation', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.longcat.chat/anthropic/v1'
  process.env.OPENAI_API_KEY = 'generic-openai-key'

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('codex auth error redacts descriptor-declared provider secret values used as model text', async () => {
  const providerSecret = 'ogw-provider-secret'
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.CLAUDE_CODE_SIMPLE = '1'
  process.env.CODEX_AUTH_JSON_PATH = `/tmp/openclaude-provider-validation-missing-auth-${process.pid}.json`
  process.env.OPENAI_BASE_URL = 'https://chatgpt.com/backend-api/codex'
  process.env.OPENAI_MODEL = providerSecret
  process.env.OPENGATEWAY_API_KEY = providerSecret
  delete process.env.CODEX_API_KEY
  delete process.env.CHATGPT_ACCOUNT_ID
  delete process.env.CODEX_ACCOUNT_ID

  const message = await getProviderValidationError(process.env)
  expect(message).not.toBeNull()
  expect(message!).toContain('Codex auth is required for ogw...ret')
  expect(message!).not.toContain(providerSecret)
})

test('mistral validation is descriptor-backed and requires MISTRAL_API_KEY', async () => {
  process.env.CLAUDE_CODE_USE_MISTRAL = '1'
  delete process.env.MISTRAL_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBe(
    'MISTRAL_API_KEY is required when CLAUDE_CODE_USE_MISTRAL=1.',
  )
})

test('mistral validation still wins when stale openai mode is also set', async () => {
  process.env.CLAUDE_CODE_USE_MISTRAL = '1'
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.MISTRAL_API_KEY
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBe(
    'MISTRAL_API_KEY is required when CLAUDE_CODE_USE_MISTRAL=1.',
  )
})

test('minimax validation accepts MINIMAX_API_KEY without OPENAI_API_KEY', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.minimax.io/v1'
  process.env.MINIMAX_API_KEY = 'minimax-live-key'
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('minimax validation accepts MINIMAX_API_KEY on minimax chat host alias', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.minimax.chat/v1'
  process.env.MINIMAX_API_KEY = 'minimax-live-key'
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('nvidia nim validation accepts NVIDIA_API_KEY without OPENAI_API_KEY', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://integrate.api.nvidia.com/v1'
  process.env.NVIDIA_API_KEY = 'nvidia-live-key'
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('nvidia nim validation accepts NVIDIA_API_KEY for custom NIM endpoints when NVIDIA_NIM is set', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.NVIDIA_NIM = '1'
  process.env.OPENAI_BASE_URL = 'https://nim.example.com/v1'
  process.env.NVIDIA_API_KEY = 'nvidia-live-key'
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('bankr validation accepts BNKR_API_KEY without OPENAI_API_KEY', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://llm.bankr.bot/v1'
  process.env.BNKR_API_KEY = 'bankr-live-key'
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

// xAI accepts either XAI_API_KEY (legacy) or OAuth credentials. The OAuth
// credentials path is the saved-profile flow: applying the profile sets
// XAI_CREDENTIAL_SOURCE=oauth in process.env, so validation must not
// require XAI_API_KEY when that marker is present.
test('xai validation accepts XAI_API_KEY without OPENAI_API_KEY', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.x.ai/v1'
  process.env.OPENAI_MODEL = 'grok-4.3'
  process.env.XAI_API_KEY = 'xai-live-key'
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('xai validation accepts XAI_CREDENTIAL_SOURCE=oauth without an API key', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.x.ai/v1'
  process.env.OPENAI_MODEL = 'grok-4.3'
  process.env.XAI_CREDENTIAL_SOURCE = 'oauth'
  delete process.env.XAI_API_KEY
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('xai validation surfaces sign-in guidance when no credential source is set', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.x.ai/v1'
  process.env.OPENAI_MODEL = 'grok-4.3'
  delete process.env.XAI_API_KEY
  delete process.env.XAI_CREDENTIAL_SOURCE
  delete process.env.OPENAI_API_KEY

  // Inject "no stored credentials" so this test isn't sensitive to the
  // developer's actual login state.
  const error = await getProviderValidationError(process.env, {
    hasStoredXaiOAuthCredentials: async () => false,
  })
  expect(error).not.toBeNull()
  expect(error!).toContain('XAI_API_KEY is required')
  expect(error!).toContain('openclaude auth xai login')
})

test('xai validation accepts stored OAuth credentials even without an env marker', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.x.ai/v1'
  process.env.OPENAI_MODEL = 'grok-4.3'
  delete process.env.XAI_API_KEY
  delete process.env.XAI_CREDENTIAL_SOURCE
  delete process.env.OPENAI_API_KEY

  await expect(
    getProviderValidationError(process.env, {
      hasStoredXaiOAuthCredentials: async () => true,
    }),
  ).resolves.toBeNull()
})

test('xai validation ignores unrelated XAI_CREDENTIAL_SOURCE values', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.x.ai/v1'
  process.env.OPENAI_MODEL = 'grok-4.3'
  process.env.XAI_CREDENTIAL_SOURCE = 'something-else'
  delete process.env.XAI_API_KEY
  delete process.env.OPENAI_API_KEY

  const error = await getProviderValidationError(process.env, {
    hasStoredXaiOAuthCredentials: async () => false,
  })
  expect(error).not.toBeNull()
})

test('openai validation does not accept unrelated minimax credentials', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.MINIMAX_API_KEY = 'minimax-live-key'
  delete process.env.OPENAI_API_KEY

  const error = await getProviderValidationError(process.env)
  expect(error).not.toBeNull()
  expect(error!).toContain(
    'OPENAI_API_KEYS or OPENAI_API_KEY is required when CLAUDE_CODE_USE_OPENAI=1 and OPENAI_BASE_URL is not local.',
  )
})

test('openai validation accepts OPENAI_API_KEYS without OPENAI_API_KEY', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_API_KEYS = 'sk-openai-a,sk-openai-b'
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('openai validation accepts valid OPENAI_API_KEYS before placeholder OPENAI_API_KEY fallback', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_API_KEYS = 'sk-openai-a,sk-openai-b'
  process.env.OPENAI_API_KEY = 'SUA_CHAVE'

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('openai validation rejects placeholder values in OPENAI_API_KEYS', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_API_KEYS = 'sk-openai-a,SUA_CHAVE'
  delete process.env.OPENAI_API_KEY

  const error = await getProviderValidationError(process.env)
  expect(error).toBe(
    'Invalid OPENAI_API_KEYS: placeholder value SUA_CHAVE detected. Set real key(s) or unset for local providers.',
  )
})

test('openai validation rejects delimiter-only OPENAI_API_KEYS', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_API_KEYS = ', ,'
  delete process.env.OPENAI_API_KEY

  const error = await getProviderValidationError(process.env)
  expect(error).not.toBeNull()
  expect(error!).toContain(
    'OPENAI_API_KEYS or OPENAI_API_KEY is required when CLAUDE_CODE_USE_OPENAI=1 and OPENAI_BASE_URL is not local.',
  )
})

test('openai validation accepts OPENAI_API_KEY when OPENAI_API_KEYS is delimiter-only', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_API_KEYS = ', ,'
  process.env.OPENAI_API_KEY = 'sk-openai-single'

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('openrouter validation accepts OPENROUTER_API_KEY without OPENAI_API_KEY', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  process.env.OPENROUTER_API_KEY = 'or-live-key'
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('deepseek validation accepts DEEPSEEK_API_KEY without OPENAI_API_KEY', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.deepseek.com/v1'
  process.env.DEEPSEEK_API_KEY = 'deepseek-live-key'
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('moonshot validation accepts MOONSHOT_API_KEY without OPENAI_API_KEY', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.moonshot.ai/v1'
  process.env.MOONSHOT_API_KEY = 'moonshot-live-key'
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('xiaomi mimo validation accepts MIMO_API_KEY without OPENAI_API_KEY', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.xiaomimimo.com/v1'
  process.env.MIMO_API_KEY = 'mimo-live-key'
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('nearai validation accepts NEARAI_API_KEY for cloud-api base URL', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://cloud-api.near.ai/v1'
  process.env.NEARAI_API_KEY = 'nearai-live-key'
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('nearai validation accepts NEARAI_API_KEY for wildcard TEE completions endpoint', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://qwen35-122b.completions.near.ai/v1'
  process.env.NEARAI_API_KEY = 'nearai-tee-key'
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('opengateway validation fails without OPENGATEWAY_API_KEY or OPENAI_API_KEY', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://opengateway.gitlawb.com/v1'
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENGATEWAY_API_KEY

  const error = await getProviderValidationError(process.env)
  expect(error).not.toBeNull()
  expect(error!).toContain('OPENGATEWAY_API_KEY')
})

test('opengateway validation passes when OPENGATEWAY_API_KEY is set', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://opengateway.gitlawb.com/v1'
  process.env.OPENGATEWAY_API_KEY = 'ogw_live_test_0000000000000000'
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('opengateway validation accepts OPENAI_API_KEY as fallback', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://opengateway.gitlawb.com/v1'
  process.env.OPENAI_API_KEY = 'ogw_live_test_0000000000000000'
  delete process.env.OPENGATEWAY_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test.each([
  ['opengateway', 'https://opengateway.gitlawb.com/v1', 'mimo-v2.5-pro'],
  ['hicap', 'https://api.hicap.ai/v1', 'claude-opus-4.8'],
  ['venice', 'https://api.venice.ai/api/v1', 'venice-uncensored'],
  ['xiaomi mimo', 'https://api.xiaomimimo.com/v1', 'mimo-v2.5-pro'],
  ['opencode', 'https://opencode.ai/zen/v1', 'gpt-5.4'],
  ['opencode go', 'https://opencode.ai/zen/go/v1', 'glm-5.1'],
])('%s validation accepts OPENAI_API_KEYS fallback', async (_name, baseUrl, model) => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = baseUrl
  process.env.OPENAI_MODEL = model
  process.env.OPENAI_API_KEYS = 'key-a,key-b'
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENGATEWAY_API_KEY
  delete process.env.HICAP_API_KEY
  delete process.env.VENICE_API_KEY
  delete process.env.MIMO_API_KEY
  delete process.env.OPENCODE_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('opengateway validation still requires a key on the model-specific path', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://opengateway.gitlawb.com/v1/xiaomi-mimo'
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENGATEWAY_API_KEY

  const error = await getProviderValidationError(process.env)
  expect(error).not.toBeNull()
  expect(error!).toContain('OPENGATEWAY_API_KEY')
})

test('github validation stays descriptor-selected and reports missing auth', async () => {
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.GITHUB_ENTERPRISE_URL
  delete process.env.OPENAI_BASE_URL
  delete process.env.GITHUB_TOKEN
  delete process.env.GH_TOKEN

  await expect(getProviderValidationError(process.env)).resolves.toBe(
    'GitHub Copilot authentication required.\n' +
      'Run /onboard-github in the CLI to sign in with your GitHub account.\n' +
      'This will store your OAuth token securely and enable Copilot models.',
  )
})

test('github enterprise validation reports Enterprise auth guidance when Enterprise URL is set', async () => {
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  process.env.GITHUB_ENTERPRISE_URL = 'https://github.mycompany.com'
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.GITHUB_COPILOT_KEY
  delete process.env.GITHUB_TOKEN
  delete process.env.GH_TOKEN

  await expect(getProviderValidationError(process.env)).resolves.toBe(
    'GitHub Copilot Enterprise authentication required.\n' +
      'Set GITHUB_ENTERPRISE_URL to your GHE instance URL (e.g. https://github.mycompany.com).\n' +
      'Then run /onboard-github to sign in, or set GITHUB_COPILOT_KEY for direct API key auth.',
  )
})

test('github enterprise validation accepts PAT when Enterprise URL is set without OPENAI_BASE_URL', async () => {
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  process.env.GITHUB_ENTERPRISE_URL = 'https://github.mycompany.com'
  process.env.GITHUB_TOKEN = 'ghp_enterprisepat'
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.OPENAI_BASE_URL
  delete process.env.GH_TOKEN

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('github enterprise validation accepts a direct Copilot key without token validation', async () => {
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  process.env.GITHUB_ENTERPRISE_URL = 'https://github.mycompany.com'
  process.env.GITHUB_COPILOT_KEY = 'enterprise-direct-key'
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.GITHUB_TOKEN
  delete process.env.GH_TOKEN

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('github validation is skipped when openai mode is also active', async () => {
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  delete process.env.GITHUB_TOKEN
  delete process.env.GH_TOKEN
  delete process.env.OPENAI_API_KEY

  const error = await getProviderValidationError(process.env)
  expect(error).not.toBeNull()
  expect(error!).toContain(
    'OPENAI_API_KEYS or OPENAI_API_KEY is required when CLAUDE_CODE_USE_OPENAI=1 and OPENAI_BASE_URL is not local.',
  )
})

test('remote Ollama by hostname does not require OPENAI_API_KEY (#369)', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'http://my-ollama-server.example.com:11434/v1'
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('remote Ollama on default port without API key is allowed (#369)', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'http://203.0.113.5:11434/v1'
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('remote Ollama identified by "ollama" in hostname is allowed without key (#369)', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://ollama.corp.example.com/v1'
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('non-Ollama remote provider still requires OPENAI_API_KEY', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  delete process.env.OPENAI_API_KEY

  const message = await getProviderValidationError(process.env)
  expect(message).toContain(
    'OPENAI_API_KEYS or OPENAI_API_KEY is required when CLAUDE_CODE_USE_OPENAI=1 and OPENAI_BASE_URL is not local.',
  )
})

test('startup provider validation allows interactive recovery', () => {
  expect(
    shouldExitForStartupProviderValidationError({
      args: [],
      stdoutIsTTY: true,
    }),
  ).toBe(false)
})

test('startup provider validation stays strict for non-interactive launches', () => {
  expect(
    shouldExitForStartupProviderValidationError({
      args: ['-p', 'hello'],
      stdoutIsTTY: true,
    }),
  ).toBe(true)
  expect(
    shouldExitForStartupProviderValidationError({
      args: ['--print', 'hello'],
      stdoutIsTTY: true,
    }),
  ).toBe(true)
  expect(
    shouldExitForStartupProviderValidationError({
      args: [],
      stdoutIsTTY: false,
    }),
  ).toBe(true)
  expect(
    shouldExitForStartupProviderValidationError({
      args: ['--sdk-url', 'ws://127.0.0.1:3000'],
      stdoutIsTTY: true,
    }),
  ).toBe(true)
  expect(
    shouldExitForStartupProviderValidationError({
      args: ['--sdk-url=ws://127.0.0.1:3000'],
      stdoutIsTTY: true,
    }),
  ).toBe(true)
})
