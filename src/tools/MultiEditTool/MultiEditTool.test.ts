import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ToolUseContext } from '../../Tool.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { runWithSdkContext, setCwdState } from '../../bootstrap/state.js'
import { getCwd, runWithCwdOverride } from '../../utils/cwd.js'
import {
  createFileStateCacheWithSizeLimit,
  READ_FILE_STATE_CACHE_SIZE,
  type FileStateCache,
} from '../../utils/fileStateCache.js'
import { renderToString } from '../../utils/staticRender.js'
import type { SessionId } from '../../types/ids.js'
import { MultiEditTool } from './MultiEditTool.js'
import { MULTI_EDIT_TOOL_NAME } from './constants.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  renderToolUseRejectedMessage,
} from './UI.js'

let tempDir: string
let prevSimple: string | undefined
let prevCheckpoint: string | undefined

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'multi-edit-tool-test-'))
  prevSimple = process.env.CLAUDE_CODE_SIMPLE
  prevCheckpoint = process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING
  process.env.CLAUDE_CODE_SIMPLE = 'true'
  process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING = 'true'
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
  if (prevSimple === undefined) delete process.env.CLAUDE_CODE_SIMPLE
  else process.env.CLAUDE_CODE_SIMPLE = prevSimple
  if (prevCheckpoint === undefined) delete process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING
  else process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING = prevCheckpoint
})

function markFileAsRead(readFileState: FileStateCache, filePath: string): void {
  const content = readFileSync(filePath, 'utf8')
  readFileState.set(filePath, {
    content,
    // Far future timestamp so the "modified since read" check always passes.
    timestamp: Date.now() + 10_000,
    offset: undefined,
    limit: undefined,
  })
}

function createToolUseContext(
  readFileState: FileStateCache,
  mode: ReturnType<typeof getEmptyToolPermissionContext>['mode'] = 'default',
): ToolUseContext {
  return {
    readFileState,
    updateFileHistoryState: () => {},
    dynamicSkillDirTriggers: new Set<string>(),
    getAppState: () => ({
      toolPermissionContext: {
        ...getEmptyToolPermissionContext(),
        mode,
      },
    }),
  } as unknown as ToolUseContext
}

async function runInCwd<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const previousCwd = getCwd()
  return await runWithSdkContext(
    {
      sessionId: 'multi-edit-tool-test' as SessionId,
      sessionProjectDir: null,
      cwd,
      originalCwd: cwd,
    },
    () =>
      runWithCwdOverride(cwd, async () => {
        setCwdState(cwd)
        try {
          return await fn()
        } finally {
          setCwdState(previousCwd)
        }
      }),
  )
}

describe('MultiEditTool', () => {
  test('is registered as a base tool with deny-rule filtering', async () => {
    const { getAllBaseTools } = await import('../../tools.js')
    const names = getAllBaseTools().map(tool => tool.name)
    expect(names).toContain(MULTI_EDIT_TOOL_NAME)
    expect(MultiEditTool.name).toBe(MULTI_EDIT_TOOL_NAME)

    // Deny-rule filtering: a batch targeting a denied path is denied even
    // when another edit in the same batch targets an allowed path.
    const deniedFile = join(tempDir, 'denied.txt')
    const allowedFile = join(tempDir, 'allowed.txt')
    writeFileSync(deniedFile, 'denied')
    writeFileSync(allowedFile, 'allowed')

    const readFileState = createFileStateCacheWithSizeLimit(
      READ_FILE_STATE_CACHE_SIZE,
    )
    markFileAsRead(readFileState, deniedFile)
    markFileAsRead(readFileState, allowedFile)

    const decision = await runInCwd(tempDir, () =>
      MultiEditTool.checkPermissions(
        {
          edits: [
            { file_path: allowedFile, old_string: 'allowed', new_string: 'ALLOWED' },
            { file_path: deniedFile, old_string: 'denied', new_string: 'DENIED' },
          ],
        },
        {
          getAppState: () => ({
            toolPermissionContext: {
              ...getEmptyToolPermissionContext(),
              alwaysDenyRules: {
                session: ['Edit(**/denied.txt)'],
              },
            },
          }),
        } as unknown as ToolUseContext,
      ),
    )

    expect(decision.behavior).toBe('deny')
  })

  test('denies an empty edits batch at both permission and validation gates', async () => {
    const permission = await MultiEditTool.checkPermissions(
      { edits: [] },
      { getAppState: () => ({ toolPermissionContext: getEmptyToolPermissionContext() }) } as unknown as ToolUseContext,
    )
    expect(permission.behavior).toBe('deny')
    if (permission.behavior === 'deny') {
      expect(permission.message).toBe('No edits provided.')
    }

    const validation = await MultiEditTool.validateInput(
      { edits: [] },
      createToolUseContext(createFileStateCacheWithSizeLimit(READ_FILE_STATE_CACHE_SIZE)),
    )
    expect(validation.result).toBe(false)
    if (!validation.result) {
      expect(validation.message).toBe('No edits provided.')
      expect(validation.errorCode).toBe(0)
    }
  })

  test('applies edits and reports deduplicated file paths', async () => {
    const fileA = join(tempDir, 'a.txt')
    writeFileSync(fileA, 'foo\nbar\n')
    const readFileState = createFileStateCacheWithSizeLimit(
      READ_FILE_STATE_CACHE_SIZE,
    )
    markFileAsRead(readFileState, fileA)

    const result = await MultiEditTool.call(
      {
        edits: [
          { file_path: fileA, old_string: 'foo', new_string: 'FOO' },
          { file_path: fileA, old_string: 'bar', new_string: 'BAR' },
        ],
      },
      createToolUseContext(readFileState),
      mock(async () => ({ behavior: 'allow' })) as never,
      { uuid: 'test-uuid' } as never,
    )

    expect(result.data.editCount).toBe(2)
    // Two edits to the same file still report one unique file path.
    expect(result.data.filePaths).toEqual([fileA])
    expect(readFileSync(fileA, 'utf8')).toBe('FOO\nBAR\n')
  })

  test('a failing middle edit leaves the codebase untouched', async () => {
    const fileA = join(tempDir, 'a.txt')
    const fileB = join(tempDir, 'b.txt')
    writeFileSync(fileA, 'alpha\nbeta\n')
    writeFileSync(fileB, 'gamma\ndelta\n')
    const readFileState = createFileStateCacheWithSizeLimit(
      READ_FILE_STATE_CACHE_SIZE,
    )
    markFileAsRead(readFileState, fileA)
    markFileAsRead(readFileState, fileB)

    const attempt = MultiEditTool.call(
      {
        edits: [
          { file_path: fileA, old_string: 'alpha', new_string: 'ALPHA' },
          // This old_string is not present in fileB, so the batch must fail
          // during the in-memory resolve phase before anything is written.
          { file_path: fileB, old_string: 'zzz', new_string: 'ZZZ' },
          { file_path: fileA, old_string: 'beta', new_string: 'BETA' },
        ],
      },
      createToolUseContext(readFileState),
      mock(async () => ({ behavior: 'allow' })) as never,
      { uuid: 'test-uuid' } as never,
    )

    await expect(attempt).rejects.toThrow('String not found in file')
    expect(readFileSync(fileA, 'utf8')).toBe('alpha\nbeta\n')
    expect(readFileSync(fileB, 'utf8')).toBe('gamma\ndelta\n')
  })

  test('rejects edits to .ipynb files with a NotebookEdit hint', async () => {
    const notebook = join(tempDir, 'notebook.ipynb')
    writeFileSync(notebook, '{"cells": []}')
    const readFileState = createFileStateCacheWithSizeLimit(
      READ_FILE_STATE_CACHE_SIZE,
    )
    markFileAsRead(readFileState, notebook)

    const result = await MultiEditTool.validateInput(
      {
        edits: [
          {
            file_path: notebook,
            old_string: '{"cells"',
            new_string: '{"cells2"',
          },
        ],
      },
      createToolUseContext(readFileState),
    )

    expect(result.result).toBe(false)
    if (!result.result) {
      expect(result.message).toContain('NotebookEdit')
      expect(result.message).toContain('Jupyter Notebook')
    }
  })

  test('validates a successful batch', async () => {
    const fileA = join(tempDir, 'a.txt')
    writeFileSync(fileA, 'foo\nbar\n')
    const readFileState = createFileStateCacheWithSizeLimit(
      READ_FILE_STATE_CACHE_SIZE,
    )
    markFileAsRead(readFileState, fileA)

    const result = await MultiEditTool.validateInput(
      {
        edits: [
          { file_path: fileA, old_string: 'foo', new_string: 'FOO' },
          { file_path: fileA, old_string: 'bar', new_string: 'BAR' },
        ],
      },
      createToolUseContext(readFileState),
    )

    expect(result.result).toBe(true)
  })

  test('validates a later same-file edit against accumulated content', async () => {
    const fileA = join(tempDir, 'a.txt')
    writeFileSync(fileA, 'foo\nbar\n')
    const readFileState = createFileStateCacheWithSizeLimit(
      READ_FILE_STATE_CACHE_SIZE,
    )
    markFileAsRead(readFileState, fileA)

    const ok = await MultiEditTool.validateInput(
      {
        edits: [
          { file_path: fileA, old_string: 'foo', new_string: 'FOO' },
          { file_path: fileA, old_string: 'FOO', new_string: 'FOO2' },
        ],
      },
      createToolUseContext(readFileState),
    )
    expect(ok.result).toBe(true)

    const missing = await MultiEditTool.validateInput(
      {
        edits: [
          { file_path: fileA, old_string: 'foo', new_string: 'FOO' },
          { file_path: fileA, old_string: 'foo', new_string: 'zzz' },
        ],
      },
      createToolUseContext(readFileState),
    )
    expect(missing.result).toBe(false)
    if (!missing.result) {
      expect(missing.message).toContain('String to replace not found')
    }
  })

  test('allows a batch in acceptEdits mode when every path is inside the working dir', async () => {
    const fileA = join(tempDir, 'a.txt')
    writeFileSync(fileA, 'content')

    const decision = await runInCwd(tempDir, () =>
      MultiEditTool.checkPermissions(
        {
          edits: [{ file_path: fileA, old_string: 'content', new_string: 'CHANGED' }],
        },
        {
          getAppState: () => ({
            toolPermissionContext: {
              ...getEmptyToolPermissionContext(),
              mode: 'acceptEdits',
              additionalWorkingDirectories: new Map([[tempDir, tempDir]]),
            },
          }),
        } as unknown as ToolUseContext,
      ),
    )

    expect(decision.behavior).toBe('allow')
  })
})

describe('MultiEditTool UI', () => {
  const edits = () => [
    { file_path: join(tempDir, 'a.txt'), old_string: 'x', new_string: 'y' },
    { file_path: join(tempDir, 'b.txt'), old_string: 'x', new_string: 'y' },
  ]

  test('getToolUseSummary reports null, a single file, or a file count', () => {
    expect(getToolUseSummary(undefined)).toBeNull()
    expect(getToolUseSummary({})).toBeNull()
    expect(getToolUseSummary({ edits: [edits()[0]!] })).toContain('a.txt')
    expect(getToolUseSummary({ edits: edits() })).toBe('2 files')
  })

  test('renderToolUseMessage shows the edit count and file list', async () => {
    const output = await renderToString(
      renderToolUseMessage({ edits: edits() }, { verbose: false }),
      80,
    )
    expect(output).toContain('Editing 2 edits across')
    expect(output).toContain('a.txt')
    expect(output).toContain('b.txt')
  })

  test('renderToolResultMessage reports applied edits, verbose appends paths', async () => {
    const condensed = await renderToString(
      renderToolResultMessage(
        { editCount: 2, filePaths: [edits()[0]!.file_path, edits()[1]!.file_path] },
        [],
        { verbose: false },
      ),
      80,
    )
    expect(condensed).toContain('Applied 2 edits across 2 files')

    const verbose = await renderToString(
      renderToolResultMessage(
        { editCount: 1, filePaths: [edits()[0]!.file_path] },
        [],
        { verbose: true },
      ),
      80,
    )
    expect(verbose).toContain('Applied 1 edit across 1 file')
    expect(verbose).toContain('a.txt')
  })

  test('renderToolUseRejectedMessage reports the rejected batch size', async () => {
    const output = await renderToString(
      renderToolUseRejectedMessage(
        { edits: edits() },
        { verbose: false } as never,
      ),
      80,
    )
    expect(output).toContain('Multi-edit rejected (2 edits across 2 files)')
  })

  test('renderToolUseErrorMessage surfaces the underlying error', async () => {
    const output = await renderToString(
      renderToolUseErrorMessage('Error: boom', {
        progressMessagesForMessage: [],
        tools: {} as never,
        verbose: true,
      }),
      80,
    )
    expect(output).toContain('Error: boom')
  })
})
