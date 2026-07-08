import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readFileInRange } from './readFileInRange.js'

const createdDirs: string[] = []

function writeTemp(name: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'openclaude-readrange-'))
  createdDirs.push(dir)
  const path = join(dir, name)
  writeFileSync(path, contents)
  return path
}

afterEach(() => {
  while (createdDirs.length > 0) {
    rmSync(createdDirs.pop()!, { recursive: true, force: true })
  }
})

describe('readFileInRange', () => {
  test('reports zero lines for an empty file', async () => {
    const path = writeTemp('empty.txt', '')
    const result = await readFileInRange(path, 0)
    expect(result.content).toBe('')
    expect(result.lineCount).toBe(0)
    // Regression: an empty file must report totalLines === 0 so the
    // FileReadTool empty-file branch (keyed on totalLines === 0) is reachable.
    // Before the fix the final-fragment block pushed a phantom line -> 1.
    expect(result.totalLines).toBe(0)
    expect(result.totalBytes).toBe(0)
    expect(result.readBytes).toBe(0)
  })

  test('single line without trailing newline is one line', async () => {
    const path = writeTemp('one.txt', 'hello')
    const result = await readFileInRange(path, 0)
    expect(result.content).toBe('hello')
    expect(result.lineCount).toBe(1)
    expect(result.totalLines).toBe(1)
  })

  test('two lines without trailing newline are two lines', async () => {
    const path = writeTemp('two.txt', 'a\nb')
    const result = await readFileInRange(path, 0)
    expect(result.totalLines).toBe(2)
    expect(result.content).toBe('a\nb')
  })
})
