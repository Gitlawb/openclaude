import { PassThrough } from 'node:stream'
import { stripVTControlCharacters as stripAnsi } from 'node:util'

import { beforeEach, expect, mock, test } from 'bun:test'
import React from 'react'

import { createRoot } from '../ink.js'
import { KeybindingProvider } from '../keybindings/KeybindingContext.js'
import type {
  KeybindingContextName,
  ParsedBinding,
  ParsedKeystroke,
} from '../keybindings/types.js'
import { Doctor } from './Doctor.js'
import { AppStateProvider } from '../state/AppState.js'
import type { NpmDistTags } from '../utils/autoUpdater.js'
import type { DiagnosticInfo } from '../utils/doctorDiagnostic.js'
import type { LockInfo } from '../utils/nativeInstaller/pidLock.js'

const SYNC_START = '\x1B[?2026h'
const SYNC_END = '\x1B[?2026l'

const getDoctorDiagnostic = mock(async (): Promise<DiagnosticInfo> =>
  makeDiagnostic(),
)
const getNpmDistTags = mock(async (): Promise<NpmDistTags> => ({
  latest: '9.9.9',
  stable: '8.8.8',
}))
const getGcsDistTags = mock(async (): Promise<NpmDistTags> => ({
  latest: '7.7.7',
  stable: '6.6.6',
}))
const isPidBasedLockingEnabled = mock(() => false)
const cleanupStaleLocks = mock((_locksDir: string): number => 0)
const getAllLockInfo = mock((_locksDir: string): LockInfo[] => [])
const TEST_BINDINGS: ParsedBinding[] = []

type TestKeybindingHandlerRegistration = {
  action: string
  context: KeybindingContextName
  handler: () => void
}
const doctorDeps = {
  getDoctorDiagnostic,
  getNpmDistTags,
  getGcsDistTags,
  isPidBasedLockingEnabled,
  cleanupStaleLocks,
  getAllLockInfo,
} satisfies NonNullable<React.ComponentProps<typeof Doctor>['deps']>

function makeDiagnostic(
  overrides: Partial<DiagnosticInfo> = {},
): DiagnosticInfo {
  return {
    installationType: 'npm-global',
    version: '1.2.3',
    installationPath: '/usr/local/bin/openclaude',
    invokedBinary: '/usr/local/bin/openclaude',
    configInstallMethod: 'not set',
    autoUpdates: 'enabled',
    hasUpdatePermissions: null,
    multipleInstallations: [],
    warnings: [],
    ripgrepStatus: {
      working: true,
      mode: 'system',
      systemPath: '/usr/bin/rg',
    },
    ...overrides,
  }
}

function extractLastFrame(output: string): string {
  let lastFrame: string | null = null
  let cursor = 0

  while (cursor < output.length) {
    const start = output.indexOf(SYNC_START, cursor)
    if (start === -1) break

    const contentStart = start + SYNC_START.length
    const end = output.indexOf(SYNC_END, contentStart)
    if (end === -1) break

    const frame = output.slice(contentStart, end)
    if (frame.trim().length > 0) {
      lastFrame = frame
    }
    cursor = end + SYNC_END.length
  }

  return stripAnsi(lastFrame ?? output)
}

function createTestStreams() {
  let output = ''
  const stdout = new PassThrough()
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean
    setRawMode: (mode: boolean) => void
    ref: () => void
    unref: () => void
  }

  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}
  ;(stdout as unknown as { columns: number }).columns = 120
  stdout.on('data', chunk => {
    output += chunk.toString()
  })

  return { stdout, stdin, getOutput: () => output }
}

function TestKeybindingProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactNode {
  const pendingChordRef = React.useRef<ParsedKeystroke[] | null>(null)
  const [pendingChord, setPendingChordState] = React.useState<
    ParsedKeystroke[] | null
  >(null)
  const activeContextsRef = React.useRef<Set<KeybindingContextName>>(new Set())
  const handlerRegistryRef = React.useRef(
    new Map<string, Set<TestKeybindingHandlerRegistration>>(),
  )

  const setPendingChord = React.useCallback(
    (pending: ParsedKeystroke[] | null) => {
      pendingChordRef.current = pending
      setPendingChordState(pending)
    },
    [],
  )
  const registerActiveContext = React.useCallback(
    (context: KeybindingContextName) => {
      activeContextsRef.current.add(context)
    },
    [],
  )
  const unregisterActiveContext = React.useCallback(
    (context: KeybindingContextName) => {
      activeContextsRef.current.delete(context)
    },
    [],
  )

  return (
    <KeybindingProvider
      bindings={TEST_BINDINGS}
      pendingChordRef={pendingChordRef}
      pendingChord={pendingChord}
      setPendingChord={setPendingChord}
      activeContexts={activeContextsRef.current}
      registerActiveContext={registerActiveContext}
      unregisterActiveContext={unregisterActiveContext}
      handlerRegistryRef={handlerRegistryRef}
    >
      {children}
    </KeybindingProvider>
  )
}

async function waitForOutput(
  getOutput: () => string,
  predicate: (output: string) => boolean,
  timeoutMs = 3000,
): Promise<string> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const output = extractLastFrame(getOutput())
    if (predicate(output)) return output
    await Bun.sleep(10)
  }

  throw new Error('Timed out waiting for Doctor test output')
}

beforeEach(async () => {
  getDoctorDiagnostic.mockImplementation(async () => makeDiagnostic())
  getNpmDistTags.mockImplementation(async () => ({
    latest: '9.9.9',
    stable: '8.8.8',
  }))
  getGcsDistTags.mockImplementation(async () => ({
    latest: '7.7.7',
    stable: '6.6.6',
  }))
  isPidBasedLockingEnabled.mockImplementation(() => false)
  cleanupStaleLocks.mockImplementation(() => 0)
  getAllLockInfo.mockImplementation(() => [])
})

test('renders installation diagnostics and resolved dist tags', async () => {
  const { stdout, stdin, getOutput } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  try {
    root.render(
      <AppStateProvider>
        <TestKeybindingProvider>
          <Doctor onDone={() => {}} deps={doctorDeps} />
        </TestKeybindingProvider>
      </AppStateProvider>,
    )

    const output = await waitForOutput(getOutput, text =>
      text.includes('Latest version: 9.9.9'),
    )
    expect(output).toContain('Diagnostics')
    expect(output).toContain('Currently running: npm-global (1.2.3)')
    expect(output).toContain('Search: OK (/usr/bin/rg)')
    expect(output).toContain('Stable version: 8.8.8')
  } finally {
    root.unmount()
    stdin.end()
    stdout.end()
    await Bun.sleep(0)
  }
})

test('renders a version-fetch failure without blocking diagnostics', async () => {
  getNpmDistTags.mockImplementation(async () => {
    throw new Error('registry unavailable')
  })

  const { stdout, stdin, getOutput } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  try {
    root.render(
      <AppStateProvider>
        <TestKeybindingProvider>
          <Doctor onDone={() => {}} deps={doctorDeps} />
        </TestKeybindingProvider>
      </AppStateProvider>,
    )

    const output = await waitForOutput(getOutput, text =>
      text.includes('Failed to fetch versions'),
    )
    expect(output).toContain('Currently running: npm-global (1.2.3)')
  } finally {
    root.unmount()
    stdin.end()
    stdout.end()
    await Bun.sleep(0)
  }
})
