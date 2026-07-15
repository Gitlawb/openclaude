import { describe, expect, test } from 'bun:test'
import { stripVTControlCharacters } from 'node:util'
import React from 'react'
import {
  type AppState,
  AppStateProvider,
  getDefaultAppState,
} from '../state/AppState.js'
import { renderToString } from '../utils/staticRender.js'
import { CompanionActionFX } from './CompanionActionFX.js'

// These cases are deterministic regardless of whether the host machine's
// real config has a hatched companion: without a shot token (or under
// reduced motion) the component renders nothing before it ever consults
// companion state that would animate.

async function renderWithState(state: AppState): Promise<string> {
  const out = await renderToString(
    <AppStateProvider initialState={state}>
      <CompanionActionFX />
    </AppStateProvider>,
    120,
  )
  return stripVTControlCharacters(out).trim()
}

describe('CompanionActionFX', () => {
  test('renders nothing when no shot token is set', async () => {
    const state = getDefaultAppState()
    expect(state.companionShotAt).toBeUndefined()
    expect(await renderWithState(state)).toBe('')
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
    expect(await renderWithState(state)).toBe('')
  })
})
