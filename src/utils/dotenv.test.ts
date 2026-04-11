import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { loadDotEnvFile, hasDotEnvFile } from './dotenv.ts'

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'dotenv-test-'))
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

test('loadDotEnvFile loads simple key-value pairs', () => {
  const tempDir = createTempDir()
  const envContent = `
FOO=bar
BAZ=qux
`
  writeFileSync(join(tempDir, '.env'), envContent)
  
  const originalFoo = process.env.FOO
  const originalBaz = process.env.BAZ
  delete process.env.FOO
  delete process.env.BAZ
  
  try {
    loadDotEnvFile(tempDir)
    assert.equal(process.env.FOO, 'bar')
    assert.equal(process.env.BAZ, 'qux')
  } finally {
    process.env.FOO = originalFoo
    process.env.BAZ = originalBaz
    cleanup(tempDir)
  }
})

test('loadDotEnvFile ignores comments', () => {
  const tempDir = createTempDir()
  const envContent = `
# This is a comment
FOO=bar
# Another comment
BAZ=qux
`
  writeFileSync(join(tempDir, '.env'), envContent)
  
  const originalFoo = process.env.FOO
  delete process.env.FOO
  
  try {
    loadDotEnvFile(tempDir)
    assert.equal(process.env.FOO, 'bar')
  } finally {
    process.env.FOO = originalFoo
    cleanup(tempDir)
  }
})

test('loadDotEnvFile handles double-quoted values', () => {
  const tempDir = createTempDir()
  const envContent = `FOO="hello world"`
  writeFileSync(join(tempDir, '.env'), envContent)
  
  const originalFoo = process.env.FOO
  delete process.env.FOO
  
  try {
    loadDotEnvFile(tempDir)
    assert.equal(process.env.FOO, 'hello world')
  } finally {
    process.env.FOO = originalFoo
    cleanup(tempDir)
  }
})

test('loadDotEnvFile handles single-quoted values', () => {
  const tempDir = createTempDir()
  const envContent = `FOO='hello world'`
  writeFileSync(join(tempDir, '.env'), envContent)
  
  const originalFoo = process.env.FOO
  delete process.env.FOO
  
  try {
    loadDotEnvFile(tempDir)
    assert.equal(process.env.FOO, 'hello world')
  } finally {
    process.env.FOO = originalFoo
    cleanup(tempDir)
  }
})

test('loadDotEnvFile handles escape sequences in double-quoted values', () => {
  const tempDir = createTempDir()
  const envContent = `FOO="line1\\nline2"`
  writeFileSync(join(tempDir, '.env'), envContent)
  
  const originalFoo = process.env.FOO
  delete process.env.FOO
  
  try {
    loadDotEnvFile(tempDir)
    assert.equal(process.env.FOO, 'line1\nline2')
  } finally {
    process.env.FOO = originalFoo
    cleanup(tempDir)
  }
})

test('loadDotEnvFile handles escaped quotes in double-quoted values', () => {
  const tempDir = createTempDir()
  const envContent = `KEY="a\\"b"`
  writeFileSync(join(tempDir, '.env'), envContent)
  
  const originalKey = process.env.KEY
  delete process.env.KEY
  
  try {
    loadDotEnvFile(tempDir)
    assert.equal(process.env.KEY, 'a"b')
  } finally {
    process.env.KEY = originalKey
    cleanup(tempDir)
  }
})

test('loadDotEnvFile preserves literal backslashes in Windows paths', () => {
  const tempDir = createTempDir()
  const envContent = `CODEX_AUTH_JSON_PATH="C:\\\\new\\\\auth.json"`
  writeFileSync(join(tempDir, '.env'), envContent)
  
  const originalPath = process.env.CODEX_AUTH_JSON_PATH
  delete process.env.CODEX_AUTH_JSON_PATH
  
  try {
    loadDotEnvFile(tempDir)
    assert.equal(process.env.CODEX_AUTH_JSON_PATH, 'C:\\new\\auth.json')
  } finally {
    process.env.CODEX_AUTH_JSON_PATH = originalPath
    cleanup(tempDir)
  }
})

test('loadDotEnvFile handles mixed escapes correctly', () => {
  const tempDir = createTempDir()
  const envContent = `MIXED="line1\\nC:\\\\path\\\\file.txt"`
  writeFileSync(join(tempDir, '.env'), envContent)
  
  const originalMixed = process.env.MIXED
  delete process.env.MIXED
  
  try {
    loadDotEnvFile(tempDir)
    assert.equal(process.env.MIXED, 'line1\nC:\\path\\file.txt')
  } finally {
    process.env.MIXED = originalMixed
    cleanup(tempDir)
  }
})

test('loadDotEnvFile does not override existing env vars', () => {
  const tempDir = createTempDir()
  const envContent = `FOO=from-file`
  writeFileSync(join(tempDir, '.env'), envContent)
  
  const originalFoo = process.env.FOO
  process.env.FOO = 'from-shell'
  
  try {
    loadDotEnvFile(tempDir)
    assert.equal(process.env.FOO, 'from-shell')
  } finally {
    process.env.FOO = originalFoo
    cleanup(tempDir)
  }
})

test('loadDotEnvFile removes inline comments from unquoted values', () => {
  const tempDir = createTempDir()
  const envContent = `FOO=bar # this is a comment`
  writeFileSync(join(tempDir, '.env'), envContent)
  
  const originalFoo = process.env.FOO
  delete process.env.FOO
  
  try {
    loadDotEnvFile(tempDir)
    assert.equal(process.env.FOO, 'bar')
  } finally {
    process.env.FOO = originalFoo
    cleanup(tempDir)
  }
})

test('loadDotEnvFile handles empty file gracefully', () => {
  const tempDir = createTempDir()
  writeFileSync(join(tempDir, '.env'), '')
  
  try {
    loadDotEnvFile(tempDir)
  } finally {
    cleanup(tempDir)
  }
})

test('loadDotEnvFile handles non-existent file gracefully', () => {
  const tempDir = createTempDir()
  loadDotEnvFile(tempDir)
  cleanup(tempDir)
})

test('hasDotEnvFile returns true when .env exists', () => {
  const tempDir = createTempDir()
  writeFileSync(join(tempDir, '.env'), 'FOO=bar')
  
  try {
    assert.equal(hasDotEnvFile(tempDir), true)
  } finally {
    cleanup(tempDir)
  }
})

test('hasDotEnvFile returns false when .env does not exist', () => {
  const tempDir = createTempDir()
  
  try {
    assert.equal(hasDotEnvFile(tempDir), false)
  } finally {
    cleanup(tempDir)
  }
})
