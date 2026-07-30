import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'

const facadePath = fileURLToPath(new URL('../openaiShim.ts', import.meta.url))
const moduleDirectory = fileURLToPath(new URL('.', import.meta.url))

// The rebased shared extraction seam is 5,636 lines. The ten representative
// extractions below remove 4,054 net lines, yielding the verified 1,582-line
// fully extracted façade.
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
    for (const [moduleName] of extractionDeltas) {
      expect(existsSync(`${moduleDirectory}/${moduleName}`)).toBe(true)
    }
    const activeReduction = extractionDeltas.reduce(
      (total, [, reduction]) => total + reduction,
      0,
    )
    const facadeLines = readFileSync(facadePath, 'utf8').trimEnd().split('\n').length

    expect(facadeLines).toBeLessThanOrEqual(5_636 - activeReduction)
  })
})
