import { describe, expect, test } from 'bun:test'
import { TestRunnerTool } from './TestRunnerTool.js'
import { DependencyTool } from '../DependencyTool/DependencyTool.js'

describe('TestRunnerTool permissions', () => {
  test('isReadOnly returns false (executes subprocesses)', () => {
    expect(TestRunnerTool.isReadOnly()).toBe(false)
  })

  test('isConcurrencySafe returns false', () => {
    expect(TestRunnerTool.isConcurrencySafe()).toBe(false)
  })

  test('checkPermissions returns ask behavior', async () => {
    const result = await TestRunnerTool.checkPermissions(
      { command: 'npm test' },
      {} as any,
    )
    expect(result.behavior).toBe('ask')
  })
})

describe('DependencyTool permissions', () => {
  test('isReadOnly returns false (executes subprocesses)', () => {
    expect(DependencyTool.isReadOnly()).toBe(false)
  })

  test('isConcurrencySafe returns false', () => {
    expect(DependencyTool.isConcurrencySafe()).toBe(false)
  })

  test('checkPermissions returns ask behavior', async () => {
    const result = await DependencyTool.checkPermissions(
      { operation: 'audit' },
      {} as any,
    )
    expect(result.behavior).toBe('ask')
  })
})
