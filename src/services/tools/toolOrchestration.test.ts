import { expect, test } from 'bun:test'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { BashTool } from '../../tools/BashTool/BashTool.js'
import { _test } from './toolOrchestration.js'

function bashToolUse(id: string, command: string): ToolUseBlock {
  return {
    type: 'tool_use',
    id,
    name: 'Bash',
    input: { command },
  } as ToolUseBlock
}

test('Bash commands with shell parser limitations are serialized', () => {
  const batches = _test.partitionToolCalls(
    [
      bashToolUse('read-1', 'pwd'),
      bashToolUse('unparseable-1', 'echo ${value + 1}'),
      bashToolUse('read-2', 'pwd'),
    ],
    {
      options: {
        tools: [BashTool],
      },
    },
  )

  expect(batches).toEqual([
    {
      isConcurrencySafe: true,
      blocks: [expect.objectContaining({ id: 'read-1' })],
    },
    {
      isConcurrencySafe: false,
      blocks: [expect.objectContaining({ id: 'unparseable-1' })],
    },
    {
      isConcurrencySafe: true,
      blocks: [expect.objectContaining({ id: 'read-2' })],
    },
  ])
})
