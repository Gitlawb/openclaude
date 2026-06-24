import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyLoadedEnvFileValues,
  clearRememberedEnvFileValuesForTests,
  loadEnvFile,
  parseEnvFile,
  parseProviderEnvFileArgs,
  reapplyRememberedEnvFileValues,
  rememberLoadedEnvFileValues,
} from './envFile.js'

const TEST_ENV_KEYS = [
  'NODE_OPTIONS',
  'AZURE_OPENAI_API_VERSION',
  'CODEX_AUTH_JSON_PATH',
  'CODEX_HOME',
  'OPENAI_API_KEYS',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'WEB_AUTH_HEADER',
  'WEB_AUTH_SCHEME',
  'WEB_BODY_TEMPLATE',
  'WEB_CUSTOM_ALLOW_ARBITRARY_HEADERS',
  'WEB_CUSTOM_ALLOW_HTTP',
  'WEB_CUSTOM_ALLOW_PRIVATE',
  'WEB_CUSTOM_MAX_BODY_KB',
  'WEB_CUSTOM_TIMEOUT_SEC',
  'WEB_HEADERS',
  'WEB_JSON_PATH',
  'WEB_KEY',
  'WEB_METHOD',
  'WEB_PARAMS',
  'WEB_PROVIDER',
  'WEB_QUERY_PARAM',
  'WEB_SEARCH_API',
  'WEB_SEARCH_PROVIDER',
  'WEB_URL_TEMPLATE',
]

const originalEnv = new Map<string, string | undefined>()
let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'openclaude-env-file-test-'))
  for (const key of TEST_ENV_KEYS) {
    originalEnv.set(key, process.env[key])
    delete process.env[key]
  }
})

afterEach(() => {
  clearRememberedEnvFileValuesForTests()
  rmSync(tempDir, { recursive: true, force: true })
  for (const key of TEST_ENV_KEYS) {
    const originalValue = originalEnv.get(key)
    if (originalValue === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = originalValue
    }
  }
  originalEnv.clear()
})

function writeTempEnvFile(content: string, fileName = '.env'): string {
  const filePath = join(tempDir, fileName)
  writeFileSync(filePath, content, 'utf-8')
  return filePath
}

describe('envFile parser', () => {
  it('parses basic KEY=VALUE', () => {
    const result = parseEnvFile('FOO=bar\nBAZ=qux')
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  it('handles quotes', () => {
    const result = parseEnvFile('FOO="bar"\nBAZ=\'qux\'')
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  it('handles export prefix', () => {
    const result = parseEnvFile('export FOO=bar\nexport BAZ="qux"')
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  it('ignores comments and empty lines', () => {
    const content = `
# This is a comment
FOO=bar

# Another comment
BAZ=qux
`
    const result = parseEnvFile(content)
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  it('rejects invalid lines', () => {
    expect(() => parseEnvFile('FOO=bar\ninvalid_line\nBAZ=qux')).toThrow(
      'Invalid line 2: expected KEY=VALUE',
    )
  })

  it('rejects invalid variable names', () => {
    expect(() => parseEnvFile('BAD KEY=value')).toThrow(
      'Invalid variable name on line 1',
    )
  })

  it('preserves inner equals signs', () => {
    const result = parseEnvFile('FOO=bar=baz')
    expect(result).toEqual({ FOO: 'bar=baz' })
  })

  it('uses the last value when a key appears multiple times', () => {
    const result = parseEnvFile('FOO=first\nFOO=second')
    expect(result).toEqual({ FOO: 'second' })
  })

  it('trims whitespace', () => {
    const result = parseEnvFile('  FOO = bar  ')
    expect(result).toEqual({ FOO: 'bar' })
  })

  it('handles empty values', () => {
    const result = parseEnvFile('FOO=\nBAZ=""')
    expect(result).toEqual({ FOO: '', BAZ: '' })
  })

  it('handles values with spaces inside quotes', () => {
    const result = parseEnvFile('FOO=" bar "\nBAZ=\' qux \'')
    expect(result).toEqual({ FOO: ' bar ', BAZ: ' qux ' })
  })

  it('handles escaped quote characters inside quoted values', () => {
    const result = parseEnvFile([
      'FOO="{\\"k\\":\\"v\\"}"',
      "BAZ='it\\'s ok'",
    ].join('\n'))

    expect(result).toEqual({
      FOO: '{"k":"v"}',
      BAZ: "it's ok",
    })
  })

  it('strips inline comments from unquoted values', () => {
    const result = parseEnvFile('FOO=bar # comment\nBAZ=qux')
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  it('preserves hash signs inside unquoted strings if not preceded by space', () => {
    const result = parseEnvFile('FOO=bar#comment')
    expect(result).toEqual({ FOO: 'bar#comment' })
  })

  it('preserves inline comments in quoted values', () => {
    const result = parseEnvFile('FOO="bar # comment"')
    expect(result).toEqual({ FOO: 'bar # comment' })
  })

  it('strips trailing comments after quoted values', () => {
    const result = parseEnvFile('FOO="bar" # comment')
    expect(result).toEqual({ FOO: 'bar' })
  })

  it('handles Windows line endings', () => {
    const result = parseEnvFile('FOO=bar\r\nBAZ=qux')
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })
})

describe('loadEnvFile', () => {
  it('loads variables without overwriting existing process environment', () => {
    process.env.OPENAI_API_KEY = 'from-shell'
    const filePath = writeTempEnvFile([
      'OPENAI_MODEL=from-file',
      'OPENAI_API_KEY=from-file',
    ].join('\n'))

    const loaded = loadEnvFile(filePath)

    expect(process.env.OPENAI_API_KEY).toBe('from-shell')
    expect(process.env.OPENAI_MODEL).toBe('from-file')
    expect(loaded).toEqual({ OPENAI_MODEL: 'from-file' })
  })

  it('returns loaded values that can be restored after later settings mutations', () => {
    const filePath = writeTempEnvFile([
      'OPENAI_BASE_URL=https://file.example/v1',
      'OPENAI_MODEL=from-file',
    ].join('\n'))

    const loaded = loadEnvFile(filePath)
    process.env.OPENAI_BASE_URL = 'https://settings.example/v1'
    process.env.OPENAI_MODEL = 'from-settings'

    applyLoadedEnvFileValues(loaded)

    expect(process.env.OPENAI_BASE_URL).toBe('https://file.example/v1')
    expect(process.env.OPENAI_MODEL).toBe('from-file')
  })

  it('reapplies remembered loaded values after later settings mutations', () => {
    const filePath = writeTempEnvFile([
      'OPENAI_BASE_URL=https://file.example/v1',
      'OPENAI_MODEL=from-file',
    ].join('\n'))

    const loaded = loadEnvFile(filePath)
    rememberLoadedEnvFileValues(loaded)
    process.env.OPENAI_BASE_URL = 'https://settings.example/v1'
    process.env.OPENAI_MODEL = 'from-settings'

    reapplyRememberedEnvFileValues()

    expect(process.env.OPENAI_BASE_URL).toBe('https://file.example/v1')
    expect(process.env.OPENAI_MODEL).toBe('from-file')
  })

  it('loads and reapplies OpenAI credential pools from provider env files', () => {
    const filePath = writeTempEnvFile([
      'CLAUDE_CODE_USE_OPENAI=1',
      'OPENAI_BASE_URL=https://api.openai.com/v1',
      'OPENAI_MODEL=gpt-4o',
      'OPENAI_API_KEYS=key-a,key-b',
    ].join('\n'))

    const loaded = loadEnvFile(filePath)
    rememberLoadedEnvFileValues(loaded)
    process.env.OPENAI_API_KEYS = 'settings-key'

    reapplyRememberedEnvFileValues()

    expect(process.env.OPENAI_API_KEYS).toBe('key-a,key-b')
    expect(loaded).toEqual({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
      OPENAI_MODEL: 'gpt-4o',
      OPENAI_API_KEYS: 'key-a,key-b',
    })
  })

  it('loads documented Azure OpenAI API version values', () => {
    const filePath = writeTempEnvFile(
      'AZURE_OPENAI_API_VERSION=2024-12-01-preview',
    )

    const loaded = loadEnvFile(filePath)

    expect(process.env.AZURE_OPENAI_API_VERSION).toBe('2024-12-01-preview')
    expect(loaded).toEqual({
      AZURE_OPENAI_API_VERSION: '2024-12-01-preview',
    })
  })

  it('loads documented custom web search and Codex auth-file setup values', () => {
    const filePath = writeTempEnvFile([
      'WEB_SEARCH_PROVIDER=custom',
      'WEB_PROVIDER=searxng',
      'WEB_KEY=web-key',
      'WEB_SEARCH_API=https://search.example.com/search',
      'WEB_QUERY_PARAM=query',
      'WEB_METHOD=POST',
      'WEB_PARAMS={"lang":"en","count":"10"}',
      'WEB_URL_TEMPLATE=https://api.example.com/v2/search/{query}',
      'WEB_BODY_TEMPLATE={"input":{"text":"{query}"}}',
      'WEB_AUTH_HEADER=X-Api-Key',
      'WEB_AUTH_SCHEME=',
      'WEB_HEADERS=Accept: application/json; X-Tenant: acme',
      'WEB_JSON_PATH=response.payload.results',
      'WEB_CUSTOM_TIMEOUT_SEC=15',
      'WEB_CUSTOM_MAX_BODY_KB=300',
      'WEB_CUSTOM_ALLOW_ARBITRARY_HEADERS=true',
      'WEB_CUSTOM_ALLOW_HTTP=true',
      'WEB_CUSTOM_ALLOW_PRIVATE=true',
      'CODEX_AUTH_JSON_PATH=/tmp/codex-auth.json',
      'CODEX_HOME=/tmp/codex',
    ].join('\n'))

    const loaded = loadEnvFile(filePath)

    expect(loaded).toEqual({
      WEB_SEARCH_PROVIDER: 'custom',
      WEB_PROVIDER: 'searxng',
      WEB_KEY: 'web-key',
      WEB_SEARCH_API: 'https://search.example.com/search',
      WEB_QUERY_PARAM: 'query',
      WEB_METHOD: 'POST',
      WEB_PARAMS: '{"lang":"en","count":"10"}',
      WEB_URL_TEMPLATE: 'https://api.example.com/v2/search/{query}',
      WEB_BODY_TEMPLATE: '{"input":{"text":"{query}"}}',
      WEB_AUTH_HEADER: 'X-Api-Key',
      WEB_AUTH_SCHEME: '',
      WEB_HEADERS: 'Accept: application/json; X-Tenant: acme',
      WEB_JSON_PATH: 'response.payload.results',
      WEB_CUSTOM_TIMEOUT_SEC: '15',
      WEB_CUSTOM_MAX_BODY_KB: '300',
      WEB_CUSTOM_ALLOW_ARBITRARY_HEADERS: 'true',
      WEB_CUSTOM_ALLOW_HTTP: 'true',
      WEB_CUSTOM_ALLOW_PRIVATE: 'true',
      CODEX_AUTH_JSON_PATH: '/tmp/codex-auth.json',
      CODEX_HOME: '/tmp/codex',
    })
    expect(process.env.WEB_SEARCH_API).toBe('https://search.example.com/search')
    expect(process.env.CODEX_AUTH_JSON_PATH).toBe('/tmp/codex-auth.json')
  })

  it('rejects unsupported variables before mutating process environment', () => {
    const filePath = writeTempEnvFile([
      'OPENAI_MODEL=from-file',
      'NODE_OPTIONS=--require ./malicious.js',
    ].join('\n'))

    expect(() => loadEnvFile(filePath)).toThrow(
      'Unsupported variable NODE_OPTIONS in --provider-env-file',
    )
    expect(process.env.OPENAI_MODEL).toBeUndefined()
    expect(process.env.NODE_OPTIONS).toBeUndefined()
  })

  it('rejects lowercase spellings of supported variables', () => {
    const filePath = writeTempEnvFile('openai_model=from-file')

    expect(() => loadEnvFile(filePath)).toThrow(
      'Unsupported variable openai_model in --provider-env-file',
    )
    expect(process.env.OPENAI_MODEL).toBeUndefined()
  })

  it('keeps earlier file values when multiple files define the same key', () => {
    const firstFilePath = writeTempEnvFile('OPENAI_MODEL=first', '.env')
    const secondFilePath = writeTempEnvFile('OPENAI_MODEL=second', '.env.local')

    loadEnvFile(firstFilePath)
    loadEnvFile(secondFilePath)

    expect(process.env.OPENAI_MODEL).toBe('first')
  })

  it('wraps file read errors with env-file context', () => {
    const filePath = join(tempDir, 'missing.env')

    let message = ''
    try {
      loadEnvFile(filePath)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain(`Failed to load --provider-env-file at ${filePath}:`)
  })

  it('wraps parse errors without exposing secret values from the file', () => {
    const filePath = writeTempEnvFile([
      'OPENAI_API_KEY=super-secret-value',
      'invalid_line',
    ].join('\n'))

    let message = ''
    try {
      loadEnvFile(filePath)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain(`Failed to load --provider-env-file at ${filePath}:`)
    expect(message).toContain('Invalid line 2: expected KEY=VALUE')
    expect(message).not.toContain('super-secret-value')
    expect(process.env.OPENAI_API_KEY).toBeUndefined()
  })
})

describe('parseProviderEnvFileArgs', () => {
  it('extracts repeatable provider env-file paths', () => {
    const result = parseProviderEnvFileArgs([
      '--provider-env-file',
      '.env',
      '--provider-env-file=.env.local',
    ])

    expect(result).toEqual({ paths: ['.env', '.env.local'] })
  })

  it('returns an error when the flag has no path', () => {
    const result = parseProviderEnvFileArgs(['--provider-env-file'])

    expect(result).toEqual({
      paths: [],
      error: 'Error: --provider-env-file requires a path',
    })
  })

  it('does not parse provider env-file flags after end-of-options marker', () => {
    const result = parseProviderEnvFileArgs([
      '--',
      '--provider-env-file',
      '.env',
    ])

    expect(result).toEqual({ paths: [] })
  })
})
