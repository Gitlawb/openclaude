import { describe, expect, test } from 'bun:test'
import { homedir } from 'node:os'
import { getKnownProviderSecretEnvKeys } from '../providerSecrets.js'
import {
  collectProviderSecretEnvVars,
  redactDiagnosticObject,
  redactDiagnosticUrl,
  redactHomePath,
  summarizeSecretEnvPresence,
} from './redaction.js'

describe('diagnostic redaction', () => {
  test('collects every known provider secret env var from the centralized registry', () => {
    const expected = new Set(getKnownProviderSecretEnvKeys())

    expect(new Set(collectProviderSecretEnvVars())).toEqual(expected)
    expect(expected.has('GEMINI_ACCESS_TOKEN')).toBe(true)
    expect(expected.has('GITHUB_TOKEN')).toBe(true)
    expect(expected.has('OPENGATEWAY_API_KEY')).toBe(true)
    expect(expected.size).toBeGreaterThan(10)
  })

  test('represents provider secret env vars as presence booleans only', () => {
    const envVars = collectProviderSecretEnvVars()
    const env = Object.fromEntries(
      envVars.map((name, index) => [name, `sk-${name}-secret-${index}`]),
    )

    const summary = summarizeSecretEnvPresence(env, envVars)
    const serialized = JSON.stringify(summary)

    for (const name of envVars) {
      expect(summary).toContainEqual({ name, present: true })
      expect(serialized).not.toContain(env[name]!)
    }
  })

  test('redacts known and likely secret-looking values in nested objects', () => {
    const redacted = redactDiagnosticObject({
      OPENAI_API_KEY: 'sk-openai-secret',
      headers: {
        Authorization: 'Bearer abc123',
        'x-api-key': 'plain-token',
      },
      nested: [{ password: 'hunter2' }, { safe: 'enabled' }],
    })

    expect(redacted).toEqual({
      OPENAI_API_KEY: '[set]',
      headers: {
        Authorization: '[redacted]',
        'x-api-key': '[redacted]',
      },
      nested: [{ password: '[redacted]' }, { safe: 'enabled' }],
    })
  })

  test('redacts secret-looking values even under harmless field names', () => {
    const home = homedir()
    const redacted = redactDiagnosticObject({
      messages: [
        'request used sk-openai-secret-token',
        'google key AIzaSyDUMMY-secret-token',
        'header was Bearer abcdefghijklmnop',
        'token github_pat_abcdefghijklmnopqrstuvwxyz',
        'MISTRAL_API_KEY=mistralOpaqueToken123456789',
        'mistral api key abcdefghijklmnopqrstuvwxyz',
      ],
      path: `${home}/private/openclaude/src/file.ts`,
    }) as { messages: string[]; path: string }
    const serialized = JSON.stringify(redacted)

    expect(redacted.messages).toEqual([
      'request used [redacted]',
      'google key [redacted]',
      'header was [redacted]',
      'token [redacted]',
      'MISTRAL_API_KEY=[redacted]',
      'mistral api key [redacted]',
    ])
    expect(redacted.path).toBe('~/private/openclaude/src/file.ts')
    expect(serialized).not.toContain('sk-openai-secret-token')
    expect(serialized).not.toContain('AIzaSyDUMMY-secret-token')
    expect(serialized).not.toContain('abcdefghijklmnop')
    expect(serialized).not.toContain('github_pat_abcdefghijklmnopqrstuvwxyz')
    expect(serialized).not.toContain('mistralOpaqueToken123456789')
    expect(serialized).not.toContain('abcdefghijklmnopqrstuvwxyz')
    expect(serialized).not.toContain(home)
  })

  test('does not redact arbitrary opaque ids without Mistral key context', () => {
    expect(
      redactDiagnosticObject({
        traceId: 'abcdefghijklmnopqrstuvwxyz',
        message: 'request id abcdefghijklmnopqrstuvwxyz failed',
      }),
    ).toEqual({
      traceId: 'abcdefghijklmnopqrstuvwxyz',
      message: 'request id abcdefghijklmnopqrstuvwxyz failed',
    })
  })

  test('redacts Windows-style home paths without matching sibling directories', () => {
    const home = 'C:\\Users\\Alice'

    expect(
      redactHomePath(
        'debug path C:\\Users\\Alice\\AppData\\Roaming\\openclaude',
        home,
      ),
    ).toBe('debug path ~\\AppData\\Roaming\\openclaude')
    expect(redactHomePath('C:\\Users\\AliceOther\\openclaude', home)).toBe(
      'C:\\Users\\AliceOther\\openclaude',
    )
  })

  test('sanitizes credentials and sensitive query params in URLs', () => {
    expect(
      redactDiagnosticUrl(
        'https://user:pass@example.com/v1?api_key=secret&mode=test&token=abc',
      ),
    ).toBe(
      'https://redacted:redacted@example.com/v1?api_key=redacted&mode=test&token=redacted',
    )
  })
})
