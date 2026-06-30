import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type * as ConfigModule from './config.js'

const originalOpenClaudeConfigDir = process.env.OPENCLAUDE_CONFIG_DIR
const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR

async function importFreshConfigModule(): Promise<typeof ConfigModule> {
  return (await import(
    `./config.js?corruptRecoveryTest=${Date.now()}-${Math.random()}`
  )) as typeof ConfigModule
}

afterEach(() => {
  if (originalOpenClaudeConfigDir === undefined) {
    delete process.env.OPENCLAUDE_CONFIG_DIR
  } else {
    process.env.OPENCLAUDE_CONFIG_DIR = originalOpenClaudeConfigDir
  }

  if (originalClaudeConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
  }
})

describe('startup config recovery', () => {
  test('restores corrupt global config from the newest valid backup', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'openclaude-config-recovery-'))
    try {
      process.env.OPENCLAUDE_CONFIG_DIR = configDir
      delete process.env.CLAUDE_CONFIG_DIR

      const configPath = join(configDir, '.openclaude.json')
      const backupDir = join(configDir, 'backups')
      const backupConfig = { promptQueueUseCount: 7 }
      mkdirSync(backupDir)
      writeFileSync(configPath, '{"promptQueueUseCount": 1,\u0000', 'utf-8')
      writeFileSync(
        join(backupDir, '.openclaude.json.backup.9999999999999'),
        JSON.stringify(backupConfig),
        'utf-8',
      )

      const config = await importFreshConfigModule()

      expect(() => config.enableConfigs()).not.toThrow()
      expect(JSON.parse(readFileSync(configPath, 'utf-8'))).toEqual(backupConfig)
      expect(
        readdirSync(backupDir).some(file =>
          file.startsWith('.openclaude.json.corrupted.'),
        ),
      ).toBe(true)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })
})
