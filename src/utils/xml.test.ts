import { expect, test } from 'bun:test'

import { escapeXml, escapeXmlAttr } from './xml.js'

test('escapeXml escapes the core XML metacharacters', () => {
  expect(escapeXml('<tag>&"\'</tag>')).toBe(
    '&lt;tag&gt;&amp;"\'&lt;/tag&gt;',
  )
})

test('escapeXml returns an empty string for null and undefined (#1247)', () => {
  // Regression: BashTool / ShellError surface `stdout` and `stderr` as null
  // when the stream produced nothing. processBashCommand piped those straight
  // into escapeXml, and the previous `s.replace(...)` call crashed the REPL
  // with `TypeError: Cannot read properties of null (reading 'replace')`.
  expect(escapeXml(null)).toBe('')
  expect(escapeXml(undefined)).toBe('')
})

test('escapeXml passes empty string through unchanged', () => {
  expect(escapeXml('')).toBe('')
})

test('escapeXmlAttr also escapes quotes', () => {
  expect(escapeXmlAttr('"hi"&\'<bye>')).toBe(
    '&quot;hi&quot;&amp;&apos;&lt;bye&gt;',
  )
})

test('escapeXmlAttr inherits the null/undefined tolerance', () => {
  expect(escapeXmlAttr(null)).toBe('')
  expect(escapeXmlAttr(undefined)).toBe('')
})
