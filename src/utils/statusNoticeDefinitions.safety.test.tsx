import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import figures from 'figures'
import type { StatusNoticeContext } from './statusNoticeDefinitions.js'
import {
  getActiveNotices,
  statusNoticeDefinitions,
} from './statusNoticeDefinitions.js'
import { renderToString } from './staticRender.js'

// Regression coverage for issue #244 — the two safety-related status notices
// that warn 3P users when they are running without the AI classifier or with
// `--dangerously-skip-permissions` outside a sandbox.

// Empty baseline context (no large-memory/agent-description triggers).
function buildContext(
  overrides?: Partial<StatusNoticeContext>,
): StatusNoticeContext {
  return {
    config: {} as StatusNoticeContext['config'],
    memoryFiles: [],
    ...overrides,
  }
}

function activeIds(ctx: StatusNoticeContext): string[] {
  return getActiveNotices(ctx).map(n => n.id)
}

async function renderNoticePlainText(
  id: string,
  ctx: StatusNoticeContext,
): Promise<string> {
  const notice = statusNoticeDefinitions.find(n => n.id === id)
  expect(notice).toBeDefined()
  return renderToString(notice!.render(ctx), 80)
}

const SAVED_ARGV = process.argv
const SAVED_API_KEY = process.env.ANTHROPIC_API_KEY

beforeEach(() => {
  // Test isolation: normalize argv to a clean baseline so a stray bypass flag
  // in the test runner's argv can't leak into any test. (The notice itself is
  // keyed off permissionMode, not argv.)
  process.argv = [
    ...SAVED_ARGV.filter(
      a => a !== '--dangerously-skip-permissions' && a !== '--yolo',
    ),
  ]
  // Other status notices read auth state via getAnthropicApiKeyWithSource,
  // which throws when no key/token is present. Seed a dummy so getActiveNotices
  // can iterate every notice without unrelated failures crashing the test.
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'sk-test-dummy'
})

afterEach(() => {
  process.argv = SAVED_ARGV
  if (SAVED_API_KEY === undefined) {
    delete process.env.ANTHROPIC_API_KEY
  } else {
    process.env.ANTHROPIC_API_KEY = SAVED_API_KEY
  }
  mock.restore()
})

describe('third-party permissive mode notice (#244 finding 1)', () => {
  test('fires when 3P + acceptEdits + classifier-off model', async () => {
    mock.module('./model/providers.js', () => ({
      getAPIProvider: () => 'openai',
    }))
    mock.module('./betas.js', () => ({
      modelSupportsAutoMode: () => false,
    }))
    const { getActiveNotices: freshGetActiveNotices } = await import(
      `./statusNoticeDefinitions.js?ts=${Date.now()}`
    )
    const ctx = buildContext({ permissionMode: 'acceptEdits', mainLoopModel: 'gpt-5.4' })
    const ids = freshGetActiveNotices(ctx).map((n: { id: string }) => n.id)
    expect(ids).toContain('third-party-permissive-mode')
  })

  test('fires when 3P + bypassPermissions', async () => {
    mock.module('./model/providers.js', () => ({
      getAPIProvider: () => 'openai',
    }))
    mock.module('./betas.js', () => ({
      modelSupportsAutoMode: () => false,
    }))
    const { getActiveNotices: freshGetActiveNotices } = await import(
      `./statusNoticeDefinitions.js?ts=${Date.now()}`
    )
    const ctx = buildContext({ permissionMode: 'bypassPermissions', mainLoopModel: 'llama3.1' })
    const ids = freshGetActiveNotices(ctx).map((n: { id: string }) => n.id)
    expect(ids).toContain('third-party-permissive-mode')
  })

  test('suppressed in default mode even on 3P', async () => {
    mock.module('./model/providers.js', () => ({
      getAPIProvider: () => 'openai',
    }))
    mock.module('./betas.js', () => ({
      modelSupportsAutoMode: () => false,
    }))
    const { getActiveNotices: freshGetActiveNotices } = await import(
      `./statusNoticeDefinitions.js?ts=${Date.now()}`
    )
    const ctx = buildContext({ permissionMode: 'default', mainLoopModel: 'gpt-5.4' })
    const ids = freshGetActiveNotices(ctx).map((n: { id: string }) => n.id)
    expect(ids).not.toContain('third-party-permissive-mode')
  })

  test('suppressed on firstParty Anthropic in acceptEdits', async () => {
    mock.module('./model/providers.js', () => ({
      getAPIProvider: () => 'firstParty',
    }))
    mock.module('./betas.js', () => ({
      modelSupportsAutoMode: () => true,
    }))
    const { getActiveNotices: freshGetActiveNotices } = await import(
      `./statusNoticeDefinitions.js?ts=${Date.now()}`
    )
    const ctx = buildContext({ permissionMode: 'acceptEdits', mainLoopModel: 'claude-opus-4-7' })
    const ids = freshGetActiveNotices(ctx).map((n: { id: string }) => n.id)
    expect(ids).not.toContain('third-party-permissive-mode')
  })

  test('suppressed when classifier supports the model (defensive)', async () => {
    mock.module('./model/providers.js', () => ({
      getAPIProvider: () => 'openai',
    }))
    mock.module('./betas.js', () => ({
      modelSupportsAutoMode: () => true,
    }))
    const { getActiveNotices: freshGetActiveNotices } = await import(
      `./statusNoticeDefinitions.js?ts=${Date.now()}`
    )
    const ctx = buildContext({ permissionMode: 'acceptEdits', mainLoopModel: 'mystery-model' })
    const ids = freshGetActiveNotices(ctx).map((n: { id: string }) => n.id)
    expect(ids).not.toContain('third-party-permissive-mode')
  })
})

describe('dangerously-skip-permissions sandbox notice (#244 finding 2)', () => {
  // The notice is Commander-authoritative: both --dangerously-skip-permissions
  // and its --yolo alias are resolved into permissionMode === 'bypassPermissions'
  // during startup, so the notice keys off the resolved mode, not raw argv.
  test('fires when permission mode is bypassPermissions (either spelling, or settings defaultMode)', () => {
    expect(activeIds(buildContext({ permissionMode: 'bypassPermissions' }))).toContain(
      'dangerously-skip-permissions-no-sandbox',
    )
  })

  test('rendered notice names the --yolo alias so the message is not misleading', async () => {
    const notice = await renderNoticePlainText(
      'dangerously-skip-permissions-no-sandbox',
      buildContext({ permissionMode: 'bypassPermissions' }),
    )
    // Fires for either spelling, so its text must name both.
    expect(notice).toContain('--yolo')
    expect(notice).toContain('--dangerously-skip-permissions')
  })

  test('does not fire in default mode without the flag', () => {
    expect(activeIds(buildContext({ permissionMode: 'default' }))).not.toContain(
      'dangerously-skip-permissions-no-sandbox',
    )
  })
})

describe('safety notice rendering', () => {
  test('separates warning icons from the notice text', async () => {
    const ctx = buildContext({
      permissionMode: 'bypassPermissions',
      mainLoopModel: 'llama3.1',
    })

    const thirdPartyNotice = await renderNoticePlainText(
      'third-party-permissive-mode',
      ctx,
    )
    const dangerouslySkipNotice = await renderNoticePlainText(
      'dangerously-skip-permissions-no-sandbox',
      ctx,
    )

    expect(thirdPartyNotice).toContain(`${figures.warning} bypassPermissions`)
    expect(thirdPartyNotice).not.toContain(
      `${figures.warning}bypassPermissions`,
    )
    expect(dangerouslySkipNotice).toContain(
      `${figures.warning} --dangerously-skip-permissions`,
    )
    expect(dangerouslySkipNotice).not.toContain(
      `${figures.warning}--dangerously-skip-permissions`,
    )
    expect(
      thirdPartyNotice
        .split('\n')
        .slice(1)
        .every(line => line.startsWith('  ')),
    ).toBe(true)
    expect(
      dangerouslySkipNotice
        .split('\n')
        .slice(1)
        .every(line => line.startsWith('  ')),
    ).toBe(true)
  })
})
