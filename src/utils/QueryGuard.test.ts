import { expect, test } from 'bun:test'
import { QueryGuard } from './QueryGuard.js'

test('reserves one generation across prompt preparation and streaming', () => {
  const guard = new QueryGuard()
  expect(guard.reserve()).toBe(true)
  const preparation = guard.generation
  expect(guard.tryStart()).toBe(preparation)
  expect(guard.reserve()).toBe(false)
  expect(guard.end(preparation)).toBe(true)
})

test('cancellation pauses dispatch even when only background work remains', () => {
  const guard = new QueryGuard()
  guard.pause()
  expect(guard.isActive).toBe(false)
  expect(guard.getPausedSnapshot()).toBe(true)
  expect(guard.reserve()).toBe(false)
  expect(guard.tryStart()).toBeNull()
  guard.resume()
  expect(guard.reserve()).toBe(true)
})

test('old preparation and finally cannot release a new reservation or query', () => {
  const guard = new QueryGuard()
  guard.reserve()
  const old = guard.generation
  guard.pause()
  guard.resume()
  guard.reserve()
  const next = guard.generation
  guard.cancelReservation(old)
  expect(guard.isActive).toBe(true)
  expect(guard.isCurrent(old)).toBe(false)
  expect(guard.tryStart()).toBe(next)
  expect(guard.end(old)).toBe(false)
  expect(guard.isActive).toBe(true)
  expect(guard.end(next)).toBe(true)
})
