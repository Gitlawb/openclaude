import { afterEach, beforeEach, expect, test } from 'bun:test'
import type { GlobalConfig } from 'src/utils/config.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import { getMigrationNotifications } from './useModelMigrationNotifications.js'

const originalSonnetEnv = process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
const originalOpusEnv = process.env.ANTHROPIC_DEFAULT_OPUS_MODEL

beforeEach(async () => {
  await acquireSharedMutationLock('hooks/notifs/useModelMigrationNotifications.test.ts')
  delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
  delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL
})

afterEach(() => {
  try {
    if (originalSonnetEnv !== undefined) {
      process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = originalSonnetEnv
    } else {
      delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
    }
    if (originalOpusEnv !== undefined) {
      process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = originalOpusEnv
    } else {
      delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL
    }
  } finally {
    releaseSharedMutationLock()
  }
})

test('migration notification names the current Sonnet and Opus destinations', () => {
  const now = Date.now()
  const config: Partial<GlobalConfig> = {
    sonnet45To46MigrationTimestamp: now,
    opusProMigrationTimestamp: now,
  }

  const notifs = getMigrationNotifications(config)
  expect(notifs).toHaveLength(2)

  const sonnetNotif = notifs.find(n => n.key === 'sonnet-46-update')
  expect(sonnetNotif).toBeDefined()
  expect(sonnetNotif && 'text' in sonnetNotif ? sonnetNotif.text : undefined).toBe('Model updated to Sonnet 5')

  const opusNotif = notifs.find(n => n.key === 'opus-pro-update')
  expect(opusNotif).toBeDefined()
  expect(opusNotif && 'text' in opusNotif ? opusNotif.text : undefined).toBe('Model updated to Opus 5')
})

test('legacy Opus migration notification includes opt-out copy with current Opus destination', () => {
  const now = Date.now()
  const config: Partial<GlobalConfig> = {
    legacyOpusMigrationTimestamp: now,
  }

  const notifs = getMigrationNotifications(config)
  expect(notifs).toHaveLength(1)
  expect(notifs[0].key).toBe('opus-pro-update')
  expect('text' in notifs[0] ? notifs[0].text : undefined).toBe(
    'Model updated to Opus 5 · Set CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP=1 to opt out',
  )
})

test('migration notifications dynamically adapt when model defaults are overridden', () => {
  process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'claude-sonnet-4-6'
  process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'claude-opus-4-8'

  const now = Date.now()
  const config: Partial<GlobalConfig> = {
    sonnet45To46MigrationTimestamp: now,
    legacyOpusMigrationTimestamp: now,
  }

  const notifs = getMigrationNotifications(config)
  expect('text' in notifs[0] ? notifs[0].text : undefined).toBe('Model updated to Sonnet 4.6')
  expect('text' in notifs[1] ? notifs[1].text : undefined).toBe(
    'Model updated to Opus 4.8 · Set CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP=1 to opt out',
  )
})

test('stale migration timestamps do not emit notifications', () => {
  const old = Date.now() - 5000
  const config: Partial<GlobalConfig> = {
    sonnet45To46MigrationTimestamp: old,
    opusProMigrationTimestamp: old,
  }

  const notifs = getMigrationNotifications(config)
  expect(notifs).toHaveLength(0)
})

test('stale legacy timestamp alongside recent Opus Pro timestamp falls back to Opus Pro notification', () => {
  const stale = Date.now() - 10000
  const recent = Date.now()
  const config: Partial<GlobalConfig> = {
    legacyOpusMigrationTimestamp: stale,
    opusProMigrationTimestamp: recent,
  }

  const notifs = getMigrationNotifications(config)
  expect(notifs).toHaveLength(1)
  expect(notifs[0].key).toBe('opus-pro-update')
  expect('text' in notifs[0] ? notifs[0].text : undefined).toBe('Model updated to Opus 5')
})
