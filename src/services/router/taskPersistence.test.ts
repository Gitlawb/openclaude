import { expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TaskPersistence } from './taskPersistence.js'

let tempDir: string

beforeEach(() => { tempDir = mkdtempSync(join(tmpdir(), 'task-test-')) })
afterEach(() => { rmSync(tempDir, { recursive: true, force: true }) })

test('starts empty', () => {
  expect(new TaskPersistence(tempDir).getAllTasks()).toEqual([])
})

test('adds a task with auto id', () => {
  const tp = new TaskPersistence(tempDir)
  const task = tp.addTask('Build auth system')
  expect(task.id).toBeTruthy()
  expect(task.subject).toBe('Build auth system')
  expect(task.status).toBe('pending')
  expect(tp.getAllTasks().length).toBe(1)
})

test('completes a task with stats', () => {
  const tp = new TaskPersistence(tempDir)
  const task = tp.addTask('Write tests')
  const completed = tp.completeTask(task.id, 15000, 0.006, 'T1')
  expect(completed!.status).toBe('completed')
  expect(completed!.tokensUsed).toBe(15000)
  expect(completed!.cost).toBe(0.006)
  expect(completed!.tier).toBe('T1')
  expect(completed!.completedSession).toBeTruthy()
})

test('getPendingTasks filters correctly', () => {
  const tp = new TaskPersistence(tempDir)
  const t1 = tp.addTask('Task 1')
  const t2 = tp.addTask('Task 2')
  tp.completeTask(t1.id)
  expect(tp.getPendingTasks().length).toBe(1)
  expect(tp.getPendingTasks()[0]!.subject).toBe('Task 2')
})

test('persists across instances', () => {
  const tp1 = new TaskPersistence(tempDir)
  tp1.addTask('Persistent task')
  tp1.addTask('Another task')

  const tp2 = new TaskPersistence(tempDir)
  expect(tp2.getAllTasks().length).toBe(2)
  expect(tp2.getAllTasks()[0]!.subject).toBe('Persistent task')
})

test('archiveCompleted removes done tasks', () => {
  const tp = new TaskPersistence(tempDir)
  const t1 = tp.addTask('Done task')
  tp.addTask('Pending task')
  tp.completeTask(t1.id)
  const archived = tp.archiveCompleted()
  expect(archived).toBe(1)
  expect(tp.getAllTasks().length).toBe(1)
})

test('getTotalCost sums all task costs', () => {
  const tp = new TaskPersistence(tempDir)
  const t1 = tp.addTask('Task 1')
  const t2 = tp.addTask('Task 2')
  tp.completeTask(t1.id, 1000, 0.01)
  tp.completeTask(t2.id, 2000, 0.02)
  expect(tp.getTotalCost()).toBeCloseTo(0.03, 3)
})

test('toSummary produces readable output', () => {
  const tp = new TaskPersistence(tempDir)
  tp.addTask('Build feature')
  const t = tp.addTask('Write docs')
  tp.completeTask(t.id)
  const summary = tp.toSummary()
  expect(summary).toContain('1 done')
  expect(summary).toContain('1 remaining')
  expect(summary).toContain('Build feature')
})
