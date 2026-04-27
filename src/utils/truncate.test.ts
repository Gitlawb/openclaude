import { truncate, truncateToWidth, truncatePathMiddle } from './truncate.js'

describe('truncate utilities', () => {
  test('truncate returns empty string for undefined input', () => {
    expect(truncate(undefined, 10)).toBe('')
  })

  test('truncateToWidth returns empty string for undefined input', () => {
    expect(truncateToWidth(undefined, 5)).toBe('')
  })

  test('truncatePathMiddle returns empty string for undefined path', () => {
    expect(truncatePathMiddle(undefined, 20)).toBe('')
  })
})
