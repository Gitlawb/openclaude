import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  initializeState,
  readState,
  readStateRaw,
  updateCurrentWork,
  clearCurrentWork,
  appendDecision,
  appendBlocker,
  removeBlocker,
  appendLesson,
  appendTodo,
  appendDeferredIdea,
} from './state.js'

let tempDir: string
let vaultPath: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'vault-state-test-'))
  vaultPath = join(tempDir, '.bridgeai', 'vault')
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('initializeState', () => {
  test('creates STATE.md with all section headers', () => {
    initializeState(vaultPath)
    const raw = readStateRaw(vaultPath)
    expect(raw).not.toBeNull()
    expect(raw).toContain('# Project State')
    expect(raw).toContain('**Last Updated:**')
    expect(raw).toContain('**Current Work:** None')
    expect(raw).toContain('## Recent Decisions')
    expect(raw).toContain('## Active Blockers')
    expect(raw).toContain('## Lessons Learned')
    expect(raw).toContain('## Todos')
    expect(raw).toContain('## Deferred Ideas')
  })
})

describe('readState', () => {
  test('parses empty state correctly', () => {
    initializeState(vaultPath)
    const state = readState(vaultPath)
    expect(state).not.toBeNull()
    expect(state!.currentWork).toBe('None')
    expect(state!.decisions).toEqual([])
    expect(state!.blockers).toEqual([])
    expect(state!.lessons).toEqual([])
    expect(state!.todos).toEqual([])
    expect(state!.deferredIdeas).toEqual([])
    expect(state!.lastUpdated).toBeTruthy()
  })

  test('returns null for non-existent file', () => {
    const result = readState(join(tempDir, 'nonexistent'))
    expect(result).toBeNull()
  })
})

describe('readStateRaw', () => {
  test('returns raw content string', () => {
    initializeState(vaultPath)
    const raw = readStateRaw(vaultPath)
    expect(typeof raw).toBe('string')
    expect(raw!.length).toBeGreaterThan(0)
  })

  test('returns null for non-existent file', () => {
    const result = readStateRaw(join(tempDir, 'nonexistent'))
    expect(result).toBeNull()
  })
})

describe('updateCurrentWork', () => {
  test('changes current work and updates timestamp', () => {
    initializeState(vaultPath)
    updateCurrentWork(vaultPath, 'Implementing auth module')
    const after = readState(vaultPath)!
    expect(after.currentWork).toBe('Implementing auth module')
    // Verify timestamp is a valid ISO date string
    expect(after.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe('clearCurrentWork', () => {
  test('sets current work to "None"', () => {
    initializeState(vaultPath)
    updateCurrentWork(vaultPath, 'Something in progress')
    clearCurrentWork(vaultPath)
    const state = readState(vaultPath)!
    expect(state.currentWork).toBe('None')
  })
})

describe('appendDecision', () => {
  test('adds decision with date', () => {
    initializeState(vaultPath)
    appendDecision(vaultPath, {
      title: 'Use Bun over Node',
      context: 'Need faster test runner',
      tradeoffs: 'Less ecosystem support',
    })
    const state = readState(vaultPath)!
    expect(state.decisions).toHaveLength(1)
    expect(state.decisions[0].title).toBe('Use Bun over Node')
    expect(state.decisions[0].context).toBe('Need faster test runner')
    expect(state.decisions[0].tradeoffs).toBe('Less ecosystem support')
    expect(state.decisions[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('appendBlocker / removeBlocker', () => {
  test('adds blocker and removes it by id', () => {
    initializeState(vaultPath)
    appendBlocker(vaultPath, {
      id: 'BLK-01',
      description: 'API key not configured',
    })
    let state = readState(vaultPath)!
    expect(state.blockers).toHaveLength(1)
    expect(state.blockers[0].id).toBe('BLK-01')
    expect(state.blockers[0].description).toBe('API key not configured')

    removeBlocker(vaultPath, 'BLK-01')
    state = readState(vaultPath)!
    expect(state.blockers).toHaveLength(0)
  })
})

describe('appendLesson', () => {
  test('adds lesson entry', () => {
    initializeState(vaultPath)
    appendLesson(vaultPath, {
      context: 'Setting up CI',
      problem: 'Tests flaky on GitHub Actions',
      solution: 'Added retry logic and increased timeout',
    })
    const state = readState(vaultPath)!
    expect(state.lessons).toHaveLength(1)
    expect(state.lessons[0].context).toBe('Setting up CI')
    expect(state.lessons[0].problem).toBe('Tests flaky on GitHub Actions')
    expect(state.lessons[0].solution).toBe(
      'Added retry logic and increased timeout',
    )
    expect(state.lessons[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('appendTodo', () => {
  test('adds todo item', () => {
    initializeState(vaultPath)
    appendTodo(vaultPath, 'Write integration tests')
    const state = readState(vaultPath)!
    expect(state.todos).toHaveLength(1)
    expect(state.todos[0].done).toBe(false)
    expect(state.todos[0].text).toBe('Write integration tests')
  })
})

describe('appendDeferredIdea', () => {
  test('adds idea', () => {
    initializeState(vaultPath)
    appendDeferredIdea(vaultPath, 'Support YAML vault format')
    const state = readState(vaultPath)!
    expect(state.deferredIdeas).toHaveLength(1)
    expect(state.deferredIdeas[0].text).toBe('Support YAML vault format')
  })
})

describe('round-trip', () => {
  test('initialize, append multiple items, readState verifies all present', () => {
    initializeState(vaultPath)

    updateCurrentWork(vaultPath, 'Building vault state manager')

    appendDecision(vaultPath, {
      title: 'Markdown over JSON for state',
      context: 'Human readability matters',
      tradeoffs: 'Parsing complexity',
    })
    appendDecision(vaultPath, {
      title: 'Flat file over DB',
      context: 'Simplicity for MVP',
      tradeoffs: 'No concurrent writes',
    })

    appendBlocker(vaultPath, {
      id: 'BLK-01',
      description: 'Need vault path resolution',
    })
    appendBlocker(vaultPath, {
      id: 'BLK-02',
      description: 'Manifest format undecided',
    })

    appendLesson(vaultPath, {
      context: 'File parsing',
      problem: 'Regex too fragile',
      solution: 'Split by section headers instead',
    })

    appendTodo(vaultPath, 'Add validation')
    appendTodo(vaultPath, 'Add error handling')

    appendDeferredIdea(vaultPath, 'Plugin system for vault providers')
    appendDeferredIdea(vaultPath, 'Auto-sync to cloud')

    // Remove one blocker
    removeBlocker(vaultPath, 'BLK-01')

    const state = readState(vaultPath)!

    expect(state.currentWork).toBe('Building vault state manager')
    expect(state.decisions).toHaveLength(2)
    expect(state.decisions[0].title).toBe('Markdown over JSON for state')
    expect(state.decisions[1].title).toBe('Flat file over DB')
    expect(state.blockers).toHaveLength(1)
    expect(state.blockers[0].id).toBe('BLK-02')
    expect(state.lessons).toHaveLength(1)
    expect(state.todos).toHaveLength(2)
    expect(state.todos[0].text).toBe('Add validation')
    expect(state.todos[1].text).toBe('Add error handling')
    expect(state.deferredIdeas).toHaveLength(2)
    expect(state.deferredIdeas[0].text).toBe(
      'Plugin system for vault providers',
    )
    expect(state.deferredIdeas[1].text).toBe('Auto-sync to cloud')
  })
})
