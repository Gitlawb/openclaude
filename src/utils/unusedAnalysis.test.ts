import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { analyzeUnusedCode } from './unusedAnalysis.ts'

const tempRoots: string[] = []

afterEach(() => {
  while (tempRoots.length > 0) {
    const path = tempRoots.pop()
    if (!path) continue
    rmSync(path, { force: true, recursive: true })
  }
})

describe('analyzeUnusedCode', () => {
  test('tracks transitive dead declarations and imports', () => {
    const rootDir = createFixture({
      'src/entry.ts': [
        "import { join, resolve } from 'node:path'",
        '',
        "const liveValue = resolve('a')",
        "const deadValue = join('a', 'b')",
        '',
        'function deadHelper() {',
        '  return deadValue',
        '}',
        '',
        'export function liveExport() {',
        '  return liveValue',
        '}',
        '',
        'export function deadExport() {',
        '  return deadHelper()',
        '}',
        '',
        'export { deadExport }',
      ].join('\n'),
      'src/consumer.ts': [
        "import { liveExport } from './entry'",
        '',
        'console.log(liveExport())',
      ].join('\n'),
    })

    const report = analyzeUnusedCode({
      rootDir,
      includeDirs: ['src'],
    })

    expect(report.unusedImports).toEqual([
      {
        file: 'src/entry.ts',
        name: 'join',
        kind: 'named-import',
        moduleSpecifier: 'node:path',
        startLine: 1,
        endLine: 1,
      },
    ])

    expect(report.unusedDeclarations).toEqual([
      {
        file: 'src/entry.ts',
        name: 'deadValue',
        kind: 'variable',
        startLine: 4,
        endLine: 4,
      },
      {
        file: 'src/entry.ts',
        name: 'deadHelper',
        kind: 'function',
        startLine: 6,
        endLine: 8,
      },
      {
        file: 'src/entry.ts',
        name: 'deadExport',
        kind: 'function',
        startLine: 14,
        endLine: 16,
      },
    ])

    expect(report.unusedLineRanges).toEqual([
      {
        file: 'src/entry.ts',
        startLine: 1,
        endLine: 1,
        reasons: ['named-import:join'],
      },
      {
        file: 'src/entry.ts',
        startLine: 4,
        endLine: 8,
        reasons: ['variable:deadValue', 'function:deadHelper'],
      },
      {
        file: 'src/entry.ts',
        startLine: 14,
        endLine: 16,
        reasons: ['function:deadExport'],
      },
    ])
  })

  test('keeps locally referenced declarations alive', () => {
    const rootDir = createFixture({
      'src/index.ts': [
        'const helper = 42',
        '',
        'function liveLocal() {',
        '  return helper',
        '}',
        '',
        'console.log(liveLocal())',
      ].join('\n'),
    })

    const report = analyzeUnusedCode({
      rootDir,
      includeDirs: ['src'],
    })

    expect(report.unusedImports).toEqual([])
    expect(report.unusedDeclarations).toEqual([])
    expect(report.unusedLineRanges).toEqual([])
  })
})

function createFixture(files: Record<string, string>): string {
  const rootDir = mkdtempSync(join(tmpdir(), 'unused-analysis-'))
  tempRoots.push(rootDir)

  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = join(rootDir, relativePath)
    mkdirSync(join(filePath, '..'), { recursive: true })
    writeFileSync(filePath, contents)
  }

  return rootDir
}
