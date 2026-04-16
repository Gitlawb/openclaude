import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { scanEnvReferences } from './envScan.js'

describe('scanEnvReferences', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'bridgeai-envscan-'))
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  function write(name: string, content: string): string {
    const p = path.join(tmp, name)
    mkdirSync(path.dirname(p), { recursive: true })
    writeFileSync(p, content, 'utf-8')
    return p
  }

  test('detects process.env.VAR_NAME', () => {
    const f = write('a.ts', `const port = process.env.PORT\nconst host = process.env.HOST`)
    const result = scanEnvReferences([f])
    expect(result).toContain('`HOST`')
    expect(result).toContain('`PORT`')
  })

  test('detects dotenv import', () => {
    const f = write('b.ts', `import 'dotenv'\nimport dotenv from 'dotenv'`)
    const result = scanEnvReferences([f])
    expect(result).toContain('Uses `dotenv` for environment configuration')
  })

  test('detects Bun.env references', () => {
    const f = write('c.ts', `const key = Bun.env.API_KEY`)
    const result = scanEnvReferences([f])
    expect(result).toContain('`API_KEY`')
  })

  test('returns empty for files with no env references', () => {
    const f = write('d.ts', `export const x = 1`)
    const result = scanEnvReferences([f])
    expect(result).toHaveLength(0)
  })

  test('handles non-existent files gracefully', () => {
    const result = scanEnvReferences(['/nonexistent/file.ts'])
    expect(result).toHaveLength(0)
  })
})
