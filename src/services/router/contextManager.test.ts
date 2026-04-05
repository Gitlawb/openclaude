import { expect, test, beforeEach } from 'bun:test'
import { ContextManager } from './contextManager.js'

let mgr: ContextManager

beforeEach(() => { mgr = new ContextManager() })

test('starts with zero tokens', () => {
  const status = mgr.getStatus()
  expect(status.currentTokens).toBe(0)
  expect(status.level).toBe('ok')
})

test('addTokens increments and returns status', () => {
  const status = mgr.addTokens(10000)
  expect(status.currentTokens).toBe(10000)
  expect(status.level).toBe('ok')
})

test('yellow warning at 60% of work budget', () => {
  mgr.addTokens(50000) // 50K / 80K = 62.5%
  const status = mgr.getStatus()
  expect(status.level).toBe('yellow')
})

test('orange warning at 80% of work budget', () => {
  mgr.addTokens(65000) // 65K / 80K = 81.25%
  expect(mgr.getStatus().level).toBe('orange')
})

test('red warning at 90% of work budget', () => {
  mgr.addTokens(73000) // 73K / 80K = 91.25%
  expect(mgr.getStatus().level).toBe('red')
})

test('getRemainingBudget accounts for reserve', () => {
  const remaining = mgr.getRemainingBudget()
  // 80K budget - 0 used - 10% reserve (8K) = 72K
  expect(remaining).toBe(72000)
  mgr.addTokens(30000)
  expect(mgr.getRemainingBudget()).toBe(42000)
})

test('canFitTask checks against remaining budget', () => {
  expect(mgr.canFitTask(50000)).toBe(true)
  expect(mgr.canFitTask(80000)).toBe(false)
  mgr.addTokens(60000)
  expect(mgr.canFitTask(20000)).toBe(false)
})

test('task token tracking works', () => {
  mgr.addTokens(10000)
  mgr.startTask()
  mgr.addTokens(5000)
  expect(mgr.getTaskTokens()).toBe(5000)
})

test('reset clears everything', () => {
  mgr.addTokens(50000)
  mgr.reset()
  expect(mgr.getStatus().currentTokens).toBe(0)
  expect(mgr.getStatus().level).toBe('ok')
})

test('formatStatusLine produces readable output', () => {
  mgr.addTokens(40000)
  const line = mgr.formatStatusLine()
  expect(line).toContain('CTX:')
  expect(line).toContain('40K')
  expect(line).toContain('80K')
})

test('setActiveTier changes budget', () => {
  mgr.setActiveTier('T0')
  const status = mgr.getStatus()
  expect(status.workBudget).toBe(8000)
})
