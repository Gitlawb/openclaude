import { describe, expect, test } from 'bun:test'
import { execaSync } from 'execa'
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

describe('startup config recovery', () => {
  test('restores corrupt global config from the newest valid backup candidate', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'openclaude-config-recovery-'))
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

      const result = execaSync(
        process.execPath,
        [
          '--feature=UNATTENDED_RETRY',
          '-e',
          "const { enableConfigs } = await import(`${import.meta.dir}/src/utils/config.ts`); enableConfigs();",
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            OPENCLAUDE_CONFIG_DIR: configDir,
            CLAUDE_CONFIG_DIR: '',
          },
          reject: false,
        },
      )

      expect(result.exitCode).toBe(0)
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
