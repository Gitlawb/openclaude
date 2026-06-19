import { describe, expect, it } from 'bun:test'
import {
  buildBackgroundSessionLaunch,
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

  it('preserves space-separated resume and PR option values', () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440000'
    const resumeParsed = parseBackgroundInvocation([
      '--bg',
      '--resume',
      sessionId,
    ])
    const fromPrParsed = parseBackgroundInvocation([
      '--bg',
      '--from-pr',
      '1642',
    ])
    const shortResumeParsed = parseBackgroundInvocation([
      '--bg',
      '-r',
      sessionId,
    ])
    const inlineResumeParsed = parseBackgroundInvocation([
      '--bg',
      '--resume=auth',
    ])

    expect(resumeParsed.prompt).toBeUndefined()
    expect(resumeParsed.childArgs).toEqual([
      '--resume',
      sessionId,
      '--print',
    ])
    expect(fromPrParsed.prompt).toBeUndefined()
    expect(fromPrParsed.childArgs).toEqual([
      '--from-pr',
      '1642',
      '--print',
    ])
    expect(shortResumeParsed.prompt).toBeUndefined()
    expect(shortResumeParsed.childArgs).toEqual(['-r', sessionId, '--print'])
    expect(inlineResumeParsed.prompt).toBeUndefined()
    expect(inlineResumeParsed.childArgs).toEqual(['--resume=auth', '--print'])
  })

  it('finds the prompt after a space-separated resume option value', () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440000'
    const parsed = parseBackgroundInvocation([
      '--bg',
      '--resume',
      sessionId,
      'continue the fix',
    ])

    expect(parsed.prompt).toBe('continue the fix')
    expect(parsed.childArgs).toEqual([
      '--resume',
      sessionId,
      '--print',
      'continue the fix',
    ])
  })

  it('does not inject a generated session id when resuming without forking', async () => {
    const resumeSessionId = '550e8400-e29b-41d4-a716-446655440000'
    const generatedSessionId = '00000000-0000-4000-8000-000000000001'

    const launch = await buildBackgroundSessionLaunch(
      ['--resume', resumeSessionId, '--print'],
      generatedSessionId,
    )

    expect(launch.sessionId).toBe(resumeSessionId)
    expect(launch.childArgs).toEqual(['--resume', resumeSessionId, '--print'])
  })

  it('preserves an explicit session id without injecting a generated one', async () => {
    const explicitSessionId = '550e8400-e29b-41d4-a716-446655440000'
    const generatedSessionId = '00000000-0000-4000-8000-000000000001'

    const launch = await buildBackgroundSessionLaunch(
      ['--session-id', explicitSessionId, '--print', 'fix failing tests'],
      generatedSessionId,
    )

    expect(launch.sessionId).toBe(explicitSessionId)
    expect(launch.childArgs).toEqual([
      '--session-id',
      explicitSessionId,
      '--print',
      'fix failing tests',
    ])
  })

  it('uses a generated session id for forked background resumes', async () => {
    const resumeSessionId = '550e8400-e29b-41d4-a716-446655440000'
    const generatedSessionId = '00000000-0000-4000-8000-000000000001'

    const launch = await buildBackgroundSessionLaunch(
      ['--resume', resumeSessionId, '--fork-session', '--print'],
      generatedSessionId,
    )

    expect(launch.sessionId).toBe(generatedSessionId)
    expect(launch.childArgs).toEqual([
      '--resume',
      resumeSessionId,
      '--fork-session',
      '--print',
      '--session-id',
      generatedSessionId,
    ])
  })

  it('registers non-forked PR resumes under the selected transcript id', async () => {
    const generatedSessionId = '00000000-0000-4000-8000-000000000001'
    const prSessionId = '550e8400-e29b-41d4-a716-446655440000'
    const seenSelectors: unknown[] = []

    const launch = await buildBackgroundSessionLaunch(
      ['--from-pr', '1642', '--print'],
      generatedSessionId,
      {
        resolvePrResumeSessionId: async selector => {
          seenSelectors.push(selector)
          return prSessionId
        },
      },
    )

    expect(seenSelectors).toEqual(['1642'])
    expect(launch.sessionId).toBe(prSessionId)
    expect(launch.childArgs).toEqual(['--from-pr', '1642', '--print'])
  })

  it('fails when a non-forked PR resume selector cannot be resolved', async () => {
    await expect(
      buildBackgroundSessionLaunch(
        ['--from-pr', '1642', '--print'],
        '00000000-0000-4000-8000-000000000001',
        {
          resolvePrResumeSessionId: async () => null,
        },
      ),
    ).rejects.toThrow('No conversation found linked to PR selector: 1642')
  })

  it('inserts generated flags before -- so dash-prefixed prompts stay positional', () => {
    const parsed = parseBackgroundInvocation(['--bg', '--', '--fix-tests'])

    expect(parsed.prompt).toBe('--fix-tests')
    expect(parsed.childArgs).toEqual(['--print', '--', '--fix-tests'])
  })

  it('injects print mode when the prompt after -- looks like a print flag', () => {
    const longFlagParsed = parseBackgroundInvocation(['--bg', '--', '--print'])
    const shortFlagParsed = parseBackgroundInvocation(['--bg', '--', '-p'])

    expect(longFlagParsed.prompt).toBe('--print')
    expect(longFlagParsed.childArgs).toEqual(['--print', '--', '--print'])
    expect(shortFlagParsed.prompt).toBe('-p')
    expect(shortFlagParsed.childArgs).toEqual(['--print', '--', '-p'])
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
