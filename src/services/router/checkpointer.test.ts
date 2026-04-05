import { expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Checkpointer } from './checkpointer.js'
import { DecisionLog } from './decisionLog.js'
import { TaskPersistence } from './taskPersistence.js'

let tempDir: string

beforeEach(() => { tempDir = mkdtempSync(join(tmpdir(), 'checkpoint-test-')) })
afterEach(() => { rmSync(tempDir, { recursive: true, force: true }) })

test('save creates a checkpoint file', () => {
  const cp = new Checkpointer(tempDir)
  const path = cp.save('test-session', null, null, null)
  expect(existsSync(path)).toBe(true)
})

test('checkpoint contains session info', () => {
  const cp = new Checkpointer(tempDir)
  const path = cp.save('my-session', null, null, null)
  const latest = cp.getLatestCheckpoint()
  expect(latest).not.toBeNull()
  expect(latest!.content).toContain('my-session')
  expect(latest!.content).toContain('Session Checkpoint')
})

test('checkpoint includes decisions', () => {
  const dl = new DecisionLog(tempDir)
  dl.addDecision({ title: 'Use JWT', choice: 'JWT auth', why: 'stateless', alternativesRejected: [], session: 's1' })
  const cp = new Checkpointer(tempDir)
  const path = cp.save('s1', null, dl, null)
  const latest = cp.getLatestCheckpoint()
  expect(latest!.content).toContain('Use JWT')
  expect(latest!.content).toContain('Decisions Made')
})

test('checkpoint includes tasks', () => {
  const tp = new TaskPersistence(tempDir)
  const t1 = tp.addTask('Build auth')
  tp.completeTask(t1.id, 1000, 0.01)
  tp.addTask('Write docs')
  const cp = new Checkpointer(tempDir)
  cp.save('s1', null, null, tp)
  const latest = cp.getLatestCheckpoint()
  expect(latest!.content).toContain('Build auth')
  expect(latest!.content).toContain('Write docs')
  expect(latest!.content).toContain('Work Completed')
  expect(latest!.content).toContain('Work Remaining')
})

test('listCheckpoints returns sorted list', () => {
  const cp = new Checkpointer(tempDir)
  cp.save('s1', null, null, null)
  cp.save('s2', null, null, null)
  const list = cp.listCheckpoints()
  expect(list.length).toBe(2)
})

test('getLatestCheckpoint returns most recent', () => {
  const cp = new Checkpointer(tempDir)
  cp.save('first', null, null, null)
  cp.save('second', null, null, null)
  const latest = cp.getLatestCheckpoint()
  expect(latest!.content).toContain('second')
})

test('getLatestCheckpoint returns null when empty', () => {
  const cp = new Checkpointer(tempDir)
  expect(cp.getLatestCheckpoint()).toBeNull()
})
