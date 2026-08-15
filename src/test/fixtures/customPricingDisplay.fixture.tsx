import { mock } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { stripVTControlCharacters as stripAnsi } from 'node:util'
import React from 'react'
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js'
import {
  getAllowedSettingSources,
  getFlagSettingsInline,
  getFlagSettingsPath,
  resetModelStringsForTestingOnly,
  setAllowedSettingSources,
  setFlagSettingsInline,
  setFlagSettingsPath,
} from '../../bootstrap/state.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'

// Preserve real source reads for modelPricing while preventing the shortcut
// fixture from writing the user's settings file.
// @ts-expect-error -- query suffix intentionally bypasses Bun's module cache.
import * as realSettings from '../../utils/settings/settings.js?pricingDisplayRealSettings'

mock.module('../../utils/settings/settings.js', () => ({
  ...realSettings,
  updateSettingsForSource: () => ({ error: null }),
}))
mock.module('../../utils/model/providers.js', () => ({
  getAPIProvider: () => 'firstParty',
  getAPIProviderForStatsig: () => 'firstParty',
  isFirstPartyAnthropicBaseUrl: () => true,
  isFirstPartyAnthropicProvider: () => true,
  isCustomAnthropicProvider: () => false,
  isGithubNativeAnthropicMode: () => false,
  usesAnthropicAccountFlow: () => true,
}))
mock.module('../../utils/auth.js', () => ({
  getSubscriptionType: () => null,
  isClaudeAISubscriber: () => false,
  isMaxSubscriber: () => false,
  isProSubscriber: () => false,
  isTeamPremiumSubscriber: () => false,
}))
mock.module('../../utils/fastMode.js', () => ({
  clearFastModeCooldown: () => {},
  FAST_MODE_MODEL_DISPLAY: 'Opus 4.8',
  getFastModeModel: () => 'opus',
  getFastModeRuntimeState: () => ({ status: 'active' }),
  getFastModeUnavailableReason: () => null,
  isFastModeEnabled: () => true,
  isFastModeSupportedByModel: () => true,
  prefetchFastModeStatus: async () => {},
}))

const originalSources = [...getAllowedSettingSources()]
const originalFlagPath = getFlagSettingsPath()
const originalFlagInline = getFlagSettingsInline()
const fixtureDir = mkdtempSync(join(tmpdir(), 'openclaude-pricing-display-'))
const settingsPath = join(fixtureDir, 'settings.json')

function writePricing(opusInput: number, opusOutput: number): void {
  writeFileSync(
    settingsPath,
    `${JSON.stringify({
      modelPricing: {
        'claude-sonnet-4-6': {
          inputTokens: 9,
          outputTokens: 10,
          promptCacheReadTokens: 0,
          promptCacheWriteTokens: 0,
          webSearchRequests: 0,
        },
        'claude-opus-4-8': {
          inputTokens: opusInput,
          outputTokens: opusOutput,
          promptCacheReadTokens: 0,
          promptCacheWriteTokens: 0,
          webSearchRequests: 0,
        },
      },
    })}\n`,
    'utf8',
  )
}

try {
  writePricing(7, 8)
  setAllowedSettingSources(['flagSettings'])
  setFlagSettingsPath(settingsPath)
  setFlagSettingsInline(null)
  resetSettingsCache()
  resetModelStringsForTestingOnly()

  const {
    getDefaultOptionForUser,
    getMaxOpus46_1MOption,
    getMaxSonnet46_1MOption,
    getOpus46_1MOption,
    getSonnet46_1MOption,
  } = await import('../../utils/model/modelOptions.js')

  assert.match(getDefaultOptionForUser().description, /\$9\/\$10 per Mtok/)
  assert.match(getSonnet46_1MOption().description, /\$9\/\$10 per Mtok/)
  assert.match(getMaxSonnet46_1MOption().description, /\$9\/\$10 per Mtok/)
  assert.match(getOpus46_1MOption(true).description, /\$7\/\$8 per Mtok/)
  assert.match(getMaxOpus46_1MOption(true).description, /\$7\/\$8 per Mtok/)

  const { FastModePicker, handleFastModeShortcut } = await import(
    '../../commands/fast/fast.js'
  )
  const { AppStateProvider, getDefaultAppState } = await import(
    '../../state/AppState.js'
  )
  const { createRoot } = await import('../../ink.js')
  let appState = getDefaultAppState()
  const shortcut = await handleFastModeShortcut(
    true,
    () => appState,
    update => {
      appState = update(appState)
    },
  )
  assert.match(shortcut, /\$7\/\$8 per Mtok/)

  let output = ''
  const stdout = new PassThrough()
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean
    ref: () => PassThrough
    setRawMode: (mode: boolean) => void
    unref: () => PassThrough
  }
  stdin.isTTY = true
  stdin.ref = () => stdin
  stdin.setRawMode = () => {}
  stdin.unref = () => stdin
  ;(stdout as unknown as { columns: number }).columns = 120
  stdout.on('data', chunk => {
    output += chunk.toString()
  })
  const completions: string[] = []
  const onPickerDone = (message: string) => completions.push(message)
  const picker = () => (
    <AppStateProvider initialState={appState}>
      <KeybindingSetup>
        <FastModePicker onDone={onPickerDone} unavailableReason={null} />
      </KeybindingSetup>
    </AppStateProvider>
  )
  const instance = await createRoot({
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    exitOnCtrlC: false,
    patchConsole: false,
  })
  instance.render(picker())
  await Bun.sleep(20)
  assert.match(stripAnsi(output), /\$7\/\$8 per Mtok/)

  writePricing(17, 18)
  resetSettingsCache()
  output = ''
  instance.render(picker())
  await Bun.sleep(20)
  assert.match(stripAnsi(output), /\$17\/\$18 per Mtok/)

  stdin.write('\r')
  await Bun.sleep(20)
  assert.match(completions.at(-1) ?? '', /\$17\/\$18 per Mtok/)

  instance.unmount()
  stdin.end()
  stdout.end()
} finally {
  mock.restore()
  resetModelStringsForTestingOnly()
  setAllowedSettingSources(originalSources)
  setFlagSettingsPath(originalFlagPath)
  setFlagSettingsInline(originalFlagInline)
  resetSettingsCache()
  rmSync(fixtureDir, { recursive: true, force: true })
}
