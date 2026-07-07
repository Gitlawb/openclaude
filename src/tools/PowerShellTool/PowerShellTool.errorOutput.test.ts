import { describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  appendPersistedPowerShellOutputHint,
  MAX_PERSISTED_POWERSHELL_OUTPUT_SIZE,
  persistPowerShellOutputFile,
} from './PowerShellTool.js'

describe('PowerShellTool persisted error output', () => {
  test('hint reports a cap instead of "full output" when the roll file was truncated', () => {
    const original = MAX_PERSISTED_POWERSHELL_OUTPUT_SIZE + 4096
    const hint = appendPersistedPowerShellOutputHint('preview', '/tmp/out', original, true)

    expect(hint).not.toContain('full output')
    expect(hint).toContain('capped')
    expect(hint).toContain(`first ${MAX_PERSISTED_POWERSHELL_OUTPUT_SIZE} bytes`)
    expect(hint).toContain(`${original}-byte`)
    expect(hint).toContain('/tmp/out')
  })

  test('hint keeps "full output" wording when the roll file fit under the cap', () => {
    const hint = appendPersistedPowerShellOutputHint('preview', '/tmp/out', 1234, false)
    expect(hint).toMatch(/full output \(1234 bytes\) saved to \/tmp\/out; read with the Read tool/)
  })

  test('caps the destination copy and leaves the rolled-output source intact', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'powershell-persist-source-'))
    const source = join(dir, 'roll.txt')
    const body = 'x'.repeat(4096)
    writeFileSync(source, body)
    const cap = 1024
    let dest: string | undefined

    try {
      const persisted = await persistPowerShellOutputFile(source, 'powershell-persist-src-test', cap)
      expect(persisted).not.toBeNull()
      dest = persisted!.path
      expect(persisted!.size).toBe(4096)
      expect(persisted!.truncated).toBe(true)
      expect(statSync(source).size).toBe(4096)
      expect(readFileSync(source, 'utf8')).toBe(body)
      expect(statSync(dest).size).toBe(cap)
    } finally {
      if (dest && existsSync(dest)) rmSync(dest, { force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('capped destination contains exactly the first maxSize bytes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'powershell-persist-head-'))
    const source = join(dir, 'roll.txt')
    const cap = 2048
    const head = 'A'.repeat(cap)
    const tail = 'B'.repeat(cap)
    writeFileSync(source, head + tail)
    let dest: string | undefined

    try {
      const persisted = await persistPowerShellOutputFile(source, 'powershell-persist-head-test', cap)
      expect(persisted).not.toBeNull()
      dest = persisted!.path
      expect(persisted!.truncated).toBe(true)
      const saved = readFileSync(dest, 'utf8')
      expect(saved.length).toBe(cap)
      expect(saved).toBe(head)
      expect(saved).not.toContain('B')
    } finally {
      if (dest && existsSync(dest)) rmSync(dest, { force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
