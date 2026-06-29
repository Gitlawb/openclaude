import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  initMemdirIndex,
  searchMemdirIndex,
  rebuildIndex,
  clearIndex,
  getIndexPath,
} from './vectorIndex.js'

describe('memdir vectorIndex', () => {
  let memDir: string

  beforeEach(() => {
    memDir = mkdtempSync(join(tmpdir(), 'vector-index-test-'))
    clearIndex()
  })

  afterEach(() => {
    clearIndex()
    rmSync(memDir, { recursive: true, force: true })
  })

  function writeMem(filename: string, title: string, type: string, description: string, body: string) {
    const content = `---
title: ${title}
type: ${type}
description: ${description}
---

${body}`
    writeFileSync(join(memDir, filename), content, 'utf-8')
  }

  it('builds index from memory files', async () => {
    writeMem('user-role.md', 'Data Scientist', 'user', 'Role info', 'User is a data scientist')
    writeMem('reference-pg.md', 'PostgreSQL Config', 'reference', 'DB setup', 'Database runs on port 5432')

    await initMemdirIndex(memDir)

    const results = await searchMemdirIndex('database', memDir)
    expect(results.length).toBeGreaterThan(0)
    expect(results.some(r => r.title.includes('PostgreSQL'))).toBe(true)
  })

  it('finds nothing on empty memory dir', async () => {
    await initMemdirIndex(memDir)
    const results = await searchMemdirIndex('anything', memDir)
    expect(results.length).toBe(0)
  })

  it('searches by description', async () => {
    writeMem('feedback-test.md', 'Testing approach', 'feedback', 'prefer integration tests', 'Always use real DB')
    await initMemdirIndex(memDir)
    const results = await searchMemdirIndex('integration', memDir)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].description).toContain('integration')
  })

  it('rebuilds index after new files', async () => {
    writeMem('project-goal.md', 'Migration', 'project', 'Upgrade to v3', 'Migrate from v2 to v3')
    await initMemdirIndex(memDir)

    const before = await searchMemdirIndex('v3', memDir)
    expect(before.length).toBeGreaterThan(0)

    writeMem('reference-auth.md', 'Auth Config', 'reference', 'OAuth2 setup', 'Using OAuth2 with JWT')
    await rebuildIndex(memDir)

    const after = await searchMemdirIndex('OAuth2', memDir)
    expect(after.length).toBeGreaterThan(0)
  })

  it('index path returns correct location', () => {
    const indexPath = getIndexPath(memDir)
    expect(indexPath).toBe(join(memDir, '.vector-index'))
  })

  it('persists index between inits', async () => {
    writeMem('user-pref.md', 'Theme', 'user', 'Dark mode', 'Prefers dark theme')
    await initMemdirIndex(memDir)

    const r1 = await searchMemdirIndex('dark', memDir)
    expect(r1.length).toBeGreaterThan(0)

    clearIndex()
    const r2 = await searchMemdirIndex('dark', memDir)
    expect(r2.length).toBeGreaterThan(0)
  })
})
