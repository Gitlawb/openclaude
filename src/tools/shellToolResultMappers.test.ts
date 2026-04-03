import { expect, test } from 'bun:test'
import { BashTool } from './BashTool/BashTool.js'
import { PowerShellTool } from './PowerShellTool/PowerShellTool.js'

test('BashTool result mapper tolerates null stderr', () => {
  const result = BashTool.mapToolResultToToolResultBlockParam(
    {
      stdout: 'ok',
      stderr: null as unknown as string,
      interrupted: false,
    },
    'tool-1',
  )

  expect(result).toMatchObject({
    type: 'tool_result',
    tool_use_id: 'tool-1',
    content: 'ok',
  })
})

test('BashTool result mapper tolerates null stdout', () => {
  const result = BashTool.mapToolResultToToolResultBlockParam(
    {
      stdout: null as unknown as string,
      stderr: 'problem',
      interrupted: false,
    },
    'tool-2',
  )

  expect(result).toMatchObject({
    type: 'tool_result',
    tool_use_id: 'tool-2',
    content: 'problem',
  })
})

test('PowerShellTool result mapper tolerates null stderr', () => {
  const result = PowerShellTool.mapToolResultToToolResultBlockParam(
    {
      stdout: 'ok',
      stderr: null as unknown as string,
      interrupted: false,
    },
    'tool-3',
  )

  expect(result).toMatchObject({
    type: 'tool_result',
    tool_use_id: 'tool-3',
    content: 'ok',
  })
})

test('PowerShellTool result mapper tolerates null stdout', () => {
  const result = PowerShellTool.mapToolResultToToolResultBlockParam(
    {
      stdout: null as unknown as string,
      stderr: 'problem',
      interrupted: false,
    },
    'tool-4',
  )

  expect(result).toMatchObject({
    type: 'tool_result',
    tool_use_id: 'tool-4',
    content: 'problem',
  })
})
