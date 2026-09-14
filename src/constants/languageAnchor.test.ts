import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// MACRO is replaced at build time by Bun.define but not in test mode.
// Define it globally so tests that import modules using MACRO don't crash.
;(globalThis as Record<string, unknown>).MACRO = {
  VERSION: '99.0.0',
  DISPLAY_VERSION: '0.0.0-test',
  BUILD_TIME: new Date().toISOString(),
  ISSUES_EXPLAINER: 'report the issue at https://github.com/verbeux-ai/code/issues',
  PACKAGE_URL: '@verboo/code',
  NATIVE_PACKAGE_URL: undefined,
}

import { setClaudeConfigHomeDirForTesting } from '../utils/envUtils.js'
import { resetSettingsCache } from '../utils/settings/settingsCache.js'
import { clearSystemPromptSections } from './systemPromptSections.js'
import { getSystemPrompt } from './prompts.js'

const MIRROR_SNIPPET =
  "Always respond in the same language as the user's most recent message"
const SECTION_HEADER = '# Language'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lang-anchor-'))
  setClaudeConfigHomeDirForTesting(dir)
  resetSettingsCache()
  clearSystemPromptSections()
})

afterEach(() => {
  setClaudeConfigHomeDirForTesting(undefined)
  resetSettingsCache()
  clearSystemPromptSections()
  rmSync(dir, { recursive: true, force: true })
  delete process.env.CLAUDE_CODE_SIMPLE
})

test('default (unset language) injects the mirror directive', async () => {
  const text = (await getSystemPrompt([], 'test-model')).join('\n')

  expect(text).toContain(SECTION_HEADER)
  expect(text).toContain(MIRROR_SNIPPET)
})

test('default (unset language) never leaks an undefined preference', async () => {
  const text = (await getSystemPrompt([], 'test-model')).join('\n')

  expect(text).not.toContain('Always respond in undefined')
  expect(text).not.toContain('Use undefined')
})

test('the default directive is locale-agnostic — pins no language', async () => {
  const text = (await getSystemPrompt([], 'test-model')).join('\n')

  expect(text).not.toContain('Always respond in English')
  expect(text).not.toContain('Always respond in Portuguese')
  expect(text).not.toContain('Always respond in Spanish')
})

test('explicit language override replaces the mirror directive', async () => {
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({ language: 'Brazilian Portuguese' }),
  )
  resetSettingsCache()
  clearSystemPromptSections()

  const text = (await getSystemPrompt([], 'test-model')).join('\n')

  expect(text).toContain('Always respond in Brazilian Portuguese.')
  expect(text).not.toContain(MIRROR_SNIPPET)
})

test('any configured language value passes through verbatim', async () => {
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({ language: 'japanese' }),
  )
  resetSettingsCache()
  clearSystemPromptSections()

  const text = (await getSystemPrompt([], 'test-model')).join('\n')

  expect(text).toContain('Always respond in japanese.')
  expect(text).not.toContain(MIRROR_SNIPPET)
})

test('simple mode system prompt also includes the language anchor', async () => {
  process.env.CLAUDE_CODE_SIMPLE = '1'
  clearSystemPromptSections()

  const text = (await getSystemPrompt([], 'test-model')).join('\n')

  expect(text).toContain(MIRROR_SNIPPET)
})

test('simple mode respects an explicit language override', async () => {
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({ language: 'english' }),
  )
  resetSettingsCache()
  process.env.CLAUDE_CODE_SIMPLE = '1'
  clearSystemPromptSections()

  const text = (await getSystemPrompt([], 'test-model')).join('\n')

  expect(text).toContain('Always respond in english.')
  expect(text).not.toContain(MIRROR_SNIPPET)
})

test('mirror section keeps technical terms exempt (no forced translation of code)', async () => {
  const text = (await getSystemPrompt([], 'test-model')).join('\n')

  expect(text).toContain(
    'Technical terms and code identifiers should remain in their original form',
  )
})
