import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  buildMemoryGuardChecks,
  buildSandboxRuntimeCheck,
  checkOpenAIEnv,
  checkNodeVersion,
  formatReachabilityFailureDetail,
  isCliSandboxRuntimeStubbed,
  readNodeExecutableVersion,
  serializeSafeEnvSummary,
} from './system-check.ts'
import { DEFAULT_MAX_ACTIVE_MESSAGES_HARD_CAP } from '../src/utils/maxActiveMessages.ts'

const ENV_KEYS = [
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_MISTRAL',
  'CLAUDE_CODE_SIMPLE',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_MODEL',
  'MISTRAL_API_KEY',
  'MISTRAL_MODEL',
  'OPENAI_MODEL',
  'OPENAI_BASE_URL',
  'OPENAI_API_KEYS',
  'OPENAI_API_KEY',
  'OPENGATEWAY_API_KEY',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'CODEX_API_KEY',
  'CODEX_AUTH_JSON_PATH',
  'CODEX_HOME',
  'DISABLE_COMPACT',
  'DISABLE_AUTO_COMPACT',
  'OPENCLAUDE_MAX_ACTIVE_MESSAGES',
  'OPENCLAUDE_MAX_ACTIVE_MESSAGES_HARD_CAP',
  'OPENCLAUDE_MAX_MEMORY_MB',
] as const

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

describe('formatReachabilityFailureDetail', () => {
  test('returns generic failure detail for non-codex transport', () => {
    const detail = formatReachabilityFailureDetail(
      'https://api.openai.com/v1/models',
      429,
      '{"error":"rate_limit"}',
      {
        transport: 'chat_completions',
        requestedModel: 'gpt-4o',
        resolvedModel: 'gpt-4o',
      },
    )

    expect(detail).toBe(
      'Unexpected status 429 from https://api.openai.com/v1/models. Body: {"error":"rate_limit"}',
    )
  })

  test('redacts credentials and sensitive query parameters in endpoint details', () => {
    const detail = formatReachabilityFailureDetail(
      'http://user:pass@localhost:11434/v1/models?token=abc123&mode=test',
      502,
      'bad gateway',
      {
        transport: 'chat_completions',
        requestedModel: 'llama3.1:8b',
        resolvedModel: 'llama3.1:8b',
      },
    )

    expect(detail).toBe(
      'Unexpected status 502 from http://redacted:redacted@localhost:11434/v1/models?token=redacted&mode=test. Body: bad gateway',
    )
  })

  test('redacts secret-shaped values embedded in response bodies', () => {
    const leakedKey = 'sk-liveLeakToken1234567890ABCdef'
    const detail = formatReachabilityFailureDetail(
      'https://api.openai.com/v1/models',
      401,
      `{"error":"Invalid API key: ${leakedKey}"}`,
      {
        transport: 'chat_completions',
        requestedModel: 'gpt-4o',
        resolvedModel: 'gpt-4o',
      },
    )

    expect(detail).toBe(
      'Unexpected status 401 from https://api.openai.com/v1/models. Body: {"error":"Invalid API key: sk-...def"}',
    )
    expect(detail).not.toContain(leakedKey)
  })

  test('adds alias/entitlement hint for codex model support 400s', () => {
    const detail = formatReachabilityFailureDetail(
      'https://chatgpt.com/backend-api/codex/responses',
      400,
      '{"detail":"The \\"gpt-5.3-codex-spark\\" model is not supported when using Codex with a ChatGPT account."}',
      {
        transport: 'codex_responses',
        requestedModel: 'codexspark',
        resolvedModel: 'gpt-5.3-codex-spark',
      },
    )

    expect(detail).toContain(
      'model alias "codexspark" resolved to "gpt-5.3-codex-spark"',
    )
    expect(detail).toContain(
      'Try "codexplan" or another entitled Codex model.',
    )
  })

  test('redacts descriptor-declared provider secret values in codex model hints', () => {
    const providerSecret = 'ogw-provider-secret'
    process.env.OPENGATEWAY_API_KEY = providerSecret

    const detail = formatReachabilityFailureDetail(
      'https://chatgpt.com/backend-api/codex/responses',
      400,
      '{"detail":"model is not supported with this chatgpt account"}',
      {
        transport: 'codex_responses',
        requestedModel: providerSecret,
        resolvedModel: providerSecret,
      },
    )

    expect(detail).toContain('model alias "ogw...ret" resolved to "ogw...ret"')
    expect(detail).not.toContain(providerSecret)
  })
})

describe('system-check provider diagnostics', () => {
  test('redacts descriptor-declared provider secret values in displayed model fields', () => {
    const providerSecret = 'ogw-provider-secret'
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'https://opengateway.gitlawb.com/v1'
    process.env.OPENAI_MODEL = providerSecret
    process.env.OPENGATEWAY_API_KEY = providerSecret

    const results = checkOpenAIEnv()
    const serialized = JSON.stringify(results)

    expect(serialized).toContain('ogw...ret')
    expect(serialized).not.toContain(providerSecret)
  })

  test('summarizes descriptor-declared provider credentials without exposing values', () => {
    const providerSecret = 'ogw-provider-secret'
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'https://opengateway.gitlawb.com/v1'
    process.env.OPENAI_MODEL = providerSecret
    process.env.OPENGATEWAY_API_KEY = providerSecret

    const summary = serializeSafeEnvSummary()

    expect(summary.OPENAI_MODEL).toBe('ogw...ret')
    expect(summary.PROVIDER_API_KEY_SET).toBe(true)
    expect(JSON.stringify(summary)).not.toContain(providerSecret)
  })

  test('does not use active GitHub credentials for a default OpenAI base URL', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.CLAUDE_CODE_USE_GITHUB = '1'
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
    process.env.GITHUB_TOKEN = 'ghp_FAKEgithubToken0123456789'
    delete process.env.OPENAI_API_KEY

    const results = checkOpenAIEnv()
    const summary = serializeSafeEnvSummary()
    const credentialResult = results.find(
      result => result.label === 'OPENAI_API_KEYS or OPENAI_API_KEY',
    )

    expect(credentialResult).toEqual({
      ok: false,
      label: 'OPENAI_API_KEYS or OPENAI_API_KEY',
      detail:
        'Missing key for non-local provider URL. Set OPENAI_API_KEYS or OPENAI_API_KEY.',
    })
    expect(summary.PROVIDER_API_KEY_SET).toBe(false)
  })

  test('falls back to OPENAI_API_KEY when OPENAI_API_KEYS is delimiter-only', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
    process.env.OPENAI_MODEL = 'gpt-4o'
    process.env.OPENAI_API_KEYS = ', ,'
    process.env.OPENAI_API_KEY = 'sk-openai-single'

    const results = checkOpenAIEnv()
    const summary = serializeSafeEnvSummary()
    const credentialResult = results.find(
      result => result.label === 'OPENAI_API_KEYS or OPENAI_API_KEY',
    )

    expect(credentialResult).toEqual({
      ok: true,
      label: 'OPENAI_API_KEYS or OPENAI_API_KEY',
      detail: 'Configured.',
    })
    expect(summary.PROVIDER_API_KEY_SET).toBe(true)
  })

  test('accepts valid OPENAI_API_KEYS before placeholder OPENAI_API_KEY fallback', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
    process.env.OPENAI_MODEL = 'gpt-4o'
    process.env.OPENAI_API_KEYS = 'sk-openai-a,sk-openai-b'
    process.env.OPENAI_API_KEY = 'SUA_CHAVE'

    const results = checkOpenAIEnv()
    const summary = serializeSafeEnvSummary()
    const credentialResult = results.find(
      result => result.label === 'OPENAI_API_KEYS or OPENAI_API_KEY',
    )

    expect(credentialResult).toEqual({
      ok: true,
      label: 'OPENAI_API_KEYS or OPENAI_API_KEY',
      detail: 'Configured.',
    })
    expect(summary.PROVIDER_API_KEY_SET).toBe(true)
  })

  test('rejects placeholder values inside OPENAI_API_KEYS pools', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
    process.env.OPENAI_MODEL = 'gpt-4o'
    process.env.OPENAI_API_KEYS = 'sk-openai-a,SUA_CHAVE'
    delete process.env.OPENAI_API_KEY

    const results = checkOpenAIEnv()
    const credentialResult = results.find(
      result => result.label === 'OPENAI_API_KEYS or OPENAI_API_KEY',
    )

    expect(credentialResult).toEqual({
      ok: false,
      label: 'OPENAI_API_KEYS or OPENAI_API_KEY',
      detail: 'Placeholder value detected: SUA_CHAVE.',
    })
  })
})

describe('system-check memory guard diagnostics', () => {
  test('reports safe default auto-compact and hard-cap guards', () => {
    const results = buildMemoryGuardChecks({
      autoCompactEnabled: true,
      maxMessagesCompactionThreshold: undefined,
      env: {},
    })

    expect(results).toContainEqual({
      ok: true,
      label: 'Auto-compact guard',
      detail: `Enabled; message-count threshold off; hard cap ${DEFAULT_MAX_ACTIVE_MESSAGES_HARD_CAP}.`,
    })
    expect(results).toContainEqual({
      ok: true,
      label: 'Active-message hard cap',
      detail: `Active at ${DEFAULT_MAX_ACTIVE_MESSAGES_HARD_CAP} messages (default; malformed overrides fall back to ${DEFAULT_MAX_ACTIVE_MESSAGES_HARD_CAP}).`,
    })
    expect(results.find(result => result.label === 'Memory pressure guard'))
      .toMatchObject({ ok: true })
  })

  test('falls back to the default hard cap when the override is malformed', () => {
    const results = buildMemoryGuardChecks({
      autoCompactEnabled: true,
      maxMessagesCompactionThreshold: undefined,
      env: {
        OPENCLAUDE_MAX_ACTIVE_MESSAGES_HARD_CAP: 'not-a-number',
      },
    })

    expect(results).toContainEqual({
      ok: true,
      label: 'Active-message hard cap',
      detail: `Active at ${DEFAULT_MAX_ACTIVE_MESSAGES_HARD_CAP} messages; malformed override fell back to ${DEFAULT_MAX_ACTIVE_MESSAGES_HARD_CAP}.`,
    })
  })

  test('reports valid custom hard-cap overrides without fallback wording', () => {
    const results = buildMemoryGuardChecks({
      autoCompactEnabled: true,
      maxMessagesCompactionThreshold: undefined,
      env: {
        OPENCLAUDE_MAX_ACTIVE_MESSAGES_HARD_CAP: '500',
      },
    })

    expect(results).toContainEqual({
      ok: true,
      label: 'Active-message hard cap',
      detail: 'Active at 500 messages.',
    })
  })

  test('fails when auto-compact is disabled by settings or env flags', () => {
    const results = buildMemoryGuardChecks({
      autoCompactEnabled: false,
      maxMessagesCompactionThreshold: '500',
      env: {
        DISABLE_COMPACT: '1',
        DISABLE_AUTO_COMPACT: 'true',
      },
    })

    expect(results[0]).toEqual({
      ok: false,
      label: 'Auto-compact guard',
      detail:
        'settings disabled; DISABLE_COMPACT is set; DISABLE_AUTO_COMPACT is set',
    })
  })

  test('fails when active-message hard cap is explicitly disabled', () => {
    const results = buildMemoryGuardChecks({
      autoCompactEnabled: true,
      maxMessagesCompactionThreshold: '100',
      env: {
        OPENCLAUDE_MAX_ACTIVE_MESSAGES_HARD_CAP: '0',
        OPENCLAUDE_MAX_MEMORY_MB: '4096',
      },
    })

    expect(results).toContainEqual({
      ok: false,
      label: 'Active-message hard cap',
      detail:
        'Disabled by OPENCLAUDE_MAX_ACTIVE_MESSAGES_HARD_CAP=0; long sessions can grow without the active-message safety cap.',
    })
    expect(results).toContainEqual({
      ok: true,
      label: 'Memory pressure guard',
      detail:
        'Per-session budget 4096MB; elevated/critical compaction thresholds are derived from this budget at runtime.',
    })
  })
})

describe('checkNodeVersion', () => {
  test('reads the Node.js version from the node executable output', () => {
    const probe = readNodeExecutableVersion(() => ({
      status: 0,
      stdout: 'v22.0.0\n',
      stderr: '',
      error: undefined,
    }))

    expect(probe).toEqual({
      ok: true,
      version: 'v22.0.0',
    })
  })

  test('checks the probed node executable version', () => {
    expect(checkNodeVersion({ ok: true, version: 'v20.11.1' })).toEqual({
      ok: false,
      label: 'Node.js version',
      detail:
        'Detected 20.11.1. OpenClaude requires Node.js >=22.0.0. Install Node 22 LTS or newer, then reinstall/re-run OpenClaude.',
    })
  })

  test('reports a missing node executable as a Node.js version failure', () => {
    const probe = readNodeExecutableVersion(() => ({
      status: null,
      stdout: '',
      stderr: '',
      error: new Error('spawn node ENOENT'),
    }))

    expect(checkNodeVersion(probe)).toEqual({
      ok: false,
      label: 'Node.js version',
      detail:
        'Unable to run `node --version`: spawn node ENOENT. OpenClaude requires Node.js >=22.0.0 on PATH.',
    })
  })

  test('uses the shared Node.js minimum in doctor failures', () => {
    expect(checkNodeVersion('20.11.1')).toEqual({
      ok: false,
      label: 'Node.js version',
      detail:
        'Detected 20.11.1. OpenClaude requires Node.js >=22.0.0. Install Node 22 LTS or newer, then reinstall/re-run OpenClaude.',
    })
  })

  test('passes supported Node.js versions', () => {
    expect(checkNodeVersion('22.0.0')).toEqual({
      ok: true,
      label: 'Node.js version',
      detail: '22.0.0',
    })
  })
})

describe('sandbox runtime diagnostics', () => {
  test('fails when sandbox runtime inspection throws an Error', () => {
    const result = buildSandboxRuntimeCheck({
      inspectionError: new Error('EACCES: permission denied, open dist/cli.mjs'),
    })

    expect(result).toEqual({
      ok: false,
      label: 'Sandbox runtime',
      detail:
        'Unable to inspect CLI sandbox runtime: EACCES: permission denied, open dist/cli.mjs',
    })
  })

  test('fails when sandbox runtime inspection throws a non-Error value', () => {
    const result = buildSandboxRuntimeCheck({
      inspectionError: 'bundle read failed',
    })

    expect(result).toEqual({
      ok: false,
      label: 'Sandbox runtime',
      detail: 'Unable to inspect CLI sandbox runtime: bundle read failed',
    })
  })

  test('detects sandbox-runtime native stubs in the CLI bundle', () => {
    expect(
      isCliSandboxRuntimeStubbed(
        '// native-stub:@anthropic-ai/sandbox-runtime\nconst noop = () => null',
      ),
    ).toBe(true)
    expect(isCliSandboxRuntimeStubbed('bubblewrap (bwrap) not installed')).toBe(
      false,
    )
  })

  test('fails when the CLI bundle contains a sandbox runtime stub', () => {
    const result = buildSandboxRuntimeCheck({
      cliRuntimeStubbed: true,
      sandboxEnabled: true,
      failIfUnavailable: true,
      sandboxingEnabled: false,
      unavailableReason: 'sandbox.enabled is set but the runtime is stubbed',
    })

    expect(result.ok).toBe(false)
    expect(result.label).toBe('Sandbox runtime')
    expect(result.detail).toContain('CLI bundle: stubbed')
    expect(result.detail).toContain('effective behavior: fail-closed')
    expect(result.detail).toContain(
      'reason: sandbox.enabled is set but the runtime is stubbed',
    )
  })

  test('reports warning-only behavior when sandbox is enabled but unavailable', () => {
    const result = buildSandboxRuntimeCheck({
      cliRuntimeStubbed: false,
      sandboxEnabled: true,
      failIfUnavailable: false,
      sandboxingEnabled: false,
      unavailableReason: 'bubblewrap (bwrap) not installed',
    })

    expect(result.ok).toBe(true)
    expect(result.detail).toContain('CLI bundle: real runtime')
    expect(result.detail).toContain('effective behavior: warning-only')
    expect(result.detail).toContain('reason: bubblewrap (bwrap) not installed')
  })

  test('flags fail-closed behavior when sandbox is required but unavailable', () => {
    const result = buildSandboxRuntimeCheck({
      cliRuntimeStubbed: false,
      sandboxEnabled: true,
      failIfUnavailable: true,
      sandboxingEnabled: false,
      unavailableReason: 'bubblewrap (bwrap) not installed',
    })

    expect(result.ok).toBe(false)
    expect(result.detail).toContain('CLI bundle: real runtime')
    expect(result.detail).toContain('effective behavior: fail-closed')
    expect(result.detail).toContain('reason: bubblewrap (bwrap) not installed')
  })

  test('reports enforcing behavior when sandboxing is active', () => {
    const result = buildSandboxRuntimeCheck({
      cliRuntimeStubbed: false,
      sandboxEnabled: true,
      failIfUnavailable: true,
      sandboxingEnabled: true,
    })

    expect(result.ok).toBe(true)
    expect(result.detail).toBe(
      'CLI bundle: real runtime; sandbox.enabled: true; failIfUnavailable: true; effective behavior: enforcing',
    )
  })

  test('reports disabled behavior without failing when sandbox is not enabled', () => {
    const result = buildSandboxRuntimeCheck({
      cliRuntimeStubbed: false,
      sandboxEnabled: false,
      failIfUnavailable: false,
      sandboxingEnabled: false,
    })

    expect(result.ok).toBe(true)
    expect(result.detail).toBe(
      'CLI bundle: real runtime; sandbox.enabled: false; failIfUnavailable: false; effective behavior: disabled',
    )
  })

  test('reports disabled behavior without failing when sandbox is off and the CLI runtime is stubbed', () => {
    const result = buildSandboxRuntimeCheck({
      cliRuntimeStubbed: true,
      sandboxEnabled: false,
      failIfUnavailable: false,
      sandboxingEnabled: false,
    })

    expect(result.ok).toBe(true)
    expect(result.detail).toBe(
      'CLI bundle: stubbed; sandbox.enabled: false; failIfUnavailable: false; effective behavior: disabled',
    )
  })
})
