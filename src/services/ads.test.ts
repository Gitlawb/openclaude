import { afterEach, describe, expect, test } from 'bun:test'

import { confirmTip, fetchNextTip, sanitizeForAds } from './ads.js'

describe('sanitizeForAds', () => {
  test('passes through ordinary prompt text', () => {
    const t = 'help me set up a Next.js app with a Postgres database'
    expect(sanitizeForAds(t)).toBe(t)
  })

  test('redacts API-key shapes (openai, github, aws)', () => {
    // Built at runtime so the AWS-shaped fixture isn't flagged by security:pr-scan.
    const awsLikeKey = 'AKIA' + 'IOSFODNN7EXAMPLE'
    expect(sanitizeForAds('my key is sk-ABCDEFGH1234567890 ok')).toContain('[redacted]')
    expect(sanitizeForAds('token ghp_ABCDEFGH1234567890')).toContain('[redacted]')
    expect(sanitizeForAds(`${awsLikeKey} here`)).toContain('[redacted]')
    expect(sanitizeForAds('my key is sk-ABCDEFGH1234567890')).not.toContain('sk-ABCDEFGH')
  })

  test('redacts bearer tokens and JWTs', () => {
    expect(sanitizeForAds('Authorization: Bearer abcdef123456789')).toContain('Bearer [redacted]')
    expect(
      sanitizeForAds('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payloadpart.sigpart'),
    ).toContain('[redacted-jwt]')
  })

  test('redacts emails', () => {
    expect(sanitizeForAds('email me at kevin@example.com please')).toContain('[redacted-email]')
    expect(sanitizeForAds('email me at kevin@example.com')).not.toContain('kevin@example.com')
  })

  test('redacts long hex blobs (hashes/keys)', () => {
    const hex = 'a'.repeat(40)
    expect(sanitizeForAds(`hash ${hex} end`)).toContain('[redacted]')
    expect(sanitizeForAds(`hash ${hex} end`)).not.toContain(hex)
  })

  test('truncates to the share cap', () => {
    expect(sanitizeForAds('x'.repeat(2000)).length).toBeLessThanOrEqual(500)
  })

  test('collapses whitespace and trims', () => {
    expect(sanitizeForAds('  a\n\n  b   c  ')).toBe('a b c')
  })
})

describe('fetchNextTip / confirmTip (mocked fetch)', () => {
  const realFetch = globalThis.fetch
  const ORIG_BASE = process.env.ADS_BASE_URL
  let captured: { url?: string; method?: string; body?: Record<string, unknown> }

  function stubFetch(status: number, payload: unknown): void {
    captured = {}
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      captured.url = String(input)
      captured.method = init?.method ?? 'GET'
      captured.body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined
      return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
  }

  afterEach(() => {
    globalThis.fetch = realFetch
    if (ORIG_BASE === undefined) delete process.env.ADS_BASE_URL
    else process.env.ADS_BASE_URL = ORIG_BASE
  })

  const TIP = {
    impression_id: 'imp1',
    token: 'tok',
    tip_text: 'Try Vultr',
    name: 'Vultr',
    link: 'https://vultr.com',
    label: 'Sponsored by Vultr',
    dwell_ms: 4000,
  }

  test('POSTs sanitized conversation context when a prompt is given', async () => {
    process.env.ADS_BASE_URL = 'https://ads.test'
    stubFetch(200, TIP)
    const tip = await fetchNextTip('code', 'openclaude', 'deploy with key sk-ABCDEFGH1234567890')
    expect(captured.method).toBe('POST')
    expect(captured.url).toContain('/api/ads/next?surface=openclaude')
    const sent = (captured.body as { context: { messages: { content: string }[] } }).context
      .messages[0].content
    expect(sent).toContain('deploy with key')
    expect(sent).toContain('[redacted]') // secret sanitized before sending
    expect(sent).not.toContain('sk-ABCDEFGH')
    expect(tip).toMatchObject({ name: 'Vultr', token: 'tok', dwellMs: 4000 })
  })

  test('GETs with no body when there is no prompt', async () => {
    stubFetch(200, TIP)
    await fetchNextTip('code', 'openclaude')
    expect(captured.method).toBe('GET')
    expect(captured.body).toBeUndefined()
  })

  test('returns null on a non-OK response', async () => {
    stubFetch(500, { error: 'server_error' })
    expect(await fetchNextTip('code', 'openclaude', 'a prompt')).toBeNull()
  })

  test('returns null when there is no ad to serve', async () => {
    stubFetch(200, { ad: null })
    expect(await fetchNextTip('code', 'openclaude', 'a prompt')).toBeNull()
  })

  test('clamps a malformed dwell_ms to the 5000ms default', async () => {
    stubFetch(200, { ...TIP, dwell_ms: 'not-a-number' })
    const tip = await fetchNextTip('code', 'openclaude', 'a prompt')
    expect(tip?.dwellMs).toBe(5000)
  })

  test('confirmTip POSTs and normalizes the settle result', async () => {
    stubFetch(200, { status: 'confirmed', earned_micro: 1000, balance_micro: 5000 })
    const r = await confirmTip('code', 'tok')
    expect(captured.method).toBe('POST')
    expect(captured.url).toContain('/api/ads/confirm')
    expect(r).toEqual({ status: 'confirmed', earnedMicro: 1000, balanceMicro: 5000 })
  })
})
