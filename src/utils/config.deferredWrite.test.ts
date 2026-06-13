import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import type * as ConfigModule from './config.js'

// In NODE_ENV=test saveGlobalConfigDeferred delegates synchronously to
// saveGlobalConfig (the in-memory test config), so these assertions exercise
// the public contract — apply-in-order and a safe flush — without touching the
// real ~/.openclaude.json or lockfiles. The actual queue/debounce/write-through/
// batch-drain branch (skipped here by the NODE_ENV bypass) is covered against
// injected storage/scheduler in deferredConfigWrites.test.ts.
//
// Load config through a unique URL specifier rather than the bare './config.js'.
// mock.module() is process-global in bun:test and is NOT reliably undone by
// afterEach (a documented trap — see user.test.ts), so a leaked
// mock.module('./config.js') from another file used to drop promptQueueUseCount
// and silently turn these assertions into no-ops. A query-suffixed specifier is
// a different module key that mock.module never replaces, so this file always
// loads the real module and exercises the real path — never skipping coverage,
// never flaking on another file's leak. It is also a private instance, so these
// tests neither read nor mutate the config the rest of the suite shares.
let config: typeof ConfigModule
beforeAll(async () => {
  config = (await import(
    `./config.js?deferredWriteTest=${Date.now()}-${Math.random()}`
  )) as typeof ConfigModule
})

describe('saveGlobalConfigDeferred', () => {
  // Reset the private test config after each case so ordering within this file
  // can't carry a value between tests.
  afterEach(() => {
    config.saveGlobalConfig(c => ({ ...c, promptQueueUseCount: 0 }))
  })

  test('applies the updater (visible via getGlobalConfig)', () => {
    const before = config.getGlobalConfig().promptQueueUseCount ?? 0
    config.saveGlobalConfigDeferred(c => ({
      ...c,
      promptQueueUseCount: (c.promptQueueUseCount ?? 0) + 1,
    }))
    config.flushGlobalConfigWrites()
    expect(config.getGlobalConfig().promptQueueUseCount).toBe(before + 1)
  })

  test('composes multiple queued updaters in call order', () => {
    config.saveGlobalConfig(c => ({ ...c, promptQueueUseCount: 10 }))
    // Order matters: +1 then *2 => 22, the other order would give 21.
    config.saveGlobalConfigDeferred(c => ({
      ...c,
      promptQueueUseCount: (c.promptQueueUseCount ?? 0) + 1,
    }))
    config.saveGlobalConfigDeferred(c => ({
      ...c,
      promptQueueUseCount: (c.promptQueueUseCount ?? 0) * 2,
    }))
    config.flushGlobalConfigWrites()
    expect(config.getGlobalConfig().promptQueueUseCount).toBe(22)
  })

  test('flushGlobalConfigWrites is a safe no-op when nothing is queued', () => {
    expect(() => config.flushGlobalConfigWrites()).not.toThrow()
    expect(() => config.flushGlobalConfigWrites()).not.toThrow()
  })

  test('a no-op updater (same reference) does not change config', () => {
    config.saveGlobalConfig(c => ({ ...c, promptQueueUseCount: 5 }))
    config.saveGlobalConfigDeferred(c => c)
    config.flushGlobalConfigWrites()
    expect(config.getGlobalConfig().promptQueueUseCount).toBe(5)
  })
})
