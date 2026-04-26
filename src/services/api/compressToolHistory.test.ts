import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { compressToolHistory, getTiers } from './compressToolHistory.js'

// Mock the two dependencies so tests are deterministic and don't read disk config.
const mockState = {
  enabled: true,
  effectiveWindow: 100_000,
}

mock.module('../../utils/config.js', () => ({
  getGlobalConfig: () => ({
    toolHistoryCompressionEnabled: mockState.enabled,
  }),
}))

mock.module('../compact/autoCompact.js', () => ({
  getEffectiveContextWindowSize: () => mockState.effectiveWindow,
}))

beforeEach(() => {
  mockState.enabled = true
  mockState.effectiveWindow = 100_000
})

afterEach(() => {
  mockState.enabled = true
  mockState.effectiveWindow = 100_000
})

type Block = Record<string, unknown>
type Msg = { role: string; content: Block[] | string }

function bigText(n: number): string {
  return 'x'.repeat(n)
}

function buildToolExchange(id: number, resultLength: number): Msg[] {
  return [
    {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: `toolu_${id}`,
          name: 'Read',
          input: { file_path: `/path/to/file${id}.ts` },
        },
      ],
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: `toolu_${id}`,
          content: bigText(resultLength),
        },
      ],
    },
  ]
}

function buildConversation(numToolExchanges: number, resultLength = 5_000): Msg[] {
  const out: Msg[] = [{ role: 'user', content: 'Initial request' }]
  for (let i = 0; i < numToolExchanges; i++) {
    out.push(...buildToolExchange(i, resultLength))
  }
  return out
}

function getResultMessages(messages: Msg[]): Msg[] {
  return messages.filter(
    m => Array.isArray(m.content) && m.content.some((b: any) => b.type === 'tool_result'),
  )
}

function getResultBlock(msg: Msg): Block {
  return (msg.content as Block[]).find((b: any) => b.type === 'tool_result') as Block
}

function getResultText(msg: Msg): string {
  const block = getResultBlock(msg)
  const c = block.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
  }
  return ''
}

// ---------- getTiers ----------

test('getTiers: < 16k window → recent=2, mid=3', () => {
  expect(getTiers(8_000)).toEqual({ recent: 2, mid: 3 })
})

test('getTiers: 16k–32k → recent=3, mid=5', () => {
  expect(getTiers(20_000)).toEqual({ recent: 3, mid: 5 })
})

test('getTiers: 32k–64k → recent=4, mid=8', () => {
  expect(getTiers(48_000)).toEqual({ recent: 4, mid: 8 })
})

test('getTiers: 64k–128k (Copilot gpt-4o) → recent=5, mid=10', () => {
  expect(getTiers(100_000)).toEqual({ recent: 5, mid: 10 })
})

test('getTiers: 128k–256k (Copilot Claude) → recent=8, mid=15', () => {
  expect(getTiers(200_000)).toEqual({ recent: 8, mid: 15 })
})

test('getTiers: 256k–500k → recent=12, mid=25', () => {
  expect(getTiers(400_000)).toEqual({ recent: 12, mid: 25 })
})

test('getTiers: ≥ 500k (gpt-4.1 1M) → recent=25, mid=50', () => {
  expect(getTiers(1_000_000)).toEqual({ recent: 25, mid: 50 })
})

// ---------- master switch ----------

test('pass-through when toolHistoryCompressionEnabled is false', () => {
  mockState.enabled = false
  const messages = buildConversation(20)
  const result = compressToolHistory(messages, 'gpt-4o')
  expect(result).toBe(messages) // same reference (no transformation)
})

test('pass-through when total tool_results <= recent tier', () => {
  // 100k effective → recent=5; only 4 exchanges → no compression
  const messages = buildConversation(4)
  const result = compressToolHistory(messages, 'gpt-4o')
  expect(result).toBe(messages)
})

// ---------- per-tier behavior ----------

test('recent tier: tool_result content untouched', () => {
  // 100k effective → recent=5, mid=10. With 6 exchanges, only the oldest is touched.
  const messages = buildConversation(6, 5_000)
  const result = compressToolHistory(messages, 'gpt-4o')
  const resultMsgs = getResultMessages(result)

  // Last 5 should be untouched (full 5000 chars)
  for (let i = resultMsgs.length - 5; i < resultMsgs.length; i++) {
    expect(getResultText(resultMsgs[i]).length).toBe(5_000)
  }
})

test('mid tier: long content truncated to MID_MAX_CHARS with marker', () => {
  // 100k → recent=5, mid=10. 10 exchanges: 5 recent + 5 mid (none old).
  const messages = buildConversation(10, 5_000)
  const result = compressToolHistory(messages, 'gpt-4o')
  const resultMsgs = getResultMessages(result)

  // First 5 are mid tier — should be truncated to ~2000 chars + marker
  for (let i = 0; i < 5; i++) {
    const text = getResultText(resultMsgs[i])
    expect(text).toContain('[…truncated')
    expect(text).toContain('chars from tool history]')
    // Should be roughly 2000 chars + marker (under 2200)
    expect(text.length).toBeLessThan(2_200)
    expect(text.length).toBeGreaterThan(2_000)
  }
})

test('mid tier: short content (< MID_MAX_CHARS) untouched', () => {
  const messages = buildConversation(10, 500) // 500 < MID_MAX_CHARS
  const result = compressToolHistory(messages, 'gpt-4o')
  const resultMsgs = getResultMessages(result)

  for (let i = 0; i < 5; i++) {
    expect(getResultText(resultMsgs[i])).toBe(bigText(500))
  }
})

test('old tier: content replaced with stub [name args={...} → N chars omitted]', () => {
  // 100k → recent=5, mid=10, old=rest. 20 exchanges → 5 old + 10 mid + 5 recent.
  const messages = buildConversation(20, 5_000)
  const result = compressToolHistory(messages, 'gpt-4o')
  const resultMsgs = getResultMessages(result)

  // First 5 are old tier — should be stubs
  for (let i = 0; i < 5; i++) {
    const text = getResultText(resultMsgs[i])
    expect(text).toMatch(/^\[Read args=\{.*\} → 5000 chars omitted\]$/)
  }
})

test('old tier: stub args truncated to 200 chars', () => {
  const longArg = bigText(500)
  const messages: Msg[] = [
    { role: 'user', content: 'start' },
    {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_x',
          name: 'Bash',
          input: { command: longArg },
        },
      ],
    },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_x', content: 'output' },
      ],
    },
    // Pad with enough recent exchanges to push the above into old tier
    ...buildConversation(20, 100).slice(1),
  ]
  const result = compressToolHistory(messages, 'gpt-4o')
  const resultMsgs = getResultMessages(result)
  const text = getResultText(resultMsgs[0])

  // Stub format: [Bash args=<json≤200chars> → N chars omitted]
  // The args portion (between args= and →) must be ≤ 200 chars.
  const argsMatch = text.match(/args=(.*?) →/)
  expect(argsMatch).not.toBeNull()
  expect(argsMatch![1].length).toBeLessThanOrEqual(200)
})

test('old tier: orphan tool_result (no matching tool_use) falls back to "tool"', () => {
  const messages: Msg[] = [
    { role: 'user', content: 'start' },
    // Orphan: tool_result without matching tool_use in history
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'orphan_id', content: 'data' },
      ],
    },
    ...buildConversation(20, 100).slice(1),
  ]
  const result = compressToolHistory(messages, 'gpt-4o')
  const resultMsgs = getResultMessages(result)
  const text = getResultText(resultMsgs[0])

  expect(text).toMatch(/^\[tool args=\{\} → 4 chars omitted\]$/)
})

// ---------- structural preservation ----------

test('tool_use blocks always preserved', () => {
  const messages = buildConversation(20, 5_000)
  const result = compressToolHistory(messages, 'gpt-4o')

  const useCount = (msgs: Msg[]) =>
    msgs.reduce((sum, m) => {
      if (!Array.isArray(m.content)) return sum
      return sum + m.content.filter((b: any) => b.type === 'tool_use').length
    }, 0)

  expect(useCount(result as Msg[])).toBe(useCount(messages))
})

test('text blocks always preserved', () => {
  const messages: Msg[] = [
    { role: 'user', content: 'first' },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'reasoning before tool' },
        { type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} },
      ],
    },
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: bigText(5000) }],
    },
    ...buildConversation(20, 5_000).slice(1),
  ]
  const result = compressToolHistory(messages, 'gpt-4o')
  const assistantMsg = (result as Msg[])[1]
  const textBlock = (assistantMsg.content as Block[]).find((b: any) => b.type === 'text')

  expect(textBlock).toEqual({ type: 'text', text: 'reasoning before tool' })
})

test('thinking blocks always preserved', () => {
  const messages: Msg[] = [
    { role: 'user', content: 'first' },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'internal reasoning', signature: 'sig' },
        { type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} },
      ],
    },
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: bigText(5000) }],
    },
    ...buildConversation(20, 5_000).slice(1),
  ]
  const result = compressToolHistory(messages, 'gpt-4o')
  const assistantMsg = (result as Msg[])[1]
  const thinking = (assistantMsg.content as Block[]).find((b: any) => b.type === 'thinking')

  expect(thinking).toEqual({
    type: 'thinking',
    thinking: 'internal reasoning',
    signature: 'sig',
  })
})

test('non-array content (string) handled gracefully', () => {
  const messages: Msg[] = [
    { role: 'user', content: 'plain string content' },
    ...buildConversation(20, 100).slice(1),
  ]
  const result = compressToolHistory(messages, 'gpt-4o')
  expect((result as Msg[])[0].content).toBe('plain string content')
})

test('empty content array handled gracefully', () => {
  const messages: Msg[] = [
    { role: 'user', content: [] },
    ...buildConversation(20, 100).slice(1),
  ]
  expect(() => compressToolHistory(messages, 'gpt-4o')).not.toThrow()
})

// ---------- message shape compatibility ----------

test('wrapped shape ({ message: { role, content } }) handled', () => {
  type WrappedMsg = { message: { role: string; content: Block[] | string } }
  const wrap = (m: Msg): WrappedMsg => ({ message: { role: m.role, content: m.content } })
  const messages = buildConversation(20, 5_000).map(wrap)
  const result = compressToolHistory(messages as any, 'gpt-4o')

  // First wrapped tool-result message should have stub content (old tier)
  const firstResultMsg = (result as WrappedMsg[]).find(
    m =>
      Array.isArray(m.message.content) &&
      m.message.content.some((b: any) => b.type === 'tool_result'),
  )
  const block = (firstResultMsg!.message.content as Block[]).find(
    (b: any) => b.type === 'tool_result',
  ) as Block
  const text = ((block.content as Block[])[0] as any).text
  expect(text).toMatch(/^\[Read args=.*→ 5000 chars omitted\]$/)
})

test('flat shape ({ role, content }) handled', () => {
  const messages = buildConversation(20, 5_000)
  const result = compressToolHistory(messages, 'gpt-4o')
  const resultMsgs = getResultMessages(result)

  expect(getResultText(resultMsgs[0])).toMatch(/^\[Read args=.*→ 5000 chars omitted\]$/)
})

// ---------- tier boundary correctness ----------

test('tier boundaries: 6 exchanges → 1 mid + 5 recent (recent=5)', () => {
  const messages = buildConversation(6, 5_000)
  const result = compressToolHistory(messages, 'gpt-4o')
  const resultMsgs = getResultMessages(result)

  // Oldest: mid (truncated)
  expect(getResultText(resultMsgs[0])).toContain('[…truncated')
  // Last 5: untouched
  for (let i = 1; i < 6; i++) {
    expect(getResultText(resultMsgs[i]).length).toBe(5_000)
  }
})

test('tier boundaries: 16 exchanges → 1 old + 10 mid + 5 recent', () => {
  const messages = buildConversation(16, 5_000)
  const result = compressToolHistory(messages, 'gpt-4o')
  const resultMsgs = getResultMessages(result)

  // Oldest 1: stub (old tier)
  expect(getResultText(resultMsgs[0])).toMatch(/^\[Read .*chars omitted\]$/)
  // Next 10: mid (truncated)
  for (let i = 1; i < 11; i++) {
    expect(getResultText(resultMsgs[i])).toContain('[…truncated')
  }
  // Last 5: untouched
  for (let i = 11; i < 16; i++) {
    expect(getResultText(resultMsgs[i]).length).toBe(5_000)
  }
})

test('large window (1M) with 30 exchanges: all untouched (recent=25 ≥ 30 - 5)', () => {
  // ≥500k → recent=25, mid=50. 30 exchanges → 5 mid + 25 recent. None old.
  mockState.effectiveWindow = 1_000_000
  const messages = buildConversation(30, 5_000)
  const result = compressToolHistory(messages, 'gpt-4.1')
  const resultMsgs = getResultMessages(result)

  // Last 25: untouched
  for (let i = 5; i < 30; i++) {
    expect(getResultText(resultMsgs[i]).length).toBe(5_000)
  }
})

// ---------- attribute preservation ----------

test('is_error flag preserved in mid tier', () => {
  const messages: Msg[] = [
    { role: 'user', content: 'start' },
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_err', name: 'Bash', input: {} }],
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_err',
          is_error: true,
          content: bigText(5_000),
        },
      ],
    },
    // Pad with enough recent exchanges to push the above into MID tier
    ...buildConversation(10, 100).slice(1),
  ]
  const result = compressToolHistory(messages, 'gpt-4o')
  const resultMsgs = getResultMessages(result)
  const block = getResultBlock(resultMsgs[0]) as { is_error?: boolean; content: unknown }

  expect(block.is_error).toBe(true)
  expect(getResultText(resultMsgs[0])).toContain('[…truncated')
})

test('is_error flag preserved in old tier (stub)', () => {
  const messages: Msg[] = [
    { role: 'user', content: 'start' },
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_err', name: 'Bash', input: {} }],
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_err',
          is_error: true,
          content: bigText(5_000),
        },
      ],
    },
    ...buildConversation(20, 100).slice(1),
  ]
  const result = compressToolHistory(messages, 'gpt-4o')
  const resultMsgs = getResultMessages(result)
  const block = getResultBlock(resultMsgs[0]) as { is_error?: boolean; content: unknown }

  expect(block.is_error).toBe(true)
  expect(getResultText(resultMsgs[0])).toMatch(/^\[Bash .*chars omitted\]$/)
})

// ---------- COMPACTABLE_TOOLS filter ----------

test('non-compactable tool (e.g. Task/Agent) is NEVER compressed', () => {
  // Build conversation where the OLDEST exchange uses a non-compactable tool name
  const messages: Msg[] = [
    { role: 'user', content: 'start' },
    {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'task_1', name: 'Task', input: { goal: 'plan' } },
      ],
    },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'task_1', content: bigText(5_000) },
      ],
    },
    // Pad with 20 compactable exchanges to push Task into old tier
    ...buildConversation(20, 100).slice(1),
  ]
  const result = compressToolHistory(messages, 'gpt-4o')
  const resultMsgs = getResultMessages(result)

  // First tool_result is for Task (non-compactable) → must remain full
  expect(getResultText(resultMsgs[0]).length).toBe(5_000)
  expect(getResultText(resultMsgs[0])).not.toContain('chars omitted')
  expect(getResultText(resultMsgs[0])).not.toContain('[…truncated')
})

test('mcp__ prefixed tools ARE compactable (matches microCompact behavior)', () => {
  const messages: Msg[] = [
    { role: 'user', content: 'start' },
    {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'mcp_1', name: 'mcp__github__get_issue', input: {} },
      ],
    },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'mcp_1', content: bigText(5_000) },
      ],
    },
    ...buildConversation(20, 100).slice(1),
  ]
  const result = compressToolHistory(messages, 'gpt-4o')
  const resultMsgs = getResultMessages(result)

  // MCP tool result is compressed (gets stub since it's in old tier)
  expect(getResultText(resultMsgs[0])).toMatch(/^\[mcp__github__get_issue .*chars omitted\]$/)
})

// ---------- skip already-cleared blocks ----------

test('blocks already cleared by microCompact are NOT re-compressed', () => {
  const messages: Msg[] = [
    { role: 'user', content: 'start' },
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'cleared_1', name: 'Read', input: {} }],
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'cleared_1',
          content: '[Old tool result content cleared]', // microCompact's marker
        },
      ],
    },
    ...buildConversation(20, 100).slice(1),
  ]
  const result = compressToolHistory(messages, 'gpt-4o')
  const resultMsgs = getResultMessages(result)

  // Already-cleared marker survives untouched (no double processing)
  expect(getResultText(resultMsgs[0])).toBe('[Old tool result content cleared]')
})

test('extra block attributes (e.g. cache_control) preserved across rewrites', () => {
  const cacheControl = { type: 'ephemeral' }
  const messages: Msg[] = [
    { role: 'user', content: 'start' },
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_cc', name: 'Read', input: {} }],
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_cc',
          cache_control: cacheControl,
          content: bigText(5_000),
        },
      ],
    },
    ...buildConversation(20, 100).slice(1),
  ]
  const result = compressToolHistory(messages, 'gpt-4o')
  const resultMsgs = getResultMessages(result)
  const block = getResultBlock(resultMsgs[0]) as { cache_control?: unknown }

  // The custom attribute survived the stub rewrite via ...block spread
  expect(block.cache_control).toEqual(cacheControl)
})
