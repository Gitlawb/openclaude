import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadEnvFile,
  parseEnvFile,
  parseProviderEnvFileArgs,
} from './envFile.js'

const TEST_ENV_KEYS = [
  'NODE_OPTIONS',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
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

    for (const [key, value] of Object.entries(loaded)) {
      process.env[key] = value
    }

    expect(process.env.OPENAI_BASE_URL).toBe('https://file.example/v1')
    expect(process.env.OPENAI_MODEL).toBe('from-file')
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
