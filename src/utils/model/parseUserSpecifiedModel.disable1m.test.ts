import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { parseUserSpecifiedModel } from './model.js'

// Regression: when 1M context is disabled (CLAUDE_CODE_DISABLE_1M_CONTEXT, used
// by C4E/HIPAA admins), `has1mContext` returns false. The parser gated the
// stripping of the `[1m]` tag on that flag, so an aliased request like
// `sonnet[1m]` kept the tag attached, never matched the `sonnet` alias, and
// returned the literal, unservable string `sonnet[1m]`. The tag must be stripped
// for matching regardless; only the re-appended suffix depends on 1M being on.
describe('parseUserSpecifiedModel — [1m] tag when 1M context is disabled', () => {
  const original = process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT

  beforeEach(() => {
    process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = '1'
  })
  afterEach(() => {
    if (original === undefined) {
      delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    } else {
      process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = original
    }
  })

  for (const alias of ['sonnet', 'opus', 'haiku', 'best', 'opusplan']) {
    test(`${alias}[1m] resolves to the base model (no [1m]) when 1M is disabled`, () => {
      const base = parseUserSpecifiedModel(alias)
      const tagged = parseUserSpecifiedModel(`${alias}[1m]`)
      // Base model is returned, with the 1M tag dropped — not a literal alias.
      expect(tagged).toBe(base)
      expect(tagged.endsWith('[1m]')).toBe(false)
      expect(tagged).not.toBe(`${alias}[1m]`)
    })
  }

  test('case-insensitive tag is also resolved (SONNET[1M] → base sonnet)', () => {
    expect(parseUserSpecifiedModel('SONNET[1M]')).toBe(
      parseUserSpecifiedModel('sonnet'),
    )
  })

  test('custom model id drops the [1m] suffix when 1M is disabled', () => {
    expect(parseUserSpecifiedModel('my-custom-deploy[1m]')).toBe(
      'my-custom-deploy',
    )
  })

  test('mixed-case custom id drops [1m]/[1M] but preserves casing when disabled', () => {
    expect(parseUserSpecifiedModel('MyCustomDeploy[1M]')).toBe('MyCustomDeploy')
    expect(parseUserSpecifiedModel('MyCustomDeploy[1m]')).toBe('MyCustomDeploy')
  })

  // Codex aliases are resolved by a separate branch from the Claude-family
  // aliases, so they need their own disabled-1M coverage.
  test('codex aliases drop the [1m] tag when 1M is disabled', () => {
    const codexplan = parseUserSpecifiedModel('codexplan')
    const codexspark = parseUserSpecifiedModel('codexspark')
    expect(parseUserSpecifiedModel('codexplan[1m]')).toBe(codexplan)
    expect(parseUserSpecifiedModel('codexspark[1M]')).toBe(codexspark)
    expect(parseUserSpecifiedModel('codexplan[1m]').endsWith('[1m]')).toBe(false)
    expect(parseUserSpecifiedModel('codexspark[1M]').endsWith('[1m]')).toBe(
      false,
    )
  })
})

// Guard the opposite direction: with 1M enabled (default), the tag is preserved.
describe('parseUserSpecifiedModel — [1m] tag when 1M context is enabled', () => {
  const original = process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT

  beforeEach(() => {
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
  })
  afterEach(() => {
    if (original === undefined) {
      delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    } else {
      process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = original
    }
  })

  test('sonnet[1m] keeps the tag on the resolved base model', () => {
    const base = parseUserSpecifiedModel('sonnet')
    expect(parseUserSpecifiedModel('sonnet[1m]')).toBe(`${base}[1m]`)
  })

  test('custom model id keeps the [1m] suffix', () => {
    expect(parseUserSpecifiedModel('my-custom-deploy[1m]')).toBe(
      'my-custom-deploy[1m]',
    )
  })

  // Mixed-case custom deployment ids keep their casing; only the [1m]/[1M] tag
  // is normalized/reattached.
  test('mixed-case custom id preserves casing, tag normalized to [1m]', () => {
    expect(parseUserSpecifiedModel('MyCustomDeploy[1M]')).toBe(
      'MyCustomDeploy[1m]',
    )
    expect(parseUserSpecifiedModel('MyCustomDeploy[1m]')).toBe(
      'MyCustomDeploy[1m]',
    )
  })
})

// Custom default-model env overrides (ANTHROPIC_DEFAULT_SONNET_MODEL etc.) can
// bake a [1m] suffix into the resolved alias target. The disabled-1M path must
// strip that too, and the enabled path must honor it without duplicating it.
describe('parseUserSpecifiedModel — [1m] on custom default env overrides', () => {
  const KEYS = [
    'CLAUDE_CODE_DISABLE_1M_CONTEXT',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
  ] as const
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k]
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'MySonnetDeploy[1m]'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'MyOpusDeploy[1M]'
  })
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  test('disabled: alias drops the baked [1m] from the resolved default', () => {
    process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = '1'
    // Casing of the custom deployment id is preserved; only the tag is dropped.
    expect(parseUserSpecifiedModel('sonnet[1m]')).toBe('MySonnetDeploy')
    expect(parseUserSpecifiedModel('sonnet')).toBe('MySonnetDeploy')
    expect(parseUserSpecifiedModel('opus[1M]')).toBe('MyOpusDeploy')
  })

  test('enabled: baked [1m] honored and never duplicated', () => {
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    // Bare alias honors the env default's opt-in; tag normalized to [1m].
    expect(parseUserSpecifiedModel('sonnet')).toBe('MySonnetDeploy[1m]')
    // Tagged alias does not double the suffix.
    expect(parseUserSpecifiedModel('sonnet[1m]')).toBe('MySonnetDeploy[1m]')
    expect(parseUserSpecifiedModel('opus')).toBe('MyOpusDeploy[1m]')
  })
})
