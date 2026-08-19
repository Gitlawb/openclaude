import { expect, test } from 'bun:test'
import type { SettingsWriteResult } from './settings.js'
import type { SettingsJson } from './types.js'
import {
  commitModelSettingsTransition,
  commitSettingsTransition,
  mergeSettingsTransitions,
  rollbackModelSettingsTransition,
} from './modelTransition.js'

function committedResult(): SettingsWriteResult {
  return {
    status: 'committed',
    bytesOnDisk: true,
    committed: true,
    cacheInvalidated: true,
    sessionNotified: false,
    error: null,
    written: true,
  }
}

function unchangedResult(): SettingsWriteResult {
  return {
    status: 'not-requested',
    bytesOnDisk: false,
    committed: false,
    cacheInvalidated: false,
    sessionNotified: false,
    error: null,
    written: false,
    unchanged: true,
  }
}

function rejectedResult(error: Error): SettingsWriteResult {
  return {
    status: 'rejected',
    bytesOnDisk: false,
    committed: false,
    cacheInvalidated: false,
    sessionNotified: false,
    error,
    written: false,
  }
}

test('rollback restores the lock-scoped preimage rather than a render-time value', () => {
  let settings: SettingsJson = { model: 'peer-model', effortLevel: 'high' }
  const committed = commitModelSettingsTransition(
    'next-model',
    { effortLevel: 'low' },
    {
      updateFresh: (_source, update) => {
        settings = { ...settings, ...update(structuredClone(settings)) }
        return committedResult()
      },
    },
  )

  expect(committed.transition).toBeDefined()
  const rollback = rollbackModelSettingsTransition(committed.transition!, {
    updateFreshOrNoop: (_source, update) => {
      const patch = update(structuredClone(settings))
      if (typeof patch === 'symbol') {
        return unchangedResult()
      }
      settings = { ...settings, ...patch }
      return committedResult()
    },
  })

  expect(rollback).toEqual({ status: 'restored' })
  expect(settings).toMatchObject({ model: 'peer-model', effortLevel: 'high' })
})

test('rollback preserves a newer writer that superseded the attempted model', () => {
  let settings: SettingsJson = { model: 'peer-model' }
  const committed = commitModelSettingsTransition('next-model', {}, {
    updateFresh: (_source, update) => {
      settings = { ...settings, ...update(structuredClone(settings)) }
      return committedResult()
    },
  })
  settings.model = 'newer-model'

  let updateCalls = 0
  const rollback = rollbackModelSettingsTransition(committed.transition!, {
    updateFreshOrNoop: (_source, update) => {
      updateCalls++
      const patch = update(structuredClone(settings))
      expect(typeof patch).toBe('symbol')
      return unchangedResult()
    },
  })

  expect(rollback).toEqual({ status: 'superseded' })
  expect(updateCalls).toBe(1)
  expect(settings.model).toBe('newer-model')
})

test('rollback treats reordered object settings as the same attempted value', () => {
  let settings: SettingsJson = {
    env: { FIRST: '1', SECOND: '2' },
  }
  const committed = commitSettingsTransition(
    { env: { FIRST: 'next', SECOND: 'next' } },
    {
      updateFresh: (_source, update) => {
        settings = { ...settings, ...update(structuredClone(settings)) }
        return committedResult()
      },
    },
  )
  settings.env = { SECOND: 'next', FIRST: 'next' }

  const rollback = rollbackModelSettingsTransition(committed.transition!, {
    updateFreshOrNoop: (_source, update) => {
      const patch = update(structuredClone(settings))
      if (typeof patch === 'symbol') {
        return unchangedResult()
      }
      settings = { ...settings, ...patch }
      return committedResult()
    },
  })

  expect(rollback).toEqual({ status: 'restored' })
  expect(settings.env).toEqual({ FIRST: '1', SECOND: '2' })
})

test('rollback compares the full post-merge value for sparse nested patches', () => {
  let settings: SettingsJson = {
    env: { KEEP: '1', REMOVE: 'stale' },
    model: 'previous-model',
  }
  const committed = commitSettingsTransition(
    { env: { REMOVE: undefined }, model: 'next-model' } as unknown as SettingsJson,
    {
      updateFresh: (_source, update) => {
        update(structuredClone(settings))
        settings = { env: { KEEP: '1' }, model: 'next-model' }
        return committedResult()
      },
    },
  )

  expect(committed.transition?.attempted).toEqual({
    env: { KEEP: '1' },
    model: 'next-model',
  })

  const rollback = rollbackModelSettingsTransition(committed.transition!, {
    updateFreshOrNoop: (_source, update) => {
      const patch = update(structuredClone(settings))
      if (typeof patch === 'symbol') {
        return unchangedResult()
      }
      settings = {
        env: { KEEP: '1', REMOVE: 'stale' },
        model: 'previous-model',
      }
      return committedResult()
    },
  })

  expect(rollback).toEqual({ status: 'restored' })
  expect(settings).toEqual({
    env: { KEEP: '1', REMOVE: 'stale' },
    model: 'previous-model',
  })
})

test('rollback reports when restoring the previous model was rejected', () => {
  const committed = commitModelSettingsTransition('next-model', {}, {
    updateFresh: (_source, update) => {
      update({ model: 'previous-model' })
      return committedResult()
    },
  })

  const rollback = rollbackModelSettingsTransition(committed.transition!, {
    updateFreshOrNoop: () => rejectedResult(new Error('read-only settings')),
  })

  expect(rollback).toEqual({
    status: 'failed',
    error: 'read-only settings',
  })
})

test('merged dialog transitions preserve the first fresh preimage per key', () => {
  const merged = mergeSettingsTransitions(
    {
      attempted: { model: 'model-c' },
      previous: { model: 'model-b', effortLevel: 'low' },
    },
    {
      attempted: { model: 'model-d', effortLevel: 'high' },
      previous: { model: 'model-c', effortLevel: 'medium' },
    },
  )

  expect(merged).toEqual({
    attempted: { model: 'model-d', effortLevel: 'high' },
    previous: { model: 'model-b', effortLevel: 'medium' },
  })
})

test('fast-mode cancellation restores both its model and latch', () => {
  let settings: SettingsJson = {
    model: 'claude-sonnet-4-6',
    fastMode: undefined,
  }
  const committed = commitSettingsTransition(
    { model: 'claude-opus-4-6', fastMode: true },
    {
      updateFresh: (_source, update) => {
        settings = { ...settings, ...update(structuredClone(settings)) }
        return committedResult()
      },
    },
  )

  const rollback = rollbackModelSettingsTransition(committed.transition!, {
    updateFreshOrNoop: (_source, update) => {
      const patch = update(structuredClone(settings))
      if (typeof patch === 'symbol') {
        return unchangedResult()
      }
      settings = { ...settings, ...patch }
      return committedResult()
    },
  })

  expect(rollback).toEqual({ status: 'restored' })
  expect(settings).toMatchObject({
    model: 'claude-sonnet-4-6',
    fastMode: undefined,
  })
})
