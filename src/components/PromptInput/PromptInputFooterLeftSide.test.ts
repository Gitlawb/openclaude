import { describe, expect, it } from 'bun:test'
import {
  applyHistorySearchActiveState,
  resolveFooterOverlay,
  resolveRegularFooterActive,
  resolveTransientFooterMessage,
  resolveVisibleTransientFooterMessage,
} from './footerVisibility.js'

describe('applyHistorySearchActiveState', () => {
  it('closes help before activating history search', () => {
    const transitions: string[] = []
    applyHistorySearchActiveState(
      true,
      open => transitions.push(`help:${open}`),
      active => transitions.push(`search:${active}`),
    )
    expect(transitions).toEqual(['help:false', 'search:true'])
  })

  it('does not change help when history search ends', () => {
    const transitions: string[] = []
    applyHistorySearchActiveState(
      false,
      open => transitions.push(`help:${open}`),
      active => transitions.push(`search:${active}`),
    )
    expect(transitions).toEqual(['search:false'])
  })
})

describe('resolveFooterOverlay', () => {
  it('lets history search replace help and inline suggestions', () => {
    expect(
      resolveFooterOverlay({
        hasInlineSuggestions: true,
        helpOpen: true,
        isSearching: true,
      }),
    ).toBeNull()
  })

  it('shows suggestions before help outside history search', () => {
    expect(
      resolveFooterOverlay({
        hasInlineSuggestions: true,
        helpOpen: true,
        isSearching: false,
      }),
    ).toBe('suggestions')
    expect(
      resolveFooterOverlay({
        hasInlineSuggestions: false,
        helpOpen: true,
        isSearching: false,
      }),
    ).toBe('help')
  })
})

describe('resolveTransientFooterMessage', () => {
  it('shows transient feedback outside history search', () => {
    expect(
      resolveTransientFooterMessage({
        exitMessageShown: true,
        isPasting: false,
      }),
    ).toBe('exit')
    expect(
      resolveTransientFooterMessage({
        exitMessageShown: false,
        isPasting: true,
      }),
    ).toBe('paste')
  })

  it('lets history search replace pending transient feedback', () => {
    expect(
      resolveVisibleTransientFooterMessage({
        isSearching: true,
        exitMessageShown: true,
        isPasting: false,
      }),
    ).toBeNull()
  })

  it('prioritizes exit feedback when paste feedback is also active', () => {
    expect(
      resolveTransientFooterMessage({
        exitMessageShown: true,
        isPasting: true,
      }),
    ).toBe('exit')
  })
})

describe('resolveRegularFooterActive', () => {
  it('requires both parent visibility and no transient message', () => {
    expect(
      resolveRegularFooterActive({
        parentActive: true,
        transientMessage: null,
      }),
    ).toBe(true)
    expect(
      resolveRegularFooterActive({
        parentActive: false,
        transientMessage: null,
      }),
    ).toBe(false)
    expect(
      resolveRegularFooterActive({
        parentActive: true,
        transientMessage: 'exit',
      }),
    ).toBe(false)
  })
})
