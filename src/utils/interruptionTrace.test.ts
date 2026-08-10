import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  __getInterruptionTraceSnapshotForTests,
  __INTERRUPTION_TRACE_CAPACITY_FOR_TESTS,
  __resetInterruptionTraceForTests,
  __waitForInterruptionTraceFlushForTests,
  flushInterruptionTrace,
  getInterruptionSignalAbortEventId,
  registerInterruptionController,
  requestAbort,
  traceInterruptionEvent,
} from './interruptionTrace.js'
import { createCombinedAbortSignal } from './combinedAbortSignal.js'
import { createChildAbortController } from './abortController.js'
import { logForDiagnosticsNoPII } from './diagLogs.js'
import {
  getFsImplementation,
  setFsImplementation,
  type FsOperations,
} from './fsOperations.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

const originalEnabled = process.env.OPENCLAUDE_INTERRUPT_TRACE
const originalFile = process.env.OPENCLAUDE_INTERRUPT_TRACE_FILE
const originalDiagnosticsFile = process.env.CLAUDE_CODE_DIAGNOSTICS_FILE
let tempDirectory: string | undefined
let originalFs: FsOperations

beforeEach(async () => {
  await acquireSharedMutationLock('utils/interruptionTrace.test.ts')
  originalFs = getFsImplementation()
  await __waitForInterruptionTraceFlushForTests()
  __resetInterruptionTraceForTests()
  delete process.env.OPENCLAUDE_INTERRUPT_TRACE
  delete process.env.OPENCLAUDE_INTERRUPT_TRACE_FILE
  delete process.env.CLAUDE_CODE_DIAGNOSTICS_FILE
})

afterEach(async () => {
  await __waitForInterruptionTraceFlushForTests()
  __resetInterruptionTraceForTests()
  setFsImplementation(originalFs)
  if (originalEnabled === undefined) delete process.env.OPENCLAUDE_INTERRUPT_TRACE
  else process.env.OPENCLAUDE_INTERRUPT_TRACE = originalEnabled
  if (originalFile === undefined) delete process.env.OPENCLAUDE_INTERRUPT_TRACE_FILE
  else process.env.OPENCLAUDE_INTERRUPT_TRACE_FILE = originalFile
  if (originalDiagnosticsFile === undefined) {
    delete process.env.CLAUDE_CODE_DIAGNOSTICS_FILE
  } else {
    process.env.CLAUDE_CODE_DIAGNOSTICS_FILE = originalDiagnosticsFile
  }
  if (tempDirectory) {
    await rm(tempDirectory, { recursive: true, force: true })
    tempDirectory = undefined
  }
  releaseSharedMutationLock()
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

  test('assigns a causal event id when a registered signal aborts natively', () => {
    process.env.OPENCLAUDE_INTERRUPT_TRACE = '1'
    const controller = new AbortController()
    registerInterruptionController(controller, { controllerRole: 'external' })

    controller.abort('external-abort')

    const observed = __getInterruptionTraceSnapshotForTests().find(
      entry => entry.event === 'signal.observed',
    )
    expect(getInterruptionSignalAbortEventId(controller.signal)).toBe(
      observed?.eventId,
    )
  })

  test('observes and flushes a query-root controller already aborted when registered', async () => {
    process.env.OPENCLAUDE_INTERRUPT_TRACE = '1'
    process.env.OPENCLAUDE_INTERRUPT_TRACE_FILE = '/trace.jsonl'
    let writes = 0
    setFsImplementation({
      ...originalFs,
      appendRegularFile: async () => {
        writes++
      },
    })
    const controller = new AbortController()
    controller.abort('external-abort')

    registerInterruptionController(controller, { controllerRole: 'query-root' })
    await __waitForInterruptionTraceFlushForTests()

    const observed = __getInterruptionTraceSnapshotForTests().find(
      entry => entry.event === 'signal.observed',
    )
    expect(observed?.controllerRole).toBe('query-root')
    expect(getInterruptionSignalAbortEventId(controller.signal)).toBe(
      observed?.eventId,
    )
    expect(writes).toBe(1)
  })

  test('preserves an established query-root role when creating a child', async () => {
    process.env.OPENCLAUDE_INTERRUPT_TRACE = '1'
    process.env.OPENCLAUDE_INTERRUPT_TRACE_FILE = '/trace.jsonl'
    let writes = 0
    setFsImplementation({
      ...originalFs,
      appendRegularFile: async () => {
        writes++
      },
    })
    const parent = new AbortController()
    registerInterruptionController(parent, { controllerRole: 'query-root' })
    createChildAbortController(parent)

    requestAbort(parent, 'user-cancel', {
      source: 'cancel_keybinding',
      controllerRole: 'tool',
    })
    await __waitForInterruptionTraceFlushForTests()

    const observed = __getInterruptionTraceSnapshotForTests().find(
      entry =>
        entry.event === 'signal.observed' &&
        entry.normalizedReason === 'user-abort',
    )
    expect(observed?.controllerRole).toBe('query-root')
    expect(writes).toBe(1)
  })

  test('throwing abort-reason accessors cannot block native or combined aborts', () => {
    process.env.OPENCLAUDE_INTERRUPT_TRACE = '1'
    const reason = new Proxy(
      {},
      {
        get() {
          throw new Error('reason getter must stay isolated')
        },
      },
    )
    const direct = new AbortController()
    expect(() =>
      requestAbort(direct, reason, {
        source: 'throwing-reason-test',
        controllerRole: 'query-root',
      }),
    ).not.toThrow()
    expect(direct.signal.aborted).toBe(true)
    expect(direct.signal.reason).toBe(reason)

    const parent = new AbortController()
    const combined = createCombinedAbortSignal(parent.signal)
    expect(() => parent.abort(reason)).not.toThrow()
    expect(combined.signal.aborted).toBe(true)
    expect(combined.signal.reason).toBe(reason)
    combined.cleanup()
  })

  test('keeps only the newest allowlisted records up to capacity', () => {
    process.env.OPENCLAUDE_INTERRUPT_TRACE = 'true'
    const emitted = __INTERRUPTION_TRACE_CAPACITY_FOR_TESTS + 88
    for (let index = 0; index < emitted; index++) {
      traceInterruptionEvent('stream.progress', {
        rawByteCount: index,
        // Runtime extras are deliberately ignored by the allowlist boundary.
        ...({ prompt: 'must-not-appear' } as Record<string, unknown>),
      })
    }

    const entries = __getInterruptionTraceSnapshotForTests()
    expect(entries).toHaveLength(__INTERRUPTION_TRACE_CAPACITY_FOR_TESTS)
    expect(entries[0]?.sequence).toBe(emitted - __INTERRUPTION_TRACE_CAPACITY_FOR_TESTS + 1)
    expect(entries.at(-1)?.sequence).toBe(emitted)
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
    await __waitForInterruptionTraceFlushForTests()

    const lines = (await readFile(traceFile, 'utf8')).trim().split('\n')
    const entries = lines.map(line => JSON.parse(line) as { event: string })
    expect(entries.map(entry => entry.event)).toEqual([
      'query.started',
      'trace.flush',
    ])
  })

  test('flushes every pending record when the ring is at capacity', async () => {
    process.env.OPENCLAUDE_INTERRUPT_TRACE = '1'
    tempDirectory = await mkdtemp(join(tmpdir(), 'openclaude-interrupt-trace-'))
    const traceFile = join(tempDirectory, 'trace.jsonl')
    process.env.OPENCLAUDE_INTERRUPT_TRACE_FILE = traceFile
    for (let index = 0; index < __INTERRUPTION_TRACE_CAPACITY_FOR_TESTS; index++) {
      traceInterruptionEvent('stream.progress', { rawByteCount: index })
    }

    flushInterruptionTrace('capacity')
    await __waitForInterruptionTraceFlushForTests()

    const entries = (await readFile(traceFile, 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as { sequence: number; event: string })
    expect(entries).toHaveLength(__INTERRUPTION_TRACE_CAPACITY_FOR_TESTS + 1)
    expect(entries[0]?.sequence).toBe(1)
    expect(entries.at(-1)?.event).toBe('trace.flush')
  })

  test('retains pending records after a failed write and retries them', async () => {
    process.env.OPENCLAUDE_INTERRUPT_TRACE = '1'
    process.env.OPENCLAUDE_INTERRUPT_TRACE_FILE = '/trace.jsonl'
    let failWrites = true
    const successfulWrites: string[] = []
    setFsImplementation({
      ...originalFs,
      mkdirSync: () => {},
      appendRegularFile: async (_path, data) => {
        if (failWrites) throw new Error('synthetic write failure')
        successfulWrites.push(data)
      },
    })

    traceInterruptionEvent('first')
    flushInterruptionTrace('failed')
    await __waitForInterruptionTraceFlushForTests()
    failWrites = false
    traceInterruptionEvent('second')
    flushInterruptionTrace('retry')
    await __waitForInterruptionTraceFlushForTests()

    expect(successfulWrites).toHaveLength(1)
    const events = successfulWrites[0]!
      .trim()
      .split('\n')
      .map(line => (JSON.parse(line) as { event: string }).event)
    expect(events).toEqual(['first', 'second', 'trace.flush'])
  })

  test('rejects an existing non-regular trace target', async () => {
    process.env.OPENCLAUDE_INTERRUPT_TRACE = '1'
    tempDirectory = await mkdtemp(join(tmpdir(), 'openclaude-interrupt-trace-'))
    process.env.OPENCLAUDE_INTERRUPT_TRACE_FILE = tempDirectory
    traceInterruptionEvent('pending')

    flushInterruptionTrace('non-regular')
    await __waitForInterruptionTraceFlushForTests()

    expect(
      __getInterruptionTraceSnapshotForTests().some(
        entry => entry.event === 'trace.flush',
      ),
    ).toBe(false)
  })

  test('rejects symlink targets and creates private files and directories', async () => {
    process.env.OPENCLAUDE_INTERRUPT_TRACE = '1'
    tempDirectory = await mkdtemp(join(tmpdir(), 'openclaude-interrupt-trace-'))
    const target = join(tempDirectory, 'target.jsonl')
    const link = join(tempDirectory, 'trace-link.jsonl')
    await writeFile(target, '')
    await symlink(target, link)
    process.env.OPENCLAUDE_INTERRUPT_TRACE_FILE = link
    traceInterruptionEvent('symlink-pending')
    flushInterruptionTrace('symlink')
    await __waitForInterruptionTraceFlushForTests()
    expect(await readFile(target, 'utf8')).toBe('')

    const privateDirectory = join(tempDirectory, 'private')
    const privateTrace = join(privateDirectory, 'trace.jsonl')
    process.env.OPENCLAUDE_INTERRUPT_TRACE_FILE = privateTrace
    flushInterruptionTrace('private-target')
    await __waitForInterruptionTraceFlushForTests()
    expect((await stat(privateDirectory)).mode & 0o777).toBe(0o700)
    expect((await stat(privateTrace)).mode & 0o777).toBe(0o600)
  })

  test('preserves legacy diagnostics append-through-symlink behavior', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'openclaude-diagnostics-'))
    const target = join(tempDirectory, 'target.jsonl')
    const link = join(tempDirectory, 'diagnostics-link.jsonl')
    await writeFile(target, '')
    await symlink(target, link)
    process.env.CLAUDE_CODE_DIAGNOSTICS_FILE = link

    logForDiagnosticsNoPII('info', 'symlink-test')

    expect(await readFile(target, 'utf8')).toContain('symlink-test')
    delete process.env.CLAUDE_CODE_DIAGNOSTICS_FILE
  })

  test('does not block native abort while a trace append is pending', async () => {
    process.env.OPENCLAUDE_INTERRUPT_TRACE = '1'
    process.env.OPENCLAUDE_INTERRUPT_TRACE_FILE = '/trace.jsonl'
    let releaseWrite!: () => void
    const writeBlocked = new Promise<void>(resolve => {
      releaseWrite = resolve
    })
    setFsImplementation({
      ...originalFs,
      appendRegularFile: async () => writeBlocked,
    })
    const controller = new AbortController()

    requestAbort(controller, 'user-cancel', {
      source: 'cancel_keybinding',
      controllerRole: 'query-root',
    })

    expect(controller.signal.aborted).toBe(true)
    releaseWrite()
    await __waitForInterruptionTraceFlushForTests()
  })

  test('keeps sequence IDs unique and later events pending during an async flush', async () => {
    process.env.OPENCLAUDE_INTERRUPT_TRACE = '1'
    process.env.OPENCLAUDE_INTERRUPT_TRACE_FILE = '/trace.jsonl'
    let releaseFirstWrite!: () => void
    let markFirstWriteStarted!: () => void
    const firstWriteStarted = new Promise<void>(resolve => {
      markFirstWriteStarted = resolve
    })
    const firstWriteBlocked = new Promise<void>(resolve => {
      releaseFirstWrite = resolve
    })
    const writes: string[] = []
    setFsImplementation({
      ...originalFs,
      appendRegularFile: async (_path, data) => {
        writes.push(data)
        if (writes.length === 1) {
          markFirstWriteStarted()
          await firstWriteBlocked
        }
      },
    })

    traceInterruptionEvent('before')
    flushInterruptionTrace('first')
    await firstWriteStarted
    traceInterruptionEvent('during_one')
    traceInterruptionEvent('during_two')
    releaseFirstWrite()
    await __waitForInterruptionTraceFlushForTests()
    flushInterruptionTrace('second')
    await __waitForInterruptionTraceFlushForTests()

    const persistedEvents = writes.flatMap(write =>
      write
        .trim()
        .split('\n')
        .map(line => (JSON.parse(line) as { event: string }).event),
    )
    expect(persistedEvents.filter(event => event === 'before')).toHaveLength(1)
    expect(persistedEvents.filter(event => event === 'during_one')).toHaveLength(1)
    expect(persistedEvents.filter(event => event === 'during_two')).toHaveLength(1)
    const snapshot = __getInterruptionTraceSnapshotForTests()
    expect(new Set(snapshot.map(entry => entry.eventId)).size).toBe(snapshot.length)
    expect(snapshot.map(entry => entry.sequence)).toEqual(
      [...snapshot.map(entry => entry.sequence)].sort((left, right) => left - right),
    )
  })

  test('does not write for relative paths and isolates write failures', async () => {
    process.env.OPENCLAUDE_INTERRUPT_TRACE = '1'
    traceInterruptionEvent('query.started')

    process.env.OPENCLAUDE_INTERRUPT_TRACE_FILE = 'relative-trace.jsonl'
    expect(() => flushInterruptionTrace('relative')).not.toThrow()
    process.env.OPENCLAUDE_INTERRUPT_TRACE_FILE = '/proc/openclaude/trace.jsonl'
    expect(() => flushInterruptionTrace('unwritable')).not.toThrow()
    await __waitForInterruptionTraceFlushForTests()
  })

  test('redacts secret-shaped values and absolute local paths', () => {
    process.env.OPENCLAUDE_INTERRUPT_TRACE = '1'
    traceInterruptionEvent('provider.failed', {
      model: 'AKIA1234567890ABCDEF',
      providerRoute: 'github_pat_1234567890abcdef',
      attemptId: '\\\\server\\share\\private',
      queryId: 'prefix(/srv/private/project)',
      error: new Error('message content is never serialized'),
    })

    const serialized = JSON.stringify(__getInterruptionTraceSnapshotForTests())
    expect(serialized).toContain('[redacted]')
    expect(serialized).toContain('Error')
    expect(serialized).not.toContain('AKIA1234567890ABCDEF')
    expect(serialized).not.toContain('github_pat_1234567890abcdef')
    expect(serialized).not.toContain('server')
    expect(serialized).not.toContain('/srv/private/project')
    expect(serialized).not.toContain('message content')
  })
})
