import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'

const facadePath = fileURLToPath(new URL('../openaiShim.ts', import.meta.url))
const moduleDirectory = fileURLToPath(new URL('.', import.meta.url))

// The shared extraction seam is 5,140 lines. Each independently mergeable PR
// removes at least this many net lines when its representative module exists.
// Detecting modules makes the ceiling tighten regardless of merge order.
const extractionDeltas = [
  ['streamControl.ts', 169],
  ['providerCompatibility.ts', 115],
  ['ollamaAdapter.ts', 387],
  ['messageConversion.ts', 474],
  ['rawToolCallParsing.ts', 291],
  ['xmlToolCallParsing.ts', 356],
  ['streamConversion.ts', 1_072],
  ['clientDispatch.ts', 182],
  ['requestPlanner.ts', 304],
  ['requestExecutor.ts', 704],
] as const

describe('openaiShim façade architecture', () => {
  test('does not regain logic removed by the independent extractions', () => {
    const activeReduction = extractionDeltas.reduce(
      (total, [moduleName, reduction]) =>
        total + (existsSync(`${moduleDirectory}/${moduleName}`) ? reduction : 0),
      0,
    )
    const facadeLines = readFileSync(facadePath, 'utf8').trimEnd().split('\n').length

    expect(facadeLines).toBeLessThanOrEqual(5_140 - activeReduction)
  })
})
