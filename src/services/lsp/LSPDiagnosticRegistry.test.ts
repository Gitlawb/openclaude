import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { Diagnostic, DiagnosticFile } from '../diagnosticTracking.js'

const debugMessages: string[] = []

const realDebugModule = await import(
  `../../utils/debug.js?real=${Date.now()}-${Math.random()}`,
)

mock.module('../../utils/debug.js', () => ({
  ...realDebugModule,
  logForDebugging: mock((message: string) => {
    debugMessages.push(message)
  }),
}))
// Other tests mock slowOperations process-wide; restore the real serializer so
// diagnostic keys keep message/range/code entropy under full-suite ordering.
mock.module('../../utils/slowOperations.js', () => ({
  jsonStringify: JSON.stringify,
}))

const registry = await import(
  `./LSPDiagnosticRegistry.ts?test=${Date.now()}-${Math.random()}`
)

function diagnostic(message: string, line = 0): Diagnostic {
  return {
    message,
    severity: 'Error',
    range: {
      start: { line, character: 0 },
      end: { line, character: 1 },
    },
    source: 'typescript',
    code: `TS${line}`,
  }
}

function diagnosticFile(uri: string, messages: string[]): DiagnosticFile {
  return {
    uri,
    diagnostics: messages.map((message, index) => diagnostic(message, index)),
  }
}

function diagnosticCount(files: DiagnosticFile[]): number {
  return files.reduce((sum, file) => sum + file.diagnostics.length, 0)
}

describe('LSPDiagnosticRegistry storm control', () => {
  beforeEach(() => {
    registry.resetAllLSPDiagnosticState()
    debugMessages.length = 0
  })

  test('dedupes repeated identical diagnostics before delivery', () => {
    const repeated = diagnostic('same missing import')
    registry.registerPendingLSPDiagnostic({
      serverName: 'typescript',
      files: [{ uri: '/repo/a.ts', diagnostics: [repeated, repeated] }],
    })

    const diagnosticSets = registry.checkForLSPDiagnostics()

    expect(diagnosticSets).toHaveLength(1)
    expect(diagnosticSets[0]?.files).toEqual([
      { uri: '/repo/a.ts', diagnostics: [repeated] },
    ])
  })

  test('does not reattach unchanged diagnostics across turns', () => {
    const file = diagnosticFile('/repo/a.ts', ['same missing import'])

    registry.registerPendingLSPDiagnostic({
      serverName: 'typescript',
      files: [file],
    })
    const firstDiagnosticSets = registry.checkForLSPDiagnostics()
    expect(firstDiagnosticSets).toHaveLength(1)
    expect(diagnosticCount(firstDiagnosticSets[0]!.files)).toBe(1)

    registry.registerPendingLSPDiagnostic({
      serverName: 'typescript',
      files: [file],
    })

    expect(registry.checkForLSPDiagnostics()).toEqual([])
  })

  test('allows edited files to resend diagnostics when cleared by file URI', () => {
    const file = diagnosticFile('/repo/a.ts', ['same missing import'])

    registry.registerPendingLSPDiagnostic({
      serverName: 'typescript',
      files: [file],
    })
    const firstDiagnosticSets = registry.checkForLSPDiagnostics()
    expect(firstDiagnosticSets).toHaveLength(1)
    expect(diagnosticCount(firstDiagnosticSets[0]!.files)).toBe(1)

    // Intentionally clear by file:// URI while diagnostics use a plain path;
    // both forms must normalize to the same delivered-diagnostic key.
    registry.clearDeliveredDiagnosticsForFile('file:///repo/a.ts')
    registry.registerPendingLSPDiagnostic({
      serverName: 'typescript',
      files: [file],
    })

    const secondDiagnosticSets = registry.checkForLSPDiagnostics()
    expect(secondDiagnosticSets).toHaveLength(1)
    expect(diagnosticCount(secondDiagnosticSets[0]!.files)).toBe(1)
  })

  test('enforces per-file and per-turn diagnostic caps', () => {
    registry.registerPendingLSPDiagnostic({
      serverName: 'typescript',
      files: [
        diagnosticFile(
          '/repo/crowded.ts',
          Array.from({ length: 12 }, (_, index) => `crowded ${index}`),
        ),
        ...Array.from({ length: 25 }, (_, index) =>
          diagnosticFile(`/repo/file-${index}.ts`, [`other ${index}`]),
        ),
      ],
    })

    const files = registry.checkForLSPDiagnostics()[0]?.files ?? []

    expect(diagnosticCount(files)).toBe(30)
    expect(
      files.find(file => file.uri === '/repo/crowded.ts')?.diagnostics.length,
    ).toBe(10)
  })

  test('preserves recently active file diagnostics when total turn cap is exceeded', () => {
    registry.recordLSPDiagnosticFileActivity('/repo/recent.ts')
    registry.registerPendingLSPDiagnostic({
      serverName: 'typescript',
      files: [
        ...Array.from({ length: 30 }, (_, index) =>
          diagnosticFile(`/repo/old-${index}.ts`, [`old ${index}`]),
        ),
        diagnosticFile('/repo/recent.ts', ['recent file should survive']),
      ],
    })

    const files = registry.checkForLSPDiagnostics()[0]?.files ?? []

    expect(diagnosticCount(files)).toBe(30)
    expect(files.some(file => file.uri === '/repo/recent.ts')).toBe(true)
  })

  test('emits one compact storm summary with rolling top files and no diagnostic text', () => {
    const firstStormFile = diagnosticFile(
      '/home/alice/project/src/noisy-a.ts',
      Array.from(
        { length: 120 },
        (_, index) => `do not leak raw diagnostic text A ${index}`,
      ),
    )
    const secondStormFile = diagnosticFile(
      '/home/alice/project/src/noisy-b.ts',
      Array.from(
        { length: 90 },
        (_, index) => `do not leak raw diagnostic text B ${index}`,
      ),
    )

    registry.registerPendingLSPDiagnostic({
      serverName: 'typescript',
      files: [firstStormFile, secondStormFile],
    })

    const files = registry.checkForLSPDiagnostics()[0]?.files ?? []
    const stormSummary = files.find(file =>
      file.uri.startsWith('lsp://diagnostic-storm/typescript'),
    )
    const stormLogs = debugMessages.filter(message =>
      message.startsWith('LSP diagnostic storm: server=typescript'),
    )

    expect(diagnosticCount(files)).toBeLessThanOrEqual(30)
    expect(stormSummary?.diagnostics).toHaveLength(1)
    expect(stormSummary?.diagnostics[0]?.message).toContain('raw=210')
    expect(stormSummary?.diagnostics[0]?.message).toContain('dropped=')
    expect(stormSummary?.diagnostics[0]?.message).toContain('delivered=')
    expect(stormSummary?.diagnostics[0]?.message).toContain(
      'topFiles=[noisy-a.ts:120, noisy-b.ts:90]',
    )
    expect(stormSummary?.diagnostics[0]?.message).not.toContain(
      'do not leak raw diagnostic text',
    )
    expect(stormLogs).toHaveLength(1)
  })

  test('does not trickle capped storm diagnostics into later turns', () => {
    const stormFile = diagnosticFile(
      '/repo/noisy.ts',
      Array.from({ length: 210 }, (_, index) => `storm diagnostic ${index}`),
    )

    registry.registerPendingLSPDiagnostic({
      serverName: 'typescript',
      files: [stormFile],
    })
    const firstFiles = registry.checkForLSPDiagnostics()[0]?.files ?? []
    const firstRegularFile = firstFiles.find(file => file.uri === stormFile.uri)

    expect(firstRegularFile?.diagnostics.map(diag => diag.code)).toEqual(
      Array.from({ length: 10 }, (_, index) => `TS${index}`),
    )

    registry.registerPendingLSPDiagnostic({
      serverName: 'typescript',
      files: [stormFile],
    })
    const secondFiles = registry.checkForLSPDiagnostics()[0]?.files ?? []

    expect(secondFiles.map(file => file.uri)).toEqual([
      'lsp://diagnostic-storm/typescript',
    ])
  })

  test('reserves compact summaries for multiple storming servers before full diagnostics', () => {
    registry.registerPendingLSPDiagnostic({
      serverName: 'typescript',
      files: Array.from({ length: 220 }, (_, index) =>
        diagnosticFile(`/repo/typescript-${index}.ts`, [
          `typescript storm ${index}`,
        ]),
      ),
    })
    registry.registerPendingLSPDiagnostic({
      serverName: 'eslint',
      files: [
        diagnosticFile(
          '/repo/eslint.ts',
          Array.from({ length: 220 }, (_, index) => `eslint storm ${index}`),
        ),
      ],
    })

    const files = registry.checkForLSPDiagnostics()[0]?.files ?? []
    const summaryUris = files
      .filter(file => file.uri.startsWith('lsp://diagnostic-storm/'))
      .map(file => file.uri)

    expect(diagnosticCount(files)).toBeLessThanOrEqual(30)
    expect(summaryUris).toContain('lsp://diagnostic-storm/typescript')
    expect(summaryUris).toContain('lsp://diagnostic-storm/eslint')
  })
})
