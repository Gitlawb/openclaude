import { describe, expect, test } from 'bun:test'
import { analyzeTaskComplexity, shouldAutoSpawn } from '../src/utils/taskComplexityDetector'

describe('taskComplexityDetector', () => {
  test('detecta planning keywords', () => {
    const result = analyzeTaskComplexity('implement user authentication system')
    expect(result.needsPlanning).toBe(true)
    expect(result.confidence).toBeGreaterThan(0.3)
  })

  test('detecta review keywords', () => {
    const result = analyzeTaskComplexity('review security vulnerabilities in auth module')
    expect(result.needsReview).toBe(true)
    expect(result.confidence).toBeGreaterThanOrEqual(0.3)
  })

  test('detecta complexity indicators', () => {
    const result = analyzeTaskComplexity('refactor entire codebase for performance')
    expect(result.needsPlanning).toBe(true)
    expect(result.confidence).toBeGreaterThan(0.5)
    expect(result.reasons.length).toBeGreaterThan(1)
  })

  test('detecta multi-file changes', () => {
    const result = analyzeTaskComplexity('update 10+ files to use new API')
    expect(result.confidence).toBeGreaterThanOrEqual(0.3)
  })

  test('não auto-spawn para tasks simples', () => {
    const result = analyzeTaskComplexity('fix typo in README')
    expect(shouldAutoSpawn(result)).toBe(false)
  })

  test('auto-spawn para tasks complexas', () => {
    const result = analyzeTaskComplexity('implement comprehensive security audit across entire system')
    expect(shouldAutoSpawn(result)).toBe(true)
    expect(result.confidence).toBeGreaterThanOrEqual(0.5)
  })

  test('long prompt aumenta confidence', () => {
    const shortPrompt = 'add feature'
    const longPrompt = 'add feature ' + 'x'.repeat(200)

    const short = analyzeTaskComplexity(shortPrompt)
    const long = analyzeTaskComplexity(longPrompt)

    expect(long.confidence).toBeGreaterThan(short.confidence)
  })
})
