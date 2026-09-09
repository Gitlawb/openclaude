import { expect, test } from 'bun:test'
import { sponsoredTipsEnabled, getSponsoredTipsFrequency, sponsoredTips } from './sponsoredTips.js'

test('Verboo Code has no sponsored tip catalogue or enabled advertising slots', () => {
  expect(sponsoredTipsEnabled()).toBe(false)
  expect(getSponsoredTipsFrequency()).toBe(0)
  expect(sponsoredTips).toEqual([])
})
