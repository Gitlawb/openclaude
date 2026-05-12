import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const originalEnv = {
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
  CLAUDE_CODE_CUSTOM_OAUTH_URL: process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL,
  USER_TYPE: process.env.USER_TYPE,
}

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'openclaude-env-test-'))
  process.env.CLAUDE_CONFIG_DIR = tempDir
  delete process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL
  delete process.env.USER_TYPE
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
  if (originalEnv.CLAUDE_CONFIG_DIR === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalEnv.CLAUDE_CONFIG_DIR
  }
  if (originalEnv.CLAUDE_CODE_CUSTOM_OAUTH_URL === undefined) {
    delete process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL
  } else {
    process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL = originalEnv.CLAUDE_CODE_CUSTOM_OAUTH_URL
  }
  if (originalEnv.USER_TYPE === undefined) {
    delete process.env.USER_TYPE
  } else {
    process.env.USER_TYPE = originalEnv.USER_TYPE
  }
})

async function importFreshEnvModule() {
  return import(`./env.js?ts=${Date.now()}-${Math.random()}`)
}

// getGlobalClaudeFile — default path plus explicit override compatibility

test('getGlobalClaudeFile: new install returns .openclaude.json when neither file exists', async () => {
  const { getGlobalClaudeFile } = await importFreshEnvModule()
  expect(getGlobalClaudeFile()).toBe(join(tempDir, '.openclaude.json'))
})

test('getGlobalClaudeFile: explicit config dir keeps .claude.json fallback when only legacy file exists', async () => {
  writeFileSync(join(tempDir, '.claude.json'), '{}')
  const { getGlobalClaudeFile } = await importFreshEnvModule()
  expect(getGlobalClaudeFile()).toBe(join(tempDir, '.claude.json'))
})

test('getGlobalClaudeFile: migrated user uses .openclaude.json when both files exist', async () => {
  writeFileSync(join(tempDir, '.claude.json'), '{}')
  writeFileSync(join(tempDir, '.openclaude.json'), '{}')
  const { getGlobalClaudeFile } = await importFreshEnvModule()
  expect(getGlobalClaudeFile()).toBe(join(tempDir, '.openclaude.json'))
})

test('resolveGlobalClaudeFile: failed default migration keeps legacy file when new file is missing', async () => {
  writeFileSync(join(tempDir, '.claude.json'), '{}')
  const { resolveGlobalClaudeFile } = await importFreshEnvModule()

  expect(
    resolveGlobalClaudeFile({
      homeDir: tempDir,
      migrationSucceeded: false,
      existsSync: path => path === join(tempDir, '.claude.json'),
    }),
  ).toBe(join(tempDir, '.claude.json'))
})
