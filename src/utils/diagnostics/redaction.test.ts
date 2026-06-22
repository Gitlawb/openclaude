import { describe, expect, test } from 'bun:test'
import { homedir } from 'node:os'
import { getKnownProviderSecretEnvKeys } from '../providerSecrets.js'
import {
  collectProviderSecretEnvVars,
  redactDiagnosticObject,
  redactDiagnosticUrl,
  redactHomePath,
  redactSensitiveInfo,
  summarizeSecretEnvPresence,
} from '../redaction.js'

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

describe('redactSensitiveInfo', () => {
  // Regression: the generic header-field regex stops at the first whitespace,
  // so a PEM private key value would only redact the `-----BEGIN` prefix and
  // leak the rest. The dedicated PEM pattern must consume the full block.
  test('redacts PEM private key values as a whole', () => {
    const input = [
      'private_key: -----BEGIN RSA PRIVATE KEY-----',
      'FAKE_SECRET_BODY',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n')
    expect(redactSensitiveInfo(input)).toBe(
      'private_key: [REDACTED]',
    )
  })

  test('redacts inline PEM private key with escaped newlines', () => {
    const input =
      'privateKey: -----BEGIN PRIVATE KEY-----\\nFAKE_SECRET_BODY\\n-----END PRIVATE KEY-----'
    expect(redactSensitiveInfo(input)).toBe(
      'privateKey: [REDACTED]',
    )
  })

  test('redacts private_key label with non-PEM value after space', () => {
    // The generic header regex still handles single-word values after space,
    // but the PEM pattern runs first and is more aggressive.
    const input = 'private_key: my-secret-token'
    expect(redactSensitiveInfo(input)).toBe(
      'private_key: [REDACTED]',
    )
  })
})
