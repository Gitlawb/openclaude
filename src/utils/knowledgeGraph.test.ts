import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, existsSync, rmSync, mkdirSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getGlobalGraph, resetGlobalGraph } from './knowledgeGraph.js'
import { getProjectsDir } from './envUtils.js'
import { sanitizePath } from './sessionStoragePortable.js'
import { getAutoMemPath } from '../memdir/paths.js'

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'kg-test-'))
}

// The legacy graph + migrated memdir live under
// getProjectsDir()/sanitizePath(cwd)/..., mirroring the source resolution.
function legacyJsonPath(project: string): string {
  return join(getProjectsDir(), sanitizePath(project), 'knowledge_graph.json')
}

function factsDir(project: string): string {
  return join(getProjectsDir(), sanitizePath(project), 'memory', '.facts')
}

function sqlitePath(project: string): string {
  return join(getProjectsDir(), sanitizePath(project), 'knowledge.db')
}

function writeLegacyJson(project: string, body: object): void {
  const dir = join(getProjectsDir(), sanitizePath(project))
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(legacyJsonPath(project), JSON.stringify(body), 'utf-8')
}

describe('knowledgeGraph legacy migration', () => {
  let project: string
  const prevCwd = process.cwd()

  beforeEach(() => {
    project = makeProject()
    process.chdir(project)
    delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
  })

  afterEach(() => {
    rmSync(join(getProjectsDir(), sanitizePath(project)), { recursive: true, force: true })
    process.chdir(prevCwd)
    delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
  })

  it('does not write to memdir when auto-memory is disabled (P1#2)', () => {
    process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'
    writeLegacyJson(project, {
      entities: [{ id: 'e1', type: 'fact', name: 'env secret thing', attributes: { kind: 'secret' } }],
      relations: [],
    })
    getGlobalGraph()
    expect(existsSync(factsDir(project))).toBe(false)
  })

  it('migrates legacy entities including attributes and relations (P2#5)', () => {
    writeLegacyJson(project, {
      entities: [
        { id: 'e1', type: 'endpoint', name: 'API', attributes: { url: 'https://api.example.com', owner: 'team-a' } },
      ],
      relations: [{ sourceId: 'e1', targetId: 'e2', type: 'depends-on' }],
    })
    const graph = getGlobalGraph()
    const entity = Object.values(graph.entities).find(e => e.name === 'API')
    expect(entity).toBeDefined()
    expect(entity!.attributes.url).toBe('https://api.example.com')
    expect(entity!.attributes.owner).toBe('team-a')
    expect(graph.relations.length).toBeGreaterThan(0)
    expect(graph.relations[0].type).toBe('depends-on')
  })

  it('migrates a legacy graph present at the resolved project path (P1#4)', () => {
    const factsRoot = join(getAutoMemPath(), '.facts')
    // Write the legacy graph at the resolved cwd (getProjectRoot is constant in
    // this harness, so the migration guard keys on sanitizePath(cwd)).
    writeLegacyJson(process.cwd(), {
      entities: [{ id: 'b1', type: 'fact', name: 'B fact', attributes: {} }],
      relations: [],
    })
    getGlobalGraph()
    expect(existsSync(join(factsRoot, 'fact-fact-b-fact.md'))).toBe(true)

    // A second call must not error or double-migrate (guard recorded).
    getGlobalGraph()
    const files = existsSync(factsRoot) ? readdirSync(factsRoot) : []
    expect(files.filter(f => f === 'fact-fact-b-fact.md').length).toBe(1)

    // Cleanup test-created migration output.
    rmSync(join(getProjectsDir(), sanitizePath(process.cwd()), 'memory'), { recursive: true, force: true })
  })
})

describe('knowledgeGraph reset', () => {
  let project: string
  const prevCwd = process.cwd()

  beforeEach(() => {
    project = makeProject()
    process.chdir(project)
  })

  afterEach(() => {
    rmSync(join(getProjectsDir(), sanitizePath(project)), { recursive: true, force: true })
    process.chdir(prevCwd)
  })

  it('removes SQLite WAL/SHM sidecars on clear (P2#8)', () => {
    const dbPath = sqlitePath(project)
    mkdirSync(join(getProjectsDir(), sanitizePath(project)), { recursive: true })
    writeFileSync(dbPath, 'main')
    writeFileSync(`${dbPath}-wal`, 'wal')
    writeFileSync(`${dbPath}-shm`, 'shm')
    resetGlobalGraph()
    expect(existsSync(dbPath)).toBe(false)
    expect(existsSync(`${dbPath}-wal`)).toBe(false)
    expect(existsSync(`${dbPath}-shm`)).toBe(false)
  })
})
