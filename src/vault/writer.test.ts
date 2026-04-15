import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeVaultDoc, writeVaultDocs, writeVaultFile } from './writer'
import type { VaultDoc } from './writer'

describe('vault writer', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'vault-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('writeVaultDoc', () => {
    test('writes file with title header and content', () => {
      const doc: VaultDoc = {
        filename: 'overview.md',
        title: 'Project Overview',
        content: 'This is the overview.',
      }

      writeVaultDoc(tempDir, doc)

      const filePath = join(tempDir, 'overview.md')
      expect(existsSync(filePath)).toBe(true)

      const written = readFileSync(filePath, 'utf-8')
      expect(written).toBe('# Project Overview\n\nThis is the overview.')
    })

    test('creates parent directories if needed', () => {
      const nested = join(tempDir, 'deep', 'nested')
      const doc: VaultDoc = {
        filename: 'deep/nested/doc.md',
        title: 'Nested Doc',
        content: 'Nested content.',
      }

      // vault path is tempDir, filename includes subdirs
      writeVaultDoc(tempDir, doc)

      const filePath = join(tempDir, 'deep', 'nested', 'doc.md')
      expect(existsSync(filePath)).toBe(true)

      const written = readFileSync(filePath, 'utf-8')
      expect(written).toContain('# Nested Doc')
    })
  })

  describe('writeVaultDocs', () => {
    const sampleDocs: VaultDoc[] = [
      { filename: 'overview.md', title: 'Project Overview', content: 'Overview content.' },
      { filename: 'arch.md', title: 'Architecture', content: 'Arch content.' },
    ]

    test('generates index.md with correct links', () => {
      writeVaultDocs(tempDir, 'my-project', sampleDocs)

      const index = readFileSync(join(tempDir, 'index.md'), 'utf-8')
      expect(index).toContain('# my-project — Vault')
      expect(index).toContain('- [Project Overview](./overview.md)')
      expect(index).toContain('- [Architecture](./arch.md)')
    })

    test('index.md includes timestamp and marker comment', () => {
      writeVaultDocs(tempDir, 'my-project', sampleDocs)

      const index = readFileSync(join(tempDir, 'index.md'), 'utf-8')
      expect(index).toContain('<!-- bridge-ai generated -->')
      expect(index).toMatch(/Generated at \d{4}-\d{2}-\d{2}T/)
    })

    test('returns correct filename list including index.md', () => {
      const result = writeVaultDocs(tempDir, 'my-project', sampleDocs)

      expect(result).toEqual(['overview.md', 'arch.md', 'index.md'])
    })

    test('writes all doc files', () => {
      writeVaultDocs(tempDir, 'my-project', sampleDocs)

      expect(existsSync(join(tempDir, 'overview.md'))).toBe(true)
      expect(existsSync(join(tempDir, 'arch.md'))).toBe(true)
      expect(existsSync(join(tempDir, 'index.md'))).toBe(true)
    })
  })

  describe('writeVaultFile', () => {
    test('writes raw content without title header', () => {
      const rawContent = JSON.stringify({ version: '1.0' }, null, 2)
      writeVaultFile(tempDir, 'manifest.json', rawContent)

      const filePath = join(tempDir, 'manifest.json')
      expect(existsSync(filePath)).toBe(true)

      const written = readFileSync(filePath, 'utf-8')
      expect(written).toBe(rawContent)
      expect(written).not.toContain('# ')
    })
  })

  describe('overwrite behavior', () => {
    test('handles overwriting existing files without error', () => {
      const doc: VaultDoc = {
        filename: 'overview.md',
        title: 'V1',
        content: 'First version.',
      }

      writeVaultDoc(tempDir, doc)

      const updated: VaultDoc = {
        filename: 'overview.md',
        title: 'V2',
        content: 'Second version.',
      }

      expect(() => writeVaultDoc(tempDir, updated)).not.toThrow()

      const written = readFileSync(join(tempDir, 'overview.md'), 'utf-8')
      expect(written).toContain('# V2')
      expect(written).toContain('Second version.')
    })
  })
})
