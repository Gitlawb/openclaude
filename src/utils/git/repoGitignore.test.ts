import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ensureIgnored } from './repoGitignore'

describe('repoGitignore.ensureIgnored', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'repo-gitignore-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('creates .gitignore if missing and adds pattern; returns { added: true }', () => {
    const gitignorePath = join(tempDir, '.gitignore')
    expect(existsSync(gitignorePath)).toBe(false)

    const result = ensureIgnored(tempDir, '.bridgeai/')

    expect(result).toEqual({ added: true })
    expect(existsSync(gitignorePath)).toBe(true)
    const content = readFileSync(gitignorePath, 'utf-8')
    expect(content).toContain('.bridgeai/')
  })

  test('appends pattern when file exists but does not contain it', () => {
    const gitignorePath = join(tempDir, '.gitignore')
    writeFileSync(gitignorePath, 'node_modules/\ndist/\n', 'utf-8')

    const result = ensureIgnored(tempDir, '.bridgeai/')

    expect(result).toEqual({ added: true })
    const content = readFileSync(gitignorePath, 'utf-8')
    expect(content).toContain('node_modules/')
    expect(content).toContain('dist/')
    expect(content).toContain('.bridgeai/')
    // existing content preserved, new pattern on its own line
    expect(content.split('\n').filter((l) => l.trim() === '.bridgeai/').length).toBe(1)
  })

  test('returns { added: false } when exact pattern already present', () => {
    const gitignorePath = join(tempDir, '.gitignore')
    const original = 'node_modules/\n.bridgeai/\ndist/\n'
    writeFileSync(gitignorePath, original, 'utf-8')

    const result = ensureIgnored(tempDir, '.bridgeai/')

    expect(result).toEqual({ added: false })
    const content = readFileSync(gitignorePath, 'utf-8')
    expect(content).toBe(original)
  })

  test('treats foo/ and foo as equivalent (no duplicate added)', () => {
    const gitignorePath = join(tempDir, '.gitignore')
    // File has `.bridgeai` (no trailing slash), caller asks for `.bridgeai/`
    writeFileSync(gitignorePath, 'node_modules/\n.bridgeai\n', 'utf-8')

    const result = ensureIgnored(tempDir, '.bridgeai/')

    expect(result).toEqual({ added: false })
    const content = readFileSync(gitignorePath, 'utf-8')
    // no duplicate written
    expect(content.split('\n').filter((l) => l.trim().replace(/\/$/, '') === '.bridgeai').length).toBe(1)

    // And the reverse: file has `foo/`, caller asks for `foo`
    const other = join(tempDir, '.gitignore-other')
    const otherRoot = mkdtempSync(join(tmpdir(), 'repo-gitignore-test-other-'))
    try {
      writeFileSync(join(otherRoot, '.gitignore'), 'foo/\n', 'utf-8')
      const r2 = ensureIgnored(otherRoot, 'foo')
      expect(r2).toEqual({ added: false })
    } finally {
      rmSync(otherRoot, { recursive: true, force: true })
    }
  })

  test('preserves CRLF line endings when existing file uses them', () => {
    const gitignorePath = join(tempDir, '.gitignore')
    writeFileSync(gitignorePath, 'node_modules/\r\ndist/\r\n', 'utf-8')

    const result = ensureIgnored(tempDir, '.bridgeai/')

    expect(result).toEqual({ added: true })
    const content = readFileSync(gitignorePath, 'utf-8')
    // All line endings should remain CRLF (no bare \n that isn't preceded by \r)
    const bareLf = content.match(/(?<!\r)\n/g)
    expect(bareLf).toBeNull()
    expect(content).toContain('.bridgeai/')
    expect(content).toContain('\r\n')
  })
})
