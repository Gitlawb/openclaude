import { describe, expect, test } from 'bun:test'
import type { Dirent } from 'fs'
import { join, relative, sep } from 'path'
import { PathTraversalError } from '../../memdir/teamMemPaths.js'
import { __test } from './index.js'

function deferred(): {
  promise: Promise<void>
  resolve: () => void
} {
  let resolve!: () => void
  const promise = new Promise<void>(res => {
    resolve = res
  })
  return { promise, resolve }
}

async function waitFor(
  condition: () => boolean,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 1000
  while (Date.now() < deadline) {
    if (condition()) return
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  throw new Error(message)
}

type FakeDirent = Pick<Dirent, 'name' | 'isDirectory' | 'isFile'>

function file(name: string): FakeDirent {
  return {
    name,
    isDirectory: () => false,
    isFile: () => true,
  }
}

describe('team memory local read perf contracts', () => {
  test('bounds concurrent file reads while preserving sorted output keys', async () => {
    const root = `/tmp/team-memory-${Date.now()}`
    const gate = deferred()
    let activeReads = 0
    let maxActiveReads = 0

    const deps = {
      getTeamMemPath: () => root + sep,
      readdir: async (path: string) => {
        if (path === root + sep) {
          return Array.from(
            { length: __test.TEAM_MEMORY_FILE_IO_CONCURRENCY * 3 },
            (_, i) => file(`file-${String(i).padStart(2, '0')}.md`),
          )
        }
        return []
      },
      stat: async () => ({ size: 10 }),
      readFile: async (path: string) => {
        activeReads++
        maxActiveReads = Math.max(maxActiveReads, activeReads)
        await gate.promise
        activeReads--
        return relative(root, path)
      },
      scanForSecrets: () => [],
    }

    const promise = __test.readLocalTeamMemoryWithDependencies(null, deps)
    await waitFor(
      () => activeReads >= __test.TEAM_MEMORY_FILE_IO_CONCURRENCY,
      'expected first bounded read batch to start',
    )

    expect(maxActiveReads).toBeLessThanOrEqual(
      __test.TEAM_MEMORY_FILE_IO_CONCURRENCY,
    )
    gate.resolve()

    const result = await promise
    expect(Object.keys(result.entries)).toEqual(
      Object.keys(result.entries).sort(),
    )
  })

  test('keeps learned-cap truncation deterministic after secret filtering', async () => {
    const root = `/tmp/team-memory-${Date.now()}`
    const deps = {
      getTeamMemPath: () => root + sep,
      readdir: async () => [
        file('a.md'),
        file('b-secret.md'),
        file('c.md'),
        file('d.md'),
      ],
      stat: async () => ({ size: 10 }),
      readFile: async (path: string) => path,
      scanForSecrets: (content: string) =>
        content.endsWith('b-secret.md')
          ? [{ ruleId: 'github-pat', label: 'Github Pat' }]
          : [],
    }

    const result = await __test.readLocalTeamMemoryWithDependencies(2, deps)

    expect(Object.keys(result.entries)).toEqual(['a.md', 'c.md'])
    expect(result.skippedSecrets).toEqual([
      { path: 'b-secret.md', ruleId: 'github-pat', label: 'Github Pat' },
    ])
  })
})

describe('team memory remote write perf contracts', () => {
  test('bounds concurrent remote writes', async () => {
    const root = `/tmp/team-memory-${Date.now()}`
    const gate = deferred()
    let activeWrites = 0
    let maxActiveWrites = 0

    const deps = {
      validateTeamMemKey: async (relPath: string) => join(root, relPath),
      readFile: async () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      },
      mkdir: async () => {},
      writeFile: async () => {
        activeWrites++
        maxActiveWrites = Math.max(maxActiveWrites, activeWrites)
        await gate.promise
        activeWrites--
      },
    }

    const entries = Object.fromEntries(
      Array.from(
        { length: __test.TEAM_MEMORY_FILE_IO_CONCURRENCY * 3 },
        (_, i) => [`file-${i}.md`, `content-${i}`],
      ),
    )

    const promise = __test.writeRemoteEntriesToLocalWithDependencies(
      entries,
      deps,
    )
    await waitFor(
      () => activeWrites >= __test.TEAM_MEMORY_FILE_IO_CONCURRENCY,
      'expected first bounded write batch to start',
    )

    expect(maxActiveWrites).toBeLessThanOrEqual(
      __test.TEAM_MEMORY_FILE_IO_CONCURRENCY,
    )
    gate.resolve()
    await expect(promise).resolves.toBe(Object.keys(entries).length)
  })

  test('still skips path traversal entries', async () => {
    const deps = {
      validateTeamMemKey: async () => {
        throw new PathTraversalError('bad path')
      },
      readFile: async () => '',
      mkdir: async () => {},
      writeFile: async () => {},
    }

    const written = await __test.writeRemoteEntriesToLocalWithDependencies(
      { '../bad.md': 'bad' },
      deps,
    )

    expect(written).toBe(0)
  })
})
