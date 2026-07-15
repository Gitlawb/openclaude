import { afterAll, describe, expect, mock, test } from 'bun:test'
import { stripVTControlCharacters } from 'node:util'
import React from 'react'
import {
  type AppState,
  AppStateProvider,
  getDefaultAppState,
} from '../state/AppState.js'
import { renderToString } from '../utils/staticRender.js'
import { robinhood } from './types.js'

// Deterministic companion fixture (complete-config mock, cache-busted real
// module — see companion.test.ts for the pattern and why). Without this, the
// tests would silently pass through `companion === undefined` on machines
// with no hatched buddy instead of exercising the eligibility gates.
const actualConfig = await import(`../utils/config.js?real=${Date.now()}`)
mock.module('../utils/config.js', () => ({
  ...actualConfig,
  getGlobalConfig: () => ({
    ...actualConfig.getGlobalConfig(),
    userID: 'fx-test-user',
    oauthAccount: undefined,
    companionMuted: false,
    companion: {
      name: 'Testbud',
      personality: 'Test personality.',
      hatchedAt: 1,
      speciesOverride: robinhood,
    },
  }),
}))

const { CompanionActionFX } = await import('./CompanionActionFX.js')

afterAll(() => {
  mock.module('../utils/config.js', () => actualConfig)
  mock.restore()
})

// Raw output on purpose — NO trim(): an incorrectly rendered blank FX row
// adds a line to the output and must stay observable. Each render is
// compared against a rendered-null baseline through the identical wrapper,
// so renderToString's own framing (trailing newline) cancels out.
async function render(node: React.ReactNode, state: AppState): Promise<string> {
  const out = await renderToString(
    <AppStateProvider initialState={state}>{node}</AppStateProvider>,
    120,
  )
  return stripVTControlCharacters(out)
}

async function expectRendersNothing(state: AppState): Promise<void> {
  const baseline = await render(null, state)
  expect(await render(<CompanionActionFX />, state)).toBe(baseline)
}

describe('CompanionActionFX', () => {
  test('renders nothing when no shot token is set', async () => {
    const state = getDefaultAppState()
    expect(state.companionShotAt).toBeUndefined()
    await expectRendersNothing(state)
  })

  test('a token that predates the mount is consumed, never replayed', async () => {
    // Regression for the remount-replay bug: the companion is eligible
    // (hatched robinhood, unmuted, wide terminal, no reduced motion), yet a
    // shot stamped BEFORE this component existed must not render an FX row.
    const state = { ...getDefaultAppState(), companionShotAt: 12345 } as AppState
    await expectRendersNothing(state)
  })

  test('renders nothing under reduced motion even with a shot token', async () => {
    const base = getDefaultAppState()
    const state = {
      ...base,
      companionShotAt: 12345,
      settings: {
        ...base.settings,
        prefersReducedMotion: true,
      },
    } as AppState
    await expectRendersNothing(state)
  })
})
