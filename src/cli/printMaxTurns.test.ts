import { describe, expect, spyOn, test } from 'bun:test'

import * as queryModule from '../query.js'
import { type QueryParams } from '../query.js'
import type { QueryDeps } from '../query/deps.js'
import { asSystemPrompt } from '../utils/systemPromptType.js'
import {
  createAssistantMessage,
  createUserMessage,
} from '../utils/messages.js'
import { parseMaxTurnsCli, resolveReplMaxTurns } from '../utils/replMaxTurns.js'

function makeHeadlessQueryParams(maxTurns: number | undefined): QueryParams {
  return {
    messages: [createUserMessage({ content: 'headless prompt' })],
    systemPrompt: asSystemPrompt([]),
    userContext: {},
    systemContext: {},
    canUseTool: async () => ({ behavior: 'allow' }),
    maxTurns,
    querySource: 'sdk',
    toolUseContext: {
      abortController: new AbortController(),
      agentId: 'agent-test',
      getAppState: () => ({
        fastMode: false,
        mcp: { tools: [], clients: [] },
        toolPermissionContext: {
          mode: 'default',
          additionalWorkingDirectories: new Map(),
          alwaysAllowRules: {},
          alwaysDenyRules: {},
          alwaysAskRules: {},
          isBypassPermissionsModeAvailable: false,
        },
        sessionHooks: new Map(),
        mainLoopModel: 'gpt-4o',
        effortValue: undefined,
        advisorModel: undefined,
      }),
      options: {
        commands: [],
        debug: false,
        thinkingConfig: { type: 'disabled' },
        tools: [],
        verbose: false,
        mcpClients: [],
        mcpResources: {},
        isNonInteractiveSession: true,
        agentDefinitions: { activeAgents: [], allAgents: [] },
        appendSystemPrompt: undefined,
        providerOverride: undefined,
        mainLoopModel: 'gpt-4o',
      },
      addNotification: () => {},
      messages: [],
      setInProgressToolUseIDs: () => {},
      setResponseLength: () => {},
      updateAttributionState: () => {},
    } as unknown as QueryParams['toolUseContext'],
    deps: {
      callModel: async function* () {
        yield createAssistantMessage({ content: 'done' })
      },
      microcompact: async messages => ({ messages }),
      autocompact: async () => ({
        compactionResult: null,
        consecutiveFailures: undefined,
      }),
      uuid: () => '00000000-0000-4000-8000-000000000000',
    } as unknown as QueryDeps,
  }
}

describe('headless --print max-turns', () => {
  test('forwards parsed --max-turns 0 into query params without interactive resolution', async () => {
    const headlessMaxTurns = parseMaxTurnsCli('0')
    expect(headlessMaxTurns).toBe(0)
    expect(resolveReplMaxTurns(headlessMaxTurns)).toBeUndefined()

    const querySpy = spyOn(queryModule, 'query')
    const params = makeHeadlessQueryParams(headlessMaxTurns)

    const generator = queryModule.query(params)
    let terminal
    while (true) {
      const next = await generator.next()
      if (next.done) {
        terminal = next.value
        break
      }
    }

    expect(querySpy.mock.calls[0]?.[0]?.maxTurns).toBe(0)
    expect(terminal?.reason).toBe('completed')
    querySpy.mockRestore()
  })
})
