import { EventEmitter } from 'node:events'
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import {
  buildBackgroundSessionLaunch,
  buildBackgroundChildProcessConfig,
  followLogFile,
  printExistingLog,
  terminateBackgroundProcessTree,
  LOG_STREAM_CHUNK_SIZE,
  parseBackgroundInvocation,
  parseLogsInvocation,
} from './bg.js'

class TestOutput extends EventEmitter {
  chunks: Buffer[] = []
  destroyed = false
  writableDestroyed = false
  writeResults: boolean[] = []
  writeError: unknown

  write(chunk: Uint8Array): boolean {
    if (this.writeError) throw this.writeError
    if (this.destroyed || this.writableDestroyed) {
      throw Object.assign(new Error('stdout closed'), { code: 'EPIPE' })
    }
    this.chunks.push(Buffer.from(chunk))
    return this.writeResults.shift() ?? true
  }

  bytes(): Buffer {
    return Buffer.concat(this.chunks)
  }
}

function createManualScheduler() {
  let intervalCallback: (() => void) | undefined
  let cleared = false

  return {
    setInterval(callback: () => void): ReturnType<typeof setInterval> {
      intervalCallback = callback
      return 1 as unknown as ReturnType<typeof setInterval>
    },
    clearInterval(): void {
      cleared = true
    },
    tick(): void {
      intervalCallback?.()
    },
    get cleared(): boolean {
      return cleared
    },
  }
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (condition()) return
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  throw new Error('condition was not met')
}

async function withTempFile<T>(
  name: string,
  run: (path: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'openclaude-bg-test-'))
  try {
    return await run(join(dir, name))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

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

  it('preserves provider env-file values before the prompt', () => {
    const parsed = parseBackgroundInvocation([
      '--bg',
      '--provider-env-file',
      '.env',
      'fix failing tests',
    ])

    expect(parsed.prompt).toBe('fix failing tests')
    expect(parsed.childArgs).toEqual([
      '--provider-env-file',
      '.env',
      '--print',
      'fix failing tests',
    ])
  })

  it('preserves provider env-file values after the prompt', () => {
    const parsed = parseBackgroundInvocation([
      '--bg',
      'fix failing tests',
      '--provider-env-file',
      '.env',
    ])

    expect(parsed.prompt).toBe('fix failing tests')
    expect(parsed.childArgs).toEqual([
      '--print',
      'fix failing tests',
      '--provider-env-file',
      '.env',
    ])
  })

  it('preserves repeated provider env-file values while finding the prompt', () => {
    const parsed = parseBackgroundInvocation([
      '--bg',
      '--provider-env-file',
      '.env.local',
      'fix failing tests',
      '--provider-env-file',
      '.env.ci',
    ])

    expect(parsed.prompt).toBe('fix failing tests')
    expect(parsed.childArgs).toEqual([
      '--provider-env-file',
      '.env.local',
      '--print',
      'fix failing tests',
      '--provider-env-file',
      '.env.ci',
    ])
  })

  it('preserves inline provider env-file values', () => {
    const parsed = parseBackgroundInvocation([
      '--bg',
      'fix failing tests',
      '--provider-env-file=.env',
    ])

    expect(parsed.prompt).toBe('fix failing tests')
    expect(parsed.childArgs).toEqual([
      '--print',
      'fix failing tests',
      '--provider-env-file=.env',
    ])
  })

  it('preserves provider env-file paths containing spaces', () => {
    const parsed = parseBackgroundInvocation([
      '--bg',
      'fix failing tests',
      '--provider-env-file',
      'config files/provider.env',
    ])

    expect(parsed.prompt).toBe('fix failing tests')
    expect(parsed.childArgs).toEqual([
      '--print',
      'fix failing tests',
      '--provider-env-file',
      'config files/provider.env',
    ])
  })

  it('keeps provider env-file-looking prompts after -- positional', () => {
    const parsed = parseBackgroundInvocation([
      '--bg',
      '--',
      '--provider-env-file=.env',
    ])

    expect(parsed.prompt).toBe('--provider-env-file=.env')
    expect(parsed.childArgs).toEqual([
      '--print',
      '--',
      '--provider-env-file=.env',
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
    expect(parseLogsInvocation(['auth-refactor', '--stdout', '-f'])).toEqual({
      target: 'auth-refactor',
      follow: true,
      stream: 'stdout',
    })
    expect(parseLogsInvocation(['auth-refactor', '-f', '--stderr'])).toEqual({
      target: 'auth-refactor',
      follow: true,
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

describe('background session log streaming', () => {
  it('emits a multi-megabyte existing log exactly with bounded allocations', async () => {
    await withTempFile('stdout.log', async path => {
      const chunkSize = LOG_STREAM_CHUNK_SIZE
      const contents = Buffer.alloc(chunkSize * 32 + 123)
      for (let i = 0; i < contents.length; i++) contents[i] = i % 251
      await writeFile(path, contents)

      const allocations: number[] = []
      const output = new TestOutput()
      const offset = await printExistingLog(path, {
        output,
        chunkSize,
        createBuffer: size => {
          allocations.push(size)
          return Buffer.alloc(size)
        },
      })

      expect(offset).toBe(contents.length)
      expect(output.bytes()).toEqual(contents)
      expect(Math.max(...allocations)).toBeLessThanOrEqual(chunkSize)
      expect(allocations.length).toBeGreaterThan(1)
    })
  })

  it('follow mode emits existing and appended content exactly once in order', async () => {
    await withTempFile('stdout.log', async path => {
      const output = new TestOutput()
      await writeFile(path, Buffer.from('existing-'))

      const offset = await printExistingLog(path, { output, chunkSize: 4 })
      const scheduler = createManualScheduler()
      const abort = new AbortController()
      const following = followLogFile(path, offset, {
        output,
        chunkSize: 4,
        signal: abort.signal,
        setInterval: scheduler.setInterval,
        clearInterval: scheduler.clearInterval,
      })

      await writeFile(path, Buffer.from('existing-appended'))
      scheduler.tick()
      await waitFor(() => output.bytes().toString() === 'existing-appended')
      abort.abort()
      await following

      expect(output.bytes().toString()).toBe('existing-appended')
    })
  })

  it('splits a large appended range into bounded chunks', async () => {
    await withTempFile('stdout.log', async path => {
      const chunkSize = 16
      await writeFile(path, Buffer.from('seed'))
      const appended = Buffer.alloc(chunkSize * 2 + 5, 7)
      await writeFile(path, Buffer.concat([Buffer.from('seed'), appended]))

      const output = new TestOutput()
      const scheduler = createManualScheduler()
      const abort = new AbortController()
      const following = followLogFile(path, 4, {
        output,
        chunkSize,
        signal: abort.signal,
        setInterval: scheduler.setInterval,
        clearInterval: scheduler.clearInterval,
      })

      scheduler.tick()
      await waitFor(() => output.bytes().length === appended.length)
      abort.abort()
      await following

      expect(output.bytes()).toEqual(appended)
      expect(output.chunks.map(chunk => chunk.length)).toEqual([16, 16, 5])
    })
  })

  it('waits for drain before reading or writing more when stdout applies backpressure', async () => {
    await withTempFile('stdout.log', async path => {
      await writeFile(path, Buffer.from('abcdef'))
      const output = new TestOutput()
      output.writeResults.push(false)

      let settled = false
      const printing = printExistingLog(path, { output, chunkSize: 3 }).then(
        offset => {
          settled = true
          return offset
        },
      )

      await waitFor(() => output.chunks.length === 1)
      expect(output.bytes().toString()).toBe('abc')
      expect(settled).toBe(false)

      output.emit('drain')
      await expect(printing).resolves.toBe(6)
      expect(output.bytes().toString()).toBe('abcdef')
      expect(output.chunks.map(chunk => chunk.length)).toEqual([3, 3])
    })
  })

  it('resets the follow read position when the log is truncated', async () => {
    await withTempFile('stdout.log', async path => {
      await writeFile(path, Buffer.from('abcdef'))
      const output = new TestOutput()
      const scheduler = createManualScheduler()
      const abort = new AbortController()
      const following = followLogFile(path, 6, {
        output,
        chunkSize: 8,
        signal: abort.signal,
        setInterval: scheduler.setInterval,
        clearInterval: scheduler.clearInterval,
      })

      await writeFile(path, Buffer.from('xy'))
      scheduler.tick()
      await waitFor(() => output.bytes().toString() === 'xy')
      abort.abort()
      await following

      expect(output.bytes().toString()).toBe('xy')
    })
  })

  it('tolerates temporary file disappearance while following', async () => {
    await withTempFile('stdout.log', async path => {
      await writeFile(path, Buffer.from('seed'))
      const output = new TestOutput()
      const scheduler = createManualScheduler()
      const abort = new AbortController()
      const following = followLogFile(path, 4, {
        output,
        chunkSize: 8,
        signal: abort.signal,
        setInterval: scheduler.setInterval,
        clearInterval: scheduler.clearInterval,
      })

      await unlink(path)
      scheduler.tick()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(output.bytes().length).toBe(0)

      await writeFile(path, Buffer.from('new'))
      scheduler.tick()
      await waitFor(() => output.bytes().toString() === 'new')
      abort.abort()
      await following

      expect(output.bytes().toString()).toBe('new')
    })
  })

  it('prevents writes after signal cleanup during an in-flight poll', async () => {
    const output = new TestOutput()
    const scheduler = createManualScheduler()
    const abort = new AbortController()
    const readStarted = deferred()
    const releaseRead = deferred()
    let closed = false

    const handle = {
      stat: async () => ({ size: 4 }),
      read: async (buffer: Buffer) => {
        readStarted.resolve()
        await releaseRead.promise
        buffer.write('late')
        return { bytesRead: 4, buffer }
      },
      close: async () => {
        closed = true
      },
    }

    let resolved = false
    const following = followLogFile('/tmp/stdout.log', 0, {
      output,
      chunkSize: 4,
      signal: abort.signal,
      setInterval: scheduler.setInterval,
      clearInterval: scheduler.clearInterval,
      openFile: async () => handle,
    }).then(() => {
      resolved = true
    })

    scheduler.tick()
    await readStarted.promise
    abort.abort()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(resolved).toBe(false)
    releaseRead.resolve()
    await following
    scheduler.tick()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(scheduler.cleared).toBe(true)
    expect(closed).toBe(true)
    expect(output.bytes().length).toBe(0)
  })

  it('preserves streamed progress when a later close failure occurs', async () => {
    const output = new TestOutput()
    const scheduler = createManualScheduler()
    const abort = new AbortController()
    let openCount = 0

    const following = followLogFile('/tmp/stdout.log', 0, {
      output,
      chunkSize: 4,
      signal: abort.signal,
      setInterval: scheduler.setInterval,
      clearInterval: scheduler.clearInterval,
      openFile: async () => {
        openCount++
        return {
          stat: async () => ({ size: 4 }),
          read: async (buffer: Buffer) => {
            buffer.write('once')
            return { bytesRead: 4 }
          },
          close: async () => {
            if (openCount === 1) throw new Error('close failed')
          },
        }
      },
    })

    scheduler.tick()
    await waitFor(() => output.bytes().toString() === 'once')
    scheduler.tick()
    await waitFor(() => openCount === 2)
    await new Promise(resolve => setTimeout(resolve, 0))
    abort.abort()
    await following

    expect(output.bytes().toString()).toBe('once')
  })

  it('surfaces non-follow file read failures', async () => {
    let closed = false
    const readError = Object.assign(new Error('read failed'), {
      code: 'EIO',
    })

    await expect(
      printExistingLog('/tmp/stdout.log', {
        chunkSize: 4,
        openFile: async () => ({
          stat: async () => ({ size: 4 }),
          read: async () => {
            throw readError
          },
          close: async () => {
            closed = true
          },
        }),
      }),
    ).rejects.toThrow('read failed')
    expect(closed).toBe(true)
  })

  it('handles EPIPE and destroyed stdout without throwing', async () => {
    await withTempFile('stdout.log', async path => {
      await writeFile(path, Buffer.from('closed-pipe'))

      const epipeOutput = new TestOutput()
      epipeOutput.writeError = Object.assign(new Error('broken pipe'), {
        code: 'EPIPE',
      })
      await expect(
        printExistingLog(path, { output: epipeOutput, chunkSize: 4 }),
      ).resolves.toBe(0)

      const destroyedOutput = new TestOutput()
      destroyedOutput.destroyed = true
      await expect(
        printExistingLog(path, { output: destroyedOutput, chunkSize: 4 }),
      ).resolves.toBe(0)
      expect(destroyedOutput.bytes().length).toBe(0)
    })
  })
})
