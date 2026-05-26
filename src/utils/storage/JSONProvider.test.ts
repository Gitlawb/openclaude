import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { join } from 'path'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { JSONProvider } from './JSONProvider.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'

const tempDirs: string[] = []

const emptyGraph = {
  entities: {},
  relations: [],
  summaries: [],
  rules: [],
  lastUpdateTime: 1,
}

function captureConsoleError<T>(run: () => T): { result: T; calls: unknown[][] } {
  const originalConsoleError = console.error
  const calls: unknown[][] = []
  console.error = (...args: unknown[]) => {
    calls.push(args)
  }

  try {
    return {
      result: run(),
      calls,
    }
  } finally {
    console.error = originalConsoleError
  }
}

beforeEach(async () => {
  await acquireSharedMutationLock('utils/storage/JSONProvider.test.ts')
})

afterEach(() => {
  try {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()
      if (!dir) continue
      rmSync(dir, { recursive: true, force: true })
    }
  } finally {
    releaseSharedMutationLock()
  }
})

describe('JSONProvider', () => {
  it('reports save failure when the graph path cannot be written', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'openclaude-json-provider-'))
    tempDirs.push(projectDir)
    mkdirSync(join(projectDir, 'knowledge_graph.json'))

    const provider = new JSONProvider(projectDir)
    const { result, calls } = captureConsoleError(() =>
      provider.saveGraph(emptyGraph),
    )

    expect(result).toBe(false)
    expect(calls).toHaveLength(1)
    expect(String(calls[0][0])).toContain('Failed to save project graph to JSON')
  })

  it('reports delete failure when the graph path is a directory', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'openclaude-json-provider-'))
    tempDirs.push(projectDir)
    mkdirSync(join(projectDir, 'knowledge_graph.json'))

    const provider = new JSONProvider(projectDir)
    expect(provider.delete()).toBe(false)
  })

  it('reports delete success when the graph file is removed', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'openclaude-json-provider-'))
    tempDirs.push(projectDir)
    writeFileSync(join(projectDir, 'knowledge_graph.json'), '{}', 'utf8')

    const provider = new JSONProvider(projectDir)
    expect(provider.delete()).toBe(true)
  })
})
