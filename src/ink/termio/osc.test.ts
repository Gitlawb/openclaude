import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { join } from 'node:path'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'

const originalEnv = { ...process.env }
const originalPlatform = process.platform
const mockedClipboardPath = join(process.cwd(), 'openclaude-clipboard.txt')

const generateTempFilePathMock = mock(
  (
    _prefix?: string,
    _extension?: string,
    _options?: { contentHash?: string },
  ) => mockedClipboardPath,
)

// Mirrors the execFileNoThrow/execFileNoThrowWithCwd signature so that
// recorded calls keep usable tuple types ([file, args, options]).
const execFileNoThrowMock = mock(
  async (
    _file: string,
    _args: string[],
    _options?: Record<string, unknown>,
  ) => ({ code: 0, stdout: '', stderr: '' }),
)

type ExecFileNoThrowModule = typeof import('../../utils/execFileNoThrow.js')
type TempfileModule = typeof import('../../utils/tempfile.js')

type RealOscModules = {
  execFileNoThrow: ExecFileNoThrowModule
  tempfile: TempfileModule
}

let realOscModules: RealOscModules | undefined

// Bun's mock.module is process-global and cannot be reliably reverted (neither
// mock.restore() nor a re-register under a different specifier form displaces
// it). So instead of trying to undo these mocks, gate them: when this suite is
// not actively running, every mocked export delegates to the real module, so a
// later suite that imports execFileNoThrow.js / tempfile.js (e.g. via worktree)
// transparently gets the genuine implementation instead of our stubs.
let oscMocksActive = false

async function importRealOscModules(): Promise<RealOscModules> {
  if (realOscModules) return realOscModules

  const cacheKey = `${Date.now()}-${Math.random()}`
  realOscModules = {
    execFileNoThrow: (await import(
      `../../utils/execFileNoThrow.ts?osc-real-${cacheKey}`
    )) as ExecFileNoThrowModule,
    tempfile: (await import(
      `../../utils/tempfile.ts?osc-real-${cacheKey}`
    )) as TempfileModule,
  }
  return realOscModules
}

// Spread the real surfaces so these mocks keep the full module surface, and
// gate every overridden export on `oscMocksActive` so they pass through to the
// real implementation whenever this suite is not the one running.
function installOscMocks(real: RealOscModules): void {
  mock.module('../../utils/execFileNoThrow.js', () => ({
    ...real.execFileNoThrow,
    execFileNoThrow: (...args: Parameters<typeof real.execFileNoThrow.execFileNoThrow>) =>
      oscMocksActive
        ? execFileNoThrowMock(...args)
        : real.execFileNoThrow.execFileNoThrow(...args),
    execFileNoThrowWithCwd: (
      ...args: Parameters<typeof real.execFileNoThrow.execFileNoThrowWithCwd>
    ) =>
      oscMocksActive
        ? execFileNoThrowMock(...args)
        : real.execFileNoThrow.execFileNoThrowWithCwd(...args),
  }))

  mock.module('../../utils/tempfile.js', () => ({
    ...real.tempfile,
    generateTempFilePath: (
      ...args: Parameters<typeof real.tempfile.generateTempFilePath>
    ) =>
      oscMocksActive
        ? generateTempFilePathMock(...args)
        : real.tempfile.generateTempFilePath(...args),
  }))
}

async function importFreshOscModule() {
  return import(`./osc.ts?ts=${Date.now()}-${Math.random()}`)
}

async function flushClipboardCopy(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

async function waitForExecCall(
  command: string,
  attempts = 20,
): Promise<(typeof execFileNoThrowMock.mock.calls)[number] | undefined> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const call = execFileNoThrowMock.mock.calls.find(([cmd]) => cmd === command)
    if (call) {
      return call
    }
    await flushClipboardCopy()
  }

  return undefined
}

describe('Windows clipboard fallback', () => {
  beforeEach(async () => {
    await acquireSharedMutationLock('ink/termio/osc.test.ts')
    installOscMocks(await importRealOscModules())
    oscMocksActive = true
    execFileNoThrowMock.mockClear()
    generateTempFilePathMock.mockClear()
    process.env = { ...originalEnv }
    delete process.env['SSH_CONNECTION']
    delete process.env['TMUX']
    Object.defineProperty(process, 'platform', { value: 'win32' })
  })

  afterEach(() => {
    try {
      mock.restore()
      oscMocksActive = false
      process.env = { ...originalEnv }
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    } finally {
      releaseSharedMutationLock()
    }
  })

  test('uses PowerShell instead of clip.exe for local Windows copy', async () => {
    const { setClipboard } = await importFreshOscModule()

    await setClipboard('Привет мир')
    const windowsCall = await waitForExecCall('powershell')

    expect(execFileNoThrowMock.mock.calls.some(([cmd]) => cmd === 'clip')).toBe(
      false,
    )
    expect(windowsCall).toBeDefined()
  })

  test('passes Windows clipboard text through a UTF-8 temp file instead of stdin', async () => {
    const { setClipboard } = await importFreshOscModule()

    await setClipboard('Привет мир')
    await flushClipboardCopy()

    const windowsCall = await waitForExecCall('powershell')

    expect(windowsCall?.[2]).toMatchObject({
      stdin: 'ignore',
    })
    expect(windowsCall?.[2]).not.toMatchObject({ input: 'Привет мир' })
    expect(windowsCall?.[2]).not.toMatchObject({
      env: expect.objectContaining({
        OPENCLAUDE_CLIPBOARD_TEXT_B64: expect.any(String),
      }),
    })
    expect(windowsCall?.[1]).toContain(
      `$text = [System.IO.File]::ReadAllText('${mockedClipboardPath.replace(/'/g, "''")}', [System.Text.Encoding]::UTF8); Set-Clipboard -Value $text`,
    )
  })
})

describe('clipboard path behavior remains stable', () => {
  beforeEach(async () => {
    await acquireSharedMutationLock('ink/termio/osc.test.ts')
    installOscMocks(await importRealOscModules())
    oscMocksActive = true
    execFileNoThrowMock.mockClear()
    process.env = { ...originalEnv }
    delete process.env['SSH_CONNECTION']
    delete process.env['TMUX']
  })

  afterEach(() => {
    try {
      mock.restore()
      oscMocksActive = false
      process.env = { ...originalEnv }
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    } finally {
      releaseSharedMutationLock()
    }
  })

  test('getClipboardPath stays native on local macOS', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    const { getClipboardPath } = await importFreshOscModule()

    expect(getClipboardPath()).toBe('native')
  })

  test('getClipboardPath stays tmux-buffer when TMUX is set', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    process.env['TMUX'] = '/tmp/tmux-1000/default,123,0'
    const { getClipboardPath } = await importFreshOscModule()

    expect(getClipboardPath()).toBe('tmux-buffer')
  })

  test('Windows clipboard fallback is skipped over SSH', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    process.env['SSH_CONNECTION'] = '1 2 3 4'
    const { setClipboard } = await importFreshOscModule()

    await setClipboard('Привет мир')

    expect(execFileNoThrowMock.mock.calls.some(([cmd]) => cmd === 'powershell')).toBe(
      false,
    )
  })

  test('local macOS clipboard fallback still uses pbcopy', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    const { setClipboard } = await importFreshOscModule()

    await setClipboard('hello')

    expect(execFileNoThrowMock.mock.calls.some(([cmd]) => cmd === 'pbcopy')).toBe(
      true,
    )
  })
})
