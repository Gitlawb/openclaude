import { afterEach, describe, expect, mock, test, vi } from 'bun:test'
import * as runAgentNs from '../../tools/AgentTool/runAgent.js'
import * as forkedAgentNs from '../../utils/forkedAgent.js'
import * as sessionStorageNs from '../../utils/sessionStorage.js'
import * as localAgentTaskNs from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import * as debugNs from '../../utils/debug.js'

const realRunAgent = { ...runAgentNs }
const realForkedAgent = { ...forkedAgentNs }
const realSessionStorage = { ...sessionStorageNs }
const realLocalAgentTask = { ...localAgentTaskNs }
const realDebug = { ...debugNs }

describe('agent summary cancellation', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    mock.restore()
    mock.module('../../tools/AgentTool/runAgent.js', () => realRunAgent)
    mock.module('../../utils/forkedAgent.js', () => realForkedAgent)
    mock.module('../../utils/sessionStorage.js', () => realSessionStorage)
    mock.module(
      '../../tasks/LocalAgentTask/LocalAgentTask.js',
      () => realLocalAgentTask,
    )
    mock.module('../../utils/debug.js', () => realDebug)
  })

  test('stopping an in-flight summary aborts with an expected side-task reason', async () => {
    vi.useFakeTimers()

    let summaryAbortController: AbortController | undefined
    const debugLog = mock(
      (_message: string, _options?: { level?: string }) => {},
    )
    const runForkedAgent = mock(
      ({ overrides }: { overrides?: { abortController?: AbortController } }) => {
        summaryAbortController = overrides?.abortController
        return new Promise(() => {})
      },
    )

    mock.module('../../tools/AgentTool/runAgent.js', () => ({
      filterIncompleteToolCalls: <T>(messages: T) => messages,
      runAgent: async function* () {},
    }))
    mock.module('../../utils/forkedAgent.js', () => ({
      ...realForkedAgent,
      runForkedAgent,
    }))
    mock.module('../../utils/sessionStorage.js', () => ({
      ...realSessionStorage,
      getAgentTranscript: mock(async () => ({
        messages: [{ type: 'user' }, { type: 'assistant' }, { type: 'user' }],
      })),
    }))
    mock.module('../../tasks/LocalAgentTask/LocalAgentTask.js', () => ({
      updateAgentSummary: mock(() => {}),
    }))
    mock.module('../../utils/debug.js', () => ({
      ...realDebug,
      logForDebugging: debugLog,
    }))

    const { startAgentSummarization } = await import(
      `./agentSummary.js?ts=${Date.now()}-${Math.random()}`
    )
    const { stop } = startAgentSummarization(
      'task-1',
      'agent-1' as never,
      {} as never,
      mock(() => {}) as never,
    )

    vi.advanceTimersByTime(30_000)
    await Promise.resolve()
    await Promise.resolve()

    expect(runForkedAgent).toHaveBeenCalledTimes(1)
    expect(summaryAbortController).toBeDefined()

    stop()

    expect(summaryAbortController!.signal.aborted).toBe(true)
    expect(summaryAbortController!.signal.reason).toBe(
      'agent-summary-superseded',
    )
    expect(
      debugLog.mock.calls.some(([message, options]) => {
        return (
          String(message).includes('[AgentSummary] Stopping summarization') &&
          String(message).includes('agent-summary-superseded') &&
          (options as { level?: string } | undefined)?.level !== 'error'
        )
      }),
    ).toBe(true)
  })
})
