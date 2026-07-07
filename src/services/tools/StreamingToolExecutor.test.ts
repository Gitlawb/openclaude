import { describe, expect, test } from 'bun:test'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { z } from 'zod/v4'

import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import { createToolFixture } from '../../test/toolFixtures.js'
import {
  getEmptyToolPermissionContext,
  type Tool,
  type ToolUseContext,
} from '../../Tool.js'
import type { AssistantMessage } from '../../types/message.js'
import {
  type QueryActiveOperationSnapshot,
  QueryLifecycleOperationTracker,
} from '../../utils/queryLifecycle.js'
import { StreamingToolExecutor } from './StreamingToolExecutor.js'

const assistantMessage = {
  uuid: 'assistant-message-1',
  requestId: 'request-1',
  message: {
    id: 'assistant-api-message-1',
    content: [],
  },
} as unknown as AssistantMessage

function firstToolResultText(message: unknown): string {
  const content = (message as { message?: { content?: unknown } }).message
    ?.content
  if (!Array.isArray(content)) return ''
  const toolResult = content.find(
    block =>
      typeof block === 'object' &&
      block !== null &&
      (block as { type?: unknown }).type === 'tool_result',
  ) as { content?: unknown } | undefined
  return String(toolResult?.content ?? '')
}

function toolUseResultText(message: unknown): string {
  return String((message as { toolUseResult?: unknown }).toolUseResult ?? '')
}

class CountingQueryLifecycleTracker extends QueryLifecycleOperationTracker {
  endCount = 0

  override endToolUse(toolUseId: string): void {
    this.endCount++
    super.endToolUse(toolUseId)
  }
}

function makeToolUseContext(
  tools: readonly Tool[],
  queryLifecycle: QueryLifecycleOperationTracker,
  inProgressToolUseIds: { current: Set<string> },
  hasInterruptibleToolInProgress: { current: boolean },
): ToolUseContext {
  return {
    abortController: new AbortController(),
    messages: [],
    queryLifecycle,
    options: {
      tools,
      commands: [],
      debug: false,
      verbose: false,
      mainLoopModel: 'test-model',
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
    },
    getAppState: () => ({
      toolPermissionContext: getEmptyToolPermissionContext(),
      sessionHooks: new Map(),
    }),
    setAppState: () => {},
    setInProgressToolUseIDs: updater => {
      inProgressToolUseIds.current = updater(inProgressToolUseIds.current)
    },
    setHasInterruptibleToolInProgress: value => {
      hasInterruptibleToolInProgress.current = value
    },
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
  } as unknown as ToolUseContext
}

describe('StreamingToolExecutor lifecycle tracking', () => {
  test('normal streaming execution clears lifecycle tracking after results are consumed', async () => {
    const queryLifecycle = new QueryLifecycleOperationTracker()
    const inProgressToolUseIds = { current: new Set<string>() }
    const hasInterruptibleToolInProgress = { current: false }
    let lifecycleSnapshotDuringCall: QueryActiveOperationSnapshot | undefined
    const tool = createToolFixture(z.object({}), {
      name: 'FastLifecycleTool',
      async call() {
        lifecycleSnapshotDuringCall = queryLifecycle.snapshot()
        return { data: 'ok' }
      },
    })
    const toolUseContext = makeToolUseContext(
      [tool],
      queryLifecycle,
      inProgressToolUseIds,
      hasInterruptibleToolInProgress,
    )
    const executor = new StreamingToolExecutor(
      [tool],
      (async () => ({ behavior: 'allow' })) as CanUseToolFn,
      toolUseContext,
    )

    executor.addTool(
      {
        type: 'tool_use',
        id: 'tool-use-1',
        name: tool.name,
        input: {},
      } as ToolUseBlock,
      assistantMessage,
    )

    const results: unknown[] = []
    for await (const result of executor.getRemainingResults()) {
      results.push(result)
    }

    expect(results.length).toBeGreaterThan(0)
    expect(lifecycleSnapshotDuringCall?.toolUses).toMatchObject([
      {
        toolUseId: 'tool-use-1',
        toolName: 'FastLifecycleTool',
      },
    ])
    expect(queryLifecycle.snapshot()).toEqual({ apiCalls: [], toolUses: [] })
    expect(inProgressToolUseIds.current.has('tool-use-1')).toBe(false)
  })

  test('discard aborts in-flight tools and clears lifecycle tracking immediately', async () => {
    const queryLifecycle = new CountingQueryLifecycleTracker()
    const inProgressToolUseIds = { current: new Set<string>() }
    const hasInterruptibleToolInProgress = { current: false }
    let resolveStarted!: () => void
    const started = new Promise<void>(resolve => {
      resolveStarted = resolve
    })
    let observedAbortReason: unknown
    let resolveAborted!: () => void
    const aborted = new Promise<void>(resolve => {
      resolveAborted = resolve
    })
    let resolveCallFinished!: () => void
    const callFinished = new Promise<void>(resolve => {
      resolveCallFinished = resolve
    })
    const tool = createToolFixture(z.object({}), {
      name: 'SlowLifecycleTool',
      interruptBehavior: () => 'cancel',
      async call(_input, context) {
        resolveStarted()
        await new Promise<void>(resolve => {
          if (context.abortController.signal.aborted) {
            observedAbortReason = context.abortController.signal.reason
            resolveAborted()
            resolve()
            return
          }
          context.abortController.signal.addEventListener(
            'abort',
            () => {
              observedAbortReason = context.abortController.signal.reason
              resolveAborted()
              resolve()
            },
            { once: true },
          )
        })
        resolveCallFinished()
        return { data: 'aborted' }
      },
    })
    const queuedTool = createToolFixture(z.object({}), {
      name: 'QueuedLifecycleTool',
    })
    const toolUseContext = makeToolUseContext(
      [tool, queuedTool],
      queryLifecycle,
      inProgressToolUseIds,
      hasInterruptibleToolInProgress,
    )
    const executor = new StreamingToolExecutor(
      [tool, queuedTool],
      (async () => ({ behavior: 'allow' })) as CanUseToolFn,
      toolUseContext,
    )

    executor.addTool(
      {
        type: 'tool_use',
        id: 'tool-use-1',
        name: tool.name,
        input: {},
      } as ToolUseBlock,
      assistantMessage,
    )
    executor.addTool(
      {
        type: 'tool_use',
        id: 'tool-use-2',
        name: queuedTool.name,
        input: {},
      } as ToolUseBlock,
      assistantMessage,
    )
    await started

    expect(queryLifecycle.snapshot().toolUses).toEqual([
      {
        toolUseId: 'tool-use-1',
        toolName: tool.name,
        startedAt: expect.any(Number),
      },
    ])
    expect(inProgressToolUseIds.current.has('tool-use-1')).toBe(true)
    expect(inProgressToolUseIds.current.has('tool-use-2')).toBe(false)
    expect(hasInterruptibleToolInProgress.current).toBe(true)

    executor.discard()

    expect(queryLifecycle.snapshot()).toEqual({ apiCalls: [], toolUses: [] })
    expect(queryLifecycle.endCount).toBe(1)
    expect(inProgressToolUseIds.current.has('tool-use-1')).toBe(false)
    expect(inProgressToolUseIds.current.has('tool-use-2')).toBe(false)
    expect(hasInterruptibleToolInProgress.current).toBe(false)
    await aborted
    await callFinished
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(queryLifecycle.endCount).toBe(1)
    expect(observedAbortReason).toBe('streaming_fallback')
    expect([...executor.getCompletedResults()]).toEqual([])
  })

  test.each([
    [
      'query-timeout',
      'Tool use was interrupted because the query timed out.',
    ],
    [
      'hard_max',
      'Tool use was interrupted because the query reached its hard maximum runtime.',
    ],
    [
      'background',
      'Tool use was interrupted because the query was backgrounded.',
    ],
  ])(
    'already-aborted streaming tool uses reason-aware result for %s',
    async (abortReason, expectedMessage) => {
      const queryLifecycle = new QueryLifecycleOperationTracker()
      const inProgressToolUseIds = { current: new Set<string>() }
      const hasInterruptibleToolInProgress = { current: false }
      const tool = createToolFixture(z.object({}), {
        name: `AbortedStreamingTool_${abortReason}`,
        async call() {
          throw new Error('tool should not run after parent abort')
        },
      })
      const toolUseContext = makeToolUseContext(
        [tool],
        queryLifecycle,
        inProgressToolUseIds,
        hasInterruptibleToolInProgress,
      )
      toolUseContext.abortController.abort(abortReason)
      const executor = new StreamingToolExecutor(
        [tool],
        (async () => ({ behavior: 'allow' })) as CanUseToolFn,
        toolUseContext,
      )

      executor.addTool(
        {
          type: 'tool_use',
          id: `tool-use-${abortReason}`,
          name: tool.name,
          input: {},
        } as ToolUseBlock,
        assistantMessage,
      )

      const updates: unknown[] = []
      for await (const update of executor.getRemainingResults()) {
        if (update.message) updates.push(update.message)
      }

      expect(updates).toHaveLength(1)
      expect(firstToolResultText(updates[0])).toContain(expectedMessage)
      expect(toolUseResultText(updates[0])).toBe(expectedMessage)
      expect(firstToolResultText(updates[0])).not.toContain('User rejected')
      expect(firstToolResultText(updates[0])).not.toContain(
        "The user doesn't want",
      )
    },
  )
})
