import assert from 'node:assert/strict'
import test from 'node:test'

import { FpsTracker } from './fpsTracker.js'

test('FpsTracker keeps a bounded frame-duration sample window', () => {
  const tracker = new FpsTracker()

  for (let i = 0; i < 6000; i++) {
    tracker.record(i)
  }

  const state = tracker as unknown as {
    frameDurations: number[]
    sampleCount: number
    writeIndex: number
  }
  assert.equal(state.frameDurations.length, 5000)
  assert.equal(state.sampleCount, 5000)
  assert.equal(state.writeIndex, 1000)
  assert.equal(state.frameDurations[state.writeIndex], 1000)
  assert.equal(state.frameDurations[state.writeIndex - 1], 5999)
})

test('FpsTracker keeps average FPS stable after the sample cap is reached', () => {
  const originalPerformance = globalThis.performance
  let now = 0

  Object.defineProperty(globalThis, 'performance', {
    configurable: true,
    value: {
      now: () => now,
    },
  })

  try {
    const tracker = new FpsTracker()

    for (let i = 0; i < 6000; i++) {
      now = i * (1000 / 60)
      tracker.record(1000 / 60)
    }

    assert.equal(tracker.getMetrics()?.averageFps, 60.01)
  } finally {
    Object.defineProperty(globalThis, 'performance', {
      configurable: true,
      value: originalPerformance,
    })
  }
})
