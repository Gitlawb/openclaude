import { expect, test } from 'bun:test'

import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { getMissingToolResultAbortMessage } from '../utils/abortReasons.js'
import {
  createToolFailureLoopGuardState,
  getToolFailureLoopThreshold,
  updateToolFailureLoopGuard,
} from './toolFailureLoopGuard.js'

const querySourceFile = new URL('../query.ts', import.meta.url)

function toolUse(
  id: string,
  name: string,
  input: Record<string, unknown> = {},
): ToolUseBlock {
  return {
    type: 'tool_use',
    id,
    name,
    input,
  } as ToolUseBlock
}

function toolResult(
  toolUseId: string,
  content: string,
  isError = true,
  isAgentStepLimitToolResult = false,
): {
  type: 'user'
  isAgentStepLimitToolResult?: boolean
  message: { content: unknown[] }
} {
  return {
    type: 'user',
    ...(isAgentStepLimitToolResult ? { isAgentStepLimitToolResult } : {}),
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content,
          ...(isError ? { is_error: true } : {}),
        },
      ],
    },
  }
}

function update(
  state = createToolFailureLoopGuardState(),
  toolUseBlocks: ToolUseBlock[],
  results: ReturnType<typeof toolResult>[],
  threshold = 3,
) {
  return updateToolFailureLoopGuard({
    state,
    toolUseBlocks,
    // Minimal fixtures (no uuid/timestamp envelope) — cast type-side only.
    toolResults: results as unknown as Parameters<
      typeof updateToolFailureLoopGuard
    >[0]['toolResults'],
    threshold,
  })
}

test('three identical tool failures trip the guard', () => {
  const state = createToolFailureLoopGuardState()

  expect(
    update(state, [toolUse('a', 'Edit')], [
      toolResult('a', 'Error writing file: failed to replace text'),
    ]).tripped,
  ).toBe(false)
  expect(
    update(state, [toolUse('b', 'Edit')], [
      toolResult('b', 'Error writing file: failed to replace text'),
    ]).tripped,
  ).toBe(false)

  const decision = update(state, [toolUse('c', 'Edit')], [
    toolResult('c', 'Error writing file: failed to replace text'),
  ])

  if (!decision.tripped) {
    throw new Error('Expected repeated Edit failures to trip the guard')
  }
  expect(decision.message).toContain('`Edit` failed 3 times')
  expect(decision.message).toContain('`FileWriteError`')
})

test('multiple failures in the same batch each increment the counters', () => {
  const state = createToolFailureLoopGuardState()

  const decision = update(
    state,
    [
      toolUse('a', 'Edit'),
      toolUse('b', 'Edit'),
      toolUse('c', 'Edit'),
    ],
    [
      toolResult('a', 'Error writing file: failed to replace text'),
      toolResult('b', 'Error writing file: failed to replace text'),
      toolResult('c', 'Error writing file: failed to replace text'),
    ],
  )

  expect(decision.tripped).toBe(true)
})

test('different tools with different error categories do not trip early', () => {
  const state = createToolFailureLoopGuardState()

  update(state, [toolUse('a', 'Edit')], [
    toolResult('a', 'Error writing file: failed to replace text'),
  ])
  update(state, [toolUse('b', 'Read')], [
    toolResult('b', 'ENOENT: no such file or directory'),
  ])
  const decision = update(state, [toolUse('c', 'Bash')], [
    toolResult('c', 'No such tool available: Bash'),
  ])

  expect(decision.tripped).toBe(false)
})

test('a successful result from the same tool resets the counter', () => {
  const state = createToolFailureLoopGuardState()

  update(state, [toolUse('a', 'Edit')], [
    toolResult('a', 'Error writing file: failed to replace text'),
  ])
  update(state, [toolUse('b', 'Edit')], [
    toolResult('b', 'Error writing file: failed to replace text'),
  ])
  update(state, [toolUse('c', 'Edit')], [toolResult('c', 'ok', false)])
  const decision = update(state, [toolUse('d', 'Edit')], [
    toolResult('d', 'Error writing file: failed to replace text'),
  ])

  expect(decision.tripped).toBe(false)
})

test('a successful result from the same tool in the same batch resets the no-success streak', () => {
  const state = createToolFailureLoopGuardState()

  update(state, [toolUse('a', 'Edit')], [
    toolResult('a', 'Error writing file: failed to replace text'),
  ])
  update(
    state,
    [toolUse('b', 'Edit'), toolUse('c', 'Edit')],
    [
      toolResult('b', 'Error writing file: failed to replace text'),
      toolResult('c', 'ok', false),
    ],
  )
  const decision = update(state, [toolUse('d', 'Edit')], [
    toolResult('d', 'Error writing file: failed to replace text'),
  ])

  expect(decision.tripped).toBe(false)
})

test('user aborts, user rejections, and streaming fallback discards are ignored', () => {
  const state = createToolFailureLoopGuardState()

  const ignoredMessages = [
    'Interrupted by user',
    'Request interrupted by user',
    'User rejected tool use',
    "The user doesn't want to proceed with this tool use",
    "The user doesn't want to take this action right now",
    getMissingToolResultAbortMessage('interrupt'),
    getMissingToolResultAbortMessage('query-timeout'),
    getMissingToolResultAbortMessage('hard-max-query-timeout'),
    getMissingToolResultAbortMessage('background'),
    getMissingToolResultAbortMessage('side-task-cancelled'),
    getMissingToolResultAbortMessage('agent-summary-superseded'),
    getMissingToolResultAbortMessage('memory-extraction-superseded'),
    getMissingToolResultAbortMessage('parent-ended'),
    getMissingToolResultAbortMessage('unknown-abort'),
    'Streaming fallback - tool execution discarded',
    'Cancelled: parallel tool call abc was skipped',
  ]

  for (const [index, message] of ignoredMessages.entries()) {
    const id = `ignored-${index}`
    const decision = update(state, [toolUse(id, 'Edit')], [
      toolResult(id, message),
    ])
    expect(decision.tripped).toBe(false)
  }

  const decision = update(state, [toolUse('real', 'Edit')], [
    toolResult('real', 'Error writing file: failed to replace text'),
  ])
  expect(decision.tripped).toBe(false)
})

test('reason-aware synthetic aborts are ignored through wrappers and memory hints', () => {
  const state = createToolFailureLoopGuardState()

  const ignoredMessages = [
    `<tool_use_error>${getMissingToolResultAbortMessage('query-timeout')}</tool_use_error>`,
    `Error: ${getMissingToolResultAbortMessage('hard-max-query-timeout')}`,
    `[${getMissingToolResultAbortMessage('background')}]`,
    `${getMissingToolResultAbortMessage('unknown-abort')}\n\nNote: memory hint`,
  ]

  for (const [index, message] of ignoredMessages.entries()) {
    const id = `reason-aware-${index}`
    const decision = update(state, [toolUse(id, 'Bash')], [
      toolResult(id, message),
    ])
    expect(decision.tripped).toBe(false)
  }

  const decision = update(
    state,
    [toolUse('real', 'Bash')],
    [toolResult('real', 'Error: command exited 1')],
    2,
  )

  expect(decision.tripped).toBe(false)
})

test('expected side-task cancellation messages do not trip repeated failure guard', () => {
  const state = createToolFailureLoopGuardState()
  const message = getMissingToolResultAbortMessage(
    'memory-extraction-superseded',
  )

  update(state, [toolUse('a', 'Read')], [toolResult('a', message)], 2)
  const decision = update(
    state,
    [toolUse('b', 'Read')],
    [toolResult('b', message)],
    2,
  )

  expect(decision.tripped).toBe(false)
})

test('tool timeout messages still count as real tool failures', () => {
  const state = createToolFailureLoopGuardState()
  const timeoutMessage = getMissingToolResultAbortMessage('tool-timeout')

  update(state, [toolUse('a', 'Bash')], [toolResult('a', timeoutMessage)], 2)
  const decision = update(
    state,
    [toolUse('b', 'Bash')],
    [toolResult('b', timeoutMessage)],
    2,
  )

  expect(decision.tripped).toBe(true)
})

test('synthetic tool errors are recognized through wrappers', () => {
  const state = createToolFailureLoopGuardState()

  const ignoredMessages = [
    '[Request interrupted by user for tool use]',
    '<tool_use_error>Error: Streaming fallback - tool execution discarded</tool_use_error>',
    '<tool_use_error>Cancelled: parallel tool call Write errored</tool_use_error>',
  ]

  for (const [index, message] of ignoredMessages.entries()) {
    const id = `wrapped-${index}`
    const decision = update(state, [toolUse(id, 'Write')], [
      toolResult(id, message),
    ])
    expect(decision.tripped).toBe(false)
  }

  const decision = update(
    state,
    [toolUse('real', 'Write')],
    [toolResult('real', 'Error writing file: failed')],
    2,
  )

  expect(decision.tripped).toBe(false)
})

test('ignored synthetic errors do not reset an existing failure streak', () => {
  const state = createToolFailureLoopGuardState()

  update(state, [toolUse('a', 'Edit')], [
    toolResult('a', 'Error writing file: failed to replace text'),
  ])
  update(state, [toolUse('b', 'Edit')], [
    toolResult('b', 'Request interrupted by user'),
  ])
  const decision = update(
    state,
    [toolUse('c', 'Edit')],
    [toolResult('c', 'Error writing file: failed to replace text')],
    2,
  )

  expect(decision.tripped).toBe(true)
})

test('non-error tool results reset even when their content resembles an ignored synthetic message', () => {
  const state = createToolFailureLoopGuardState()

  update(state, [toolUse('a', 'Bash')], [
    toolResult('a', 'grep found an exact line: Interrupted by user'),
  ])
  update(state, [toolUse('b', 'Bash')], [
    toolResult('b', 'Interrupted by user', false),
  ])
  const decision = update(
    state,
    [toolUse('c', 'Bash')],
    [toolResult('c', 'grep found an exact line: Interrupted by user')],
    2,
  )

  expect(decision.tripped).toBe(false)
})

test('real tool errors that merely mention ignored phrases are still counted', () => {
  const state = createToolFailureLoopGuardState()

  update(state, [toolUse('a', 'Bash')], [
    toolResult(
      'a',
      'grep failed while matching literal text "Interrupted by user"',
    ),
  ])
  const decision = update(
    state,
    [toolUse('b', 'Bash')],
    [
      toolResult(
        'b',
        'grep failed while matching literal text "Interrupted by user"',
      ),
    ],
    2,
  )

  expect(decision.tripped).toBe(true)
})

test('agent step-limit text is ignored only with the structured message flag', () => {
  const spoofedState = createToolFailureLoopGuardState()

  update(spoofedState, [toolUse('a', 'Bash')], [
    toolResult('a', 'Agent step limit reached while parsing logs'),
  ])
  const spoofedDecision = update(
    spoofedState,
    [toolUse('b', 'Bash')],
    [toolResult('b', 'Agent step limit reached while parsing logs')],
    2,
  )

  expect(spoofedDecision.tripped).toBe(true)

  const syntheticState = createToolFailureLoopGuardState()
  update(syntheticState, [toolUse('c', 'Bash')], [
    toolResult('c', 'Agent step limit reached for subagent', true, true),
  ])
  const syntheticDecision = update(
    syntheticState,
    [toolUse('d', 'Bash')],
    [toolResult('d', 'Agent step limit reached for subagent', true, true)],
    2,
  )

  expect(syntheticDecision.tripped).toBe(false)
})

test('same failing file_path across repeated failures trips the guard', () => {
  const state = createToolFailureLoopGuardState()

  update(state, [toolUse('a', 'Write', { file_path: 'src//foo.ts/' })], [
    toolResult('a', 'Error writing file: EACCES'),
  ])
  update(state, [toolUse('b', 'Edit', { path: 'src/foo.ts' })], [
    toolResult('b', 'InputValidationError: old_string not found'),
  ])
  const decision = update(
    state,
    [toolUse('c', 'NotebookEdit', { notebook_path: 'src\\foo.ts' })],
    [toolResult('c', 'No such tool available: NotebookEdit')],
  )

  if (!decision.tripped) {
    throw new Error('Expected repeated path failures to trip the guard')
  }
  expect(decision.message).toContain('The path `src/foo.ts` failed 3 times.')
})

test('a successful mutating tool result resets a failing path counter', () => {
  const state = createToolFailureLoopGuardState()

  update(state, [toolUse('a', 'Write', { file_path: '/tmp/blocked.txt' })], [
    toolResult('a', 'Error writing file: EACCES'),
  ])
  update(state, [toolUse('b', 'Write', { file_path: '/tmp/blocked.txt' })], [
    toolResult('b', 'ok', false),
  ])
  const decision = update(
    state,
    [toolUse('c', 'Edit', { file_path: '/tmp/blocked.txt' })],
    [toolResult('c', 'Error writing file: EACCES')],
    2,
  )

  expect(decision.tripped).toBe(false)
})

test('successful reads do not reset repeated write failures for the same path', () => {
  const state = createToolFailureLoopGuardState()

  update(state, [toolUse('a', 'Edit', { file_path: 'E:\\project\\nui.lua' })], [
    toolResult('a', 'Error writing file: failed to replace text'),
  ])
  update(state, [toolUse('b', 'Read', { file_path: 'E:/project/nui.lua' })], [
    toolResult('b', 'file contents', false),
  ])
  update(state, [toolUse('c', 'Write', { file_path: 'E:/project/nui.lua' })], [
    toolResult('c', 'Invalid tool parameters: malformed fallback script'),
  ])
  update(state, [toolUse('d', 'Read', { file_path: 'E:/project/nui.lua' })], [
    toolResult('d', 'file contents', false),
  ])
  const decision = update(state, [
    toolUse('e', 'Edit', { file_path: 'E:/project/nui.lua' }),
  ], [
    toolResult('e', 'Error writing file: failed to replace text'),
  ])

  if (!decision.tripped) {
    throw new Error('Expected repeated path failures to survive Read successes')
  }
  expect(decision.message).toContain('The path `E:/project/nui.lua` failed 3 times.')
})

test('unrelated successes in the same batch do not hide repeated path failures', () => {
  const state = createToolFailureLoopGuardState()

  update(
    state,
    [
      toolUse('a', 'Edit', { file_path: 'src/a.ts' }),
      toolUse('read-a', 'Read', { file_path: 'src/other.ts' }),
    ],
    [
      toolResult('a', 'Error writing file: failed to replace text'),
      toolResult('read-a', 'file contents', false),
    ],
  )
  update(
    state,
    [
      toolUse('b', 'Write', { file_path: 'src/a.ts' }),
      toolUse('read-b', 'Read', { file_path: 'src/other.ts' }),
    ],
    [
      toolResult('b', 'Invalid tool parameters: malformed fallback script'),
      toolResult('read-b', 'file contents', false),
    ],
  )
  const decision = update(
    state,
    [
      toolUse('c', 'NotebookEdit', { notebook_path: 'src/a.ts' }),
      toolUse('read-c', 'Read', { file_path: 'src/other.ts' }),
    ],
    [
      toolResult('c', 'No such tool available: NotebookEdit'),
      toolResult('read-c', 'file contents', false),
    ],
  )

  if (!decision.tripped) {
    throw new Error('Expected repeated path failures to survive batch successes')
  }
  expect(decision.message).toContain('The path `src/a.ts` failed 3 times.')
})

test('unrelated successful tools do not reset repeated same-tool failure signatures', () => {
  const state = createToolFailureLoopGuardState()

  update(state, [toolUse('a', 'Edit')], [
    toolResult('a', 'Error writing file: failed to replace text'),
  ])
  update(state, [toolUse('b', 'Read')], [toolResult('b', 'ok', false)])
  update(state, [toolUse('c', 'Edit')], [
    toolResult('c', 'Error writing file: failed to replace text'),
  ])
  update(state, [toolUse('d', 'Bash')], [
    toolResult('d', 'Python 3.13.7', false),
  ])
  const decision = update(state, [toolUse('e', 'Edit')], [
    toolResult('e', 'Error writing file: failed to replace text'),
  ])

  if (!decision.tripped) {
    throw new Error('Expected unrelated successes not to reset Edit failures')
  }
  expect(decision.message).toContain('`Edit` failed 3 times')
  expect(decision.message).toContain('`FileWriteError`')
})

test('a successful result from the same tool resets persistent signatures', () => {
  const state = createToolFailureLoopGuardState()

  update(state, [toolUse('a', 'Edit')], [
    toolResult('a', 'Error writing file: failed to replace text'),
  ])
  update(state, [toolUse('b', 'Edit')], [toolResult('b', 'ok', false)])
  update(state, [toolUse('c', 'Edit')], [
    toolResult('c', 'Error writing file: failed to replace text'),
  ])
  const decision = update(state, [toolUse('d', 'Edit')], [
    toolResult('d', 'Error writing file: failed to replace text'),
  ])

  expect(decision.tripped).toBe(false)
})

test('repeated invalid fallback commands trip despite unrelated successful reads', () => {
  const state = createToolFailureLoopGuardState()

  update(state, [toolUse('a', 'Bash')], [
    toolResult('a', 'Invalid tool parameters: malformed Python heredoc'),
  ])
  update(state, [toolUse('b', 'Read')], [toolResult('b', 'file contents', false)])
  update(state, [toolUse('c', 'Bash')], [
    toolResult('c', 'Invalid tool parameters: malformed Python heredoc'),
  ])
  update(state, [toolUse('d', 'Read')], [toolResult('d', 'file contents', false)])
  const decision = update(state, [toolUse('e', 'Bash')], [
    toolResult('e', 'Invalid tool parameters: malformed Python heredoc'),
  ])

  if (!decision.tripped) {
    throw new Error('Expected repeated Bash validation failures to trip')
  }
  expect(decision.message).toContain('`Bash` failed 3 times')
  expect(decision.message).toContain('`InputValidationError`')
})

test('same error category across repeated no-success failures trips the guard', () => {
  const state = createToolFailureLoopGuardState()

  update(state, [toolUse('a', 'Edit')], [
    toolResult('a', '<tool_use_error>Error writing file: one</tool_use_error>'),
  ])
  update(state, [toolUse('b', 'Write')], [
    toolResult('b', 'Error writing file: two'),
  ])
  const decision = update(state, [toolUse('c', 'NotebookEdit')], [
    toolResult('c', 'Error writing file: three'),
  ])

  if (!decision.tripped) {
    throw new Error('Expected repeated category failures to trip the guard')
  }
  expect(decision.message).toContain('Tool calls failed 3 times')
  expect(decision.message).toContain('`FileWriteError`')
})

test('repeated invalid fallback tool calls trip as no-such-tool failures', () => {
  const state = createToolFailureLoopGuardState()

  update(state, [toolUse('a', 'ReadFile')], [
    toolResult('a', 'No such tool available: ReadFile'),
  ])
  const decision = update(
    state,
    [toolUse('b', 'ReadFile')],
    [toolResult('b', 'No such tool available: ReadFile')],
    2,
  )

  if (!decision.tripped) {
    throw new Error('Expected repeated invalid fallback tools to trip the guard')
  }
  expect(decision.message).toContain('`ReadFile` failed 2 times')
  expect(decision.message).toContain('`NoSuchTool`')
})

test('content arrays and multi-block user messages are inspected', () => {
  const state = createToolFailureLoopGuardState()

  const result = {
    type: 'user' as const,
    message: {
      content: [
        {
          type: 'text',
          text: 'regular user text should not matter',
        },
        {
          type: 'tool_result',
          tool_use_id: 'a',
          is_error: true,
          content: [{ type: 'text', text: 'Error writing file: one' }],
        },
      ],
    },
  }

  update(state, [toolUse('a', 'Write')], [result], 2)
  const decision = update(
    state,
    [toolUse('b', 'Edit')],
    [toolResult('b', 'Error writing file: two')],
    2,
  )

  expect(decision.tripped).toBe(true)
})

test('permission and not-found errors use specific categories before generic write errors', () => {
  const permissionState = createToolFailureLoopGuardState()

  update(
    permissionState,
    [toolUse('a', 'Write')],
    [toolResult('a', 'Error writing file: EACCES permission denied')],
    2,
  )
  const permissionDecision = update(
    permissionState,
    [toolUse('b', 'Write')],
    [toolResult('b', 'Error writing file: EPERM permission denied')],
    2,
  )

  if (!permissionDecision.tripped) {
    throw new Error('Expected repeated permission failures to trip the guard')
  }
  expect(permissionDecision.message).toContain('`PermissionError`')

  const notFoundState = createToolFailureLoopGuardState()

  update(
    notFoundState,
    [toolUse('c', 'Write')],
    [toolResult('c', 'Error writing file: ENOENT not found')],
    2,
  )
  const notFoundDecision = update(
    notFoundState,
    [toolUse('d', 'Write')],
    [toolResult('d', 'Error writing file: ENOENT not found')],
    2,
  )

  if (!notFoundDecision.tripped) {
    throw new Error('Expected repeated not-found failures to trip the guard')
  }
  expect(notFoundDecision.message).toContain('`NotFound`')
})

test('threshold override can be passed directly', () => {
  const state = createToolFailureLoopGuardState()

  update(
    state,
    [toolUse('a', 'Edit')],
    [toolResult('a', 'InputValidationError: missing path')],
    2,
  )
  const decision = update(
    state,
    [toolUse('b', 'Edit')],
    [toolResult('b', 'Invalid tool parameters: missing path')],
    2,
  )

  if (!decision.tripped) {
    throw new Error('Expected threshold override to trip the guard')
  }
  expect(getToolFailureLoopThreshold('0')).toBe(0)
  expect(getToolFailureLoopThreshold('bad')).toBe(3)
})

test('environment threshold parsing trims valid integers and rejects invalid values', () => {
  expect(getToolFailureLoopThreshold(' 2 ')).toBe(2)
  expect(getToolFailureLoopThreshold('')).toBe(3)
  expect(getToolFailureLoopThreshold('-1')).toBe(3)
  expect(getToolFailureLoopThreshold('1.5')).toBe(3)
})

test('zero threshold disables counting and invalid explicit thresholds fall back to default', () => {
  const disabledState = createToolFailureLoopGuardState()

  for (const id of ['a', 'b', 'c']) {
    const decision = update(
      disabledState,
      [toolUse(id, 'Edit')],
      [toolResult(id, 'Error writing file: failed to replace text')],
      0,
    )
    expect(decision.tripped).toBe(false)
  }

  const fallbackState = createToolFailureLoopGuardState()

  update(
    fallbackState,
    [toolUse('d', 'Edit')],
    [toolResult('d', 'Error writing file: failed to replace text')],
    -1,
  )
  update(
    fallbackState,
    [toolUse('e', 'Edit')],
    [toolResult('e', 'Error writing file: failed to replace text')],
    -1,
  )
  const decision = update(
    fallbackState,
    [toolUse('f', 'Edit')],
    [toolResult('f', 'Error writing file: failed to replace text')],
    -1,
  )

  expect(decision.tripped).toBe(true)
})

test('unsafe threshold values fall back to the default', () => {
  const state = createToolFailureLoopGuardState()

  update(
    state,
    [toolUse('a', 'Edit')],
    [toolResult('a', 'Error writing file: failed to replace text')],
    Number.MAX_SAFE_INTEGER + 1,
  )
  update(
    state,
    [toolUse('b', 'Edit')],
    [toolResult('b', 'Error writing file: failed to replace text')],
    Number.MAX_SAFE_INTEGER + 1,
  )
  const decision = update(
    state,
    [toolUse('c', 'Edit')],
    [toolResult('c', 'Error writing file: failed to replace text')],
    Number.MAX_SAFE_INTEGER + 1,
  )

  expect(decision.tripped).toBe(true)
  expect(getToolFailureLoopThreshold(String(Number.MAX_SAFE_INTEGER + 1))).toBe(
    3,
  )
})

test('query loop checks the guard before optional follow-up work', async () => {
  const source = await Bun.file(querySourceFile).text()
  const guardIndex = source.indexOf(
    'const toolFailureLoopDecision = updateToolFailureLoopGuard',
  )
  const summaryIndex = source.indexOf('let nextPendingToolUseSummary')
  const attachmentsIndex = source.indexOf(
    "logEvent('tengu_query_before_attachments'",
  )

  expect(guardIndex).toBeGreaterThan(-1)
  expect(summaryIndex).toBeGreaterThan(-1)
  expect(attachmentsIndex).toBeGreaterThan(-1)
  expect(guardIndex).toBeLessThan(summaryIndex)
  expect(guardIndex).toBeLessThan(attachmentsIndex)
})

test('query loop emits a path-safe diagnostic when the guard trips', async () => {
  const source = await Bun.file(querySourceFile).text()
  const tripIndex = source.indexOf('Tool failure loop guard tripped:')

  expect(tripIndex).toBeGreaterThan(-1)
  expect(source).not.toContain('path: toolFailureLoopDecision.path')
  expect(source).not.toContain('tool=${toolFailureLoopDecision.toolName')
  expect(source).not.toContain(
    'category=${toolFailureLoopDecision.errorCategory',
  )
  expect(source).not.toContain('${toolFailureLoopDecision.path}')
})
