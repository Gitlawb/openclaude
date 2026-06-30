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
      const configModulePath = join(process.cwd(), 'src/utils/config.ts')

      const result = execaSync(
        process.execPath,
        [
          '--feature=UNATTENDED_RETRY',
          '-e',
          `const { enableConfigs } = await import(${JSON.stringify(configModulePath)}); enableConfigs();`,
        ],
        {
          cwd: process.cwd(),
          env: {
            HOME: process.env.HOME ?? '',
            NODE_ENV: 'test',
            OPENCLAUDE_CONFIG_DIR: configDir,
            PATH: process.env.PATH ?? '',
            TMPDIR: process.env.TMPDIR ?? tmpdir(),
            CLAUDE_CONFIG_DIR: '',
          },
          reject: false,
        },
      )

      if (result.exitCode !== 0) {
        throw new Error(
          `config recovery subprocess failed with exit code ${result.exitCode}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
        )
      }

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
