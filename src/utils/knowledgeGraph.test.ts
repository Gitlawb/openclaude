import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { writeFileSync, existsSync, rmSync, mkdirSync, readdirSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getGlobalGraph, resetGlobalGraph } from './knowledgeGraph.js'
import { getProjectsDir } from './envUtils.js'
import { sanitizePath } from './sessionStoragePortable.js'
import { getAutoMemPath } from '../memdir/paths.js'
import { getFsImplementation, setFsImplementation, setOriginalFsImplementation } from './fsOperations.js'
import { setGovernancePolicySettingsForSourceForTesting } from './governancePolicy.js'

// The legacy graph, SQLite store, and migrated memdir all resolve under
// getProjectsDir()/sanitizePath(cwd). We inject a distinct per-test cwd via
// setFsImplementation (NOT process.chdir, which would leak into other test
// files). Each test gets its own project key, so the process-lifetime
// migration guard does not collide across tests.
let projectCwd: string

function projectRoot(): string {
  return join(getProjectsDir(), sanitizePath(projectCwd))
}

function legacyJsonPath(): string {
  return join(projectRoot(), 'knowledge_graph.json')
}

function sqlitePath(): string {
  return join(projectRoot(), 'knowledge.db')
}

function factsDir(): string {
  return join(getAutoMemPath(), '.facts')
}

function writeLegacyJson(body: object): void {
  mkdirSync(projectRoot(), { recursive: true })
  writeFileSync(legacyJsonPath(), JSON.stringify(body), 'utf-8')
}

function removeProjectArtifacts(): void {
  for (const f of ['knowledge_graph.json', 'knowledge_graph.json.backup', 'knowledge.db', 'knowledge.db-wal', 'knowledge.db-shm']) {
    rmSync(join(projectRoot(), f), { force: true })
  }
  // Clean migrated facts/relations out of the shared resolved memdir.
  const fd = factsDir()
  if (existsSync(fd)) {
    for (const f of readdirSync(fd)) {
      if (f.startsWith('fact-')) rmSync(join(fd, f), { force: true })
    }
  }
}

describe('knowledgeGraph legacy migration', () => {
  beforeEach(() => {
    projectCwd = mkdtempSync(join(tmpdir(), 'kg-test-'))
    setFsImplementation({ ...getFsImplementation(), cwd: () => projectCwd })
    removeProjectArtifacts()
    delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
    setGovernancePolicySettingsForSourceForTesting(() => ({
      memory: { requireApprovalBeforeWrite: false },
    }))
  })

  afterEach(() => {
    removeProjectArtifacts()
    setOriginalFsImplementation()
    delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
    setGovernancePolicySettingsForSourceForTesting(null)
  })

  it('does not write to memdir when auto-memory is disabled (P1#2)', () => {
    process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'
    writeLegacyJson({
      entities: [{ id: 'e1', type: 'fact', name: 'env secret thing', attributes: { kind: 'secret' } }],
      relations: [],
    })
    getGlobalGraph()
    // Migration must be gated: the legacy graph is left untouched (no backup
    // created, file still present) and nothing is written for this project.
    expect(existsSync(legacyJsonPath())).toBe(true)
    const backups = readdirSync(projectRoot()).filter(f => f.includes('.backup'))
    expect(backups.length).toBe(0)
  })

  it('migrates legacy entities including attributes and relations (P2#5)', () => {
    writeLegacyJson({
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

  it('migrates once and is idempotent on repeat calls (P1#4)', () => {
    writeLegacyJson({
      entities: [{ id: 'b1', type: 'fact', name: 'B fact', attributes: {} }],
      relations: [],
    })
    getGlobalGraph()
    expect(existsSync(join(factsDir(), 'fact-fact-b-fact.md'))).toBe(true)

    // A second call must not error or double-migrate (per-project guard).
    getGlobalGraph()
    const files = existsSync(factsDir()) ? readdirSync(factsDir()) : []
    expect(files.filter(f => f === 'fact-fact-b-fact.md').length).toBe(1)
  })
})

describe('knowledgeGraph reset', () => {
  beforeEach(() => {
    projectCwd = mkdtempSync(join(tmpdir(), 'kg-test-'))
    setFsImplementation({ ...getFsImplementation(), cwd: () => projectCwd })
    removeProjectArtifacts()
  })

  afterEach(() => {
    removeProjectArtifacts()
    setOriginalFsImplementation()
  })

  it('removes SQLite WAL/SHM sidecars on clear (P2#8)', () => {
    mkdirSync(projectRoot(), { recursive: true })
    writeFileSync(sqlitePath(), 'main')
    writeFileSync(`${sqlitePath()}-wal`, 'wal')
    writeFileSync(`${sqlitePath()}-shm`, 'shm')
    resetGlobalGraph()
    expect(existsSync(sqlitePath())).toBe(false)
    expect(existsSync(`${sqlitePath()}-wal`)).toBe(false)
    expect(existsSync(`${sqlitePath()}-shm`)).toBe(false)
  })
})
