import { describe, expect, it, beforeEach } from 'bun:test'
import {
  getTokenCountFromUsage,
  getTokenUsage,
  getCurrentUsage,
} from './tokens.js'
import { IncrementalTokenCounter } from './incrementalTokenCounter.js'
import type { AssistantMessage, Message } from '../types/message.js'

interface FakeUsage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

function makeAssistantMessage(usage: FakeUsage): AssistantMessage {
  return {
    type: 'assistant',
    uuid: 'test-uuid',
    timestamp: new Date().toISOString(),
    message: {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'test-model',
      content: [{ type: 'text', text: 'Hello' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: usage as any,
    },
  }
}

describe('getTokenUsage', () => {
  it('returns usage when tokens are non-zero', () => {
    const msg = makeAssistantMessage({
      input_tokens: 100,
      output_tokens: 50,
    })
    const result = getTokenUsage(msg)
    expect(result).toBeDefined()
    expect(result?.input_tokens).toBe(100)
    expect(result?.output_tokens).toBe(50)
  })

  it('returns undefined when both input and output tokens are zero', () => {
    // Providers that strip stream_options (e.g. MiMo, Gitlawb OpenGateway)
    // never include usage in streaming responses. The shim seeds the message
    // with {0, 0} and it never gets updated. We return undefined so the
    // status line shows N/A instead of a misleading "0% used".
    const msg = makeAssistantMessage({
      input_tokens: 0,
      output_tokens: 0,
    })
    expect(getTokenUsage(msg)).toBeUndefined()
  })

  it('returns usage when only input_tokens is non-zero', () => {
    const msg = makeAssistantMessage({
      input_tokens: 200,
      output_tokens: 0,
    })
    // input_tokens > 0 means real data (partial usage), keep it
    const result = getTokenUsage(msg)
    expect(result).toBeDefined()
    expect(result?.input_tokens).toBe(200)
  })

  it('returns usage when only output_tokens is non-zero', () => {
    const msg = makeAssistantMessage({
      input_tokens: 0,
      output_tokens: 25,
    })
    const result = getTokenUsage(msg)
    expect(result).toBeDefined()
    expect(result?.output_tokens).toBe(25)
  })
})

describe('getCurrentUsage', () => {
  function makeUserMessage(): Message {
    return {
      type: 'user',
      uuid: 'u-uuid',
      timestamp: new Date().toISOString(),
      message: { role: 'user', content: 'hello' },
    }
  }

  it('returns usage from the most recent assistant message with non-zero tokens', () => {
    const msg = makeAssistantMessage({ input_tokens: 300, output_tokens: 80 })
    const result = getCurrentUsage([makeUserMessage(), msg])
    expect(result?.input_tokens).toBe(300)
    expect(result?.output_tokens).toBe(80)
  })

  it('returns null when the most recent assistant message has all-zero usage', () => {
    // Pure 3P session: provider never reported usage, message stays at {0, 0}.
    const msg = makeAssistantMessage({ input_tokens: 0, output_tokens: 0 })
    expect(getCurrentUsage([makeUserMessage(), msg])).toBeNull()
  })

  it('returns null — does NOT fall back to older Anthropic message after a 3P turn', () => {
    // Mixed-session: user started on Anthropic (real usage), then switched to
    // MiMo (zero usage). getCurrentUsage must NOT surface the stale Anthropic numbers.
    const anthropicMsg = makeAssistantMessage({ input_tokens: 1000, output_tokens: 200 })
    const mimoMsg      = makeAssistantMessage({ input_tokens: 0, output_tokens: 0 })
    const messages: Message[] = [anthropicMsg, makeUserMessage(), mimoMsg]
    // Should stop at mimoMsg (all-zero real assistant message) and return null.
    expect(getCurrentUsage(messages)).toBeNull()
  })

  it('returns null when there are no assistant messages', () => {
    expect(getCurrentUsage([makeUserMessage()])).toBeNull()
  })
})

describe('tokens', () => {
})

describe('IncrementalTokenCounter', () => {
  it('uses cached count for same message length', () => {
    const counter = new IncrementalTokenCounter()
    
    counter.getCount([
      { type: 'user', message: { content: 'hello' } } as any,
    ])
    
    expect(counter.cachedCount).toBeGreaterThan(0)
  })

  it('increments for new messages', () => {
    const counter = new IncrementalTokenCounter()
    
    const count1 = counter.getCount([
      { type: 'user', message: { content: 'hello' } } as any,
    ])
    
    const count2 = counter.getCount([
      { type: 'user', message: { content: 'hello' } } as any,
      { type: 'user', message: { content: 'world' } } as any,
    ])
    
    expect(count2).toBeGreaterThan(count1)
  })

  it('resets correctly', () => {
    const counter = new IncrementalTokenCounter()
    
    counter.getCount([{ type: 'user', message: { content: 'hello' } } as any])
    counter.reset()
    
    expect(counter.cachedCount).toBe(0)
    expect(counter.messageCount).toBe(0)
  })
})