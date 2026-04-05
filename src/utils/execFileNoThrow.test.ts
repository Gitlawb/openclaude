import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileNoThrowWithCwd } from './execFileNoThrow.js'

test('execFileNoThrowWithCwd rejects shell-like executable names', async () => {
  const result = await execFileNoThrowWithCwd('openlawb && whoami', [])

  expect(result.code).toBe(1)
  expect(result.error).toContain('Unsafe executable')
})

test('execFileNoThrowWithCwd rejects cwd values with control characters', async () => {
  const result = await execFileNoThrowWithCwd(process.execPath, ['--version'], {
    cwd: 'C:\\repo\nmalicious',
  })

  expect(result.code).toBe(1)
  expect(result.error).toContain('Unsafe working directory')
})

test('execFileNoThrowWithCwd rejects arguments with control characters', async () => {
  const result = await execFileNoThrowWithCwd(process.execPath, [
    '--version\nmalicious',
  ])

  expect(result.code).toBe(1)
  expect(result.error).toContain('Unsafe argument')
})

test('execFileNoThrowWithCwd rejects environment entries with control characters', async () => {
  const result = await execFileNoThrowWithCwd(process.execPath, ['--version'], {
    env: {
      ...process.env,
      BAD_ENV: 'line1\nline2',
    },
  })

  expect(result.code).toBe(1)
  expect(result.error).toContain('Unsafe environment')
})

test('execFileNoThrowWithCwd preserves Windows .cmd compatibility', async () => {
  if (process.platform !== 'win32') {
    return
  }

  const dir = mkdtempSync(join(tmpdir(), 'openlawb-execfile-'))
  const file = join(dir, 'hello.cmd')
  writeFileSync(file, '@echo off\r\necho hello\r\n')

  const result = await execFileNoThrowWithCwd(file, [])

  expect(result.code).toBe(0)
  expect(result.stdout).toContain('hello')
})
