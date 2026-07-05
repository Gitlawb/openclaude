import assert from 'node:assert/strict'
import test from 'node:test'

import { FpsTracker } from './fpsTracker.js'

test('FpsTracker keeps a bounded frame-duration sample window', () => {
  const tracker = new FpsTracker()

  for (let i = 0; i < 6000; i++) {
    tracker.record(i)
  }

  const state = tracker as unknown as { frameDurations: number[] }
  assert.equal(state.frameDurations.length, 5000)
  assert.equal(state.frameDurations[0], 1000)
  assert.equal(state.frameDurations.at(-1), 5999)
})
