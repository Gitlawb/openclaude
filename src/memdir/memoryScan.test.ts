import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { scanMemoryFiles } from './memoryScan.ts'

// Finding #42-3: readdir({ recursive: true }) has no depth limit.
// A deeply nested directory in the memory dir causes a full unbounded walk.

let tempDir: string

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('scanMemoryFiles finds .md files at shallow depth', async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'memoryScan-'))
  await writeFile(join(tempDir, 'note.md'), '---\nname: test\ntype: user\n---\nContent')

  const controller = new AbortController()
  const result = await scanMemoryFiles(tempDir, controller.signal)

  expect(result.length).toBe(1)
  expect(result[0].filename).toBe('note.md')
})

test('scanMemoryFiles ignores MEMORY.md', async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'memoryScan-'))
  await writeFile(join(tempDir, 'MEMORY.md'), '# index')
  await writeFile(join(tempDir, 'user_role.md'), '---\nname: role\ntype: user\n---\nContent')

  const controller = new AbortController()
  const result = await scanMemoryFiles(tempDir, controller.signal)

  expect(result.length).toBe(1)
  expect(result[0].filename).toBe('user_role.md')
})

test('scanMemoryFiles does not return .md files nested beyond max depth', async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'memoryScan-'))

  // Shallow file - should be found
  await writeFile(join(tempDir, 'shallow.md'), '---\nname: shallow\ntype: user\n---\nContent')

  // Deeply nested file (depth 5) - should be excluded
  const deepDir = join(tempDir, 'd1', 'd2', 'd3', 'd4', 'd5')
  await mkdir(deepDir, { recursive: true })
  await writeFile(join(deepDir, 'deep.md'), '---\nname: deep\ntype: user\n---\nContent')

  const controller = new AbortController()
  const result = await scanMemoryFiles(tempDir, controller.signal)

  const filenames = result.map(r => r.filename)
  expect(filenames).toContain('shallow.md')
  // The deeply nested file must not appear
  expect(filenames.some(f => f.includes('deep.md'))).toBe(false)
})
