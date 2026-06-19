import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import type { DebugLogLevel } from './debug.js'

type AnalyticsModule = typeof import('../services/analytics/index.js')
type DebugModule = typeof import('./debug.js')
type LogEventSpy = ReturnType<
  typeof mock<(eventName: string, metadata?: Record<string, unknown>) => void>
>
type DebugSpy = ReturnType<
  typeof mock<(message: string, options?: { level?: DebugLogLevel }) => void>
>

const originalEnv = {
  CLAUDE_DEBUG: process.env.CLAUDE_DEBUG,
  NODE_ENV: process.env.NODE_ENV,
  USER_TYPE: process.env.USER_TYPE,
}

let actualAnalyticsModule: AnalyticsModule | undefined
let actualDebugModule: DebugModule | undefined
let resetImportedWarningHandler: (() => void) | undefined

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

beforeEach(async () => {
  await acquireSharedMutationLock('warningHandler.test.ts')
  process.env.CLAUDE_DEBUG = '1'
  process.env.NODE_ENV = 'development'
  delete process.env.USER_TYPE
})

afterEach(() => {
  try {
    resetImportedWarningHandler?.()
    resetImportedWarningHandler = undefined
    restoreEnv('CLAUDE_DEBUG', originalEnv.CLAUDE_DEBUG)
    restoreEnv('NODE_ENV', originalEnv.NODE_ENV)
    restoreEnv('USER_TYPE', originalEnv.USER_TYPE)
    mock.restore()
    restoreMockedModules()
  } finally {
    releaseSharedMutationLock()
  }
})

test('logs trace-warnings guidance for performance entry buffer warnings', async () => {
  const { debugSpy } = await mockWarningHandlerDependencies()
  const { initializeWarningHandler } = await importWarningHandler()

  initializeWarningHandler()
  process.emit('warning', createPerformanceEntryBufferWarning())

  const guidanceCall = debugSpy.mock.calls.find(call =>
    String(call?.[0]).includes('MaxPerformanceEntryBufferExceededWarning'),
  )

  expect(guidanceCall).toBeDefined()
  const guidance = String(guidanceCall?.[0])
  expect(guidance).toContain('MaxPerformanceEntryBufferExceededWarning')
  expect(guidance).toContain('PerformanceEntry buffer exceeded')
  expect(guidance).toContain('NODE_OPTIONS=--trace-warnings')
  expect(guidanceCall?.[1]).toEqual({ level: 'warn' })
})

test('logs compact analytics for performance entry buffer warnings', async () => {
  const { logEventSpy } = await mockWarningHandlerDependencies()
  const { initializeWarningHandler } = await importWarningHandler()

  initializeWarningHandler()
  process.emit('warning', createPerformanceEntryBufferWarning())

  expect(logEventSpy).toHaveBeenCalledTimes(1)
  const [eventName, metadata] = logEventSpy.mock.calls[0] ?? []
  expect(eventName).toBe('tengu_node_warning')
  expect(metadata).toMatchObject({
    is_internal: 0,
    occurrence_count: 1,
    classname: 'MaxPerformanceEntryBufferExceededWarning',
  })
  expect(metadata).not.toHaveProperty('message')
})

test('compacts multiline performance entry buffer warning messages', async () => {
  const { debugSpy } = await mockWarningHandlerDependencies()
  const { initializeWarningHandler } = await importWarningHandler()

  initializeWarningHandler()
  process.emit(
    'warning',
    createPerformanceEntryBufferWarning(
      `PerformanceEntry buffer exceeded\n${'measure '.repeat(60)}tail-token`,
    ),
  )

  const guidanceCall = debugSpy.mock.calls.find(call =>
    String(call?.[0]).includes('MaxPerformanceEntryBufferExceededWarning'),
  )

  expect(guidanceCall).toBeDefined()
  const guidance = String(guidanceCall?.[0])
  expect(guidance).toContain('PerformanceEntry buffer exceeded measure')
  expect(guidance).toContain('...')
  expect(guidance).toContain('NODE_OPTIONS=--trace-warnings')
  expect(guidance).not.toContain('\n')
  expect(guidance).not.toContain('tail-token')
})

test('preserves generic debug warning formatting', async () => {
  const { debugSpy } = await mockWarningHandlerDependencies()
  const { initializeWarningHandler } = await importWarningHandler()

  initializeWarningHandler()
  const warning = new Error('plain warning')
  warning.name = 'PlainWarning'
  process.emit('warning', warning)

  expect(debugSpy.mock.calls).toEqual([
    ['[Warning] PlainWarning: plain warning', { level: 'warn' }],
  ])
})

async function mockWarningHandlerDependencies(): Promise<{
  debugSpy: DebugSpy
  logEventSpy: LogEventSpy
}> {
  actualAnalyticsModule ??= await import(
    `../services/analytics/index.ts?warningHandlerActual=${Date.now()}-${Math.random()}`
  )
  actualDebugModule ??= await import(
    `./debug.ts?warningHandlerActual=${Date.now()}-${Math.random()}`
  )

  const debugSpy = mock(
    (_message: string, _options?: { level?: DebugLogLevel }) => {},
  )
  const logEventSpy = mock(
    (_eventName: string, _metadata?: Record<string, unknown>) => {},
  )

  mock.module('./debug.js', () => ({
    ...actualDebugModule!,
    logForDebugging: debugSpy,
  }))
  mock.module('src/utils/debug.js', () => ({
    ...actualDebugModule!,
    logForDebugging: debugSpy,
  }))
  mock.module('src/services/analytics/index.js', () => ({
    ...actualAnalyticsModule!,
    logEvent: logEventSpy,
  }))

  return { debugSpy, logEventSpy }
}

async function importWarningHandler(): Promise<
  typeof import('./warningHandler.js')
> {
  const module = await import(
    `./warningHandler.ts?warningHandlerTest=${Date.now()}-${Math.random()}`
  )
  resetImportedWarningHandler = module.resetWarningHandler
  return module
}

function createPerformanceEntryBufferWarning(
  message = 'PerformanceEntry buffer exceeded for type measure',
): Error {
  const warning = new Error(message)
  warning.name = 'MaxPerformanceEntryBufferExceededWarning'
  return warning
}

function restoreMockedModules(): void {
  if (actualAnalyticsModule) {
    mock.module('src/services/analytics/index.js', () => ({
      ...actualAnalyticsModule!,
    }))
  }
  if (actualDebugModule) {
    mock.module('./debug.js', () => ({ ...actualDebugModule! }))
    mock.module('src/utils/debug.js', () => ({ ...actualDebugModule! }))
  }
}
