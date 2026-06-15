import { describe, expect, it } from 'bun:test'
import {
  buildBackgroundChildProcessConfig,
  terminateBackgroundProcessTree,
  parseBackgroundInvocation,
  parseLogsInvocation,
} from './bg.js'

describe('background session CLI parsing', () => {
  it('builds a print-mode child command and preserves provider/model flags', () => {
    const parsed = parseBackgroundInvocation([
      '--provider',
      'openai',
      '--model',
      'gpt-5',
      '--bg',
      '--name',
      'auth-refactor',
      'refactor auth middleware',
    ])

    expect(parsed.name).toBe('auth-refactor')
    expect(parsed.prompt).toBe('refactor auth middleware')
    expect(parsed.childArgs).toEqual([
      '--provider',
      'openai',
      '--model',
      'gpt-5',
      '--name',
      'auth-refactor',
      '--print',
      'refactor auth middleware',
    ])
  })

  it('does not duplicate --print when the user already passed it', () => {
    const parsed = parseBackgroundInvocation([
      '--background',
      '--print',
      '--max-turns',
      '2',
      'fix failing tests',
    ])

    expect(parsed.childArgs).toEqual([
      '--print',
      '--max-turns',
      '2',
      'fix failing tests',
    ])
  })

  it('preserves the prompt when --debug has no inline filter', () => {
    const parsed = parseBackgroundInvocation([
      '--bg',
      '--debug',
      'fix failing tests',
    ])

    expect(parsed.prompt).toBe('fix failing tests')
    expect(parsed.childArgs).toEqual(['--debug', '--print', 'fix failing tests'])
  })

  it('preserves inline --debug filters while finding the prompt', () => {
    const parsed = parseBackgroundInvocation([
      '--bg',
      '--debug=api,hooks',
      'fix failing tests',
    ])

    expect(parsed.prompt).toBe('fix failing tests')
    expect(parsed.childArgs).toEqual([
      '--debug=api,hooks',
      '--print',
      'fix failing tests',
    ])
  })

  it('inserts generated flags before -- so dash-prefixed prompts stay positional', () => {
    const parsed = parseBackgroundInvocation(['--bg', '--', '--fix-tests'])

    expect(parsed.prompt).toBe('--fix-tests')
    expect(parsed.childArgs).toEqual(['--print', '--', '--fix-tests'])
  })

  it('does not strip --bg when it appears after -- as the prompt', () => {
    const parsed = parseBackgroundInvocation(['--bg', '--', '--bg'])

    expect(parsed.prompt).toBe('--bg')
    expect(parsed.childArgs).toEqual(['--print', '--', '--bg'])
  })

  it('parses log follow mode', () => {
    expect(parseLogsInvocation(['auth-refactor', '-f'])).toEqual({
      target: 'auth-refactor',
      follow: true,
      stream: 'stdout',
    })
    expect(parseLogsInvocation(['auth-refactor', '--stderr'])).toEqual({
      target: 'auth-refactor',
      follow: false,
      stream: 'stderr',
    })
  })

  it('preserves Node exec flags and lets the launcher manage heap relaunch state', () => {
    const config = buildBackgroundChildProcessConfig({
      execPath: '/usr/bin/node',
      execArgv: ['--max-old-space-size=8192', '--expose-gc'],
      entrypoint: '/repo/bin/openclaude',
      childArgs: ['--print', 'fix failing tests'],
      processEnv: {
        OPENCLAUDE_HEAP_RELAUNCHED: '1',
        OPENCLAUDE_NODE_MAX_OLD_SPACE_SIZE_MB: '8192',
      },
      sessionName: 'tests',
      stdoutLogPath: '/tmp/bg.out.log',
    })

    expect(config.command).toBe('/usr/bin/node')
    expect(config.args).toEqual([
      '--max-old-space-size=8192',
      '--expose-gc',
      '/repo/bin/openclaude',
      '--print',
      'fix failing tests',
    ])
    expect(config.env.OPENCLAUDE_HEAP_RELAUNCHED).toBeUndefined()
    expect(config.env.OPENCLAUDE_NODE_MAX_OLD_SPACE_SIZE_MB).toBe('8192')
    expect(config.env.CLAUDE_CODE_SESSION_KIND).toBe('bg')
    expect(config.env.CLAUDE_CODE_SESSION_LOG).toBe('/tmp/bg.out.log')
    expect(config.env.CLAUDE_CODE_SESSION_NAME).toBe('tests')
  })

  it('escalates process-tree termination and waits for exit before returning', async () => {
    const signals: Array<string | number | undefined> = []
    let aliveChecks = 0

    await terminateBackgroundProcessTree(123, {
      isProcessAlive: () => {
        aliveChecks++
        return aliveChecks < 4
      },
      killTree: async (_pid, signal) => {
        signals.push(signal)
      },
      sleep: async () => {},
      termGraceMs: 1,
      killGraceMs: 1,
      pollIntervalMs: 1,
    })

    expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
  })
})
