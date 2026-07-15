import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, readdirSync, mkdtempSync } from 'fs'
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
    const filesAfterFirst = existsSync(factsDir()) ? readdirSync(factsDir()) : []
    const matchingFirst = filesAfterFirst.filter(f => f.startsWith('fact-fact-b-fact-') && f.endsWith('.md'))
    expect(matchingFirst.length).toBe(1)

    // A second call must not error or double-migrate (per-project guard).
    getGlobalGraph()
    const filesAfterSecond = existsSync(factsDir()) ? readdirSync(factsDir()) : []
    const matchingSecond = filesAfterSecond.filter(f => f.startsWith('fact-fact-b-fact-') && f.endsWith('.md'))
    expect(matchingSecond.length).toBe(1)
  })

  it('regression: maps relation endpoints to new fact_* ids during migration and read-back', () => {
    writeLegacyJson({
      entities: {
        e1: { id: 'e1', type: 'endpoint', name: 'API Server', attributes: { url: 'https://api.example.com' } },
        e2: { id: 'e2', type: 'database', name: 'User DB', attributes: {} }
      },
      relations: [
        { sourceId: 'e1', targetId: 'e2', type: 'queries' }
      ]
    })
    const graph = getGlobalGraph()
    expect(graph.relations.length).toBe(1)
    const rel = graph.relations[0]
    expect(rel.sourceId).toStartWith('fact_fact-endpoint-api-server-')
    expect(rel.sourceId).toEndWith('.md')
    expect(rel.targetId).toStartWith('fact_fact-database-user-db-')
    expect(rel.targetId).toEndWith('.md')
  })

  it('regression: merges SQLite and JSON data symmetrically and retires both sources', () => {
    // Write JSON source
    writeLegacyJson({
      entities: {
        e1: { id: 'e1', type: 'endpoint', name: 'API Server', attributes: {} }
      },
      relations: []
    })
    // Write SQLite source with a different entity
    mkdirSync(projectRoot(), { recursive: true })
    const Database = require('bun:sqlite').Database
    const db = new Database(sqlitePath())
    db.run('CREATE TABLE entities (id TEXT PRIMARY KEY, type TEXT, name TEXT, attributes TEXT)')
    db.run('CREATE TABLE relations (source_id TEXT, target_id TEXT, type TEXT)')
    db.run('CREATE TABLE summaries (id TEXT PRIMARY KEY, content TEXT, keywords TEXT, timestamp INTEGER)')
    db.run('CREATE TABLE rules (content TEXT)')
    db.run('INSERT INTO entities VALUES ("e2", "database", "User DB", "{}")')
    db.close()

    // Run migration
    const graph = getGlobalGraph()

    // Assert both entities are present (symmetrically merged)
    const names = Object.values(graph.entities).map(e => e.name)
    expect(names).toContain('API Server')
    expect(names).toContain('User DB')

    // Both legacy source files should be retired
    expect(existsSync(legacyJsonPath())).toBe(false)
    expect(existsSync(sqlitePath())).toBe(false)
  })

  it('regression: generated entity files have correct frontmatter schema', () => {
    writeLegacyJson({
      entities: {
        e1: { id: 'e1', type: 'endpoint', name: 'API Server', attributes: { url: 'https://api.example.com' } }
      },
      relations: []
    })
    getGlobalGraph()
    const files = readdirSync(factsDir()).filter(f => f.startsWith('fact-endpoint-api-server-'))
    expect(files.length).toBe(1)
    const rawContent = readFileSync(join(factsDir(), files[0]), 'utf-8')
    expect(rawContent).toContain('type: reference')
    expect(rawContent).toContain('factType: "endpoint"')
    expect(rawContent).toContain('legacyId: "e1"')
    expect(rawContent).toContain('url: "https://api.example.com"')
    expect(rawContent).toContain('Auto-migrated from legacy store: **API Server**')
  })

  it('regression: generated rule and summary files have correct frontmatter schema', () => {
    writeLegacyJson({
      entities: {},
      relations: [],
      summaries: [
        { id: 's1', content: 'Legacy summary content', keywords: ['api', 'web'], timestamp: 12345 }
      ],
      rules: [
        'Always use TypeScript'
      ]
    })
    getGlobalGraph()

    // Check summary file
    const summaries = readdirSync(factsDir()).filter(f => f.startsWith('fact-summary-s1-'))
    expect(summaries.length).toBe(1)
    const sumContent = readFileSync(join(factsDir(), summaries[0]), 'utf-8')
    expect(sumContent).toContain('type: reference')
    expect(sumContent).toContain('factType: summary')
    expect(sumContent).toContain('keywords: "api, web"')
    expect(sumContent).toContain('Legacy summary content')

    // Check rule file
    const rules = readdirSync(factsDir()).filter(f => f.startsWith('fact-rule-always-use-typescript-'))
    expect(rules.length).toBe(1)
    const ruleContent = readFileSync(join(factsDir(), rules[0]), 'utf-8')
    expect(ruleContent).toContain('type: reference')
    expect(ruleContent).toContain('factType: rule')
    expect(ruleContent).toContain('Always use TypeScript')
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
