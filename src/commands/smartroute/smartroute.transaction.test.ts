import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SettingsJson } from '../../utils/settings/types.js'
import { setClaudeConfigHomeDirForTesting } from '../../utils/envUtils.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import command from './index.js'

const AGENT_MODELS = {
  mini: { model: 'claude-haiku-4-5' },
  main: { model: 'claude-opus-4-5' },
}

let configDir: string
let settingsPath: string

beforeEach(async () => {
  await acquireSharedMutationLock(
    'commands/smartroute/smartroute.transaction.test.ts',
  )
  configDir = mkdtempSync(join(tmpdir(), 'openclaude-smartroute-'))
  settingsPath = join(configDir, 'settings.json')
  setClaudeConfigHomeDirForTesting(configDir)
  resetSettingsCache()
  writeFileSync(
    settingsPath,
    `${JSON.stringify({
      smartRouting: { enabled: false, simpleModel: 'mini' },
    })}\n`,
  )
})

afterEach(() => {
  try {
    setClaudeConfigHomeDirForTesting(undefined)
    resetSettingsCache()
    rmSync(configDir, { recursive: true, force: true })
  } finally {
    releaseSharedMutationLock()
  }
})

test('on revalidates roles from the fresh lock-scoped settings', async () => {
  let state = {
    settings: {
      agentModels: AGENT_MODELS,
      smartRouting: {
        enabled: false,
        simpleModel: 'mini',
        strongModel: 'main',
      },
    } as SettingsJson,
  }
  const context = {
    getAppState: () => state,
    setAppState: (updater: (current: typeof state) => typeof state) => {
      state = updater(state)
    },
  } as never
  const call = (await command.load()).call

  const result = await call('on', context)

  expect(result.type).toBe('text')
  if (result.type !== 'text') return
  expect(result.value).toContain('Set both roles first')
  expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toEqual({
    smartRouting: { enabled: false, simpleModel: 'mini' },
  })
})
