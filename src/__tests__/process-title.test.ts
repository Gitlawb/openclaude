import { describe, test, expect } from 'bun:test'
import { resolve } from 'path'

const SRC = resolve(import.meta.dir, '..')
const file = (relative: string) => Bun.file(resolve(SRC, relative))

describe('process.title', () => {
  test('should be set to openclaude in main.tsx', async () => {
    const mainSource = await file('main.tsx').text()
    expect(mainSource).toContain("process.title = 'openclaude'")
    expect(mainSource).not.toContain("process.title = 'claude'")
  })
})
