import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  __getInterruptionTraceSnapshotForTests,
  __resetInterruptionTraceForTests,
  flushInterruptionTrace,
  registerInterruptionController,
  requestAbort,
  traceInterruptionEvent,
} from './interruptionTrace.js'
import { createCombinedAbortSignal } from './combinedAbortSignal.js'

const originalEnabled = process.env.OPENCLAUDE_INTERRUPT_TRACE
const originalFile = process.env.OPENCLAUDE_INTERRUPT_TRACE_FILE
let tempDirectory: string | undefined

beforeEach(() => {
  __resetInterruptionTraceForTests()
  delete process.env.OPENCLAUDE_INTERRUPT_TRACE
  delete process.env.OPENCLAUDE_INTERRUPT_TRACE_FILE
})

afterEach(async () => {
  __resetInterruptionTraceForTests()
  if (originalEnabled === undefined) delete process.env.OPENCLAUDE_INTERRUPT_TRACE
  else process.env.OPENCLAUDE_INTERRUPT_TRACE = originalEnabled
  if (originalFile === undefined) delete process.env.OPENCLAUDE_INTERRUPT_TRACE_FILE
  else process.env.OPENCLAUDE_INTERRUPT_TRACE_FILE = originalFile
  if (tempDirectory) {
    await rm(tempDirectory, { recursive: true, force: true })
    tempDirectory = undefined
  }
})

describe('interruptionTrace', () => {
  test('is a true no-op while disabled and preserves native abort behavior', () => {
    const controller = new AbortController()
    registerInterruptionController(controller, { controllerRole: 'root' })
    traceInterruptionEvent('query.started', { queryId: 'query-1' })
    requestAbort(controller, 'query-timeout', {
      source: 'query_guard',
      controllerRole: 'root',
    })

    expect(controller.signal.reason).toBe('query-timeout')
    expect(__getInterruptionTraceSnapshotForTests()).toEqual([])
  })

  test('correlates controllers and records first-wins plus repeated requests', () => {
    process.env.OPENCLAUDE_INTERRUPT_TRACE = '1'
    const controller = new AbortController()
    const controllerId = registerInterruptionController(controller, {
      controllerRole: 'query-root',
      queryId: 'query-1',
    })

    requestAbort(controller, 'query-timeout', {
      source: 'query_guard',
      queryId: 'query-1',
    })
    requestAbort(controller, 'user-cancel', {
      source: 'cancel_keybinding',
      queryId: 'query-1',
    })

    const entries = __getInterruptionTraceSnapshotForTests()
    const requested = entries.find(entry => entry.event === 'abort.requested')
    const observed = entries.find(entry => entry.event === 'signal.observed')
    const repeated = entries.find(entry => entry.event === 'abort.repeated')
    expect(controller.signal.reason).toBe('query-timeout')
    expect(requested?.controllerId).toBe(controllerId)
    expect(requested?.normalizedReason).toBe('query-timeout')
    expect(requested?.abortStackFingerprint).toMatch(/^[a-f0-9]{16}$/)
    expect(requested?.abortCallSites?.every(site => !site.includes('/'))).toBe(true)
    expect(observed?.firstAbortEventId).toBe(requested?.eventId)
    expect(repeated?.firstAbortEventId).toBe(requested?.eventId)
    expect(repeated?.existingNormalizedReason).toBe('query-timeout')
    expect(repeated?.attemptedNormalizedReason).toBe('user-abort')
    expect(repeated?.outcome).toBe('ignored_first_abort_wins')
    expect(repeated?.repeatedCount).toBe(1)
  })

  test('links a combined signal abort to the winning parent request', () => {
    process.env.OPENCLAUDE_INTERRUPT_TRACE = '1'
    const parent = new AbortController()
    registerInterruptionController(parent, {
      controllerRole: 'query-root',
    })
    const combined = createCombinedAbortSignal(parent.signal, {
      trace: {
        subsystem: 'trace-test',
        controllerRole: 'combined',
      },
    })

    requestAbort(parent, 'query-timeout', {
      source: 'query_guard',
      subsystem: 'trace-test',
      controllerRole: 'query-root',
    })

    const requested = __getInterruptionTraceSnapshotForTests().filter(
      entry => entry.event === 'abort.requested',
    )
    expect(combined.signal.reason).toBe('query-timeout')
    expect(requested).toHaveLength(2)
    expect(requested[1]?.causalEventId).toBe(requested[0]?.eventId)
    expect(requested[1]?.winningParentControllerId).toBe(
      requested[0]?.controllerId,
    )
    combined.cleanup()
  })

  test('keeps only the newest 512 allowlisted records', () => {
    process.env.OPENCLAUDE_INTERRUPT_TRACE = 'true'
    for (let index = 0; index < 600; index++) {
      traceInterruptionEvent('stream.progress', {
        rawByteCount: index,
        // Runtime extras are deliberately ignored by the allowlist boundary.
        ...({ prompt: 'must-not-appear' } as Record<string, unknown>),
      })
    }

    const entries = __getInterruptionTraceSnapshotForTests()
    expect(entries).toHaveLength(512)
    expect(entries[0]?.sequence).toBe(89)
    expect(entries.at(-1)?.sequence).toBe(600)
    expect(JSON.stringify(entries)).not.toContain('must-not-appear')
    expect(JSON.stringify(entries)).not.toContain('prompt')
  })

  test('flushes valid JSONL once to an explicit absolute path', async () => {
    process.env.OPENCLAUDE_INTERRUPT_TRACE = '1'
    tempDirectory = await mkdtemp(join(tmpdir(), 'openclaude-interrupt-trace-'))
    const traceFile = join(tempDirectory, 'trace.jsonl')
    process.env.OPENCLAUDE_INTERRUPT_TRACE_FILE = traceFile

    traceInterruptionEvent('query.started', {
      queryId: 'query-1',
      model: 'gpt-test',
    })
    flushInterruptionTrace('test')
    flushInterruptionTrace('test-repeat')

    const lines = (await readFile(traceFile, 'utf8')).trim().split('\n')
    const entries = lines.map(line => JSON.parse(line) as { event: string })
    expect(entries.map(entry => entry.event)).toEqual([
      'query.started',
      'trace.flush',
    ])
  })

  test('does not write for relative paths and isolates write failures', () => {
    process.env.OPENCLAUDE_INTERRUPT_TRACE = '1'
    traceInterruptionEvent('query.started')

    process.env.OPENCLAUDE_INTERRUPT_TRACE_FILE = 'relative-trace.jsonl'
    expect(() => flushInterruptionTrace('relative')).not.toThrow()
    process.env.OPENCLAUDE_INTERRUPT_TRACE_FILE = '/proc/openclaude/trace.jsonl'
    expect(() => flushInterruptionTrace('unwritable')).not.toThrow()
  })

  test('redacts secret-shaped values and absolute local paths', () => {
    process.env.OPENCLAUDE_INTERRUPT_TRACE = '1'
    traceInterruptionEvent('provider.failed', {
      model: 'sk-test-secret-value',
      attemptId: '/home/example/private/file',
      error: new Error('message content is never serialized'),
    })

    const serialized = JSON.stringify(__getInterruptionTraceSnapshotForTests())
    expect(serialized).toContain('[redacted]')
    expect(serialized).toContain('Error')
    expect(serialized).not.toContain('sk-test-secret-value')
    expect(serialized).not.toContain('/home/example/private/file')
    expect(serialized).not.toContain('message content')
  })
})
