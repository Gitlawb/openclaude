import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'

import { SkillTool } from '../../tools/SkillTool/SkillTool.js'
import { AskUserQuestionTool } from '../../tools/AskUserQuestionTool/AskUserQuestionTool.js'
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import { createToolFixture } from '../../test/toolFixtures.js'
import {
  getEmptyToolPermissionContext,
  type Tool,
  type ToolUseContext,
} from '../../Tool.js'
import type { AssistantMessage } from '../../types/message.js'
import { QueryLifecycleOperationTracker } from '../../utils/queryLifecycle.js'
import {
  getSchemaValidationErrorOverride,
  getSchemaValidationToolUseResult,
  type MessageUpdateLazy,
  normalizeToolInputForValidation,
  runToolUse,
} from './toolExecution.js'

const lifecycleToolInputSchema = z.object({
  command: z.string(),
  timeout: z.number().optional(),
})

const assistantMessage = {
  uuid: 'assistant-message-1',
  requestId: 'request-1',
  message: {
    id: 'assistant-api-message-1',
  },
} as unknown as AssistantMessage

function makeToolUseContext(
  tools: readonly Tool[],
  queryLifecycle: QueryLifecycleOperationTracker,
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
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
  } as unknown as ToolUseContext
}

async function collectToolUseUpdates(
  tool: Tool,
  input: Record<string, unknown>,
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
) {
  const updates: MessageUpdateLazy[] = []
  for await (const update of runToolUse(
    {
      type: 'tool_use',
      id: 'tool-use-1',
      name: tool.name,
      input,
    } as Parameters<typeof runToolUse>[0],
    assistantMessage,
    canUseTool,
    toolUseContext,
  )) {
    updates.push(update)
  }
  return updates
}

describe('getSchemaValidationErrorOverride', () => {
  test('returns actionable missing-skill error for SkillTool', () => {
    expect(getSchemaValidationErrorOverride(SkillTool, {})).toBe(
      'Missing skill name. Pass the slash command name as the skill parameter (e.g., skill: "commit" for /commit, skill: "review-pr" for /review-pr).',
    )
  })

  test('does not override unrelated tool schema failures', () => {
    expect(getSchemaValidationErrorOverride({ name: 'Read' } as never, {})).toBe(
      null,
    )
  })

  test('does not override SkillTool when skill is present', () => {
    expect(
      getSchemaValidationErrorOverride(SkillTool, { skill: 'commit' }),
    ).toBe(null)
  })

  test('uses the actionable override for structured toolUseResult too', () => {
    expect(getSchemaValidationToolUseResult(SkillTool, {} as never)).toBe(
      'InputValidationError: Missing skill name. Pass the slash command name as the skill parameter (e.g., skill: "commit" for /commit, skill: "review-pr" for /review-pr).',
    )
  })
})

describe('runToolUse lifecycle tracking', () => {
  test('tracks the tool use while async input validation is pending and clears it on validation failure', async () => {
    const queryLifecycle = new QueryLifecycleOperationTracker()
    const snapshots: ReturnType<QueryLifecycleOperationTracker['snapshot']>[] =
      []
    const tool = createToolFixture(lifecycleToolInputSchema, {
      name: 'LifecycleTestTool',
      async validateInput() {
        snapshots.push(queryLifecycle.snapshot())
        return {
          result: false,
          message: 'blocked by validation',
          errorCode: 123,
        }
      },
      async call() {
        throw new Error('call should not run after validation failure')
      },
    })
    const toolUseContext = makeToolUseContext([tool], queryLifecycle)
    const canUseTool = (async () => ({
      behavior: 'allow',
    })) as CanUseToolFn

    const updates = await collectToolUseUpdates(
      tool,
      { command: 'echo hi', timeout: 1234 },
      canUseTool,
      toolUseContext,
    )

    expect(updates).toHaveLength(1)
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]?.apiCalls).toEqual([])
    expect(snapshots[0]?.toolUses).toHaveLength(1)
    expect(snapshots[0]?.toolUses[0]).toMatchObject({
      toolUseId: 'tool-use-1',
      toolName: 'LifecycleTestTool',
    })
    expect(typeof snapshots[0]?.toolUses[0]?.startedAt).toBe('number')
    expect(queryLifecycle.snapshot()).toEqual({ apiCalls: [], toolUses: [] })
  })

  test('tracks Bash timeout metadata while async input validation is pending', async () => {
    const queryLifecycle = new QueryLifecycleOperationTracker()
    const snapshots: ReturnType<QueryLifecycleOperationTracker['snapshot']>[] =
      []
    const tool = createToolFixture(lifecycleToolInputSchema, {
      name: BASH_TOOL_NAME,
      async validateInput() {
        snapshots.push(queryLifecycle.snapshot())
        return {
          result: false,
          message: 'blocked by validation',
          errorCode: 123,
        }
      },
      async call() {
        throw new Error('call should not run after validation failure')
      },
    })
    const toolUseContext = makeToolUseContext([tool], queryLifecycle)
    const canUseTool = (async () => ({
      behavior: 'allow',
    })) as CanUseToolFn

    await collectToolUseUpdates(
      tool,
      { command: 'sleep 1', timeout: 4321 },
      canUseTool,
      toolUseContext,
    )

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]?.toolUses).toHaveLength(1)
    expect(snapshots[0]?.toolUses[0]).toMatchObject({
      toolUseId: 'tool-use-1',
      toolName: BASH_TOOL_NAME,
      isBash: true,
      timeoutMs: 4321,
    })
    expect(queryLifecycle.snapshot()).toEqual({ apiCalls: [], toolUses: [] })
  })

  test('tracks the tool use while permission resolution is pending and clears it on denial', async () => {
    const queryLifecycle = new QueryLifecycleOperationTracker()
    const snapshots: ReturnType<QueryLifecycleOperationTracker['snapshot']>[] =
      []
    const tool = createToolFixture(lifecycleToolInputSchema, {
      name: 'LifecyclePermissionTool',
      async validateInput() {
        return { result: true }
      },
      async call() {
        throw new Error('call should not run after permission denial')
      },
    })
    const toolUseContext = makeToolUseContext([tool], queryLifecycle)
    const canUseTool = (async () => {
      snapshots.push(queryLifecycle.snapshot())
      return {
        behavior: 'deny',
        message: 'denied by test',
        decisionReason: {
          type: 'other',
          reason: 'denied by test',
        },
      }
    }) as CanUseToolFn

    const previousSimpleMode = process.env.CLAUDE_CODE_SIMPLE
    process.env.CLAUDE_CODE_SIMPLE = '1'
    let updates: Awaited<ReturnType<typeof collectToolUseUpdates>>
    try {
      updates = await collectToolUseUpdates(
        tool,
        { command: 'echo hi' },
        canUseTool,
        toolUseContext,
      )
    } finally {
      if (previousSimpleMode === undefined) {
        delete process.env.CLAUDE_CODE_SIMPLE
      } else {
        process.env.CLAUDE_CODE_SIMPLE = previousSimpleMode
      }
    }

    expect(updates).toHaveLength(1)
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]?.apiCalls).toEqual([])
    expect(snapshots[0]?.toolUses).toHaveLength(1)
    expect(snapshots[0]?.toolUses[0]).toMatchObject({
      toolUseId: 'tool-use-1',
      toolName: 'LifecyclePermissionTool',
    })
    expect(typeof snapshots[0]?.toolUses[0]?.startedAt).toBe('number')
    expect(queryLifecycle.snapshot()).toEqual({ apiCalls: [], toolUses: [] })
  })

  test('refreshes Bash timeout metadata after permission input rewrites', async () => {
    const queryLifecycle = new QueryLifecycleOperationTracker()
    const permissionSnapshots: ReturnType<
      QueryLifecycleOperationTracker['snapshot']
    >[] = []
    const callSnapshots: ReturnType<QueryLifecycleOperationTracker['snapshot']>[] =
      []
    const tool = createToolFixture(lifecycleToolInputSchema, {
      name: BASH_TOOL_NAME,
      async validateInput() {
        return { result: true }
      },
      async call(input) {
        callSnapshots.push(queryLifecycle.snapshot())
        expect(input).toMatchObject({
          command: 'sleep 2',
          timeout: 2222,
        })
        return { data: 'ok' }
      },
    })
    const toolUseContext = makeToolUseContext([tool], queryLifecycle)
    const canUseTool = (async () => {
      permissionSnapshots.push(queryLifecycle.snapshot())
      return {
        behavior: 'allow',
        updatedInput: { command: 'sleep 2', timeout: 2222 },
        decisionReason: {
          type: 'other',
          reason: 'allowed by test',
        },
      }
    }) as CanUseToolFn

    await collectToolUseUpdates(
      tool,
      { command: 'sleep 1', timeout: 1111 },
      canUseTool,
      toolUseContext,
    )

    expect(permissionSnapshots).toHaveLength(1)
    expect(permissionSnapshots[0]?.toolUses[0]).toMatchObject({
      toolUseId: 'tool-use-1',
      toolName: BASH_TOOL_NAME,
      isBash: true,
      timeoutMs: 1111,
    })
    expect(callSnapshots).toHaveLength(1)
    expect(callSnapshots[0]?.toolUses[0]).toMatchObject({
      toolUseId: 'tool-use-1',
      toolName: BASH_TOOL_NAME,
      isBash: true,
      timeoutMs: 2222,
    })
    expect(queryLifecycle.snapshot()).toEqual({ apiCalls: [], toolUses: [] })
  })
})

describe('normalizeToolInputForValidation', () => {
  test('treats blank Read.pages as omitted', () => {
    expect(
      normalizeToolInputForValidation({ name: 'Read' } as never, {
        file_path: '/tmp/example.txt',
        offset: 1,
        limit: 20,
        pages: '',
      }),
    ).toEqual({
      file_path: '/tmp/example.txt',
      offset: 1,
      limit: 20,
    })

    expect(
      normalizeToolInputForValidation({ name: 'Read' } as never, {
        file_path: '/tmp/example.txt',
        pages: '   ',
      }),
    ).toEqual({
      file_path: '/tmp/example.txt',
    })
  })

  test('treats null Read.pages as omitted', () => {
    expect(
      normalizeToolInputForValidation({ name: 'Read' } as never, {
        file_path: '/tmp/example.txt',
        pages: null,
      }),
    ).toEqual({
      file_path: '/tmp/example.txt',
    })
  })

  test('wraps Gemini-style single AskUserQuestion payloads', () => {
    const normalized = normalizeToolInputForValidation(AskUserQuestionTool, {
      header: 'Location',
      question: 'Where should we create the app?',
      options: [
        {
          label: '../todo-app (Recommended)',
          description: 'Create the app next to the current project',
        },
        {
          label: 'Custom path',
          description: 'Provide another folder',
        },
      ],
      multiSelect: false,
    })

    expect(AskUserQuestionTool.inputSchema.safeParse(normalized).success).toBe(true)
    expect(normalized).toEqual({
      questions: [
        {
          header: 'Location',
          question: 'Where should we create the app?',
          options: [
            {
              label: '../todo-app (Recommended)',
              description: 'Create the app next to the current project',
            },
            {
              label: 'Custom path',
              description: 'Provide another folder',
            },
          ],
          multiSelect: false,
        },
      ],
    })
  })

  test('leaves already valid AskUserQuestion payloads unchanged', () => {
    const input = {
      questions: [
        {
          header: 'Location',
          question: 'Where should we create the app?',
          options: [
            { label: '../todo-app', description: 'Use the default folder' },
            { label: 'Custom', description: 'Provide another folder' },
          ],
          multiSelect: false,
        },
      ],
    }

    expect(normalizeToolInputForValidation(AskUserQuestionTool, input)).toBe(input)
  })

  test('does not normalize unrelated tool inputs', () => {
    const input = {
      header: 'Location',
      question: 'Where should we create the app?',
      options: [],
    }

    expect(normalizeToolInputForValidation({ name: 'Read' } as never, input)).toBe(input)
  })
})
