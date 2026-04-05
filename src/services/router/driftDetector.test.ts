import { expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DriftDetector } from './driftDetector.js'
import { TaskPersistence } from './taskPersistence.js'

let tempDir: string
let detector: DriftDetector

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'drift-test-'))
  detector = new DriftDetector()
})
afterEach(() => { rmSync(tempDir, { recursive: true, force: true }) })

test('no drift when no tasks', () => {
  detector.recordFileAccess('src/random.ts')
  expect(detector.checkDrift().drifted).toBe(false)
})

test('no drift with few recent files', () => {
  const tp = new TaskPersistence(tempDir)
  tp.addTask('Build auth system')
  detector.setTaskPersistence(tp)
  detector.recordFileAccess('src/styles.css')
  expect(detector.checkDrift().drifted).toBe(false)
})

test('no drift when files relate to task', () => {
  const tp = new TaskPersistence(tempDir)
  tp.addTask('Build auth system')
  detector.setTaskPersistence(tp)
  for (const f of ['src/auth/login.ts', 'src/auth/middleware.ts', 'src/auth/types.ts', 'src/auth/index.ts', 'tests/auth.test.ts']) {
    detector.recordFileAccess(f)
  }
  expect(detector.checkDrift().drifted).toBe(false)
})

test('detects drift when files unrelated to any task', () => {
  const tp = new TaskPersistence(tempDir)
  tp.addTask('Build auth system')
  detector.setTaskPersistence(tp)
  for (const f of ['src/styles/theme.css', 'src/styles/layout.css', 'src/styles/colors.css', 'src/styles/fonts.css', 'src/styles/reset.css']) {
    detector.recordFileAccess(f)
  }
  const result = detector.checkDrift()
  expect(result.drifted).toBe(true)
  expect(result.reason).toBeTruthy()
})

test('reports active task', () => {
  const tp = new TaskPersistence(tempDir)
  const t = tp.addTask('Build auth system')
  tp.updateTask(t.id, { status: 'in_progress' })
  detector.setTaskPersistence(tp)
  const result = detector.checkDrift()
  expect(result.activeTask).toBe('Build auth system')
})

test('recordFileAccess maintains recent files list', () => {
  detector.recordFileAccess('a.ts')
  detector.recordFileAccess('b.ts')
  detector.recordFileAccess('c.ts')
  expect(detector.getRecentFiles()).toEqual(['a.ts', 'b.ts', 'c.ts'])
})

test('deduplicates file access', () => {
  detector.recordFileAccess('a.ts')
  detector.recordFileAccess('b.ts')
  detector.recordFileAccess('a.ts')
  expect(detector.getRecentFiles()).toEqual(['b.ts', 'a.ts'])
})

test('reset clears files', () => {
  detector.recordFileAccess('a.ts')
  detector.reset()
  expect(detector.getRecentFiles()).toEqual([])
})
