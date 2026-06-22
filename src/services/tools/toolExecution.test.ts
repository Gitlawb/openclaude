import { afterEach, describe, expect, mock, test } from 'bun:test'
import { z } from 'zod/v4'

import { getEmptyToolPermissionContext, type Tool, type ToolUseContext } from '../../Tool.js'
import {
  getReplayIndexBuilder,
  resetAllReplayIndexBuilders,
} from '../../bootstrap/state.js'
import { getDefaultAppState } from '../../state/AppStateStore.js'
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
  checkPermissionsAndCallTool,
  normalizeReplayToolInput,
  normalizeToolInputForValidation,
} from './toolExecution.js'

afterEach(() => {
  delete process.env.TEST_ENABLE_SESSION_PERSISTENCE
  resetAllReplayIndexBuilders()
})

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

  test('normalizes denied file-tool replay inputs to match allowed retry inputs', () => {
    const builder = new ReplayIndexBuilder()
    const modelInput = {
      file_path: 'src/final.ts',
      old_string: 'before',
      new_string: 'after',
    }
    const backfilledClone = {
      ...modelInput,
      file_path: 'C:\\temp\\openclaude\\src\\final.ts',
    }
    const deniedReplayInput = normalizeReplayToolInput(
      backfilledClone,
      modelInput,
      backfilledClone,
    )

    builder.trackToolStart('tool-1', FILE_EDIT_TOOL_NAME, deniedReplayInput)
    builder.trackToolEnd(
      'tool-1',
      FILE_EDIT_TOOL_NAME,
      'permission_denied',
      'denied',
    )
    builder.trackToolStart('tool-2', FILE_EDIT_TOOL_NAME, modelInput)
    builder.trackToolEnd('tool-2', FILE_EDIT_TOOL_NAME, 'success')

    const index = builder.build('session-1')
    const first = index.steps[0]
    const second = index.steps[1]

    expect(first?.type).toBe('tool')
    expect(second?.type).toBe('tool')
    if (first?.type !== 'tool' || second?.type !== 'tool') {
      throw new Error('expected tool replay steps')
    }

    expect(first.input.file_path).toBe('src/final.ts')
    expect(second.repeatedAttemptNumber).toBe(2)
    expect(second.isRepeatedAttempt).toBe(true)
  })

  test('records one error terminal status when post-call result processing fails', async () => {
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = 'true'
    resetAllReplayIndexBuilders()
    const toolUseId = 'tool-1'
    const tool = {
      name: 'TestTool',
      inputSchema: z.object({ value: z.string() }),
      maxResultSizeChars: 1000,
      call: mock(() =>
        Promise.resolve({
          data: 'tool succeeded',
        }),
      ),
      mapToolResultToToolResultBlockParam: mock(() => {
        throw new Error('mapping failed')
      }),
      checkPermissions: mock(() =>
        Promise.resolve({
          behavior: 'allow',
          updatedInput: { value: 'final' },
        }),
      ),
      isEnabled: () => true,
      isReadOnly: () => false,
      isConcurrencySafe: () => true,
      description: () => Promise.resolve('test tool'),
      prompt: () => Promise.resolve('test tool'),
    } as unknown as Tool
    const appState = getDefaultAppState()
    const context = {
      options: {
        commands: [],
        debug: false,
        mainLoopModel: 'test-model',
        tools: [tool],
        verbose: false,
        thinkingConfig: {},
        mcpClients: [],
        mcpResources: {},
        isNonInteractiveSession: true,
        agentDefinitions: { agents: [], errors: [] },
      },
      abortController: new AbortController(),
      readFileState: {},
      getAppState: () => ({
        ...appState,
        toolPermissionContext: getEmptyToolPermissionContext(),
      }),
      setAppState: () => {},
      setInProgressToolUseIDs: () => {},
      setResponseLength: () => {},
      updateFileHistoryState: () => {},
      updateAttributionState: () => {},
      messages: [],
    } as unknown as ToolUseContext

    const result = await checkPermissionsAndCallTool(
      tool,
      toolUseId,
      { value: 'initial' },
      context,
      () =>
        Promise.resolve({
          behavior: 'allow',
          updatedInput: { value: 'final' },
        }),
      {
        uuid: 'assistant-1',
        type: 'assistant',
        message: { id: 'msg-1' },
      } as never,
      'msg-1',
      undefined,
      undefined as never,
      undefined,
      () => {},
    )

    expect(result).toHaveLength(1)
    const index = getReplayIndexBuilder().build('session-1')
    expect(index.steps).toHaveLength(1)
    const step = index.steps[0]
    expect(step?.type).toBe('tool')
    if (step?.type !== 'tool') {
      throw new Error('expected tool replay step')
    }
    expect(step.toolUseId).toBe(toolUseId)
    expect(step.resultStatus).toBe('error')
    expect(step.resultPreview).toBe('mapping failed')
    expect(step.input).toEqual({ value: 'final' })
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
