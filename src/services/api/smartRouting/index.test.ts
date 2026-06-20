import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import {
  clearSmartRoutingSessionDisable,
  decideTurnModel,
  deriveUserTurnNumber,
  extractLatestUserText,
  getRoutingTally,
  isRetryableRoutedModelError,
  isSmartRoutingDisabledForSession,
  recordRoutingDecision,
  recordRoutingEscalation,
  resetRoutingTally,
} from './index.js'
import * as settingsModule from '../../../utils/settings/settings.js'
import type { SettingsJson } from '../../../utils/settings/types.js'

/** Set the ambient allowlist that isModelAllowed reads via getSettings_DEPRECATED. */
function mockGlobalAllowlist(availableModels: string[] | undefined) {
  return spyOn(settingsModule, 'getSettings_DEPRECATED').mockReturnValue(
    (availableModels ? { availableModels } : {}) as unknown as SettingsJson,
  )
}

const PARENT = 'gpt-5'

function settings(overrides: Record<string, unknown>): SettingsJson {
  return overrides as unknown as SettingsJson
}

// Two model-only agentModels keys + an opt-in smartRouting block. No availableModels
// allowlist, so isModelAllowed returns true for everything.
function enabledSettings(extra: Record<string, unknown> = {}): SettingsJson {
  return settings({
    agentModels: { mini: { model: 'gpt-5-mini' }, main: { model: 'gpt-5' } },
    smartRouting: { enabled: true, simpleModel: 'mini', strongModel: 'main' },
    ...extra,
  })
}

const userMsg = (text: string, isMeta = false) => ({
  type: 'user',
  isMeta,
  message: { role: 'user', content: text },
})
const toolResultMsg = () => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] },
})
const assistantMsg = () => ({ type: 'assistant', message: { role: 'assistant', content: 'hi' } })

describe('deriveUserTurnNumber', () => {
  test('counts only real user messages (not isMeta, not tool-results)', () => {
    const msgs = [
      userMsg('first real turn'),
      assistantMsg(),
      toolResultMsg(),
      userMsg('continue', true), // isMeta nudge
      userMsg('second real turn'),
    ]
    expect(deriveUserTurnNumber(msgs)).toBe(2)
  })

  test('empty conversation is zero', () => {
    expect(deriveUserTurnNumber([])).toBe(0)
  })
})

describe('extractLatestUserText', () => {
  test('returns the most recent real user message text', () => {
    const msgs = [userMsg('old'), assistantMsg(), userMsg('newest')]
    expect(extractLatestUserText(msgs)).toBe('newest')
  })

  test('skips isMeta and tool-result messages', () => {
    const msgs = [userMsg('the real one'), assistantMsg(), toolResultMsg(), userMsg('nudge', true)]
    expect(extractLatestUserText(msgs)).toBe('the real one')
  })

  test('joins text blocks of array content', () => {
    const msgs = [{ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } }]
    expect(extractLatestUserText(msgs)).toBe('a\nb')
  })
})

describe('decideTurnModel', () => {
  afterEach(() => {
    clearSmartRoutingSessionDisable('sess-1')
    clearSmartRoutingSessionDisable('sess-2')
  })

  test('disabled settings → routed:false', () => {
    const d = decideTurnModel({
      settings: settings({}),
      parentModel: PARENT,
      input: { userText: 'hi', turnNumber: 2 },
    })
    expect(d.routed).toBe(false)
  })

  test('short non-first turn routes simple', () => {
    const d = decideTurnModel({
      settings: enabledSettings(),
      parentModel: PARENT,
      input: { userText: 'ok thanks', turnNumber: 3 },
    })
    expect(d).toMatchObject({ routed: true, complexity: 'simple', model: 'gpt-5-mini', strongModel: 'gpt-5' })
  })

  test('first turn routes strong (routeModel turnNumber===1 guard)', () => {
    const d = decideTurnModel({
      settings: enabledSettings(),
      parentModel: PARENT,
      input: { userText: 'ok', turnNumber: 1 },
    })
    expect(d).toMatchObject({ routed: true, complexity: 'strong', model: 'gpt-5' })
  })

  test('strong-signal prompt routes strong', () => {
    const d = decideTurnModel({
      settings: enabledSettings(),
      parentModel: PARENT,
      input: { userText: 'refactor the auth module please', turnNumber: 4 },
    })
    expect(d).toMatchObject({ routed: true, complexity: 'strong', model: 'gpt-5' })
  })

  test('disallowed simple model coerces to strong', () => {
    // Distinct, non-prefix-colliding model ids so the allowlist genuinely blocks
    // simple while permitting strong.
    const s = settings({
      agentModels: { mini: { model: 'alpha-mini' }, main: { model: 'beta-big' } },
      smartRouting: { enabled: true, simpleModel: 'mini', strongModel: 'main' },
    })
    const spy = mockGlobalAllowlist(['beta-big'])
    const d = decideTurnModel({
      settings: s,
      parentModel: PARENT,
      input: { userText: 'ok thanks', turnNumber: 3 },
    })
    expect(d).toMatchObject({ routed: true, model: 'beta-big', complexity: 'strong' })
    spy.mockRestore()
  })

  test('both models disallowed → routing disabled for session, fires once', () => {
    const spy = mockGlobalAllowlist(['some-other-model'])
    const cfg = {
      settings: enabledSettings(),
      parentModel: PARENT,
      input: { userText: 'ok thanks', turnNumber: 3 },
      sessionId: 'sess-1',
    }
    const first = decideTurnModel(cfg)
    expect(first).toEqual({ routed: false, justDisabledForSession: true })
    expect(isSmartRoutingDisabledForSession('sess-1')).toBe(true)

    // Second call: still disabled, but the one-time flag is not re-raised.
    const second = decideTurnModel(cfg)
    expect(second).toEqual({ routed: false })
    spy.mockRestore()
  })

  test('a session disable does not leak into another session', () => {
    const spy = mockGlobalAllowlist(['x'])
    decideTurnModel({
      settings: enabledSettings(),
      parentModel: PARENT,
      input: { userText: 'ok', turnNumber: 3 },
      sessionId: 'sess-1',
    })
    expect(isSmartRoutingDisabledForSession('sess-1')).toBe(true)
    expect(isSmartRoutingDisabledForSession('sess-2')).toBe(false)
    spy.mockRestore()
  })
})

describe('isRetryableRoutedModelError', () => {
  test('4xx client errors (bad request / auth / permission) are not retryable', () => {
    expect(isRetryableRoutedModelError({ status: 400 })).toBe(false)
    expect(isRetryableRoutedModelError({ status: 401 })).toBe(false)
    expect(isRetryableRoutedModelError({ statusCode: 403 })).toBe(false)
  })

  test('5xx, network, and unclassified errors are retryable', () => {
    expect(isRetryableRoutedModelError({ status: 500 })).toBe(true)
    expect(isRetryableRoutedModelError({ status: 529 })).toBe(true)
    expect(isRetryableRoutedModelError(new Error('socket hang up'))).toBe(true)
    expect(isRetryableRoutedModelError(undefined)).toBe(true)
  })
})

describe('routing tally', () => {
  afterEach(() => resetRoutingTally())

  test('records decisions and escalations', () => {
    resetRoutingTally()
    recordRoutingDecision('simple')
    recordRoutingDecision('simple')
    recordRoutingDecision('strong')
    recordRoutingEscalation()
    expect(getRoutingTally()).toEqual({ simple: 2, strong: 1, escalations: 1 })
  })

  test('reset clears the tally', () => {
    recordRoutingDecision('simple')
    resetRoutingTally()
    expect(getRoutingTally()).toEqual({ simple: 0, strong: 0, escalations: 0 })
  })
})
