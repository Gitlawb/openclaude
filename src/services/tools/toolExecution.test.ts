import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'

import { SkillTool } from '../../tools/SkillTool/SkillTool.js'
import { AskUserQuestionTool } from '../../tools/AskUserQuestionTool/AskUserQuestionTool.js'
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import { FILE_EDIT_TOOL_NAME } from '../../tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from '../../tools/FileWriteTool/constants.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from '../../tools/NotebookEditTool/constants.js'
import { AbortError } from '../../utils/errors.js'
import { ReplayIndexBuilder } from '../../utils/replayIndexBuilder.js'
import {
  getReplayResultStatusForError,
  getReplayModifiedFiles,
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

describe('getReplayModifiedFiles', () => {
  test('captures file-editing tool paths', () => {
    expect(
      getReplayModifiedFiles(FILE_EDIT_TOOL_NAME, { file_path: 'src/a.ts' }),
    ).toEqual(['src/a.ts'])
    expect(
      getReplayModifiedFiles(FILE_WRITE_TOOL_NAME, { file_path: 'src/b.ts' }),
    ).toEqual(['src/b.ts'])
    expect(
      getReplayModifiedFiles(NOTEBOOK_EDIT_TOOL_NAME, {
        notebook_path: 'notebooks/a.ipynb',
      }),
    ).toEqual(['notebooks/a.ipynb'])
  })

  test('captures Bash simulated sed edit paths', () => {
    expect(
      getReplayModifiedFiles(BASH_TOOL_NAME, {
        command: "sed -i 's/a/b/' src/a.ts",
        _simulatedSedEdit: {
          filePath: 'src/a.ts',
          newContent: 'updated',
        },
      }),
    ).toEqual(['src/a.ts'])
  })
})

describe('replay tool lifecycle records', () => {
  test('records permission denied completions', () => {
    const builder = new ReplayIndexBuilder()

    builder.trackToolStart('tool-1', BASH_TOOL_NAME, { command: 'git status' })
    builder.trackToolEnd('tool-1', BASH_TOOL_NAME, 'permission_denied', 'denied')

    const step = builder.build('session-1').steps[0]
    expect(step?.type).toBe('tool')
    if (step?.type !== 'tool') {
      throw new Error('expected tool replay step')
    }
    expect(step.resultStatus).toBe('permission_denied')
    expect(step.resultPreview).toBe('denied')
  })

  test('records success completions with modified files', () => {
    const builder = new ReplayIndexBuilder()

    builder.trackToolStart('tool-1', FILE_EDIT_TOOL_NAME, {
      file_path: 'src/final.ts',
      old_string: 'old',
      new_string: 'new',
    })
    builder.trackToolEnd('tool-1', FILE_EDIT_TOOL_NAME, 'success', 'patched', [
      'src/final.ts',
    ])

    const step = builder.build('session-1').steps[0]
    expect(step?.type).toBe('tool')
    if (step?.type !== 'tool') {
      throw new Error('expected tool replay step')
    }
    expect(step.resultStatus).toBe('success')
    expect(step.filesModified).toEqual(['src/final.ts'])
  })

  test('records error completions', () => {
    const builder = new ReplayIndexBuilder()

    builder.trackToolStart('tool-1', BASH_TOOL_NAME, { command: 'bun test' })
    builder.trackToolEnd('tool-1', BASH_TOOL_NAME, 'error', 'failed')

    const step = builder.build('session-1').steps[0]
    expect(step?.type).toBe('tool')
    if (step?.type !== 'tool') {
      throw new Error('expected tool replay step')
    }
    expect(step.resultStatus).toBe('error')
    expect(step.resultPreview).toBe('failed')
  })

  test('classifies abort-shaped tool failures as cancelled', () => {
    expect(getReplayResultStatusForError(new AbortError('interrupted'))).toBe(
      'cancelled',
    )
    expect(getReplayResultStatusForError(new Error('failed'))).toBe('error')
  })

  test('captures the final executable input', () => {
    const builder = new ReplayIndexBuilder()
    const finalInput = {
      file_path: 'src/final.ts',
      old_string: 'before',
      new_string: 'after',
    }

    builder.trackToolStart('tool-1', FILE_EDIT_TOOL_NAME, finalInput)
    builder.trackToolEnd('tool-1', FILE_EDIT_TOOL_NAME, 'success')

    const step = builder.build('session-1').steps[0]
    expect(step?.type).toBe('tool')
    if (step?.type !== 'tool') {
      throw new Error('expected tool replay step')
    }
    expect(step.input).toEqual(finalInput)
    expect(step.inputSummary).toBe('Edit src/final.ts')
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
