import { afterEach, describe, expect, it } from 'bun:test'
import { join } from 'path'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { JSONProvider } from './JSONProvider.js'

const tempDirs: string[] = []

const emptyGraph = {
  entities: {},
  relations: [],
  summaries: [],
  rules: [],
  lastUpdateTime: 1,
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (!dir) continue
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('JSONProvider', () => {
  it('reports save failure when the graph path cannot be written', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'openclaude-json-provider-'))
    tempDirs.push(projectDir)
    mkdirSync(join(projectDir, 'knowledge_graph.json'))

    const provider = new JSONProvider(projectDir)
    expect(provider.saveGraph(emptyGraph)).toBe(false)
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
