import { describe, expect, it, beforeEach, afterEach, afterAll } from 'bun:test'
import {
  addGlobalEntity,
  resetGlobalGraph,
  clearMemoryOnly,
  getGlobalGraph,
  initOrama
} from '../knowledgeGraph.js'
import { mkdtempSync, rmSync, existsSync, renameSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { acquireEnvMutex, releaseEnvMutex } from '../../entrypoints/sdk/shared.js'
import { getProjectsDir, setClaudeConfigHomeDirForTesting } from '../envUtils.js'
import { getFsImplementation, setFsImplementation } from '../fsOperations.js'
import { sanitizePath } from '../sessionStoragePortable.js'
import { SQLiteProvider } from './SQLiteProvider.js'

describe('SQLite Storage Layer', () => {
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  const originalCwd = process.cwd()
  const originalFs = getFsImplementation()
  const configDir = mkdtempSync(join(tmpdir(), 'openclaude-sqlite-'))
  let workspaceDir = ''
  const removeDirWithRetry = (dir: string) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        rmSync(dir, { recursive: true, force: true })
        return
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EBUSY' && code !== 'EPERM') {
          throw error
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * (attempt + 1))
      }
    }

    try {
      rmSync(dir, { recursive: true, force: true })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EBUSY' && code !== 'EPERM') {
        throw error
      }
    }
  }

  const removeFileWithRetry = (filePath: string) => {
    const renamedPath = `${filePath}.deleted`

    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        rmSync(filePath, { force: true })
        if (!existsSync(filePath)) {
          return
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EBUSY' && code !== 'EPERM') {
          throw error
        }
      }

      try {
        if (existsSync(filePath)) {
          renameSync(filePath, renamedPath)
          return
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOENT') {
          throw error
        }
      }

      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1))
    }

    if (existsSync(filePath)) {
      throw new Error(`Timed out removing locked SQLite file: ${filePath}`)
    }
  }

  beforeEach(async () => {
    await acquireEnvMutex()
    workspaceDir = mkdtempSync(join(tmpdir(), 'openclaude-sqlite-cwd-'))
    process.chdir(workspaceDir)
    setFsImplementation({
      ...originalFs,
      cwd: () => workspaceDir,
    })
    process.env.CLAUDE_CONFIG_DIR = configDir
    setClaudeConfigHomeDirForTesting(configDir)
    resetGlobalGraph()
  })

  afterEach(() => {
    try {
      resetGlobalGraph()
      clearMemoryOnly()
      if (originalConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = originalConfigDir
      }
      process.chdir(originalCwd)
      setFsImplementation(originalFs)
      setClaudeConfigHomeDirForTesting(undefined)
      if (workspaceDir) {
        removeDirWithRetry(workspaceDir)
        workspaceDir = ''
      }
    } finally {
      releaseEnvMutex()
    }
  })

  afterAll(() => {
    removeDirWithRetry(configDir)
  })

  it('persists data in SQLite database', async () => {
    const sqlitePath = join(getProjectsDir(), sanitizePath(workspaceDir), 'knowledge.db')
    
    // 1. Add data
    await addGlobalEntity('tool', 'sqlite-test', { status: 'durable' })
    expect(existsSync(sqlitePath)).toBe(true)

    // 2. Simulate process restart (clear memory cache)
    clearMemoryOnly()

    // 3. Load should come from SQLite (hydrated by JSON)
    const graph = getGlobalGraph()
    const entity = Object.values(graph.entities).find(e => e.name === 'sqlite-test')
    expect(entity).toBeDefined()
    expect(entity?.attributes.status).toBe('durable')
  })

  it('self-heals SQLite from JSON if DB is deleted', async () => {
    const sqlitePath = join(getProjectsDir(), sanitizePath(workspaceDir), 'knowledge.db')
    const jsonPath = join(getProjectsDir(), sanitizePath(workspaceDir), 'knowledge_graph.json')

    // 1. Add data to both
    await addGlobalEntity('tool', 'self-heal-test', { val: 'safe' })
    expect(existsSync(sqlitePath)).toBe(true)
    expect(existsSync(jsonPath)).toBe(true)

    // 2. Delete SQLite DB but keep JSON
    clearMemoryOnly()
    removeFileWithRetry(sqlitePath)
    expect(existsSync(sqlitePath)).toBe(false)

    // 3. Requesting the graph should trigger hydration from JSON into a NEW SQLite DB
    // In the async architecture, we must await initialization to trigger the rebuild.
    await initOrama(workspaceDir)
    const graph = getGlobalGraph()
    const entity = Object.values(graph.entities).find(e => e.name === 'self-heal-test')
    expect(entity).toBeDefined()
    expect(entity?.attributes.val).toBe('safe')
    
    // 4. Verify SQLite was recreated
    expect(existsSync(sqlitePath)).toBe(true)
  })

  it('handles large transactions (Stress Test)', async () => {
    const count = 100
    
    // Add 100 entities sequentially (mutation queue)
    for (let i = 0; i < count; i++) {
      await addGlobalEntity('bulk', `item_${i}`, { index: String(i) })
    }

    clearMemoryOnly()
    const graph = getGlobalGraph()
    expect(Object.keys(graph.entities).length).toBe(count)
  })

  it('clears a closed on-disk database without an existing provider handle', async () => {
    const projectDir = join(getProjectsDir(), sanitizePath(workspaceDir))
    const sqlitePath = join(projectDir, 'knowledge.db')

    await addGlobalEntity('tool', 'closed-handle-test', { status: 'persisted' })
    expect(existsSync(sqlitePath)).toBe(true)

    clearMemoryOnly()

    const closedProvider = new SQLiteProvider(projectDir)
    expect(closedProvider.clear()).toBe(true)

    await closedProvider.init()
    expect(closedProvider.loadGraph()).toBeNull()
    closedProvider.close()
  })
})
