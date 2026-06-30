import { describe, expect, test } from 'bun:test'
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
import { getGlobalClaudeFile } from './env.js'

async function importFreshConfigModule() {
  return import(`./config.js?corruptRecovery=${Date.now()}-${Math.random()}`)
}

describe('startup config recovery', () => {
  test('restores corrupt global config from the newest valid backup candidate', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'openclaude-config-recovery-'))
    const originalOpenClaudeConfigDir = process.env.OPENCLAUDE_CONFIG_DIR
    const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
    const originalNodeEnv = process.env.NODE_ENV
    try {
      const configPath = join(configDir, '.openclaude.json')
      const backupDir = join(configDir, 'backups')
      const backupConfig = { promptQueueUseCount: 7 }
      mkdirSync(backupDir)
      writeFileSync(configPath, '{"promptQueueUseCount": 1,\u0000', 'utf-8')
      writeFileSync(
        join(backupDir, '.openclaude.json.backup.9999999999999'),
        '{"promptQueueUseCount": 9,\u0000',
        'utf-8',
      )
      writeFileSync(
        join(backupDir, '.openclaude.json.backup.9999999999998'),
        JSON.stringify(backupConfig),
        'utf-8',
      )

      process.env.OPENCLAUDE_CONFIG_DIR = configDir
      delete process.env.CLAUDE_CONFIG_DIR
      process.env.NODE_ENV = 'development'
      getGlobalClaudeFile.cache?.clear?.()
      const { enableConfigs, getGlobalConfig } = await importFreshConfigModule()

      enableConfigs()

      expect(getGlobalConfig().promptQueueUseCount).toBe(
        backupConfig.promptQueueUseCount,
      )
      expect(JSON.parse(readFileSync(configPath, 'utf-8'))).toEqual(backupConfig)
      expect(
        readdirSync(backupDir).some(file =>
          file.startsWith('.openclaude.json.corrupted.'),
        ),
      ).toBe(true)
    } finally {
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
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = originalNodeEnv
      }
      getGlobalClaudeFile.cache?.clear?.()
      rmSync(configDir, { recursive: true, force: true })
    }
  })
})
