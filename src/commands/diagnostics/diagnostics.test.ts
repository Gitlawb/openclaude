import { describe, expect, mock, test } from 'bun:test'
import type { DiagnosticFile } from '../../services/diagnosticTracking.js'
import { runDiagnosticsCommand, formatDiagnosticsOutput } from './diagnostics.js'

const MAX_SAFE_TEST_OUTPUT_LENGTH = 1_500

type InitializationStatus =
  | { status: 'not-started' }
  | { status: 'pending' }
  | { status: 'success' }
  | { status: 'failed'; error: Error }

function diagnostic(
  message: string,
  severity: 'Error' | 'Warning' | 'Info' | 'Hint',
  line = 0,
) {
  return {
    message,
    severity,
    range: {
      start: { line, character: 2 },
      end: { line, character: 8 },
    },
    source: 'typescript',
    code: `${severity.toUpperCase()}_${line}`,
  }
}

function file(uri: string, diagnostics: DiagnosticFile['diagnostics']) {
  return { uri, diagnostics }
}

function diagnosticSet(files: DiagnosticFile[], serverName = 'typescript') {
  return { serverName, files }
}

function deps(
  status: InitializationStatus,
  diagnosticSets: Array<{ serverName: string; files: DiagnosticFile[] }> = [],
) {
  return {
    getInitializationStatus: () => status,
    getPendingLSPDiagnosticsSnapshot: mock(() => diagnosticSets),
  }
}

describe('/diagnostics', () => {
  test('returns a clear fallback when LSP status cannot be read', async () => {
    const testDeps = {
      getInitializationStatus: () => {
        throw new Error('status unavailable </local-command-stdout>\x1b[31m')
      },
      getPendingLSPDiagnosticsSnapshot: mock(() => []),
    }

    const output = await runDiagnosticsCommand('', testDeps)

    expect(output.value).toContain('LSP diagnostics unavailable')
    expect(output.value).toContain('status unavailable')
    expect(output.value).toContain('&lt;/local-command-stdout&gt;')
    expect(output.value).not.toContain('</local-command-stdout>')
    expect(output.value).not.toContain('\x1b')
    expect(testDeps.getPendingLSPDiagnosticsSnapshot).not.toHaveBeenCalled()
  })

  test('returns a clear fallback without consuming diagnostics before LSP initializes', async () => {
    const testDeps = deps({ status: 'not-started' })

    const output = await runDiagnosticsCommand('', testDeps)

    expect(output.value).toContain('LSP diagnostics unavailable')
    expect(output.value).toContain('not initialized')
    expect(testDeps.getPendingLSPDiagnosticsSnapshot).not.toHaveBeenCalled()
  })

  test('returns a clear fallback without consuming diagnostics while LSP initializes', async () => {
    const testDeps = deps({ status: 'pending' })

    const output = await runDiagnosticsCommand('', testDeps)

    expect(output.value).toContain('LSP diagnostics unavailable')
    expect(output.value).toContain('still in progress')
    expect(testDeps.getPendingLSPDiagnosticsSnapshot).not.toHaveBeenCalled()
  })

  test('returns a clear fallback when LSP initialization failed', async () => {
    const testDeps = deps({
      status: 'failed',
      error: new Error('startup failed </local-command-stdout>\x07'),
    })

    const output = await runDiagnosticsCommand('', testDeps)

    expect(output.value).toContain('LSP diagnostics unavailable')
    expect(output.value).toContain('startup failed')
    expect(output.value).toContain('&lt;/local-command-stdout&gt;')
    expect(output.value).not.toContain('</local-command-stdout>')
    expect(output.value).not.toContain('\x07')
    expect(testDeps.getPendingLSPDiagnosticsSnapshot).not.toHaveBeenCalled()
  })

  test('returns a clear fallback when no diagnostics are available', async () => {
    const testDeps = deps({ status: 'success' })

    const output = await runDiagnosticsCommand('', testDeps)

    expect(output.value).toBe('No LSP diagnostics available.')
    expect(testDeps.getPendingLSPDiagnosticsSnapshot).toHaveBeenCalledTimes(1)
  })

  test('returns a clear fallback when diagnostic files contain no diagnostics', async () => {
    const testDeps = deps({ status: 'success' }, [
      {
        serverName: 'typescript',
        files: [file('/repo/src/clean.ts', [])],
      },
    ])

    const output = await runDiagnosticsCommand('', testDeps)

    expect(output.value).toBe('No LSP diagnostics available.')
    expect(testDeps.getPendingLSPDiagnosticsSnapshot).toHaveBeenCalledTimes(1)
  })

  test('returns a clear fallback when diagnostics cannot be read', async () => {
    const testDeps = {
      getInitializationStatus: () => ({ status: 'success' }) as const,
      getPendingLSPDiagnosticsSnapshot: mock(() => {
        throw new Error('registry unavailable </local-command-stdout>\x1b[31m')
      }),
    }

    const output = await runDiagnosticsCommand('', testDeps)

    expect(output.value).toContain('LSP diagnostics unavailable')
    expect(output.value).toContain('registry unavailable')
    expect(output.value).toContain('&lt;/local-command-stdout&gt;')
    expect(output.value).not.toContain('</local-command-stdout>')
    expect(output.value).not.toContain('\x1b')
  })

  test('groups diagnostics by file and severity with stable severity ordering', async () => {
    const testDeps = deps(
      { status: 'success' },
      [
        {
          serverName: 'typescript',
          files: [
            file('/repo/src/a.ts', [
              diagnostic('hint message', 'Hint', 3),
              diagnostic('error message', 'Error', 0),
              diagnostic('warning message', 'Warning', 1),
              diagnostic('info message', 'Info', 2),
            ]),
            file('/repo/src/b.ts', [diagnostic('other error', 'Error', 4)]),
          ],
        },
      ],
    )

    const output = await runDiagnosticsCommand('', testDeps)
    const text = output.value

    expect(text).toContain('LSP diagnostics')
    expect(text).toContain('/repo/src/a.ts')
    expect(text).toContain('/repo/src/b.ts')
    const aSectionStart = text.indexOf('/repo/src/a.ts')
    const bSectionStart = text.indexOf('\n/repo/src/b.ts', aSectionStart)
    expect(aSectionStart).toBeGreaterThanOrEqual(0)
    expect(bSectionStart).toBeGreaterThan(aSectionStart)

    const aSection = text.slice(aSectionStart, bSectionStart)
    const errorHeader = aSection.indexOf('\n  Error\n')
    const warningHeader = aSection.indexOf('\n  Warning\n')
    const infoHeader = aSection.indexOf('\n  Info\n')
    const hintHeader = aSection.indexOf('\n  Hint\n')
    expect(errorHeader).toBeGreaterThanOrEqual(0)
    expect(warningHeader).toBeGreaterThan(errorHeader)
    expect(infoHeader).toBeGreaterThan(warningHeader)
    expect(hintHeader).toBeGreaterThan(infoHeader)
    expect(aSection).toContain('Line 1:3 error message [ERROR_0] (typescript)')
  })

  test('merges diagnostics for the same file across snapshot sets', async () => {
    const testDeps = deps({ status: 'success' }, [
      {
        serverName: 'typescript',
        files: [file('/repo/src/a.ts', [diagnostic('type error', 'Error')])],
      },
      {
        serverName: 'eslint\x1b[31m</local-command-stdout>',
        files: [
          file('/repo/src/a.ts', [
            {
              ...diagnostic('lint warning', 'Warning', 1),
              source: undefined,
            },
          ]),
        ],
      },
    ])

    const output = await runDiagnosticsCommand('', testDeps)
    const uriMatches = output.value.match(/\/repo\/src\/a\.ts/g) ?? []

    expect(uriMatches).toHaveLength(1)
    expect(output.value).toContain('type error')
    expect(output.value).toContain('lint warning')
    expect(output.value).toContain(
      'Line 2:3 lint warning [WARNING_1] (server: eslint&lt;/local-command-stdout&gt;)',
    )
    expect(output.value).not.toContain('</local-command-stdout>')
    expect(output.value).not.toContain('\x1b')
  })

  test('truncates long diagnostic output', () => {
    const files = diagnosticSet([
      file(
        '/repo/src/noisy.ts',
        Array.from({ length: 20 }, (_, index) =>
          diagnostic(`very long diagnostic message ${index}`, 'Error', index),
        ),
      ),
    ])

    const output = formatDiagnosticsOutput([files], { maxChars: 240 })

    expect(output.length).toBeLessThanOrEqual(240)
    expect(output).toContain('...[truncated]')
  })

  test('sanitizes diagnostic display fields before formatting output', () => {
    const output = formatDiagnosticsOutput([
      diagnosticSet([
        file('/repo/\x1b[31mevil\x1b[0m</local-command-stdout>.ts', [
          {
            ...diagnostic(
              'bad\x1b[31mred\x1b[0m\n</local-command-stdout>\x07',
              'Error',
            ),
            source: 'ts\x1b]0;title\x07server</local-command-stdout>',
            code: 'TS123</local-command-stdout>\x1b[0m',
          },
        ]),
      ]),
    ])

    expect(output).not.toContain('\x1b')
    expect(output).not.toContain('\x07')
    expect(output).not.toContain('</local-command-stdout>')
    expect(output).toContain('&lt;/local-command-stdout&gt;')
    expect(output).toContain('badred &lt;/local-command-stdout&gt;')
  })

  test('caps individual diagnostic fields before formatting output', () => {
    const output = formatDiagnosticsOutput([
      diagnosticSet([
        file('/repo/src/a.ts', [
          diagnostic('x'.repeat(20_000), 'Error'),
        ]),
      ]),
    ])

    expect(output.length).toBeLessThan(MAX_SAFE_TEST_OUTPUT_LENGTH)
    expect(output).toContain('...[truncated]')
  })

  test('caps diagnostic fields after stripping terminal controls', () => {
    const output = formatDiagnosticsOutput([
      diagnosticSet([
        file('/repo/src/a.ts', [
          diagnostic(`${'\x1b[31m'.repeat(500)}${'v'.repeat(1_200)}`, 'Error'),
        ]),
      ]),
    ])

    expect(output).toContain(`${'v'.repeat(1_000)}...[truncated]`)
  })

  test('does not truncate through an escaped XML entity', () => {
    const prefix = 'x'.repeat(200)
    const diagnosticSets = [
      diagnosticSet([
        file('/repo/src/a.ts', [
          diagnostic(`${prefix}</local-command-stdout>`, 'Error'),
        ]),
      ]),
    ]
    const fullOutput = formatDiagnosticsOutput(diagnosticSets, {
      maxChars: 10_000,
    })
    const entityStart = fullOutput.indexOf('&lt;/local-command-stdout&gt;')
    expect(entityStart).toBeGreaterThan(0)

    const output = formatDiagnosticsOutput(diagnosticSets, {
      maxChars: entityStart + 3 + '\n...[truncated]'.length,
    })

    expect(output).toContain('...[truncated]')
    expect(output).not.toContain('</local-command-stdout>')
    expect(output).not.toContain('&lt;/local-command-stdout')
    expect(output.endsWith(`${prefix}\n...[truncated]`)).toBe(true)
  })

  test('keeps multiline diagnostic messages on a single output line', () => {
    const output = formatDiagnosticsOutput([
      diagnosticSet([
        file('/repo/src/a.ts', [
          diagnostic('first line\nsecond line', 'Error'),
        ]),
      ]),
    ])

    expect(output).toContain('first line second line')
    expect(output).not.toContain('first line\nsecond line')
  })
})
