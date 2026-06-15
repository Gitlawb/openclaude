import { describe, expect, test } from 'bun:test'

import {
  buildSandboxRuntimeCheck,
  checkNodeVersion,
  formatReachabilityFailureDetail,
  isCliSandboxRuntimeStubbed,
  readNodeExecutableVersion,
} from './system-check.ts'

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
