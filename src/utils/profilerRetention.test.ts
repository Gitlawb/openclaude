import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { performance } from 'perf_hooks'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import * as analytics from '../services/analytics/index.js'
import * as bootstrapState from '../bootstrap/state.js'
import * as debug from './debug.js'

const originalEnv = {
  CLAUDE_CODE_PROFILE_QUERY: process.env.CLAUDE_CODE_PROFILE_QUERY,
  CLAUDE_CODE_PROFILE_STARTUP: process.env.CLAUDE_CODE_PROFILE_STARTUP,
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
  USER_TYPE: process.env.USER_TYPE,
}

let tempConfigDir: string | undefined

function restoreEnv(key: keyof typeof originalEnv): void {
  const value = originalEnv[key]
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

function freshImport(path: string): Promise<Record<string, unknown>> {
  return import(`${path}?profilerRetention=${Date.now()}-${Math.random()}`)
}

function markNames(type: 'mark' | 'measure'): string[] {
  return performance.getEntriesByType(type).map(entry => entry.name)
}

function clearEntriesByName(names: string[]): void {
  for (const name of names) {
    performance.clearMarks(name)
    performance.clearMeasures(name)
  }
}

function openClaudeEntryNames(type: 'mark' | 'measure', scope: string): string[] {
  const names = markNames(type)
  const namespacedPrefix = `openclaude:${scope}:`
  if (scope === 'query') {
    return names.filter(
      name => name.startsWith(namespacedPrefix) || name.startsWith('query_'),
    )
  }
  if (scope === 'headless') {
    return names.filter(
      name => name.startsWith(namespacedPrefix) || name.startsWith('headless_'),
    )
  }
  if (scope === 'startup') {
    return names.filter(
      name =>
        name.startsWith(namespacedPrefix) ||
        [
          'profiler_initialized',
          'cli_entry',
          'main_after_run',
          'startup_retention_checkpoint',
        ].includes(name),
    )
  }
  return names.filter(name => name.startsWith(namespacedPrefix))
}

function runIsolatedProfilerScript(script: string): Record<string, unknown> {
  const result = Bun.spawnSync({
    cmd: ['bun', '--eval', script],
    cwd: process.cwd(),
    env: {
      ...process.env,
      CLAUDE_CODE_PROFILE_QUERY: '1',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (result.exitCode !== 0) {
    throw new Error(
      `isolated profiler script failed with ${result.exitCode}\n${result.stderr.toString()}`,
    )
  }

  const lines = result.stdout.toString().trim().split('\n')
  const lastLine = lines.at(-1)
  if (!lastLine) {
    throw new Error('isolated profiler script produced no output')
  }
  return JSON.parse(lastLine) as Record<string, unknown>
}

function handlePromptSubmitProfilerScript(
  processUserInputBody: string,
  onQueryBody = 'onQueryCalls++',
): string {
  return `
    import { mock } from 'bun:test'
    import { performance } from 'perf_hooks'

    process.env.CLAUDE_CODE_PROFILE_QUERY = '1'

    mock.module('./src/utils/processUserInput/processUserInput.js', () => ({
      processUserInput: async () => {
        ${processUserInputBody}
      },
    }))
    mock.module('src/services/analytics/index.js', () => ({
      logEvent: () => {},
    }))

    const { handlePromptSubmit } = await import('./src/utils/handlePromptSubmit.js')
    const queryGuard = {
      isActive: false,
      reserve() {},
      cancelReservation() {},
    }
    let onQueryCalls = 0

    performance.mark('external_profiler_retention_start')

    try {
      await handlePromptSubmit({
        input: 'hello',
        mode: 'prompt',
        pastedContents: {},
        helpers: {
          setCursorOffset() {},
          clearBuffer() {},
          resetHistory() {},
        },
        onInputChange() {},
        setPastedContents() {},
        queryGuard,
        commands: [],
        messages: [],
        mainLoopModel: 'sonnet',
        ideSelection: undefined,
        querySource: 'repl',
        setToolJSX() {},
        getToolUseContext() { return {} },
        setUserInputOnProcessing() {},
        setAbortController() {},
        onQuery: async () => { ${onQueryBody} },
        setAppState() {},
      })
    } catch {}

    const marks = performance.getEntriesByType('mark').map(entry => entry.name)
    const measures = performance.getEntriesByType('measure').map(entry => entry.name)
    console.log(JSON.stringify({
      onQueryCalls,
      queryMarks: marks.filter(name => name.startsWith('openclaude:query:')),
      queryMeasures: measures.filter(name => name.startsWith('openclaude:query:')),
      externalMarkRetained: marks.includes('external_profiler_retention_start'),
    }))
  `
}

beforeEach(async () => {
  await acquireSharedMutationLock('utils/profilerRetention.test.ts')
  process.env.CLAUDE_CODE_PROFILE_QUERY = '1'
  process.env.CLAUDE_CODE_PROFILE_STARTUP = '1'
  process.env.USER_TYPE = 'external'
  tempConfigDir = mkdtempSync(join(tmpdir(), 'openclaude-profiler-retention-'))
  process.env.CLAUDE_CONFIG_DIR = tempConfigDir
  clearEntriesByName([
    'external_profiler_retention_start',
    'external_profiler_retention_end',
    'external_profiler_retention_measure',
  ])
  for (const scope of ['query', 'headless', 'startup']) {
    for (const type of ['mark', 'measure'] as const) {
      clearEntriesByName(openClaudeEntryNames(type, scope))
    }
  }
})

afterEach(() => {
  try {
    clearEntriesByName([
      'external_profiler_retention_start',
      'external_profiler_retention_end',
      'external_profiler_retention_measure',
    ])
    for (const scope of ['query', 'headless', 'startup']) {
      for (const type of ['mark', 'measure'] as const) {
        clearEntriesByName(openClaudeEntryNames(type, scope))
      }
    }
    restoreEnv('CLAUDE_CODE_PROFILE_QUERY')
    restoreEnv('CLAUDE_CODE_PROFILE_STARTUP')
    restoreEnv('CLAUDE_CONFIG_DIR')
    restoreEnv('USER_TYPE')
    if (tempConfigDir) {
      rmSync(tempConfigDir, { recursive: true, force: true })
      tempConfigDir = undefined
    }
    mock.restore()
  } finally {
    releaseSharedMutationLock()
  }
})

test('query profile report is logged before scoped cleanup and unrelated entries survive', async () => {
  const debugSpy = spyOn(debug, 'logForDebugging').mockImplementation(() => {})
  const {
    startQueryProfile,
    queryCheckpoint,
    endQueryProfile,
    logQueryProfileReport,
  } = (await freshImport('./queryProfiler.js')) as {
    startQueryProfile: () => void
    queryCheckpoint: (name: string) => void
    endQueryProfile: () => void
    logQueryProfileReport: () => void
  }

  performance.mark('external_profiler_retention_start')
  performance.mark('external_profiler_retention_end')
  performance.measure(
    'external_profiler_retention_measure',
    'external_profiler_retention_start',
    'external_profiler_retention_end',
  )

  for (let i = 0; i < 20; i++) {
    startQueryProfile()
    queryCheckpoint('query_api_request_sent')
    queryCheckpoint('query_first_chunk_received')
    endQueryProfile()
    logQueryProfileReport()
  }

  const reports = debugSpy.mock.calls.map(call => String(call[0]))
  expect(reports.some(report => report.includes('QUERY PROFILING REPORT'))).toBe(
    true,
  )
  expect(
    reports.some(report => report.includes('query_first_chunk_received')),
  ).toBe(true)
  expect(openClaudeEntryNames('mark', 'query')).toEqual([])
  expect(openClaudeEntryNames('measure', 'query')).toEqual([])
  expect(markNames('mark')).toContain('external_profiler_retention_start')
  expect(markNames('mark')).toContain('external_profiler_retention_end')
  expect(markNames('measure')).toContain('external_profiler_retention_measure')
})

test('partial query profile cleanup is available for abort and error paths', async () => {
  const { startQueryProfile, queryCheckpoint, clearQueryProfile } =
    (await freshImport('./queryProfiler.js')) as {
      startQueryProfile: () => void
      queryCheckpoint: (name: string) => void
      clearQueryProfile: () => void
    }

  startQueryProfile()
  queryCheckpoint('query_context_loading_start')
  clearQueryProfile()

  expect(openClaudeEntryNames('mark', 'query')).toEqual([])
  expect(openClaudeEntryNames('measure', 'query')).toEqual([])
})

test('handle prompt submit clears query profile when processing produces no query', () => {
  const result = runIsolatedProfilerScript(
    handlePromptSubmitProfilerScript(
      "return { messages: [], shouldQuery: false }",
    ),
  )

  expect(result.onQueryCalls).toBe(0)
  expect(result.queryMarks).toEqual([])
  expect(result.queryMeasures).toEqual([])
  expect(result.externalMarkRetained).toBe(true)
})

test('handle prompt submit clears query profile when processing throws before query', () => {
  const result = runIsolatedProfilerScript(
    handlePromptSubmitProfilerScript("throw new Error('before query')"),
  )

  expect(result.onQueryCalls).toBe(0)
  expect(result.queryMarks).toEqual([])
  expect(result.queryMeasures).toEqual([])
  expect(result.externalMarkRetained).toBe(true)
})

test('handle prompt submit clears query profile when onQuery declines ownership', () => {
  const result = runIsolatedProfilerScript(
    handlePromptSubmitProfilerScript(
      "return { messages: [{ type: 'user', message: { role: 'user', content: 'hello' }, uuid: 'message-1' }], shouldQuery: true }",
      'onQueryCalls++; return false',
    ),
  )

  expect(result.onQueryCalls).toBe(1)
  expect(result.queryMarks).toEqual([])
  expect(result.queryMeasures).toEqual([])
  expect(result.externalMarkRetained).toBe(true)
})

test('handle prompt submit preserves query profile when onQuery owns cleanup', () => {
  const result = runIsolatedProfilerScript(
    handlePromptSubmitProfilerScript(
      "return { messages: [{ type: 'user', message: { role: 'user', content: 'hello' }, uuid: 'message-1' }], shouldQuery: true }",
    ),
  )

  expect(result.onQueryCalls).toBe(1)
  expect(result.queryMarks).toEqual(
    expect.arrayContaining([
      'openclaude:query:query_user_input_received',
      'openclaude:query:query_process_user_input_start',
      'openclaude:query:query_process_user_input_end',
    ]),
  )
  expect(result.queryMeasures).toEqual([])
  expect(result.externalMarkRetained).toBe(true)
})

test('headless turn logging extracts metrics and clears retained marks', async () => {
  process.env.USER_TYPE = 'ant'
  spyOn(bootstrapState, 'getIsNonInteractiveSession').mockImplementation(
    () => true,
  )
  const analyticsSpy = spyOn(analytics, 'logEvent').mockImplementation(() => {})
  spyOn(debug, 'logForDebugging').mockImplementation(() => {})
  const {
    headlessProfilerStartTurn,
    headlessProfilerCheckpoint,
    logHeadlessProfilerTurn,
  } = (await freshImport('./headlessProfiler.js')) as {
    headlessProfilerStartTurn: () => void
    headlessProfilerCheckpoint: (name: string) => void
    logHeadlessProfilerTurn: () => void
  }

  performance.mark('external_profiler_retention_start')

  for (let i = 0; i < 20; i++) {
    headlessProfilerStartTurn()
    headlessProfilerCheckpoint('query_started')
    headlessProfilerCheckpoint('first_chunk')
    logHeadlessProfilerTurn()
  }

  expect(analyticsSpy).toHaveBeenCalled()
  expect(openClaudeEntryNames('mark', 'headless')).toEqual([])
  expect(openClaudeEntryNames('measure', 'headless')).toEqual([])
  expect(markNames('mark')).toContain('external_profiler_retention_start')
})

test('startup profile report keeps report names but clears one-shot entries', async () => {
  const debugSpy = spyOn(debug, 'logForDebugging').mockImplementation(() => {})
  spyOn(analytics, 'logEvent').mockImplementation(() => {})
  const { profileCheckpoint, profileReport } = (await freshImport(
    './startupProfiler.js',
  )) as {
    profileCheckpoint: (name: string) => void
    profileReport: () => void
  }

  performance.mark('external_profiler_retention_start')
  profileCheckpoint('cli_entry')
  profileCheckpoint('startup_retention_checkpoint')
  profileCheckpoint('main_after_run')
  profileReport()

  const reports = debugSpy.mock.calls.map(call => String(call[0]))
  expect(reports.some(report => report.includes('STARTUP PROFILING REPORT'))).toBe(
    true,
  )
  expect(
    reports.some(report => report.includes('startup_retention_checkpoint')),
  ).toBe(true)
  expect(openClaudeEntryNames('mark', 'startup')).toEqual([])
  expect(openClaudeEntryNames('measure', 'startup')).toEqual([])
  expect(markNames('mark')).toContain('external_profiler_retention_start')
})
