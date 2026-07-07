import assert from 'node:assert/strict'
import test from 'node:test'

import {
  __resetManualHeapDumpCountForTesting,
  getHeapDumpAnalyticsMetadata,
  getEffectiveHeapDumpNumber,
  getHeapDumpFilePaths,
} from './heapDumpService.js'

test('manual heap dumps receive sequential effective dump numbers', () => {
  __resetManualHeapDumpCountForTesting()

  assert.equal(getEffectiveHeapDumpNumber('manual'), 1)
  assert.equal(getEffectiveHeapDumpNumber('manual'), 2)
})

test('explicit and auto heap dump numbers pass through unchanged', () => {
  __resetManualHeapDumpCountForTesting()

  assert.equal(getEffectiveHeapDumpNumber('manual', 7), 7)
  assert.equal(getEffectiveHeapDumpNumber('auto-1.5GB', 3), 3)
  assert.equal(getEffectiveHeapDumpNumber('auto-1.5GB'), 0)
})

test('failure analytics uses the effective heap dump number', () => {
  __resetManualHeapDumpCountForTesting()

  const effectiveDumpNumber = getEffectiveHeapDumpNumber('manual')

  assert.deepEqual(
    getHeapDumpAnalyticsMetadata('manual', effectiveDumpNumber, false),
    {
      triggerManual: true,
      triggerAuto15GB: false,
      dumpNumber: 1,
      success: false,
    },
  )
})

test('effective dump numbers are used in generated heap dump filenames', () => {
  __resetManualHeapDumpCountForTesting()

  const firstManual = getEffectiveHeapDumpNumber('manual')
  const secondManual = getEffectiveHeapDumpNumber('manual')

  assert.deepEqual(
    getHeapDumpFilePaths('session-123', '/tmp/dumps', firstManual),
    {
      heapPath: '/tmp/dumps/session-123-dump1.heapsnapshot',
      diagPath: '/tmp/dumps/session-123-dump1-diagnostics.json',
    },
  )
  assert.deepEqual(
    getHeapDumpFilePaths('session-123', '/tmp/dumps', secondManual),
    {
      heapPath: '/tmp/dumps/session-123-dump2.heapsnapshot',
      diagPath: '/tmp/dumps/session-123-dump2-diagnostics.json',
    },
  )
  assert.deepEqual(getHeapDumpFilePaths('session-123', '/tmp/dumps', 7), {
    heapPath: '/tmp/dumps/session-123-dump7.heapsnapshot',
    diagPath: '/tmp/dumps/session-123-dump7-diagnostics.json',
  })
})
