import { expect, test } from 'bun:test'
import {
  filterCandidatePathsForSuggestions,
  normalizeFileSuggestionPath,
  shouldExcludeFileSuggestionPath,
} from './fileSuggestions.js'

test('normalizeFileSuggestionPath strips leading current-directory prefixes', () => {
  expect(normalizeFileSuggestionPath('./src/index.ts')).toBe('src/index.ts')
  expect(normalizeFileSuggestionPath('.\\src\\index.ts')).toBe('src\\index.ts')
  expect(normalizeFileSuggestionPath('src/index.ts')).toBe('src/index.ts')
})

test('shouldExcludeFileSuggestionPath excludes common generated directories', () => {
  expect(shouldExcludeFileSuggestionPath('node_modules/react/index.js')).toBe(
    true,
  )
  expect(shouldExcludeFileSuggestionPath('wandb/run-1/output.log')).toBe(true)
  expect(shouldExcludeFileSuggestionPath('src/node_modules-helper.ts')).toBe(
    false,
  )
  expect(shouldExcludeFileSuggestionPath('src/components/')).toBe(false)
})

test('filterCandidatePathsForSuggestions filters generated directories and caps file count', () => {
  const result = filterCandidatePathsForSuggestions(
    [
      './src/index.ts',
      'node_modules/pkg/index.js',
      'wandb/latest-run.log',
      'src/app.ts',
      'src/extra.ts',
    ],
    2,
  )

  expect(result.files).toEqual(['src/index.ts', 'src/app.ts'])
  expect(result.truncated).toBe(true)
})
