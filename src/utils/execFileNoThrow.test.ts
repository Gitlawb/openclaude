import { expect, test } from 'bun:test'
import { execFileNoThrowWithCwd } from './execFileNoThrow.js'

test('execFileNoThrowWithCwd rejects shell-like executable names', async () => {
  const result = await execFileNoThrowWithCwd('openclaude && whoami', [])

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
  const result = await execFileNoThrowWithCwd(process.execPath, ['--version\nmalicious'])

  expect(result.code).toBe(1)
  expect(result.error).toContain('Unsafe argument')
})
