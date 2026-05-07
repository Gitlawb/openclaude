import { afterEach, describe, expect, test } from 'bun:test'
import { resolveUpdateCommand } from './index.js'

describe('resolveUpdateCommand', () => {
  const originalArgv = process.argv

  afterEach(() => {
    process.argv = originalArgv
  })

  test('passes the CLI script before update when running through node or bun', () => {
    process.argv = ['/usr/local/bin/node', '/opt/openclaude/dist/cli.mjs']

    expect(resolveUpdateCommand()).toEqual({
      command: process.execPath,
      args: ['/opt/openclaude/dist/cli.mjs', 'update'],
    })
  })

  test('uses the current executable directly when no script path exists', () => {
    process.argv = ['/usr/local/bin/openclaude']

    expect(resolveUpdateCommand()).toEqual({
      command: process.execPath,
      args: ['update'],
    })
  })
})
