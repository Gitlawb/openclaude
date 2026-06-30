import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'

import { query, type QueryParams } from '../query.js'
import { buildTool, type Tools } from '../Tool.js'
import type { QueryDeps } from './deps.js'
import {
  createAssistantMessage,
  createUserMessage,
  normalizeMessagesForAPI,
} from '../utils/messages.js'
import { asSystemPrompt } from '../utils/systemPromptType.js'
import { countToolUses } from '../tools/AgentTool/agentToolUtils.js'
import { AGENT_STEP_LIMIT_TOOL_RESULT_PREFIX } from './agentStepLimit.js'

const echoCalls: string[] = []

const echoTool = buildTool({
  name: 'Echo',
  inputSchema: z.object({ text: z.string() }),
  maxResultSizeChars: Infinity,
  async description() {
    return 'Echo input text'
  },
  async prompt() {
    return ''
  },
  async call(input) {
    echoCalls.push(input.text)
    return { data: `echo:${input.text}` }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: String(content),
    }
  },
  renderToolUseMessage() {
    return null
  },
  renderToolResultMessage() {
    return null
  },
})

function makeToolUseContext(tools: Tools = []): QueryParams['toolUseContext'] {
  const abortController = new AbortController()
  let inProgressToolUseIDs = new Set<string>()

  return {
    abortController,
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
      tools,
      verbose: false,
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: { activeAgents: [], allAgents: [] },
      appendSystemPrompt: undefined,
      providerOverride: undefined,
      mainLoopModel: 'gpt-4o',
    },
    addNotification: () => {},
    messages: [],
    setInProgressToolUseIDs: updater => {
      inProgressToolUseIDs = updater(inProgressToolUseIDs)
    },
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
  } as unknown as QueryParams['toolUseContext']
}

function makeParams(
  callModel: QueryDeps['callModel'],
  tools: Tools = [],
  agentStepLimit?: { maxSteps: number; agentType: string },
): QueryParams {
  return {
    messages: [createUserMessage({ content: 'inspect' })],
    systemPrompt: asSystemPrompt([]),
    userContext: {},
    systemContext: {},
    canUseTool: async () => ({ behavior: 'allow' }),
    toolUseContext: makeToolUseContext(tools),
    querySource: 'agent:builtin:general-purpose',
    ...(agentStepLimit ? { agentStepLimit } : {}),
    deps: {
      callModel,
      microcompact: async messages => ({ messages }),
      autocompact: async () => ({
        compactionResult: null,
        consecutiveFailures: undefined,
      }),
      uuid: () => '00000000-0000-4000-8000-000000000000',
    } as unknown as QueryDeps,
  }
}

async function drain(params: QueryParams): Promise<{
  yielded: any[]
  returned: any
}> {
  const yielded: any[] = []
  const generator = query(params)
  while (true) {
    const next = await generator.next()
    if (next.done) return { yielded, returned: next.value }
    yielded.push(next.value)
  }
}

describe('agent step limits', () => {
  test('without a configured limit, tool use behavior is unchanged', async () => {
    echoCalls.length = 0
    let modelCalls = 0

    const { yielded, returned } = await drain(
      makeParams(
        async function* () {
          modelCalls++
          if (modelCalls === 1) {
            yield createAssistantMessage({
              content: [
                {
                  type: 'tool_use',
                  id: 'toolu_echo_1',
                  name: 'Echo',
                  input: { text: 'first' },
                },
                {
                  type: 'tool_use',
                  id: 'toolu_echo_2',
                  name: 'Echo',
                  input: { text: 'second' },
                },
              ],
            })
            return
          }
          yield createAssistantMessage({ content: 'done' })
        },
        [echoTool],
      ),
    )

    expect(returned.reason).toBe('completed')
    expect(modelCalls).toBe(2)
    expect(echoCalls).toEqual(['first', 'second'])
    expect(
      yielded.some(
        message =>
          message?.type === 'user' &&
          message?.isMeta &&
          typeof message.message.content === 'string' &&
          message.message.content.includes('configured step limit'),
      ),
    ).toBe(false)
  })

  test('invalid configured limit is ignored safely', async () => {
    echoCalls.length = 0
    let modelCalls = 0

    const { returned } = await drain(
      makeParams(
        async function* () {
          modelCalls++
          if (modelCalls === 1) {
            yield createAssistantMessage({
              content: [
                {
                  type: 'tool_use',
                  id: 'toolu_echo_1',
                  name: 'Echo',
                  input: { text: 'first' },
                },
                {
                  type: 'tool_use',
                  id: 'toolu_echo_2',
                  name: 'Echo',
                  input: { text: 'second' },
                },
              ],
            })
            return
          }
          yield createAssistantMessage({ content: 'done' })
        },
        [echoTool],
        { maxSteps: 0, agentType: 'general-purpose' },
      ),
    )

    expect(returned.reason).toBe('completed')
    expect(modelCalls).toBe(2)
    expect(echoCalls).toEqual(['first', 'second'])
  })

  test('configured limit stops further tool calls and requests a no-tools summary', async () => {
    echoCalls.length = 0
    let modelCalls = 0
    const requestToolCounts: number[] = []
    const requestMessageNormalizationToolCounts: number[] = []
    const requestMessages: any[][] = []

    const { yielded, returned } = await drain(
      makeParams(
        async function* ({ messages, options, tools }) {
          modelCalls++
          requestToolCounts.push(tools.length)
          requestMessageNormalizationToolCounts.push(
            options.messageNormalizationTools?.length ?? 0,
          )
          requestMessages.push(messages)
          if (modelCalls === 1) {
            yield createAssistantMessage({
              content: [
                {
                  type: 'tool_use',
                  id: 'toolu_echo_1',
                  name: 'Echo',
                  input: { text: 'allowed' },
                },
                {
                  type: 'tool_use',
                  id: 'toolu_echo_2',
                  name: 'Echo',
                  input: { text: 'blocked' },
                },
              ],
            })
            return
          }
          yield createAssistantMessage({
            content:
              'Completed: checked the allowed step. Findings: limit reached. Remaining tasks: continue later. Another run needed: yes.',
          })
        },
        [echoTool],
        { maxSteps: 1, agentType: 'general-purpose' },
      ),
    )

    expect(returned).toMatchObject({
      reason: 'agent_step_limit',
      turnCount: 2,
      stepsUsed: 1,
      maxSteps: 1,
    })
    expect(modelCalls).toBe(2)
    expect(requestToolCounts).toEqual([1, 0])
    expect(requestMessageNormalizationToolCounts).toEqual([0, 1])
    expect(echoCalls).toEqual(['allowed'])
    expect(countToolUses(yielded)).toBe(1)
    expect(
      yielded.some(
        message =>
          message?.type === 'assistant' &&
          message.message.content.some(
            part =>
              part.type === 'text' &&
              part.text.includes('Completed: checked the allowed step') &&
              part.text.includes('Another run needed: yes'),
          ),
      ),
    ).toBe(true)
    expect(
      yielded.some(
        message =>
          message?.type === 'user' &&
          Array.isArray(message.message.content) &&
          message.message.content.some(
            (part: any) =>
              part.type === 'tool_result' &&
              part.tool_use_id === 'toolu_echo_2' &&
              part.is_error === true &&
              String(part.content).includes('Agent step limit reached'),
          ),
      ),
    ).toBe(true)
    expect(
      yielded.some(
        message =>
          message?.type === 'user' &&
          message?.isMeta &&
          typeof message.message.content === 'string' &&
          message.message.content.includes('completed work') &&
          message.message.content.includes('remaining tasks') &&
          message.message.content.includes('another run is needed'),
      ),
    ).toBe(true)
    expect(
      requestMessages[1]?.some(
        message =>
          message.type === 'user' &&
          message.isMeta &&
          typeof message.message.content === 'string' &&
          message.message.content.includes('configured step limit'),
      ),
    ).toBe(true)

    const normalizedSecondRequest = normalizeMessagesForAPI(
      requestMessages[1] as any,
      [echoTool],
    )
    const summaryUser = normalizedSecondRequest.find(
      message =>
        message.type === 'user' &&
        Array.isArray(message.message.content) &&
        message.message.content.some(
          part =>
            part.type === 'text' &&
            part.text.includes('completed work') &&
            part.text.includes('another run is needed'),
        ),
    )
    expect(summaryUser).toBeDefined()
    if (
      summaryUser?.type === 'user' &&
      Array.isArray(summaryUser.message.content)
    ) {
      const toolResultText = summaryUser.message.content
        .filter(part => part.type === 'tool_result')
        .map(part => String(part.content))
        .join('\n')
      expect(toolResultText).not.toContain('completed work')
    }
  })

  test('step count accumulates across turns before later tool calls are blocked', async () => {
    echoCalls.length = 0
    let modelCalls = 0
    const requestToolCounts: number[] = []
    const requestMessageNormalizationToolCounts: number[] = []

    const { yielded, returned } = await drain(
      makeParams(
        async function* ({ options, tools }) {
          modelCalls++
          requestToolCounts.push(tools.length)
          requestMessageNormalizationToolCounts.push(
            options.messageNormalizationTools?.length ?? 0,
          )
          if (modelCalls === 1) {
            yield createAssistantMessage({
              content: [
                {
                  type: 'tool_use',
                  id: 'toolu_turn_1',
                  name: 'Echo',
                  input: { text: 'first' },
                },
              ],
            })
            return
          }
          if (modelCalls === 2) {
            yield createAssistantMessage({
              content: [
                {
                  type: 'tool_use',
                  id: 'toolu_turn_2_allowed',
                  name: 'Echo',
                  input: { text: 'second' },
                },
                {
                  type: 'tool_use',
                  id: 'toolu_turn_2_blocked',
                  name: 'Echo',
                  input: { text: 'third' },
                },
              ],
            })
            return
          }
          yield createAssistantMessage({
            content:
              'Completed work: handled two allowed steps. Findings: a later step was blocked. Remaining tasks: continue later. Another run needed: yes.',
          })
        },
        [echoTool],
        { maxSteps: 2, agentType: 'general-purpose' },
      ),
    )

    expect(returned).toMatchObject({
      reason: 'agent_step_limit',
      turnCount: 3,
      stepsUsed: 2,
      maxSteps: 2,
    })
    expect(modelCalls).toBe(3)
    expect(requestToolCounts).toEqual([1, 1, 0])
    expect(requestMessageNormalizationToolCounts).toEqual([0, 0, 1])
    expect(echoCalls).toEqual(['first', 'second'])
    expect(countToolUses(yielded)).toBe(2)
    expect(
      yielded.some(
        message =>
          message?.type === 'user' &&
          Array.isArray(message.message.content) &&
          message.message.content.some(
            (part: any) =>
              part.type === 'tool_result' &&
              part.tool_use_id === 'toolu_turn_2_blocked' &&
              part.is_error === true &&
              String(part.content).includes('Agent step limit reached'),
          ),
      ),
    ).toBe(true)
    expect(
      yielded.some(
        message =>
          message?.type === 'assistant' &&
          message.message.content.some(
            part =>
              part.type === 'text' &&
              part.text.includes('Completed work: handled two allowed steps') &&
              part.text.includes('Another run needed: yes'),
          ),
      ),
    ).toBe(true)
  })

  test('multiple over-limit tool calls do not trip the failure-loop guard', async () => {
    echoCalls.length = 0
    let modelCalls = 0

    const { returned } = await drain(
      makeParams(
        async function* () {
          modelCalls++
          if (modelCalls === 1) {
            yield createAssistantMessage({
              content: [
                {
                  type: 'tool_use',
                  id: 'toolu_echo_allowed',
                  name: 'Echo',
                  input: { text: 'allowed' },
                },
                ...[1, 2, 3, 4].map(i => ({
                  type: 'tool_use' as const,
                  id: `toolu_echo_blocked_${i}`,
                  name: 'Echo',
                  input: { text: `blocked-${i}` },
                })),
              ],
            })
            return
          }
          yield createAssistantMessage({
            content:
              'Completed work: one allowed step. Findings: extra calls were blocked. Remaining tasks: continue later. Another run needed: yes.',
          })
        },
        [echoTool],
        { maxSteps: 1, agentType: 'general-purpose' },
      ),
    )

    expect(returned).toMatchObject({
      reason: 'agent_step_limit',
      turnCount: 2,
      stepsUsed: 1,
      maxSteps: 1,
    })
    expect(modelCalls).toBe(2)
    expect(echoCalls).toEqual(['allowed'])
  })

  test('forced summary turn cannot execute more tools', async () => {
    echoCalls.length = 0
    let modelCalls = 0

    const { yielded, returned } = await drain(
      makeParams(
        async function* () {
          modelCalls++
          if (modelCalls === 1) {
            yield createAssistantMessage({
              content: [
                {
                  type: 'tool_use',
                  id: 'toolu_echo_1',
                  name: 'Echo',
                  input: { text: 'allowed' },
                },
              ],
            })
            return
          }
          yield createAssistantMessage({
            content: [
              {
                type: 'text',
                text: 'I should inspect one more thing first.',
                citations: null,
              },
              {
                type: 'tool_use',
                id: 'toolu_echo_summary',
                name: 'Echo',
                input: { text: 'must-not-run' },
              },
            ],
          })
        },
        [echoTool],
        { maxSteps: 1, agentType: 'general-purpose' },
      ),
    )

    expect(returned).toMatchObject({
      reason: 'agent_step_limit',
      turnCount: 2,
      stepsUsed: 1,
      maxSteps: 1,
    })
    expect(modelCalls).toBe(2)
    expect(echoCalls).toEqual(['allowed'])
    expect(countToolUses(yielded)).toBe(1)
    expect(
      yielded.some(
        message =>
          message?.type === 'user' &&
          Array.isArray(message.message.content) &&
          message.message.content.some(
            (part: any) =>
              part.type === 'tool_result' &&
              part.tool_use_id === 'toolu_echo_summary' &&
              part.is_error === true &&
              String(part.content).includes('Agent step limit reached'),
          ),
      ),
    ).toBe(true)

    const finalAssistantMessage = yielded
      .filter(message => message?.type === 'assistant')
      .at(-1)
    expect(
      finalAssistantMessage?.message.content.some(
        part =>
          part.type === 'text' &&
          part.text.includes('Completed work: Agent') &&
          part.text.includes(
            'Findings: 1 additional tool call was blocked',
          ) &&
          part.text.includes('Another run needed: yes'),
      ),
    ).toBe(true)
  })

  test('forced summary turn does not add a duplicate synthetic summary after a valid model summary', async () => {
    echoCalls.length = 0
    let modelCalls = 0

    const { yielded, returned } = await drain(
      makeParams(
        async function* () {
          modelCalls++
          if (modelCalls === 1) {
            yield createAssistantMessage({
              content: [
                {
                  type: 'tool_use',
                  id: 'toolu_echo_1',
                  name: 'Echo',
                  input: { text: 'allowed' },
                },
              ],
            })
            return
          }
          yield createAssistantMessage({
            content: [
              {
                type: 'text',
                text: 'Completed work: one step.',
                citations: null,
              },
              {
                type: 'text',
                text: 'Findings: the limit was reached.',
                citations: null,
              },
              {
                type: 'text',
                text: 'Remaining tasks: continue later.',
                citations: null,
              },
              {
                type: 'text',
                text: 'Another run needed: yes.',
                citations: null,
              },
              {
                type: 'tool_use',
                id: 'toolu_echo_summary',
                name: 'Echo',
                input: { text: 'must-not-run' },
              },
            ],
          })
        },
        [echoTool],
        { maxSteps: 1, agentType: 'general-purpose' },
      ),
    )

    expect(returned).toMatchObject({
      reason: 'agent_step_limit',
      turnCount: 2,
      stepsUsed: 1,
      maxSteps: 1,
    })
    expect(modelCalls).toBe(2)
    expect(echoCalls).toEqual(['allowed'])
    expect(countToolUses(yielded)).toBe(1)

    const assistantMessages = yielded.filter(
      message => message?.type === 'assistant',
    )
    expect(assistantMessages).toHaveLength(2)
    const finalAssistantText = assistantMessages
      .at(-1)
      ?.message.content.filter(part => part.type === 'text')
      .map(part => part.text)
      .join('\n')
    expect(finalAssistantText).toContain('Completed work: one step')
    expect(finalAssistantText).toContain('Another run needed: yes')
    expect(
      assistantMessages.some(message =>
        message.message.content.some(
          part =>
            part.type === 'text' &&
            part.text.includes("Agent 'general-purpose' reached"),
        ),
      ),
    ).toBe(false)
  })

  test('real tool output with the readable limit prefix still counts as a tool use', () => {
    const messages = [
      createAssistantMessage({
        content: [
          {
            type: 'tool_use',
            id: 'toolu_real_output',
            name: 'Echo',
            input: { text: 'prefix-collision' },
          },
        ],
      }),
      createUserMessage({
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_real_output',
            content: `${AGENT_STEP_LIMIT_TOOL_RESULT_PREFIX}: this is real tool output, not synthetic`,
          },
        ],
      }),
    ]

    expect(countToolUses(messages)).toBe(1)
  })
})
