import { expect, test } from 'bun:test'
import type { SettingsJson } from './types.js'
import {
  commitModelSettingsTransition,
  commitSettingsTransition,
  mergeSettingsTransitions,
  rollbackModelSettingsTransition,
} from './modelTransition.js'

test('rollback restores the lock-scoped preimage rather than a render-time value', () => {
  let settings: SettingsJson = { model: 'peer-model', effortLevel: 'high' }
  const committed = commitModelSettingsTransition(
    'next-model',
    { effortLevel: 'low' },
    {
      updateFresh: (_source, update) => {
        settings = { ...settings, ...update(structuredClone(settings)) }
        return { error: null, written: true, committed: true }
      },
    },
  )

  expect(committed.transition).toBeDefined()
  const rollback = rollbackModelSettingsTransition(committed.transition!, {
    updateFreshOrNoop: (_source, update) => {
      const patch = update(structuredClone(settings))
      if (typeof patch === 'symbol') {
        return { error: null, written: false, unchanged: true }
      }
      settings = { ...settings, ...patch }
      return { error: null, written: true, committed: true }
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
      return { error: null, written: true, committed: true }
    },
  })
  settings.model = 'newer-model'

  const rollback = rollbackModelSettingsTransition(committed.transition!, {
    updateFreshOrNoop: (_source, update) => {
      const patch = update(structuredClone(settings))
      expect(typeof patch).toBe('symbol')
      return { error: null, written: false, unchanged: true }
    },
  })

  expect(rollback).toEqual({ status: 'superseded' })
  expect(settings.model).toBe('newer-model')
})

test('rollback reports when restoring the previous model was rejected', () => {
  const committed = commitModelSettingsTransition('next-model', {}, {
    updateFresh: (_source, update) => {
      update({ model: 'previous-model' })
      return { error: null, written: true, committed: true }
    },
  })

  const rollback = rollbackModelSettingsTransition(committed.transition!, {
    updateFreshOrNoop: () => ({
      error: new Error('read-only settings'),
      written: false,
      committed: false,
    }),
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
        return { error: null, written: true, committed: true }
      },
    },
  )

  const rollback = rollbackModelSettingsTransition(committed.transition!, {
    updateFreshOrNoop: (_source, update) => {
      const patch = update(structuredClone(settings))
      if (typeof patch === 'symbol') {
        return { error: null, written: false, unchanged: true }
      }
      settings = { ...settings, ...patch }
      return { error: null, written: true, committed: true }
    },
  })

  expect(rollback).toEqual({ status: 'restored' })
  expect(settings).toMatchObject({
    model: 'claude-sonnet-4-6',
    fastMode: undefined,
  })
})
