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
import { QueryLifecycleOperationTracker } from '../../utils/queryLifecycle.js'
import { StreamingToolExecutor } from './StreamingToolExecutor.js'

const assistantMessage = {
  uuid: 'assistant-message-1',
  requestId: 'request-1',
  message: {
    id: 'assistant-api-message-1',
    content: [],
  },
} as unknown as AssistantMessage

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
  test('discard aborts in-flight tools and clears lifecycle tracking immediately', async () => {
    const queryLifecycle = new QueryLifecycleOperationTracker()
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
        return { data: 'aborted' }
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
    await started

    expect(queryLifecycle.snapshot().toolUses).toMatchObject([
      {
        toolUseId: 'tool-use-1',
        toolName: tool.name,
      },
    ])
    expect(inProgressToolUseIds.current.has('tool-use-1')).toBe(true)
    expect(hasInterruptibleToolInProgress.current).toBe(true)

    executor.discard()

    expect(queryLifecycle.snapshot()).toEqual({ apiCalls: [], toolUses: [] })
    expect(inProgressToolUseIds.current.has('tool-use-1')).toBe(false)
    expect(hasInterruptibleToolInProgress.current).toBe(false)
    await aborted
    expect(observedAbortReason).toBe('streaming_fallback')
    expect([...executor.getCompletedResults()]).toEqual([])
  })
})
