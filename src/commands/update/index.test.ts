import { afterEach, describe, expect, test } from 'bun:test'
import { getSourceBuildUpdateMessage } from '../../cli/updateMessage.js'
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

describe('/update source build warning', () => {
  test('uses the npm package install warning instead of spawning a nested REPL', () => {
    expect(getSourceBuildUpdateMessage()).toContain(
      'Auto-update is only available for OpenClaude npm package installs.',
    )
    expect(getSourceBuildUpdateMessage()).toContain(
      'git pull && bun install && bun run build',
    )
  })
})
