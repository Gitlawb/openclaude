import { describe, expect, test } from 'bun:test'

import { getDefaultAppState, type AppState } from '../state/AppStateStore.js'
import { createGoalState } from '../services/goal/state.js'
import { asSystemPrompt } from '../utils/systemPromptType.js'

function assistant(uuid: string, text: string) {
  return {
    type: 'assistant',
    uuid,
    message: {
      id: uuid,
      type: 'message',
      role: 'assistant',
      model: 'test-model',
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      content: [{ type: 'text', text }],
    },
  }
}

function makeToolUseContext(appStateRef: { current: AppState }) {
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'sonnet',
      tools: [],
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
    abortController: new AbortController(),
    readFileState: new Map(),
    getAppState: () => appStateRef.current,
    setAppState: (updater: (prev: AppState) => AppState) => {
      appStateRef.current = updater(appStateRef.current)
    },
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
  } as any
}

describe('goal query continuation', () => {
  test('shared query path continues after incomplete goal and stops when achieved', async () => {
    const decisions = [
      {
        complete: false,
        confidence: 0.7,
        decision: 'incomplete' as const,
        reason: 'Implementation is not verified.',
        nextInstruction: 'Run tests.',
      },
      {
        complete: true,
        confidence: 0.9,
        decision: 'complete' as const,
        reason: 'Implementation is verified.',
        nextInstruction: null,
      },
    ]
    const { query } = await import('../query.js')
    let modelCalls = 0
    const appStateRef = {
      current: {
        ...getDefaultAppState(),
        goal: createGoalState('finish implementation'),
      },
    }

    const yielded: any[] = []
    const terminal = await (async () => {
      const generator = query({
        messages: [],
        systemPrompt: asSystemPrompt([]),
        userContext: {},
        systemContext: {},
        canUseTool: async () => ({ behavior: 'allow' }),
        toolUseContext: makeToolUseContext(appStateRef),
        querySource: 'sdk',
        deps: {
          uuid: () => `uuid-${modelCalls}`,
          microcompact: async messages => ({ messages }),
          autocompact: async () => ({ wasCompacted: false }),
          goalEvaluationDeps: {
            evaluateGoal: async () => decisions.shift()!,
            saveGoalState: async () => {},
          },
          callModel: async function* () {
            modelCalls++
            yield assistant(
              `assistant-${modelCalls}`,
              modelCalls === 1 ? 'Changed files.' : 'Tests pass.',
            )
          },
        } as any,
      })
      while (true) {
        const next = await generator.next()
        if (next.done) return next.value
        yielded.push(next.value)
      }
    })()

    expect(modelCalls).toBe(2)
    expect(terminal.reason).toBe('completed')
    expect(appStateRef.current.goal?.status).toBe('achieved')
    expect(
      yielded.some(
        item =>
          item.type === 'system' &&
          typeof item.content === 'string' &&
          item.content.includes('Goal not complete:'),
      ),
    ).toBe(true)
    expect(
      yielded.some(
        item =>
          item.type === 'system' &&
          typeof item.content === 'string' &&
          item.content.includes('Goal achieved:'),
      ),
    ).toBe(true)
  })
})
