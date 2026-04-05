import { expect, test, beforeEach } from 'bun:test'
import { TieredRouter } from './tieredRouter.js'
import type { HealthStatus, Tier } from './types.js'

let router: TieredRouter

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-key'
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
  router = new TieredRouter()
})

test('routes exploration prompt to T0 with override', () => {
  const result = router.routeTask('Search for all auth files')
  expect(result.tier).toBe('T0')
  expect(result.override).not.toBeNull()
  expect(result.override!.model).toBe('qwen2.5:7b')
})

test('routes code gen to T1', () => {
  const result = router.routeTask('Create a new user registration component')
  expect(result.tier).toBe('T1')
  expect(result.override).not.toBeNull()
  expect(result.override!.model).toBe('deepseek-chat')
})

test('routes debugging to T2', () => {
  const result = router.routeTask('Debug this error in the login flow')
  expect(result.tier).toBe('T2')
  expect(result.override!.model).toBe('deepseek-reasoner')
})

test('routes architecture to T4 with null override', () => {
  const result = router.routeTask('Design the database architecture for the new system')
  expect(result.tier).toBe('T4')
  expect(result.override).toBeNull()
})

test('tier override works for one request', () => {
  router.setTierOverride('T3')
  const result1 = router.routeTask('Simple code task')
  expect(result1.tier).toBe('T3')
  const result2 = router.routeTask('Simple code task')
  expect(result2.tier).toBe('T1')
})

test('tier lock persists across requests', () => {
  router.setTierLock('T2')
  expect(router.routeTask('Any task').tier).toBe('T2')
  expect(router.routeTask('Another task').tier).toBe('T2')
  router.setTierLock(null)
  expect(router.routeTask('Search files').tier).toBe('T0')
})

test('speed gate skips offline T0', () => {
  router.updateHealth('T0', {
    endpoint: 'ollama', status: 'offline', latencyMs: 0, latencyPer1kTokens: 0,
    lastCheck: new Date().toISOString(), lastError: 'connection refused', modelLoaded: null, coldStart: false,
  })
  const result = router.routeTask('Search for files')
  expect(result.tier).toBe('T1')
})

test('regression data bumps tier', () => {
  router.updateRegressionData(new Map([['src/auth.ts', 5]]))
  const result = router.routeTask('Refactor the auth module', { targetFiles: ['src/auth.ts'] })
  expect(result.classification.escalations.some(e => e.includes('regression'))).toBe(true)
})

test('falls back gracefully on error', () => {
  const badRouter = new TieredRouter({ tiers: {} as any })
  const result = badRouter.routeTask('test')
  expect(result.tier).toBeDefined()
})
